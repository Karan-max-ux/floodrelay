import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  getPool,
  closePool,
  runMigrationsUp,
  PostgisRepository,
  AuthService,
} from '@floodrelay/api';
import { assertDisposableDemoDatabase, DEMO_OPERATOR_OWNERSHIP_TABLE } from './demoDbGuard.js';
import { runDemoSetup } from './setupDemo.js';
import { runDemoCleanup } from './cleanupDemo.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const credPath = path.resolve(__dirname, '../../.demo-credentials.local.json');

const requireDb = Boolean(
  process.env.REQUIRE_DB && process.env.REQUIRE_DB !== '0' && process.env.REQUIRE_DB !== 'false',
);
const hasAllowFlag = Boolean(
  process.env.ALLOW_DISPOSABLE_DEMO_DB === '1' ||
  process.env.ALLOW_DISPOSABLE_DEMO_DB === 'true' ||
  process.env.ALLOW_DISPOSABLE_REPAIR_TEST_DB === '1' ||
  process.env.ALLOW_DISPOSABLE_REPAIR_TEST_DB === 'true',
);
const shouldRun = requireDb && hasAllowFlag;

describe.runIf(shouldRun)('Real Demo CLI Execution & PostGIS Lifecycle Suite', () => {
  const sentinelUsername = 'unrelated_sentinel_operator';
  const sentinelPassword = 'SentinelSecurePassword2026!';
  const sentinelRequestId = 'req-sentinel-unrelated-999';
  const originalDemoAuth = process.env.ALLOW_DISPOSABLE_DEMO_DB;

  beforeAll(async () => {
    // 1. Scope ALLOW_DISPOSABLE_DEMO_DB=1 strictly to this verified disposable demo integration execution
    if (
      !process.env.ALLOW_DISPOSABLE_DEMO_DB &&
      (process.env.ALLOW_DISPOSABLE_REPAIR_TEST_DB === '1' ||
        process.env.ALLOW_DISPOSABLE_REPAIR_TEST_DB === 'true')
    ) {
      process.env.ALLOW_DISPOSABLE_DEMO_DB = '1';
    }

    const pool = getPool();

    // 2. When PostGIS integration is required, missing PostGIS MUST cause a clear test failure
    const extCheck = await pool.query<{ count: string }>(
      `SELECT count(*) FROM pg_available_extensions WHERE name = 'postgis'`,
    );
    if (parseInt(extCheck.rows[0]?.count || '0', 10) === 0) {
      throw new Error(
        'POSTGIS_NOT_AVAILABLE: The connected PostgreSQL database does not have the "postgis" extension available. ' +
          'Live demo CLI lifecycle integration tests require PostgreSQL with PostGIS installed.',
      );
    }

    // 3. Strict safety validation: verifies explicit demo authorization, approved host, approved dbName, and identity marker.
    // Catch-all bypass behavior is removed; any safety validation failure immediately halts the test suite.
    await assertDisposableDemoDatabase(pool);

    // 4. Ensure migrations are applied
    await runMigrationsUp(pool);

    // 5. Ensure credentials file is clean before test execution
    if (fs.existsSync(credPath)) {
      try {
        fs.unlinkSync(credPath);
      } catch {
        // ignore
      }
    }
  });

  afterAll(async () => {
    // Restore or clear scoped ALLOW_DISPOSABLE_DEMO_DB
    if (originalDemoAuth !== undefined) {
      process.env.ALLOW_DISPOSABLE_DEMO_DB = originalDemoAuth;
    } else {
      delete process.env.ALLOW_DISPOSABLE_DEMO_DB;
    }

    if (fs.existsSync(credPath)) {
      try {
        fs.unlinkSync(credPath);
      } catch {
        // ignore
      }
    }

    const pool = getPool();
    try {
      await pool.query(`DELETE FROM requests WHERE id = $1`, [sentinelRequestId]);
      await pool.query(`DELETE FROM operators WHERE username = $1`, [sentinelUsername]);
      await pool.query(`DELETE FROM ${DEMO_OPERATOR_OWNERSHIP_TABLE}`);
      await pool.query(`DELETE FROM operators WHERE username = 'demo_operator'`);
    } catch {
      // ignore
    }
    await closePool();
  });

  it('proves demo:setup provisions demo environment, creates manifest, and protects sentinel records', async () => {
    const pool = getPool();
    const repo = new PostgisRepository(pool);
    const authService = new AuthService(repo);

    // 1. Plant unrelated sentinel records BEFORE demo:setup
    const { hash, salt } = authService.hashPassword(sentinelPassword);
    await pool.query(
      `INSERT INTO operators (id, username, password_hash, salt, name, role, is_active)
       VALUES ('op-sentinel-999', $1, $2, $3, 'Sentinel Operator', 'ADMIN', true)
       ON CONFLICT (username) DO NOTHING`,
      [sentinelUsername, hash, salt],
    );

    await pool.query(
      `INSERT INTO requests (id, location, people_count, urgency, source, status)
       VALUES ($1, ST_SetSRID(ST_MakePoint(77.23, 28.65), 4326), 2, 'LOW', 'REPORTED', 'PENDING')
       ON CONFLICT (id) DO NOTHING`,
      [sentinelRequestId],
    );

    // 2. Execute the actual runDemoSetup() CLI entrypoint (with closePool: false to keep pool alive for test assertions)
    const setupResult = await runDemoSetup({ closePool: false });

    expect(setupResult.runId).toMatch(/^demo_run_/);
    expect(setupResult.scenarioId).toBe('scenario-demo-yamuna-2026');
    expect(setupResult.isSimulationPreview).toBe(true);
    // In simulation preview mode, stops are NOT frozen because commitAssignment is not called for synthetic entities
    expect(setupResult.frozenStopsCount).toBe(0);
    expect(setupResult.churnRate).toBeGreaterThanOrEqual(0);

    // 3. Verify .demo-credentials.local.json file exists and credentials authenticate
    expect(fs.existsSync(credPath)).toBe(true);
    const credContent = JSON.parse(fs.readFileSync(credPath, 'utf-8'));
    expect(credContent.username).toBe('demo_operator');
    expect(credContent.role).toBe('DISPATCHER');
    expect(typeof credContent.password).toBe('string');
    expect(credContent.password.length).toBeGreaterThan(8);

    const authVerify = await authService.authenticate(credContent.username, credContent.password);
    expect(authVerify.token).toBeDefined();
    expect(authVerify.operator.role).toBe('DISPATCHER');

    // 4. Verify durable manifest was written to PostgreSQL in status ACTIVE
    const manifestRes = await pool.query<{ status: string; request_ids: string[] }>(
      `SELECT status, request_ids FROM demo_run_manifest WHERE run_id = $1`,
      [setupResult.runId],
    );
    expect(manifestRes.rows).toHaveLength(1);
    expect(manifestRes.rows[0]?.status).toBe('ACTIVE');
    expect(manifestRes.rows[0]?.request_ids.length).toBeGreaterThan(0);

    // 5. Verify demo operator ownership record exists
    const ownerRes = await pool.query<{ is_demo: boolean }>(
      `SELECT is_demo FROM ${DEMO_OPERATOR_OWNERSHIP_TABLE} WHERE username = $1`,
      [credContent.username],
    );
    expect(ownerRes.rows[0]?.is_demo).toBe(true);

    // 6. Verify unrelated sentinel records were NOT touched or corrupted
    const sentinelOpCheck = await repo.getOperatorByUsername(sentinelUsername);
    expect(sentinelOpCheck).not.toBeNull();
    expect(sentinelOpCheck?.username).toBe(sentinelUsername);
    expect(sentinelOpCheck?.role).toBe('ADMIN');

    const sentinelReqCheck = await repo.getRequestById(sentinelRequestId);
    expect(sentinelReqCheck).not.toBeNull();
    expect(sentinelReqCheck?.id).toBe(sentinelRequestId);
    expect(sentinelReqCheck?.source).toBe('REPORTED');
  });

  it('proves repeated demo:setup reuses operator and maintains idempotency without deleting sentinels', async () => {
    const pool = getPool();
    const repo = new PostgisRepository(pool);
    const authService = new AuthService(repo);

    // Read initial password
    const initialCreds = JSON.parse(fs.readFileSync(credPath, 'utf-8'));

    // Execute setup a second time (keeping pool alive)
    const repeatResult = await runDemoSetup({ closePool: false });
    expect(repeatResult.runId).toMatch(/^demo_run_/);

    // Credentials must remain valid
    const repeatCreds = JSON.parse(fs.readFileSync(credPath, 'utf-8'));
    expect(repeatCreds.username).toBe('demo_operator');
    expect(repeatCreds.password).toBe(initialCreds.password);

    const authVerify = await authService.authenticate(repeatCreds.username, repeatCreds.password);
    expect(authVerify.token).toBeDefined();

    // Sentinel operator must remain intact
    const sentinelOp = await repo.getOperatorByUsername(sentinelUsername);
    expect(sentinelOp).not.toBeNull();
    expect(sentinelOp?.username).toBe(sentinelUsername);
  });

  it('proves demo:cleanup safely purges demo fixtures, unlinks credentials, and preserves sentinels', async () => {
    const pool = getPool();
    const repo = new PostgisRepository(pool);

    // Execute runDemoCleanup() (keeping pool alive)
    const cleanupResult = await runDemoCleanup(undefined, { closePool: false });

    expect(cleanupResult.cleanedRuns).toBeGreaterThanOrEqual(1);
    expect(cleanupResult.deletedRequests).toBeGreaterThan(0);
    expect(cleanupResult.deletedAssignments).toBeGreaterThan(0);

    // Local credentials file must be unlinked
    expect(fs.existsSync(credPath)).toBe(false);

    // All demo manifests must now be CLEANED
    const manifestCheck = await pool.query<{ count: string }>(
      `SELECT count(*) FROM demo_run_manifest WHERE status = 'ACTIVE'`,
    );
    expect(parseInt(manifestCheck.rows[0]?.count || '0', 10)).toBe(0);

    // CRITICAL SAFETY ASSERTION: Sentinel records MUST still exist in database
    const sentinelOp = await repo.getOperatorByUsername(sentinelUsername);
    expect(sentinelOp).not.toBeNull();
    expect(sentinelOp?.username).toBe(sentinelUsername);

    const sentinelReq = await repo.getRequestById(sentinelRequestId);
    expect(sentinelReq).not.toBeNull();
    expect(sentinelReq?.id).toBe(sentinelRequestId);
  });

  it('proves demo:cleanup is idempotent when executed again', async () => {
    const secondCleanup = await runDemoCleanup(undefined, { closePool: false });
    expect(secondCleanup.cleanedRuns).toBe(0);
    expect(secondCleanup.deletedRequests).toBe(0);
    expect(secondCleanup.deletedAssignments).toBe(0);
  });
});
