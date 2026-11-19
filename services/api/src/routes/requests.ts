import { Router, type Request, type Response, type NextFunction } from 'express';
import {
  CreateRequestSchema,
  ListRequestsFilterSchema,
  ServiceAreaCheckSchema,
} from '../validation/requestSchema.js';
import type { RequestService } from '../services/requestService.js';
import type { AuthService } from '../services/authService.js';
import { requireOperatorAuth } from '../middleware/authMiddleware.js';

export function createRequestsRouter(
  requestService: RequestService,
  authService?: AuthService,
): Router {
  const router = Router();
  const authGuard = authService
    ? requireOperatorAuth(authService)
    : (_req: Request, _res: Response, next: NextFunction) => next();

  // POST /requests/service-area-check - Verify whether exact coordinates lie inside supported Delhi NCR coverage
  router.post(
    '/service-area-check',
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const parsed = ServiceAreaCheckSchema.safeParse(req.body);
        if (!parsed.success) {
          res.status(400).json({
            error: {
              code: 'VALIDATION_ERROR',
              message: 'Valid finite latitude (-90 to 90) and longitude (-180 to 180) are required',
              details: parsed.error.format(),
              timestamp: new Date().toISOString(),
            },
          });
          return;
        }

        try {
          const check = await requestService.checkServiceArea(
            parsed.data.lat,
            parsed.data.lng,
            parsed.data.accuracy,
          );
          res.status(200).json({
            success: true,
            data: check,
          });
        } catch (domainErr: unknown) {
          const code = (domainErr as { code?: string }).code;
          const statusCode = (domainErr as { statusCode?: number }).statusCode;
          const details = (domainErr as { details?: unknown }).details;
          if (code && statusCode) {
            res.status(statusCode).json({
              error: {
                code,
                message: (domainErr as Error).message,
                ...(details !== undefined ? { details } : {}),
                timestamp: new Date().toISOString(),
              },
            });
            return;
          }
          throw domainErr;
        }
      } catch (err) {
        next(err);
      }
    },
  );

  // POST /requests - Submit new rescue request with idempotency & duplicate detection
  router.post('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const headerIdempotencyKey = (
        req.header('Idempotency-Key') || req.header('X-Idempotency-Key')
      )?.trim();
      const payload = {
        ...req.body,
        idempotencyKey: req.body?.idempotencyKey || headerIdempotencyKey || undefined,
      };

      const parsed = CreateRequestSchema.safeParse(payload);
      if (!parsed.success) {
        res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid rescue request payload',
            details: parsed.error.format(),
            timestamp: new Date().toISOString(),
          },
        });
        return;
      }

      let result;
      try {
        result = await requestService.submitRequest(parsed.data);
      } catch (domainErr: unknown) {
        const code = (domainErr as { code?: string }).code;
        const statusCode = (domainErr as { statusCode?: number }).statusCode;
        const details = (domainErr as { details?: unknown }).details;
        if (code && statusCode) {
          res.status(statusCode).json({
            error: {
              code,
              message: (domainErr as Error).message,
              ...(details !== undefined ? { details } : {}),
              timestamp: new Date().toISOString(),
            },
          });
          return;
        }
        throw domainErr;
      }

      if (result.idempotent) {
        res.status(200).json({
          success: true,
          idempotent: true,
          data: {
            ...result.request,
            verificationStatus: result.request.verificationStatus ?? 'UNVERIFIED',
            isFlaggedDuplicate: false,
            duplicateOfId: null,
          },
        });
        return;
      }

      res.status(201).json({
        success: true,
        idempotent: false,
        data: {
          ...result.request,
          verificationStatus: result.request.verificationStatus ?? 'UNVERIFIED',
          isFlaggedDuplicate: result.isFlaggedDuplicate,
          duplicateOfId: result.duplicateOfId,
        },
      });
    } catch (err) {
      next(err);
    }
  });

  // GET /requests - List rescue requests (Operator Auth Required)
  router.get(
    '/',
    authGuard,
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const parsed = ListRequestsFilterSchema.safeParse(req.query);
        if (!parsed.success) {
          res.status(400).json({
            error: {
              code: 'VALIDATION_ERROR',
              message: 'Invalid query filters',
              details: parsed.error.format(),
              timestamp: new Date().toISOString(),
            },
          });
          return;
        }

        const requests = await requestService.listRequests(parsed.data);
        res.status(200).json({
          success: true,
          count: requests.length,
          data: requests,
        });
      } catch (err) {
        next(err);
      }
    },
  );

  // GET /requests/:id - Retrieve specific rescue request by ID (Operator Auth Required)
  router.get(
    '/:id',
    authGuard,
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const rawId = req.params.id;
        const id = Array.isArray(rawId) ? rawId[0] : rawId;
        if (!id) {
          res.status(400).json({
            error: {
              code: 'VALIDATION_ERROR',
              message: 'Request ID parameter is required',
              timestamp: new Date().toISOString(),
            },
          });
          return;
        }

        const request = await requestService.getRequest(id);
        if (!request) {
          res.status(404).json({
            error: {
              code: 'NOT_FOUND',
              message: `Rescue request with id "${id}" not found`,
              timestamp: new Date().toISOString(),
            },
          });
          return;
        }

        res.status(200).json({
          success: true,
          data: request,
        });
      } catch (err) {
        next(err);
      }
    },
  );

  // POST /requests/:id/cancel - Cancel rescue request (Preserves committed missions)
  // Authorization: requires either a valid operator session OR the original idempotency key
  // as proof of ownership. A request ID alone is not sufficient authorization.
  router.post(
    '/:id/cancel',
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const rawId = req.params.id;
        const id = Array.isArray(rawId) ? rawId[0] : rawId;
        if (!id) {
          res.status(400).json({
            error: {
              code: 'VALIDATION_ERROR',
              message: 'Request ID parameter is required',
              timestamp: new Date().toISOString(),
            },
          });
          return;
        }

        // Attempt to populate req.operator from session token (non-blocking)
        if (!req.operator && authService) {
          const { extractSessionToken } = await import('../middleware/authMiddleware.js');
          const token = extractSessionToken(req);
          if (token) {
            const profile = await authService.validateSession(token);
            if (profile) {
              req.operator = profile;
            }
          }
        }

        const operator = req.operator;

        if (operator) {
          const { hasPermission } = await import('../middleware/rbacMiddleware.js');
          if (!hasPermission(operator.role, 'CANCEL_REQUEST')) {
            res.status(403).json({
              error: {
                code: 'FORBIDDEN',
                message: `Access denied: role "${operator.role}" does not have "CANCEL_REQUEST" permission`,
                timestamp: new Date().toISOString(),
              },
            });
            return;
          }
        } else {
          // Citizens must prove ownership via their original idempotency key
          const citizenIdempotencyKey =
            typeof req.body?.idempotencyKey === 'string' ? req.body.idempotencyKey.trim() : null;

          if (!citizenIdempotencyKey) {
            res.status(401).json({
              error: {
                code: 'UNAUTHORIZED',
                message:
                  'Cancellation requires either operator authentication or the original idempotencyKey as proof of ownership',
                timestamp: new Date().toISOString(),
              },
            });
            return;
          }

          // Verify that the idempotency key matches the request being cancelled
          const existingRequest = await requestService.getRequest(id);
          if (
            !existingRequest ||
            !existingRequest.idempotencyKey ||
            existingRequest.idempotencyKey !== citizenIdempotencyKey
          ) {
            res.status(403).json({
              error: {
                code: 'FORBIDDEN',
                message: 'Provided idempotencyKey does not match this rescue request',
                timestamp: new Date().toISOString(),
              },
            });
            return;
          }
        }

        const reason = typeof req.body?.reason === 'string' ? req.body.reason : undefined;

        try {
          const cancelled = await requestService.cancelRequest(id, {
            actorId: operator?.username ?? null,
            actorType: operator ? 'OPERATOR' : 'CITIZEN',
            reason,
          });

          res.status(200).json({
            success: true,
            message: 'Rescue request cancelled successfully',
            data: cancelled,
          });
        } catch (domainErr: unknown) {
          const code = (domainErr as { code?: string }).code;
          const statusCode = (domainErr as { statusCode?: number }).statusCode;
          const details = (domainErr as { details?: unknown }).details;
          if (code && statusCode) {
            res.status(statusCode).json({
              error: {
                code,
                message: (domainErr as Error).message,
                ...(details !== undefined ? { details } : {}),
                timestamp: new Date().toISOString(),
              },
            });
            return;
          }
          throw domainErr;
        }
      } catch (err) {
        next(err);
      }
    },
  );

  return router;
}
