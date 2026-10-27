import express, { type Express, type Request, type Response, type NextFunction } from 'express';
import { getPool } from './db/connection.js';
import { PostgisRepository } from './db/repository.js';
import { RequestService } from './services/requestService.js';
import { createRequestsRouter } from './routes/requests.js';

export interface AppDependencies {
  repository?: PostgisRepository;
  requestService?: RequestService;
}

export function createApp(deps?: AppDependencies): Express {
  const app = express();

  app.use(express.json());

  const repo = deps?.repository ?? new PostgisRepository(getPool());
  const requestService = deps?.requestService ?? new RequestService(repo);

  // Health check endpoint
  app.get('/health', (_req: Request, res: Response) => {
    res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // Mount requests API
  app.use('/requests', createRequestsRouter(requestService));

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
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error('API Error:', err);
    res.status(500).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: err.message || 'An unexpected internal server error occurred',
        timestamp: new Date().toISOString(),
      },
    });
  });

  return app;
}
