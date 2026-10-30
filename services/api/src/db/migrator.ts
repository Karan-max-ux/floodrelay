import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type pg from 'pg';
import { getPool, closePool } from './connection.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function getMigrationsDir(): string {
  // Try relative to monorepo root: infra/migrations
  const candidateRoot = path.resolve(__dirname, '../../../../infra/migrations');
  if (fs.existsSync(candidateRoot)) {
    return candidateRoot;
  }
  // Fallback relative to services/api
  const candidateLocal = path.resolve(__dirname, '../../../infra/migrations');
  if (fs.existsSync(candidateLocal)) {
    return candidateLocal;
  }
  return path.resolve(process.cwd(), 'infra/migrations');
}

export async function ensureMigrationTable(client: pg.PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version VARCHAR(64) PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

export async function getAppliedMigrations(client: pg.PoolClient): Promise<Set<string>> {
  await ensureMigrationTable(client);
  const result = await client.query<{ version: string }>(
    'SELECT version FROM schema_migrations ORDER BY version ASC',
  );
  return new Set(result.rows.map((r) => r.version));
}

export async function runMigrationsUp(pool: pg.Pool): Promise<string[]> {
  const migrationsDir = getMigrationsDir();
  if (!fs.existsSync(migrationsDir)) {
    throw new Error(`Migrations directory not found: ${migrationsDir}`);
  }

  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql') && !f.endsWith('.down.sql'))
    .sort();

  const client = await pool.connect();
  const appliedList: string[] = [];

  try {
    const applied = await getAppliedMigrations(client);

    for (const file of files) {
      const version = file.replace(/\.sql$/, '');
      if (applied.has(version)) {
        continue;
      }

      const filePath = path.join(migrationsDir, file);
      const sql = fs.readFileSync(filePath, 'utf-8');

      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query(
          'INSERT INTO schema_migrations (version, applied_at) VALUES ($1, NOW())',
          [version],
        );
        await client.query('COMMIT');
        appliedList.push(version);
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${file} failed: ${(err as Error).message}`, {
          cause: err,
        });
      }
    }
  } finally {
    client.release();
  }

  return appliedList;
}

export async function runMigrationsDown(pool: pg.Pool): Promise<string[]> {
  const migrationsDir = getMigrationsDir();
  const client = await pool.connect();
  const revertedList: string[] = [];

  try {
    const applied = await getAppliedMigrations(client);
    const files = fs
      .readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.down.sql'))
      .sort()
      .reverse();

    for (const file of files) {
      const version = file.replace(/\.down\.sql$/, '');
      if (!applied.has(version)) {
        continue;
      }

      const filePath = path.join(migrationsDir, file);
      const sql = fs.readFileSync(filePath, 'utf-8');

      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('DELETE FROM schema_migrations WHERE version = $1', [version]);
        await client.query('COMMIT');
        revertedList.push(version);
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`Down migration ${file} failed: ${(err as Error).message}`, {
          cause: err,
        });
      }
    }
  } finally {
    client.release();
  }

  return revertedList;
}

// CLI entry point
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const mode = process.argv[2] === 'down' ? 'down' : 'up';
  const pool = getPool();

  (async () => {
    try {
      if (mode === 'down') {
        const reverted = await runMigrationsDown(pool);
        console.log(`Reverted ${reverted.length} migrations:`, reverted);
      } else {
        const applied = await runMigrationsUp(pool);
        console.log(`Applied ${applied.length} migrations:`, applied);
      }
    } catch (err) {
      console.error('Migration error:', err);
      process.exitCode = 1;
    } finally {
      await closePool();
    }
  })();
}
