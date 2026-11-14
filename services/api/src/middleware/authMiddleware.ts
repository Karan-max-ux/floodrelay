import type { Request, Response, NextFunction } from 'express';
import type { AuthService } from '../services/authService.js';
import type { OperatorProfile } from '../db/schema.js';

// Extend Express Request type
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      operator?: OperatorProfile;
    }
  }
}

/**
 * Parses a standard Cookie HTTP header string into a key-value dictionary.
 */
export function parseCookies(cookieHeader?: string): Record<string, string> {
  if (!cookieHeader) return {};
  const cookies: Record<string, string> = {};
  const pairs = cookieHeader.split(';');
  for (const pair of pairs) {
    const idx = pair.indexOf('=');
    if (idx !== -1) {
      const key = pair.slice(0, idx).trim();
      const val = pair.slice(idx + 1).trim();
      try {
        cookies[key] = decodeURIComponent(val);
      } catch {
        cookies[key] = val;
      }
    }
  }
  return cookies;
}

/**
 * Extracts session token from Authorization header or HTTP-only cookie.
 */
export function extractSessionToken(req: Request): string | null {
  // 1. Authorization: Bearer <token>
  const authHeader = req.header('Authorization') || req.header('authorization');
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7).trim();
    if (token) return token;
  }

  // 2. Cookie: floodrelay_session=<token>
  const cookieHeader = req.header('Cookie') || req.header('cookie');
  if (cookieHeader) {
    const cookies = parseCookies(cookieHeader);
    if (cookies.floodrelay_session) {
      return cookies.floodrelay_session;
    }
  }

  return null;
}

/**
 * Express middleware requiring a valid, unexpired operator session.
 */
export function requireOperatorAuth(authService: AuthService) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const token = extractSessionToken(req);

      if (!token) {
        res.status(401).json({
          error: {
            code: 'UNAUTHORIZED',
            message: 'Operator authentication required to access this resource',
            timestamp: new Date().toISOString(),
          },
        });
        return;
      }

      const operator = await authService.validateSession(token);

      if (!operator) {
        res.status(401).json({
          error: {
            code: 'SESSION_EXPIRED',
            message: 'Session is invalid or has expired. Please log in again.',
            timestamp: new Date().toISOString(),
          },
        });
        return;
      }

      req.operator = operator;
      next();
    } catch (err) {
      const errMsg = (err as Error)?.message || '';
      const errCode = (err as { code?: string })?.code;
      const isConnError =
        errCode === 'ECONNREFUSED' ||
        errCode === '57P01' ||
        errCode === '57P02' ||
        errCode === '57P03' ||
        /connect ECONNREFUSED|connection refused|timeout/i.test(errMsg);

      if (isConnError) {
        console.error(
          '[Auth Diagnostic] Database connection unavailable during session validation:',
          err,
        );
        res.status(503).json({
          error: {
            code: 'DATABASE_UNAVAILABLE',
            message:
              'Authentication service is temporarily unavailable due to database connectivity issues.',
            timestamp: new Date().toISOString(),
          },
        });
        return;
      }

      next(err);
    }
  };
}
