import { describe, it, expect } from 'vitest';
import pg from 'pg';
import crypto from 'node:crypto';
import { getPool } from '../db/connection.js';
import {
  assertDisposableTestDatabase,
  FixtureRegistry,
  STRICT_ALLOWED_TEST_DB_NAME,
} from './realRepairVerificationHelper.js';

const requireDb = Boolean(
  process.env.REQUIRE_DB && process.env.REQUIRE_DB !== '0' && process.env.REQUIRE_DB !== 'false',
);
const hasDatabaseUrl = Boolean(process.env.DATABASE_URL);
const hasAllowFlag = Boolean(
  process.env.ALLOW_DISPOSABLE_REPAIR_TEST_DB === '1' ||
  process.env.ALLOW_DISPOSABLE_REPAIR_TEST_DB === 'true',
);
const shouldRunLive = (requireDb || hasDatabaseUrl) && hasAllowFlag;

describe('Database Safety Guard & Fixture Isolation Tests (PR #29)', () => {
  it('CI=true alone does not authorize destructive tests', async () => {
    const originalAuth = process.env.ALLOW_DISPOSABLE_REPAIR_TEST_DB;
    const originalCi = process.env.CI;
    try {
      delete process.env.ALLOW_DISPOSABLE_REPAIR_TEST_DB;
      process.env.CI = 'true';

      const mockPool = {
        options: { host: 'localhost' },
        connect: async () => ({
          query: async () => ({
            rows: [{ db_name: STRICT_ALLOWED_TEST_DB_NAME, server_addr: '127.0.0.1' }],
          }),
          release: () => {},
        }),
      } as unknown as pg.Pool;

      await expect(assertDisposableTestDatabase(mockPool)).rejects.toThrow(
        /UNAUTHORIZED_TEST_EXECUTION/,
      );
    } finally {
      if (originalAuth !== undefined) process.env.ALLOW_DISPOSABLE_REPAIR_TEST_DB = originalAuth;
      else delete process.env.ALLOW_DISPOSABLE_REPAIR_TEST_DB;
      if (originalCi !== undefined) process.env.CI = originalCi;
      else delete process.env.CI;
    }
  });

  it('a missing explicit opt-in causes rejection', async () => {
    const originalAuth = process.env.ALLOW_DISPOSABLE_REPAIR_TEST_DB;
    const originalCi = process.env.CI;
    try {
      delete process.env.ALLOW_DISPOSABLE_REPAIR_TEST_DB;
      delete process.env.CI;

      const mockPool = {
        options: { host: 'localhost' },
        connect: async () => ({
          query: async () => ({
            rows: [{ db_name: STRICT_ALLOWED_TEST_DB_NAME, server_addr: '127.0.0.1' }],
          }),
          release: () => {},
        }),
      } as unknown as pg.Pool;

      await expect(assertDisposableTestDatabase(mockPool)).rejects.toThrow(
        /UNAUTHORIZED_TEST_EXECUTION/,
      );
    } finally {
      if (originalAuth !== undefined) process.env.ALLOW_DISPOSABLE_REPAIR_TEST_DB = originalAuth;
      else delete process.env.ALLOW_DISPOSABLE_REPAIR_TEST_DB;
      if (originalCi !== undefined) process.env.CI = originalCi;
      else delete process.env.CI;
    }
  });

  it('the generic database name "floodrelay" is rejected', async () => {
    const originalAuth = process.env.ALLOW_DISPOSABLE_REPAIR_TEST_DB;
    try {
      process.env.ALLOW_DISPOSABLE_REPAIR_TEST_DB = '1';

      const mockPool = {
        options: { host: 'localhost' },
        connect: async () => ({
          query: async () => ({
            rows: [{ db_name: 'floodrelay', server_addr: '127.0.0.1', db_user: 'postgres' }],
          }),
          release: () => {},
        }),
      } as unknown as pg.Pool;

      await expect(assertDisposableTestDatabase(mockPool)).rejects.toThrow(
        /UNAUTHORIZED_DATABASE_NAME/,
      );
    } finally {
      if (originalAuth !== undefined) process.env.ALLOW_DISPOSABLE_REPAIR_TEST_DB = originalAuth;
      else delete process.env.ALLOW_DISPOSABLE_REPAIR_TEST_DB;
    }
  });

  it('a database with an arbitrary name containing "test" is rejected', async () => {
    const originalAuth = process.env.ALLOW_DISPOSABLE_REPAIR_TEST_DB;
    try {
      process.env.ALLOW_DISPOSABLE_REPAIR_TEST_DB = '1';

      const mockPool = {
        options: { host: 'localhost' },
        connect: async () => ({
          query: async () => ({
            rows: [
              {
                db_name: 'prod_customer_test_db',
                server_addr: '127.0.0.1',
                db_user: 'postgres',
              },
            ],
          }),
          release: () => {},
        }),
      } as unknown as pg.Pool;

      await expect(assertDisposableTestDatabase(mockPool)).rejects.toThrow(
        /UNAUTHORIZED_DATABASE_NAME/,
      );
    } finally {
      if (originalAuth !== undefined) process.env.ALLOW_DISPOSABLE_REPAIR_TEST_DB = originalAuth;
      else delete process.env.ALLOW_DISPOSABLE_REPAIR_TEST_DB;
    }
  });

  it('an unapproved host in connection pool options is rejected', async () => {
    const originalAuth = process.env.ALLOW_DISPOSABLE_REPAIR_TEST_DB;
    try {
      process.env.ALLOW_DISPOSABLE_REPAIR_TEST_DB = '1';

      const mockPool = {
        options: { host: 'remote.corp.internal' },
        connect: async () => ({
          query: async () => ({
            rows: [{ db_name: 'floodrelay_test', server_addr: '10.0.0.5' }],
          }),
          release: () => {},
        }),
      } as unknown as pg.Pool;

      await expect(assertDisposableTestDatabase(mockPool)).rejects.toThrow(/UNAPPROVED_TEST_HOST/);
    } finally {
      if (originalAuth !== undefined) process.env.ALLOW_DISPOSABLE_REPAIR_TEST_DB = originalAuth;
      else delete process.env.ALLOW_DISPOSABLE_REPAIR_TEST_DB;
    }
  });

  it('an unapproved host in DATABASE_URL is rejected', async () => {
    const originalAuth = process.env.ALLOW_DISPOSABLE_REPAIR_TEST_DB;
    const originalDbUrl = process.env.DATABASE_URL;
    try {
      process.env.ALLOW_DISPOSABLE_REPAIR_TEST_DB = '1';
      process.env.DATABASE_URL = 'postgres://user:pass@unapproved.remote.db:5432/floodrelay_test';

      const mockPool = {
        options: { host: 'localhost' },
        connect: async () => ({
          query: async () => ({
            rows: [{ db_name: 'floodrelay_test', server_addr: '127.0.0.1' }],
          }),
          release: () => {},
        }),
      } as unknown as pg.Pool;

      await expect(assertDisposableTestDatabase(mockPool)).rejects.toThrow(/UNAPPROVED_TEST_HOST/);
    } finally {
      if (originalAuth !== undefined) process.env.ALLOW_DISPOSABLE_REPAIR_TEST_DB = originalAuth;
      else delete process.env.ALLOW_DISPOSABLE_REPAIR_TEST_DB;
      if (originalDbUrl !== undefined) process.env.DATABASE_URL = originalDbUrl;
      else delete process.env.DATABASE_URL;
    }
  });

  it('a missing test-database identity marker table is rejected', async () => {
    const originalAuth = process.env.ALLOW_DISPOSABLE_REPAIR_TEST_DB;
    const originalDbUrl = process.env.DATABASE_URL;
    try {
      process.env.ALLOW_DISPOSABLE_REPAIR_TEST_DB = '1';
      process.env.DATABASE_URL = 'postgres://postgres:postgres@localhost:5432/floodrelay_test';

      const mockPool = {
        options: { host: 'localhost' },
        connect: async () => ({
          query: async (sql: string) => {
            if (sql.includes('current_database()')) {
              return {
                rows: [
                  {
                    db_name: 'floodrelay_test',
                    db_user: 'postgres',
                    server_addr: '127.0.0.1',
                  },
                ],
              };
            }
            if (sql.includes('test_environment_metadata')) {
              throw new Error('relation "test_environment_metadata" does not exist');
            }
            return { rows: [] };
          },
          release: () => {},
        }),
      } as unknown as pg.Pool;

      await expect(assertDisposableTestDatabase(mockPool)).rejects.toThrow(
        /MISSING_TEST_DB_MARKER/,
      );
    } finally {
      if (originalAuth !== undefined) process.env.ALLOW_DISPOSABLE_REPAIR_TEST_DB = originalAuth;
      else delete process.env.ALLOW_DISPOSABLE_REPAIR_TEST_DB;
      if (originalDbUrl !== undefined) process.env.DATABASE_URL = originalDbUrl;
      else delete process.env.DATABASE_URL;
    }
  });

  it('an invalid test-database identity marker record is rejected', async () => {
    const originalAuth = process.env.ALLOW_DISPOSABLE_REPAIR_TEST_DB;
    const originalDbUrl = process.env.DATABASE_URL;
    try {
      process.env.ALLOW_DISPOSABLE_REPAIR_TEST_DB = '1';
      process.env.DATABASE_URL = 'postgres://postgres:postgres@localhost:5432/floodrelay_test';

      const mockPool = {
        options: { host: 'localhost' },
        connect: async () => ({
          query: async (sql: string) => {
            if (sql.includes('current_database()')) {
              return {
                rows: [
                  {
                    db_name: 'floodrelay_test',
                    db_user: 'postgres',
                    server_addr: '127.0.0.1',
                  },
                ],
              };
            }
            if (sql.includes('test_environment_metadata')) {
              // Return invalid/tampered marker
              return {
                rows: [
                  {
                    marker_key: 'DISPOSABLE_TEST_ENVIRONMENT',
                    marker_value: 'WRONG_MARKER_VALUE',
                    is_disposable: false,
                  },
                ],
              };
            }
            return { rows: [] };
          },
          release: () => {},
        }),
      } as unknown as pg.Pool;

      await expect(assertDisposableTestDatabase(mockPool)).rejects.toThrow(
        /INVALID_TEST_DB_MARKER/,
      );
    } finally {
      if (originalAuth !== undefined) process.env.ALLOW_DISPOSABLE_REPAIR_TEST_DB = originalAuth;
      else delete process.env.ALLOW_DISPOSABLE_REPAIR_TEST_DB;
      if (originalDbUrl !== undefined) process.env.DATABASE_URL = originalDbUrl;
      else delete process.env.DATABASE_URL;
    }
  });

  it('a mismatched database name in the identity marker is rejected', async () => {
    const originalAuth = process.env.ALLOW_DISPOSABLE_REPAIR_TEST_DB;
    const originalDbUrl = process.env.DATABASE_URL;
    try {
      process.env.ALLOW_DISPOSABLE_REPAIR_TEST_DB = '1';
      process.env.DATABASE_URL = 'postgres://postgres:postgres@localhost:5432/floodrelay_test';

      const mockPool = {
        options: { host: 'localhost' },
        connect: async () => ({
          query: async (sql: string) => {
            if (sql.includes('current_database()')) {
              return {
                rows: [
                  {
                    db_name: 'floodrelay_test',
                    db_user: 'postgres',
                    server_addr: '127.0.0.1',
                  },
                ],
              };
            }
            if (sql.includes('test_environment_metadata')) {
              // Return marker with mismatched database_name
              return {
                rows: [
                  {
                    marker_key: 'DISPOSABLE_TEST_ENVIRONMENT',
                    marker_value: 'FLOODRELAY_VERIFIED_TEST_DB',
                    is_disposable: true,
                    database_name: 'some_other_database',
                  },
                ],
              };
            }
            return { rows: [] };
          },
          release: () => {},
        }),
      } as unknown as pg.Pool;

      await expect(assertDisposableTestDatabase(mockPool)).rejects.toThrow(
        /TEST_DB_MARKER_MISMATCH/,
      );
    } finally {
      if (originalAuth !== undefined) process.env.ALLOW_DISPOSABLE_REPAIR_TEST_DB = originalAuth;
      else delete process.env.ALLOW_DISPOSABLE_REPAIR_TEST_DB;
      if (originalDbUrl !== undefined) process.env.DATABASE_URL = originalDbUrl;
      else delete process.env.DATABASE_URL;
    }
  });

  it('accepts a correctly provisioned disposable PostGIS database with verified marker', async () => {
    const originalAuth = process.env.ALLOW_DISPOSABLE_REPAIR_TEST_DB;
    const originalDbUrl = process.env.DATABASE_URL;
    try {
      process.env.ALLOW_DISPOSABLE_REPAIR_TEST_DB = '1';
      process.env.DATABASE_URL = 'postgres://postgres:postgres@localhost:5432/floodrelay_test';

      const mockPool = {
        options: { host: 'localhost' },
        connect: async () => ({
          query: async (sql: string) => {
            if (sql.includes('current_database()')) {
              return {
                rows: [
                  {
                    db_name: 'floodrelay_test',
                    db_user: 'postgres',
                    server_addr: '127.0.0.1',
                  },
                ],
              };
            }
            if (sql.includes('test_environment_metadata')) {
              return {
                rows: [
                  {
                    marker_key: 'DISPOSABLE_TEST_ENVIRONMENT',
                    marker_value: 'FLOODRELAY_VERIFIED_TEST_DB',
                    is_disposable: true,
                    database_name: 'floodrelay_test',
                  },
                ],
              };
            }
            return { rows: [] };
          },
          release: () => {},
        }),
      } as unknown as pg.Pool;

      const info = await assertDisposableTestDatabase(mockPool);
      expect(info.databaseName).toBe('floodrelay_test');
      expect(info.serverAddr).toBe('127.0.0.1');
      expect(info.dbUser).toBe('postgres');
    } finally {
      if (originalAuth !== undefined) process.env.ALLOW_DISPOSABLE_REPAIR_TEST_DB = originalAuth;
      else delete process.env.ALLOW_DISPOSABLE_REPAIR_TEST_DB;
      if (originalDbUrl !== undefined) process.env.DATABASE_URL = originalDbUrl;
      else delete process.env.DATABASE_URL;
    }
  });

  it('fails with descriptive error when database connection fails and verification is required', async () => {
    const originalAuth = process.env.ALLOW_DISPOSABLE_REPAIR_TEST_DB;
    try {
      process.env.ALLOW_DISPOSABLE_REPAIR_TEST_DB = '1';

      const mockPool = {
        options: { host: 'localhost' },
        connect: async () => {
          throw new Error('Connection refused on port 5432');
        },
      } as unknown as pg.Pool;

      await expect(assertDisposableTestDatabase(mockPool)).rejects.toThrow(
        /DATABASE_CONNECTION_FAILED/,
      );
    } finally {
      if (originalAuth !== undefined) process.env.ALLOW_DISPOSABLE_REPAIR_TEST_DB = originalAuth;
      else delete process.env.ALLOW_DISPOSABLE_REPAIR_TEST_DB;
    }
  });
});

describe('FixtureRegistry Transaction Rollback & State Preservation Tests', () => {
  it('a failed cleanup transaction preserves all tracked IDs and permits retry', async () => {
    const registry = new FixtureRegistry('retry-test');
    const req1 = registry.generateId('req');
    const res1 = registry.generateId('res');
    registry.requestIds.add(req1);
    registry.resourceIds.add(res1);

    expect(registry.requestIds.size).toBe(1);
    expect(registry.resourceIds.size).toBe(1);

    // Mock pool that throws during query execution
    let rollbackExecuted = false;
    const failingMockPool = {
      connect: async () => ({
        query: async (sql: string) => {
          if (sql === 'BEGIN') return;
          if (sql === 'ROLLBACK') {
            rollbackExecuted = true;
            return;
          }
          if (sql.includes('DELETE FROM')) {
            throw new Error('SIMULATED_QUERY_FAILURE_DURING_CLEANUP');
          }
        },
        release: () => {},
      }),
    } as unknown as pg.Pool;

    // First cleanup attempt: fails and rolls back
    await expect(registry.cleanup(failingMockPool)).rejects.toThrow(/FIXTURE_CLEANUP_FAILED/);
    expect(rollbackExecuted).toBe(true);

    // CRITICAL: Tracked IDs MUST be preserved following failed cleanup!
    expect(registry.requestIds.size).toBe(1);
    expect(registry.resourceIds.size).toBe(1);
    expect(registry.requestIds.has(req1)).toBe(true);
    expect(registry.resourceIds.has(res1)).toBe(true);

    // Second cleanup attempt: succeeds with healthy pool
    let commitExecuted = false;
    const successfulMockPool = {
      connect: async () => ({
        query: async (sql: string) => {
          if (sql === 'COMMIT') {
            commitExecuted = true;
          }
        },
        release: () => {},
      }),
    } as unknown as pg.Pool;

    await registry.cleanup(successfulMockPool);
    expect(commitExecuted).toBe(true);

    // After successful COMMIT: tracked IDs must be cleared
    expect(registry.requestIds.size).toBe(0);
    expect(registry.resourceIds.size).toBe(0);
  });

  it('a successful cleanup clears tracked IDs and repeated cleanup is idempotent', async () => {
    const registry = new FixtureRegistry('idempotent-test');
    registry.assignmentIds.add('asgn_1');
    registry.operatorUsernames.add('op_1');

    let commitCount = 0;
    const mockPool = {
      connect: async () => ({
        query: async (sql: string) => {
          if (sql === 'COMMIT') commitCount++;
        },
        release: () => {},
      }),
    } as unknown as pg.Pool;

    // First cleanup
    await registry.cleanup(mockPool);
    expect(commitCount).toBe(1);
    expect(registry.assignmentIds.size).toBe(0);
    expect(registry.operatorUsernames.size).toBe(0);

    // Second cleanup (idempotent, no-op queries)
    await registry.cleanup(mockPool);
    expect(commitCount).toBe(2);
    expect(registry.assignmentIds.size).toBe(0);
  });
});

describe.runIf(shouldRunLive)(
  'Live Database Fixture Isolation & Non-Destructive Cleanup Tests',
  () => {
    it('live database connects, verifies marker, and executes live guard check', async () => {
      const pool = getPool();
      const info = await assertDisposableTestDatabase(pool);
      expect(info.databaseName).toBe('floodrelay_test');
      expect(info.serverAddr).toBeDefined();
    });

    it('cleanup deletes only records created by the test run and preserves existing unrelated proposals', async () => {
      const pool = getPool();
      await assertDisposableTestDatabase(pool);

      const testRunRegistry = new FixtureRegistry();
      const unrelatedRegistry = new FixtureRegistry();

      // 1. Seed an unrelated proposal that looks like a repair proposal
      const unrelatedProposalId = `prop-repair-unrelated-${crypto.randomUUID()}`;
      unrelatedRegistry.trackAssignment(unrelatedProposalId);

      await pool.query(
        `INSERT INTO assignments (id, scenario_id, status, metrics, unserved, created_at, updated_at)
       VALUES ($1, 'scenario-unrelated', 'PROPOSED', '{}'::jsonb, '[]'::jsonb, NOW(), NOW());`,
        [unrelatedProposalId],
      );

      // 2. Seed an unrelated committed assignment
      const unrelatedCommittedId = `asgn-committed-unrelated-${crypto.randomUUID()}`;
      unrelatedRegistry.trackAssignment(unrelatedCommittedId);

      await pool.query(
        `INSERT INTO assignments (id, scenario_id, status, metrics, unserved, committed_at, committed_by, created_at, updated_at)
       VALUES ($1, 'scenario-unrelated', 'COMMITTED', '{}'::jsonb, '[]'::jsonb, NOW(), 'TEST_OPERATOR', NOW(), NOW());`,
        [unrelatedCommittedId],
      );

      // 3. Seed fixtures owned by the test run
      const testProposalId = `prop-repair-test-${testRunRegistry.runId}`;
      testRunRegistry.trackAssignment(testProposalId);

      await pool.query(
        `INSERT INTO assignments (id, scenario_id, status, metrics, unserved, created_at, updated_at)
       VALUES ($1, 'scenario-test', 'PROPOSED', '{}'::jsonb, '[]'::jsonb, NOW(), NOW());`,
        [testProposalId],
      );

      try {
        // 4. Run cleanup on the test run registry ONLY
        await testRunRegistry.cleanup(pool);

        // 5. Verify the test run proposal WAS deleted
        const testCheck = await pool.query('SELECT id FROM assignments WHERE id = $1;', [
          testProposalId,
        ]);
        expect(testCheck.rows.length).toBe(0);

        // 6. CRITICAL: Verify existing unrelated proposal WAS PRESERVED!
        const unrelatedCheck = await pool.query('SELECT id FROM assignments WHERE id = $1;', [
          unrelatedProposalId,
        ]);
        expect(unrelatedCheck.rows.length).toBe(1);

        // 7. CRITICAL: Verify existing committed assignment WAS PRESERVED!
        const committedCheck = await pool.query('SELECT id FROM assignments WHERE id = $1;', [
          unrelatedCommittedId,
        ]);
        expect(committedCheck.rows.length).toBe(1);
      } finally {
        // Clean up the unrelated test row
        await unrelatedRegistry.cleanup(pool);
      }
    });

    it('proves concurrent or repeated test runs do not collide or delete each other’s fixtures', async () => {
      const pool = getPool();
      await assertDisposableTestDatabase(pool);

      const runA = new FixtureRegistry();
      const runB = new FixtureRegistry();

      const reqA = runA.generateId('req');
      const reqB = runB.generateId('req');
      runA.requestIds.add(reqA);
      runB.requestIds.add(reqB);

      await pool.query(
        `INSERT INTO requests (id, location, people_count, urgency, status, source, created_at, updated_at)
       VALUES ($1, ST_SetSRID(ST_MakePoint(77.2, 28.5), 4326), 2, 'HIGH', 'PENDING', 'SIMULATED', NOW(), NOW()),
              ($2, ST_SetSRID(ST_MakePoint(77.3, 28.6), 4326), 1, 'LOW', 'PENDING', 'SIMULATED', NOW(), NOW());`,
        [reqA, reqB],
      );

      try {
        // Clean up run A only
        await runA.cleanup(pool);

        // reqA must be deleted
        const checkA = await pool.query('SELECT id FROM requests WHERE id = $1;', [reqA]);
        expect(checkA.rows.length).toBe(0);

        // reqB must STILL EXIST (not deleted by run A's cleanup!)
        const checkB = await pool.query('SELECT id FROM requests WHERE id = $1;', [reqB]);
        expect(checkB.rows.length).toBe(1);
      } finally {
        await runB.cleanup(pool);
      }
    });

    it('test fixture cleanup works reliably in finally block after test assertion failure', async () => {
      const pool = getPool();
      await assertDisposableTestDatabase(pool);

      const failingRun = new FixtureRegistry();
      const reqFail = failingRun.generateId('req_fail');
      failingRun.requestIds.add(reqFail);

      await pool.query(
        `INSERT INTO requests (id, location, people_count, urgency, status, source, created_at, updated_at)
       VALUES ($1, ST_SetSRID(ST_MakePoint(77.2, 28.5), 4326), 2, 'HIGH', 'PENDING', 'SIMULATED', NOW(), NOW());`,
        [reqFail],
      );

      // Simulate an assertion error inside a try...finally block
      let caughtError: Error | undefined;
      try {
        try {
          throw new Error('SIMULATED_ASSERTION_FAILURE');
        } finally {
          await failingRun.cleanup(pool);
        }
      } catch (err: unknown) {
        caughtError = err as Error;
      }

      expect(caughtError).toBeDefined();
      expect(caughtError?.message).toBe('SIMULATED_ASSERTION_FAILURE');

      // Verify cleanup ran and deleted the fixture despite the failure
      const check = await pool.query('SELECT id FROM requests WHERE id = $1;', [reqFail]);
      expect(check.rows.length).toBe(0);
    });
  },
);
