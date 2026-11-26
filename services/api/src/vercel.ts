import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import { createApp } from './app.js';
import { getPool } from './db/connection.js';
import { PostgisRepository } from './db/repository.js';
import { AuthService } from './services/authService.js';
import { ServiceAreaService } from './services/serviceAreaService.js';

export interface VercelAppDependencies {
  repository?: PostgisRepository;
  authService?: AuthService;
  serviceAreaService?: ServiceAreaService;
}

/**
 * Creates the Vercel-compatible serverless Express application without calling
 * app.listen(), closing the database pool, running migrations, or registering
 * process shutdown handlers.
 */
export function createVercelApp(deps?: VercelAppDependencies): Express {
  const repo = deps?.repository ?? new PostgisRepository(getPool());
  const authService = deps?.authService ?? new AuthService(repo);
  const serviceAreaService = deps?.serviceAreaService ?? new ServiceAreaService(repo);

  const innerApp = createApp({ repository: repo, authService });
  const app = express();

  let startupPromise: Promise<void> | null = null;

  const runStartupChecks = async (): Promise<void> => {
    // 1. Ensure initial operator account exists and perform startup readiness check
    try {
      await authService.ensureInitialOperator();
      console.log('[Startup] Database reachable and operator account initialized/verified.');
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      const errCode = (err as { code?: string })?.code;

      if (errCode === 'ECONNREFUSED' || /connect ECONNREFUSED/i.test(errMsg)) {
        console.error(
          '[Startup Diagnostic] PostgreSQL database is not reachable. Ensure DATABASE_URL points to a reachable PostgreSQL/PostGIS instance.',
        );
      } else if (errCode === '42P01' || /relation ".*" does not exist/i.test(errMsg)) {
        console.error(
          '[Startup Diagnostic] Database schema is missing required tables. Please run database migrations before starting the API.',
        );
      } else if (/\[Security Violation\]/i.test(errMsg)) {
        console.error('[Startup Security Error] Operator initialization rejected:', errMsg);
      } else {
        console.error('[Startup Warning] Operator account initialization failed:', errMsg);
      }

      if (
        process.env.NODE_ENV === 'production' &&
        (/\[Security Violation\]/i.test(errMsg) || process.env.REQUIRE_DB === '1')
      ) {
        throw err;
      }
    }

    // 2. Perform active PostGIS boundary integrity attestation against canonical Delhi NCR GeoJSON
    try {
      const attestation = await serviceAreaService.attestActiveBoundaryIntegrity();
      console.log(
        `[Startup] Active PostGIS boundary attested (region: ${attestation.regionId}, version: ${attestation.boundaryVersion}, area: ${attestation.areaSqKm.toFixed(1)} sq km, wkb_hash: ${attestation.geometryWkbHash.slice(0, 12)}...).`,
      );
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error('[Startup Error] Active PostGIS boundary attestation failed:', errMsg);
      if (process.env.REQUIRE_DB === '1' || process.env.NODE_ENV === 'production') {
        throw err;
      }
    }
  };

  const ensureStarted = (): Promise<void> => {
    if (!startupPromise) {
      startupPromise = runStartupChecks().catch((err: unknown) => {
        // Clear failed promise so subsequent invocations on a warm instance can retry
        startupPromise = null;
        throw err;
      });
    }
    return startupPromise;
  };

  app.use(async (_req: Request, res: Response, next: NextFunction) => {
    try {
      await ensureStarted();
      next();
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      const isSecurityViolation = /\[Security Violation\]/i.test(errMsg);
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
      res.status(isSecurityViolation ? 500 : 503).json({
        error: {
          code: isSecurityViolation ? 'STARTUP_SECURITY_ERROR' : 'SERVICE_UNAVAILABLE',
          message: isSecurityViolation
            ? 'Server startup security check failed'
            : 'Service startup checks failed; database or boundary attestation unavailable',
          timestamp: new Date().toISOString(),
        },
      });
    }
  });

  app.use(innerApp);
  return app;
}

const app = createVercelApp();

export default app;
