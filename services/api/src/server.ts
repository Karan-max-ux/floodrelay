import { createApp } from './app.js';
import { getPool } from './db/connection.js';
import { PostgisRepository } from './db/repository.js';
import { AuthService } from './services/authService.js';

const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
const pool = getPool();
const repo = new PostgisRepository(pool);
const authService = new AuthService(repo);

// Ensure initial operator account exists and perform startup readiness check
try {
  await authService.ensureInitialOperator();
  console.log('[Startup] Database reachable and operator account initialized/verified.');
} catch (err: unknown) {
  const errMsg = err instanceof Error ? err.message : String(err);
  const errCode = (err as { code?: string })?.code;

  if (errCode === 'ECONNREFUSED' || /connect ECONNREFUSED/i.test(errMsg)) {
    console.error(
      '[Startup Diagnostic] PostgreSQL database is not reachable. Ensure the database container or service is running on the configured host and port.',
    );
  } else if (errCode === '42P01' || /relation ".*" does not exist/i.test(errMsg)) {
    console.error(
      '[Startup Diagnostic] Database schema is missing required tables. Please run database migrations (`npm run migrate`).',
    );
  } else {
    console.error('[Startup Warning] Operator account initialization failed:', errMsg);
  }

  // In production with strict database requirements, abort startup if database is unreachable
  if (process.env.REQUIRE_DB === '1' && process.env.NODE_ENV === 'production') {
    console.error(
      '[Startup Fatal] REQUIRE_DB is set in production but database is not ready. Exiting.',
    );
    process.exit(1);
  }
}

const app = createApp({ repository: repo, authService });

const server = app.listen(port, () => {
  console.log(`FloodRelay API server listening on http://localhost:${port}`);
});

const shutdown = async () => {
  console.log('Shutting down API server...');
  server.close(async () => {
    try {
      await pool.end();
      console.log('Database pool closed');
    } catch {
      // ignore
    }
    process.exit(0);
  });
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
