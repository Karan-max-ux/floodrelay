import express, { type Express, type Request, type Response, type NextFunction } from 'express';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { getPool } from './db/connection.js';
import { PostgisRepository } from './db/repository.js';
import { RequestService } from './services/requestService.js';
import { AssignmentService } from './services/assignmentService.js';
import { AuthService } from './services/authService.js';
import { OperationalEventService } from './services/operationalEventService.js';
import { AffectedScopeService } from './services/affectedScopeService.js';
import { RepairOrchestrationService } from './services/repairOrchestrationService.js';
import { IncrementalRepairSolverAdapter } from './services/incrementalRepairSolverAdapter.js';
import { createRequestsRouter } from './routes/requests.js';
import { createAssignmentsRouter } from './routes/assignments.js';
import { createAuthRouter } from './routes/auth.js';
import { createOperationsRouter } from './routes/operations.js';
import { createAuditRouter } from './routes/audit.js';
import { ForecastService } from './services/floodForecast/forecastService.js';
import { createForecastRouter } from './routes/forecast.js';
import { requireOperatorAuth } from './middleware/authMiddleware.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const openapiSpec = JSON.parse(readFileSync(join(__dirname, 'openapi.json'), 'utf-8'));

export interface AppDependencies {
  repository?: PostgisRepository;
  requestService?: RequestService;
  assignmentService?: AssignmentService;
  authService?: AuthService;
  operationalEventService?: OperationalEventService;
  affectedScopeService?: AffectedScopeService;
  repairOrchestrationService?: RepairOrchestrationService;
  forecastService?: ForecastService;
}

export function createApp(deps?: AppDependencies): Express {
  const app = express();

  // 1. Defense-in-depth security headers (prevent caching of sensitive disaster/operator data)
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    next();
  });

  // 2. Strict Whitelisted CORS and CSRF Origin Protection
  const defaultAllowedOrigins = [
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'http://localhost:3001',
    'http://127.0.0.1:3001',
  ];
  const configuredOrigins = (process.env.CORS_ORIGIN || process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const allowedOrigins = new Set([...defaultAllowedOrigins, ...configuredOrigins]);

  app.use((req: Request, res: Response, next: NextFunction) => {
    const origin = req.header('Origin');

    if (origin) {
      if (allowedOrigins.has(origin)) {
        res.header('Access-Control-Allow-Origin', origin);
        res.header('Access-Control-Allow-Credentials', 'true');
        res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
        res.header(
          'Access-Control-Allow-Headers',
          'Origin, X-Requested-With, Content-Type, Accept, Idempotency-Key, X-Idempotency-Key, Authorization, Cookie',
        );
      } else {
        // Block cross-origin state-changing mutations from untrusted origins (CSRF defense)
        if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
          res.status(403).json({
            error: {
              code: 'CSRF_BLOCKED',
              message: 'Cross-origin mutation blocked by CSRF origin verification policy',
              timestamp: new Date().toISOString(),
            },
          });
          return;
        }
      }
    }

    if (req.method === 'OPTIONS') {
      if (origin && !allowedOrigins.has(origin)) {
        res.status(403).end();
        return;
      }
      res.sendStatus(204);
      return;
    }
    next();
  });

  app.use(express.json({ limit: '100kb' }));

  const repo = deps?.repository ?? new PostgisRepository(getPool());
  const authService = deps?.authService ?? new AuthService(repo);
  const requestService = deps?.requestService ?? new RequestService(repo);
  const assignmentService = deps?.assignmentService ?? new AssignmentService(repo);
  const affectedScopeService = deps?.affectedScopeService ?? new AffectedScopeService(repo);
  const eventService =
    deps?.operationalEventService ?? new OperationalEventService(repo, affectedScopeService);
  const repairSolver = new IncrementalRepairSolverAdapter(repo);
  const repairService =
    deps?.repairOrchestrationService ?? new RepairOrchestrationService(repo, repairSolver);
  const forecastService = deps?.forecastService ?? new ForecastService();

  // Health check endpoint
  app.get('/health', (_req: Request, res: Response) => {
    res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // OpenAPI spec endpoint
  app.get('/openapi.json', (_req: Request, res: Response) => {
    res.status(200).json(openapiSpec);
  });

  // Mount API routers matching OpenAPI specification paths
  app.use('/auth', createAuthRouter(authService));
  app.use('/requests', createRequestsRouter(requestService, authService));
  app.use(
    '/assignments',
    requireOperatorAuth(authService),
    createAssignmentsRouter(assignmentService),
  );
  app.use(
    '/operations',
    requireOperatorAuth(authService),
    createOperationsRouter(repo, eventService, repairService),
  );
  app.use('/audit', requireOperatorAuth(authService), createAuditRouter(repo));
  app.use('/forecast', requireOperatorAuth(authService), createForecastRouter(forecastService));

  // 404 handler for undefined routes
  app.use((_req: Request, res: Response) => {
    res.status(404).json({
      error: {
        code: 'NOT_FOUND',
        message: 'Endpoint not found',
        timestamp: new Date().toISOString(),
      },
    });
  });

  // Global error handler
  app.use((err: Error, _req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent) {
      return next(err);
    }

    // Keep the original exception in server-side diagnostics.
    console.error('API Error:', err);

    // Never expose unexpected exception details to API clients.
    res.status(500).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'An unexpected internal server error occurred',
        timestamp: new Date().toISOString(),
      },
    });
  });

  return app;
}
