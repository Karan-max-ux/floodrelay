import { Router, type Request, type Response, type NextFunction } from 'express';
import { CreateRequestSchema, ListRequestsFilterSchema } from '../validation/requestSchema.js';
import type { RequestService } from '../services/requestService.js';

export function createRequestsRouter(requestService: RequestService): Router {
  const router = Router();

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
        if (code && statusCode) {
          res.status(statusCode).json({
            error: {
              code,
              message: (domainErr as Error).message,
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

  // GET /requests - List rescue requests
  router.get('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
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
  });

  // GET /requests/:id - Retrieve specific rescue request by ID
  router.get('/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
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
  });

  return router;
}
