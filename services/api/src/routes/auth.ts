import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { type AuthService, AuthError } from '../services/authService.js';
import { requireOperatorAuth, extractSessionToken } from '../middleware/authMiddleware.js';

const LoginSchema = z.object({
  username: z.string().min(1, 'Username is required'),
  password: z.string().min(1, 'Password is required'),
});

export function createAuthRouter(authService: AuthService): Router {
  const router = Router();

  // POST /login - Authenticate operator and issue session
  router.post('/login', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsed = LoginSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid credentials payload',
            details: parsed.error.format(),
            timestamp: new Date().toISOString(),
          },
        });
        return;
      }

      const clientIp = req.ip || req.socket.remoteAddress || 'unknown';

      let result;
      try {
        result = await authService.authenticate(
          parsed.data.username,
          parsed.data.password,
          clientIp,
        );
      } catch (err) {
        if (err instanceof AuthError) {
          res.status(err.statusCode).json({
            error: {
              code: err.code,
              message: err.message,
              timestamp: new Date().toISOString(),
            },
          });
          return;
        }

        const errMsg = (err as Error)?.message || '';
        const errCode = (err as { code?: string })?.code;

        // Check for PostgreSQL connectivity failures
        const isConnError =
          errCode === 'ECONNREFUSED' ||
          errCode === '57P01' ||
          errCode === '57P02' ||
          errCode === '57P03' ||
          /connect ECONNREFUSED|connection refused|timeout/i.test(errMsg);

        // Check for missing database tables/migrations
        const isSchemaError = errCode === '42P01' || /relation ".*" does not exist/i.test(errMsg);

        if (isConnError) {
          console.error(
            '[Auth Diagnostic] Database connection unavailable during operator login:',
            err,
          );
          res.status(503).json({
            error: {
              code: 'DATABASE_UNAVAILABLE',
              message:
                'Database is currently unavailable. Please verify PostgreSQL is running and reachable.',
              timestamp: new Date().toISOString(),
            },
          });
          return;
        }

        if (isSchemaError) {
          console.error(
            '[Auth Diagnostic] Database schema error during operator login: missing operators or operator_sessions table. Run database migrations (`npm run migrate`).',
            err,
          );
          res.status(503).json({
            error: {
              code: 'SCHEMA_ERROR',
              message:
                'Authentication schema is not initialized. Please ensure database migrations have run.',
              timestamp: new Date().toISOString(),
            },
          });
          return;
        }

        console.error('[Auth Diagnostic] Unexpected error during operator authentication:', err);
        res.status(500).json({
          error: {
            code: 'INTERNAL_ERROR',
            message: 'An unexpected internal server error occurred',
            timestamp: new Date().toISOString(),
          },
        });
        return;
      }

      const isProd = process.env.NODE_ENV === 'production';
      const isSecure = isProd || req.secure || req.header('x-forwarded-proto') === 'https';

      res.cookie('floodrelay_session', result.token, {
        httpOnly: true,
        secure: isSecure,
        sameSite: 'lax',
        path: '/',
        maxAge: 8 * 3600 * 1000,
      });

      res.status(200).json({
        success: true,
        data: {
          token: result.token,
          operator: result.operator,
          expiresAt: result.expiresAt.toISOString(),
        },
      });
    } catch (err) {
      next(err);
    }
  });

  // POST /logout - Revoke operator session
  router.post('/logout', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const token = extractSessionToken(req);
      if (token) {
        await authService.invalidateSession(token);
      }

      res.clearCookie('floodrelay_session', { path: '/' });

      res.status(200).json({
        success: true,
        message: 'Logged out successfully',
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      next(err);
    }
  });

  // GET /me - Return currently authenticated operator profile
  router.get('/me', requireOperatorAuth(authService), (req: Request, res: Response): void => {
    res.status(200).json({
      success: true,
      data: {
        operator: req.operator,
      },
    });
  });

  return router;
}
