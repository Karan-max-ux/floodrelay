import express, { type Express, type Request, type Response, type NextFunction } from 'express';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { getPool } from './db/connection.js';
import { PostgisRepository } from './db/repository.js';
import { RequestService } from './services/requestService.js';
import { AssignmentService } from './services/assignmentService.js';
import { createRequestsRouter } from './routes/requests.js';
import { createAssignmentsRouter } from './routes/assignments.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const openapiSpec = JSON.parse(readFileSync(join(__dirname, 'openapi.json'), 'utf-8'));

export interface AppDependencies {
  repository?: PostgisRepository;
  requestService?: RequestService;
  assignmentService?: AssignmentService;
}

export function createApp(deps?: AppDependencies): Express {
  const app = express();

  app.use(express.json({ limit: '100kb' }));

  const repo = deps?.repository ?? new PostgisRepository(getPool());
  const requestService = deps?.requestService ?? new RequestService(repo);
  const assignmentService = deps?.assignmentService ?? new AssignmentService(repo);

  // Health check endpoint
  app.get('/health', (_req: Request, res: Response) => {
    res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // OpenAPI spec endpoint
  app.get('/openapi.json', (_req: Request, res: Response) => {
    res.status(200).json(openapiSpec);
  });

  // Mount API routers
  app.use('/requests', createRequestsRouter(requestService));
  app.use('/assignments', createAssignmentsRouter(assignmentService));

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
