import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

const DEFAULT_VERCEL_POOL_MAX = 3;

export function resolvePoolMax(): number | undefined {
  const rawMax = process.env.PG_POOL_MAX?.trim();
  if (rawMax) {
    if (/^\d+$/.test(rawMax)) {
      const parsed = Number.parseInt(rawMax, 10);
      if (Number.isFinite(parsed) && parsed > 0) {
        return parsed;
      }
    }
    console.warn(
      `[db/connection] Ignoring invalid PG_POOL_MAX "${rawMax}"; using default pool size.`,
    );
  }

  if (process.env.VERCEL === '1' || process.env.VERCEL === 'true') {
    return DEFAULT_VERCEL_POOL_MAX;
  }

  return undefined;
}

export function getDatabaseConfig(): pg.PoolConfig {
  const max = resolvePoolMax();
  const poolSizeConfig = max !== undefined ? { max } : {};

  const isTestEnv = process.env.NODE_ENV === 'test' || Boolean(process.env.VITEST);
  if (isTestEnv && process.env.TEST_DATABASE_URL) {
    return {
      connectionString: process.env.TEST_DATABASE_URL,
      ...poolSizeConfig,
    };
  }

  if (process.env.DATABASE_URL) {
    return {
      connectionString: process.env.DATABASE_URL,
      ...poolSizeConfig,
    };
  }

  return {
    user: process.env.POSTGRES_USER || 'floodrelay',
    password: process.env.POSTGRES_PASSWORD || 'floodrelay_dev',
    database: process.env.POSTGRES_DB || 'floodrelay',
    host: process.env.POSTGRES_HOST || 'localhost',
    port: parseInt(process.env.POSTGRES_PORT || '5432', 10),
    ...poolSizeConfig,
  };
}

let poolInstance: pg.Pool | null = null;

export function getPool(): pg.Pool {
  if (!poolInstance) {
    poolInstance = new Pool(getDatabaseConfig());
  }
  return poolInstance;
}

export async function closePool(): Promise<void> {
  if (poolInstance) {
    await poolInstance.end();
    poolInstance = null;
  }
}

export async function checkDatabaseConnection(): Promise<boolean> {
  const pool = getPool();
  try {
    const client = await pool.connect();
    try {
      await client.query('SELECT 1');
      return true;
    } finally {
      client.release();
    }
  } catch {
    return false;
  }
}
