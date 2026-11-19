import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type pg from 'pg';
import {
  assertDisposableDemoDatabase,
  recordDemoRunManifest,
  getActiveDemoRunManifests,
  cleanupTrackedDemoFixtures,
  DEMO_METADATA_MARKER_KEY,
  DEMO_METADATA_MARKER_VALUE,
  DEMO_MANIFEST_TABLE,
  type DemoRunManifest,
} from './demoDbGuard.js';

describe('Demo Database Safety Guard & Manifest Tracking Suite', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('assertDisposableDemoDatabase', () => {
    it('fails closed when ALLOW_DISPOSABLE_DEMO_DB is missing or false', async () => {
      delete process.env.ALLOW_DISPOSABLE_DEMO_DB;
      const mockPool = { options: { host: 'localhost' } } as unknown as pg.Pool;

      await expect(assertDisposableDemoDatabase(mockPool)).rejects.toThrow(
        /UNAUTHORIZED_DEMO_EXECUTION/,
      );
    });

    it('fails closed when running in production environment', async () => {
      process.env.ALLOW_DISPOSABLE_DEMO_DB = '1';
      process.env.NODE_ENV = 'production';
      const mockPool = { options: { host: 'localhost' } } as unknown as pg.Pool;

      await expect(assertDisposableDemoDatabase(mockPool)).rejects.toThrow(/DEMO_SAFETY_VIOLATION/);
    });

    it('fails closed when DATABASE_URL points to an unapproved remote host', async () => {
      process.env.ALLOW_DISPOSABLE_DEMO_DB = '1';
      process.env.NODE_ENV = 'development';
      process.env.DATABASE_URL =
        'postgresql://user:pass@remote-staging.internal:5432/floodrelay_demo';
      const mockPool = { options: { host: 'localhost' } } as unknown as pg.Pool;

      await expect(assertDisposableDemoDatabase(mockPool)).rejects.toThrow(/UNAPPROVED_DEMO_HOST/);
    });

    it('fails closed when pool options host is not in allowlist', async () => {
      process.env.ALLOW_DISPOSABLE_DEMO_DB = '1';
      process.env.NODE_ENV = 'development';
      delete process.env.DATABASE_URL;
      const mockPool = { options: { host: 'prod-cluster.cloud' } } as unknown as pg.Pool;

      await expect(assertDisposableDemoDatabase(mockPool)).rejects.toThrow(/UNAPPROVED_DEMO_HOST/);
    });

    it('fails closed when connected to generic development db (floodrelay) rather than dedicated demo db', async () => {
      process.env.ALLOW_DISPOSABLE_DEMO_DB = '1';
      process.env.NODE_ENV = 'development';

      const mockClient = {
        query: vi.fn().mockImplementation((query: string) => {
          if (query.includes('current_database()')) {
            return Promise.resolve({
              rows: [{ db_name: 'floodrelay', db_user: 'postgres', server_addr: '127.0.0.1' }],
            });
          }
          return Promise.resolve({ rows: [] });
        }),
        release: vi.fn(),
      };

      const mockPool = {
        options: { host: 'localhost' },
        connect: vi.fn().mockResolvedValue(mockClient),
      } as unknown as pg.Pool;

      await expect(assertDisposableDemoDatabase(mockPool)).rejects.toThrow(
        /UNAUTHORIZED_DEMO_DATABASE_NAME/,
      );
    });

    it('fails closed when demo identity marker table or marker row is missing', async () => {
      process.env.ALLOW_DISPOSABLE_DEMO_DB = '1';
      process.env.NODE_ENV = 'development';

      const mockClient = {
        query: vi.fn().mockImplementation((query: string) => {
          if (query.includes('current_database()')) {
            return Promise.resolve({
              rows: [{ db_name: 'floodrelay_demo', db_user: 'postgres', server_addr: '127.0.0.1' }],
            });
          }
          if (query.includes('demo_environment_metadata')) {
            return Promise.resolve({ rows: [] }); // No marker
          }
          return Promise.resolve({ rows: [] });
        }),
        release: vi.fn(),
      };

      const mockPool = {
        options: { host: 'localhost' },
        connect: vi.fn().mockResolvedValue(mockClient),
      } as unknown as pg.Pool;

      await expect(assertDisposableDemoDatabase(mockPool)).rejects.toThrow(
        /MISSING_DEMO_IDENTITY_MARKER/,
      );
    });

    it('passes when host, database name, and identity marker are all valid', async () => {
      process.env.ALLOW_DISPOSABLE_DEMO_DB = '1';
      process.env.NODE_ENV = 'development';

      const mockClient = {
        query: vi.fn().mockImplementation((query: string) => {
          if (query.includes('current_database()')) {
            return Promise.resolve({
              rows: [{ db_name: 'floodrelay_demo', db_user: 'postgres', server_addr: '127.0.0.1' }],
            });
          }
          if (query.includes('demo_environment_metadata')) {
            return Promise.resolve({
              rows: [
                {
                  marker_key: DEMO_METADATA_MARKER_KEY,
                  marker_value: DEMO_METADATA_MARKER_VALUE,
                  is_disposable: true,
                  database_name: 'floodrelay_demo',
                },
              ],
            });
          }
          return Promise.resolve({ rows: [] });
        }),
        release: vi.fn(),
      };

      const mockPool = {
        options: { host: 'localhost' },
        connect: vi.fn().mockResolvedValue(mockClient),
      } as unknown as pg.Pool;

      const res = await assertDisposableDemoDatabase(mockPool);
      expect(res.databaseName).toBe('floodrelay_demo');
      expect(res.dbUser).toBe('postgres');
      expect(res.serverAddr).toBe('127.0.0.1');
    });
  });

  describe('Durable Manifest & Parameterized Cleanup Safety', () => {
    it('records run manifest and cleans up strictly via parameterized arrays with zero wildcards', async () => {
      process.env.ALLOW_DISPOSABLE_DEMO_DB = '1';

      const executedQueries: { text: string; params: unknown[] }[] = [];
      const testManifest: DemoRunManifest = {
        runId: 'demo_run_12345',
        status: 'ACTIVE',
        requestIds: ['req-demo-1', 'req-demo-2'],
        assignmentIds: ['plan-demo-1'],
        assignmentStopIds: ['stop-demo-1', 'stop-demo-2'],
        resourceIds: ['res-boat-1'],
        shelterIds: ['shelter-1'],
        blockedZoneIds: ['zone-1'],
        operationalEventIds: ['evt-1'],
        auditEventIds: ['audit-1'],
        operatorUsernames: ['demo_operator'],
      };

      const mockClient = {
        query: vi.fn().mockImplementation((query: string, params: unknown[] = []) => {
          executedQueries.push({ text: query, params });

          if (query.includes(`SELECT * FROM ${DEMO_MANIFEST_TABLE}`)) {
            return Promise.resolve({
              rows: [
                {
                  run_id: testManifest.runId,
                  created_at: new Date(),
                  status: 'ACTIVE',
                  scenario_id: 'test-scenario',
                  request_ids: testManifest.requestIds,
                  assignment_ids: testManifest.assignmentIds,
                  assignment_stop_ids: testManifest.assignmentStopIds,
                  resource_ids: testManifest.resourceIds,
                  shelter_ids: testManifest.shelterIds,
                  blocked_zone_ids: testManifest.blockedZoneIds,
                  operational_event_ids: testManifest.operationalEventIds,
                  audit_event_ids: testManifest.auditEventIds,
                  operator_usernames: testManifest.operatorUsernames,
                },
              ],
            });
          }

          if (query.startsWith('DELETE FROM')) {
            return Promise.resolve({ rowCount: 1 });
          }

          return Promise.resolve({ rows: [] });
        }),
        release: vi.fn(),
      };

      const mockPool = {
        connect: vi.fn().mockResolvedValue(mockClient),
      } as unknown as pg.Pool;

      // 1. Record manifest
      await recordDemoRunManifest(mockPool, testManifest);
      const insertQuery = executedQueries.find((q) =>
        q.text.includes(`INSERT INTO ${DEMO_MANIFEST_TABLE}`),
      );
      expect(insertQuery).toBeDefined();
      expect(insertQuery?.params[0]).toBe('demo_run_12345');

      // 2. Fetch active manifests
      const active = await getActiveDemoRunManifests(mockPool);
      expect(active).toHaveLength(1);
      expect(active[0]?.runId).toBe('demo_run_12345');

      // 3. Execute cleanup
      executedQueries.length = 0;
      const counts = await cleanupTrackedDemoFixtures(mockPool);
      expect(counts.cleanedRuns).toBe(1);

      // Verify that all DELETE queries use ANY($1::text[]) and NEVER contain LIKE or wildcard
      const deleteQueries = executedQueries.filter((q) => q.text.trim().startsWith('DELETE FROM'));
      expect(deleteQueries.length).toBeGreaterThan(0);

      for (const dq of deleteQueries) {
        expect(dq.text).not.toContain('LIKE');
        expect(dq.text).not.toContain('%');
        expect(dq.text).toMatch(/WHERE .* = ANY\(\$1::text\[\]\)/);
        expect(Array.isArray(dq.params[0])).toBe(true);
      }

      // Verify manifest status update
      const updateManifestQuery = executedQueries.find((q) =>
        q.text.includes(`UPDATE ${DEMO_MANIFEST_TABLE} SET status = 'CLEANED'`),
      );
      expect(updateManifestQuery).toBeDefined();
    });

    it('protects pre-existing and reused operators from being deleted during cleanup', async () => {
      process.env.ALLOW_DISPOSABLE_DEMO_DB = '1';

      const executedQueries: { text: string; params: unknown[] }[] = [];
      const manifestWithReused: DemoRunManifest = {
        runId: 'demo_run_reused_test',
        status: 'ACTIVE',
        requestIds: ['req-1'],
        assignmentIds: [],
        assignmentStopIds: [],
        resourceIds: [],
        shelterIds: [],
        blockedZoneIds: [],
        operationalEventIds: [],
        auditEventIds: [],
        operatorUsernames: ['demo_operator'],
        createdOperatorUsernames: [], // Reused account, NOT created by this run!
        reusedOperatorUsernames: ['demo_operator'],
      };

      const mockClient = {
        query: vi.fn().mockImplementation((query: string, params: unknown[] = []) => {
          executedQueries.push({ text: query, params });
          if (query.includes(`SELECT * FROM ${DEMO_MANIFEST_TABLE}`)) {
            return Promise.resolve({
              rows: [
                {
                  run_id: manifestWithReused.runId,
                  created_at: new Date(),
                  status: 'ACTIVE',
                  request_ids: manifestWithReused.requestIds,
                  assignment_ids: [],
                  assignment_stop_ids: [],
                  resource_ids: [],
                  shelter_ids: [],
                  blocked_zone_ids: [],
                  operational_event_ids: [],
                  audit_event_ids: [],
                  operator_usernames: manifestWithReused.operatorUsernames,
                  created_operator_usernames: manifestWithReused.createdOperatorUsernames,
                  reused_operator_usernames: manifestWithReused.reusedOperatorUsernames,
                },
              ],
            });
          }
          if (query.startsWith('DELETE FROM')) {
            return Promise.resolve({ rowCount: 1 });
          }
          return Promise.resolve({ rows: [] });
        }),
        release: vi.fn(),
      };

      const mockPool = {
        connect: vi.fn().mockResolvedValue(mockClient),
      } as unknown as pg.Pool;

      const counts = await cleanupTrackedDemoFixtures(mockPool);
      // Because createdOperatorUsernames was empty, zero operators should be deleted!
      expect(counts.deletedOperators).toBe(0);

      const deleteOpQuery = executedQueries.find((q) => q.text.includes('DELETE FROM operators'));
      expect(deleteOpQuery).toBeUndefined();
    });

    it('cleans up and recovers runs in INITIALIZING and FAILED states', async () => {
      process.env.ALLOW_DISPOSABLE_DEMO_DB = '1';

      const executedQueries: { text: string; params: unknown[] }[] = [];
      const failedManifest: DemoRunManifest = {
        runId: 'demo_run_failed_midway',
        status: 'FAILED',
        requestIds: ['req-orphan-1'],
        assignmentIds: [],
        assignmentStopIds: [],
        resourceIds: [],
        shelterIds: [],
        blockedZoneIds: [],
        operationalEventIds: [],
        auditEventIds: [],
        operatorUsernames: [],
        createdOperatorUsernames: [],
      };

      const mockClient = {
        query: vi.fn().mockImplementation((query: string, params: unknown[] = []) => {
          executedQueries.push({ text: query, params });
          if (query.includes(`SELECT * FROM ${DEMO_MANIFEST_TABLE}`)) {
            expect(query).toContain("status IN ('ACTIVE', 'INITIALIZING', 'FAILED')");
            return Promise.resolve({
              rows: [
                {
                  run_id: failedManifest.runId,
                  created_at: new Date(),
                  status: 'FAILED',
                  request_ids: failedManifest.requestIds,
                  assignment_ids: [],
                  assignment_stop_ids: [],
                  resource_ids: [],
                  shelter_ids: [],
                  blocked_zone_ids: [],
                  operational_event_ids: [],
                  audit_event_ids: [],
                  operator_usernames: [],
                  created_operator_usernames: [],
                  reused_operator_usernames: [],
                },
              ],
            });
          }
          if (query.startsWith('DELETE FROM')) {
            return Promise.resolve({ rowCount: 1 });
          }
          return Promise.resolve({ rows: [] });
        }),
        release: vi.fn(),
      };

      const mockPool = {
        connect: vi.fn().mockResolvedValue(mockClient),
      } as unknown as pg.Pool;

      const counts = await cleanupTrackedDemoFixtures(mockPool);
      expect(counts.cleanedRuns).toBe(1);
      expect(counts.deletedRequests).toBe(1);
    });

    it('is completely idempotent when cleanup is executed multiple times', async () => {
      process.env.ALLOW_DISPOSABLE_DEMO_DB = '1';

      const mockClient = {
        query: vi.fn().mockImplementation((query: string) => {
          if (query.includes(`SELECT * FROM ${DEMO_MANIFEST_TABLE}`)) {
            return Promise.resolve({ rows: [] }); // No active manifests
          }
          return Promise.resolve({ rows: [] });
        }),
        release: vi.fn(),
      };

      const mockPool = {
        connect: vi.fn().mockResolvedValue(mockClient),
      } as unknown as pg.Pool;

      const counts1 = await cleanupTrackedDemoFixtures(mockPool);
      expect(counts1.cleanedRuns).toBe(0);

      const counts2 = await cleanupTrackedDemoFixtures(mockPool);
      expect(counts2.cleanedRuns).toBe(0);
    });
  });
});
