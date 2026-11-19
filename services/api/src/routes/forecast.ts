import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import type { ForecastService } from '../services/floodForecast/forecastService.js';
import { requirePermission } from '../middleware/rbacMiddleware.js';

export const ForecastQuerySchema = z.object({
  lat: z.coerce.number().min(-90).max(90).optional(),
  lng: z.coerce.number().min(-180).max(180).optional(),
  days: z.coerce.number().int().min(1).max(14).optional(),
  forceRefresh: z
    .enum(['true', 'false'])
    .optional()
    .transform((val) => val === 'true'),
});

export function createForecastRouter(forecastService: ForecastService): Router {
  const router = Router();

  // GET /forecast/context - Inspect hydrological flood forecast context (RBAC: VIEW_FORECAST)
  router.get(
    '/context',
    requirePermission('VIEW_FORECAST'),
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const parsed = ForecastQuerySchema.safeParse(req.query);
        if (!parsed.success) {
          res.status(400).json({
            error: {
              code: 'VALIDATION_ERROR',
              message: 'Invalid coordinates or forecast parameters',
              details: parsed.error.format(),
              timestamp: new Date().toISOString(),
            },
          });
          return;
        }

        const context = await forecastService.getForecastContext(parsed.data);
        res.status(200).json({
          success: true,
          data: context,
          timestamp: new Date().toISOString(),
        });
      } catch (err) {
        next(err);
      }
    },
  );

  return router;
}
