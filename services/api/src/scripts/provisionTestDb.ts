import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

export const STRICT_ALLOWED_TEST_HOSTS = new Set(['localhost', '127.0.0.1', '::1', 'postgres']);

export const STRICT_ALLOWED_TEST_DB_NAME = 'floodrelay_test';

export async function provisionDisposableTestMarker(pool: pg.Pool): Promise<void> {
  const client = await pool.connect();
  try {
    const res = await client.query<{ db_name: string; db_user: string }>(`
      SELECT current_database() AS db_name, current_user AS db_user;
    `);

    const dbName = String(res.rows[0]?.db_name || '')
      .trim()
      .toLowerCase();
    const dbUser = String(res.rows[0]?.db_user || '')
      .trim()
      .toLowerCase();

    const expectedDbName = STRICT_ALLOWED_TEST_DB_NAME;

    if (dbName !== expectedDbName) {
      throw new Error(
        `REFUSING_TO_PROVISION_NON_TEST_DB: Connected database "${dbName}" is not the dedicated disposable test database "${expectedDbName}". ` +
          'Test markers can only be provisioned on dedicated disposable test databases.',
      );
    }

    // Provision the metadata table and marker record
    await client.query(`
      CREATE TABLE IF NOT EXISTS test_environment_metadata (
        marker_key VARCHAR(64) PRIMARY KEY,
        marker_value VARCHAR(128) NOT NULL,
        is_disposable BOOLEAN NOT NULL DEFAULT TRUE,
        database_name VARCHAR(64) NOT NULL,
        provisioned_by VARCHAR(64) NOT NULL DEFAULT 'SYSTEM',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await client.query(
      `
      INSERT INTO test_environment_metadata (marker_key, marker_value, is_disposable, database_name, provisioned_by)
      VALUES ('DISPOSABLE_TEST_ENVIRONMENT', 'FLOODRELAY_VERIFIED_TEST_DB', TRUE, $1, $2)
      ON CONFLICT (marker_key) DO UPDATE SET 
        marker_value = 'FLOODRELAY_VERIFIED_TEST_DB',
        is_disposable = TRUE,
        database_name = $1,
        provisioned_by = $2,
        created_at = NOW();
    `,
      [dbName, dbUser],
    );

    console.log(
      `[Test DB Provision] Successfully provisioned disposable test database marker in database "${dbName}" for role "${dbUser}".`,
    );

    // Also provision demo environment metadata marker on the verified disposable test database
    await client.query(`
      CREATE TABLE IF NOT EXISTS demo_environment_metadata (
        marker_key VARCHAR(64) PRIMARY KEY,
        marker_value VARCHAR(128) NOT NULL,
        is_disposable BOOLEAN NOT NULL DEFAULT TRUE,
        database_name VARCHAR(64) NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await client.query(
      `
      INSERT INTO demo_environment_metadata (marker_key, marker_value, is_disposable, database_name)
      VALUES ('DISPOSABLE_DEMO_ENVIRONMENT', 'FLOODRELAY_VERIFIED_DEMO_DB', TRUE, $1)
      ON CONFLICT (marker_key) DO UPDATE SET 
        marker_value = 'FLOODRELAY_VERIFIED_DEMO_DB',
        is_disposable = TRUE,
        database_name = $1,
        created_at = NOW();
    `,
      [dbName],
    );

    console.log(
      `[Demo DB Provision] Successfully provisioned disposable demo database marker in database "${dbName}".`,
    );
  } finally {
    client.release();
  }
}

async function main() {
  const connStr =
    process.env.DATABASE_URL ||
    'postgres://floodrelay:floodrelay_dev@localhost:5432/floodrelay_test';

  let parsedHost: string | null = null;
  try {
    const u = new URL(connStr);
    parsedHost = u.hostname.trim().toLowerCase();
  } catch {
    // Non-URL format
  }

  if (parsedHost && !STRICT_ALLOWED_TEST_HOSTS.has(parsedHost)) {
    throw new Error(
      `UNAPPROVED_TEST_HOST: Host "${parsedHost}" is not in the test host allowlist.`,
    );
  }

  const pool = new pg.Pool({ connectionString: connStr });
  try {
    await provisionDisposableTestMarker(pool);
  } finally {
    await pool.end();
  }
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error('[Test DB Provision Error]', msg);
  process.exit(1);
});
