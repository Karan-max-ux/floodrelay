import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { getPool, closePool } from './connection.js';
import { PostgisRepository } from './repository.js';
import { RequestService } from '../services/requestService.js';
import { AssignmentService } from '../services/assignmentService.js';
import { CreateRequestSchema } from '../validation/requestSchema.js';
import { ProposeAssignmentSchema } from '../validation/assignmentSchema.js';
import type { RescueRequest, RescueResource, Shelter } from '@floodrelay/shared';

const requireDb = Boolean(
  process.env.REQUIRE_DB && process.env.REQUIRE_DB !== '0' && process.env.REQUIRE_DB !== 'false',
);
const hasDatabaseUrl = Boolean(process.env.DATABASE_URL);

if (requireDb && !hasDatabaseUrl) {
  throw new Error(
    'REQUIRE_DB is set in CI / environment, but DATABASE_URL is missing. Live PostGIS database tests are strictly required.',
  );
}

let dbAvailable = false;
let dbProbeError: Error | null = null;

if (hasDatabaseUrl) {
  try {
    const probePool = getPool();
    const probeClient = await probePool.connect();
    try {
      await probeClient.query('SELECT 1');
      dbAvailable = true;
    } finally {
      probeClient.release();
    }
  } catch (err) {
    dbProbeError = err as Error;
    if (requireDb) {
      throw new Error(
        `REQUIRE_DB is set in CI / environment, but the database at DATABASE_URL is unreachable: ${(err as Error).message}. Failing test suite to prevent silent skip.`,
        { cause: err },
      );
    }
    console.warn(
      `DATABASE_URL is provided but database is unreachable and REQUIRE_DB is not set. Skipping live PostGIS tests: ${(err as Error).message}`,
    );
  }
}

const shouldRun = requireDb || dbAvailable;

describe.runIf(shouldRun)('PostGIS Live Database Integration Tests', () => {
  const pool = getPool();
  const repo = new PostgisRepository(pool);
  const requestService = new RequestService(repo);
  const assignmentService = new AssignmentService(repo);

  beforeAll(async () => {
    if (requireDb && !dbAvailable) {
      throw new Error(
        `Database connection failed under REQUIRE_DB mode: ${dbProbeError?.message || 'unknown error'}`,
      );
    }
    const client = await pool.connect();
    client.release();
  });

  afterAll(async () => {
    await closePool();
  });

  beforeEach(async () => {
    const client = await pool.connect();
    try {
      await client.query('DELETE FROM assignment_stops;');
      await client.query('DELETE FROM assignments;');
      await client.query('DELETE FROM audit_events;');
      await client.query('DELETE FROM requests;');
      await client.query('DELETE FROM resources;');
      await client.query('DELETE FROM shelters;');
    } finally {
      client.release();
    }
  });

  describe('1. Schema Constraints & Provenance Enforcement', () => {
    it('enforces explicit source on resources and shelters (no default)', async () => {
      const client = await pool.connect();
      try {
        let resourceFailed = false;
        try {
          await client.query(`
            INSERT INTO resources (id, name, type, capacity, speed_km_h, location, status)
            VALUES ('res_fail', 'Boat', 'BOAT', 4, 30, ST_SetSRID(ST_MakePoint(77.2, 28.7), 4326), 'AVAILABLE');
          `);
        } catch {
          resourceFailed = true;
        }
        expect(resourceFailed).toBe(true);

        let shelterFailed = false;
        try {
          await client.query(`
            INSERT INTO shelters (id, name, location, capacity)
            VALUES ('sh_fail', 'Shelter', ST_SetSRID(ST_MakePoint(77.2, 28.7), 4326), 100);
          `);
        } catch {
          shelterFailed = true;
        }
        expect(shelterFailed).toBe(true);
      } finally {
        client.release();
      }
    });

    it('enforces check constraint on request urgency and status', async () => {
      const client = await pool.connect();
      try {
        let urgencyFailed = false;
        try {
          await client.query(`
            INSERT INTO requests (id, location, people_count, urgency, source)
            VALUES ('req_bad_urgency', ST_SetSRID(ST_MakePoint(77.2, 28.7), 4326), 4, 'SUPER_URGENT', 'REPORTED');
          `);
        } catch {
          urgencyFailed = true;
        }
        expect(urgencyFailed).toBe(true);
      } finally {
        client.release();
      }
    });
  });

  describe('2. Spatial Nearby Query (ST_DWithin)', () => {
    it('correctly retrieves requests within spatial radius and excludes those outside', async () => {
      const originLat = 28.7;
      const originLng = 77.2;

      await repo.insertRequest({
        id: 'req_nearby',
        lat: 28.701,
        lng: 77.201,
        peopleCount: 3,
        urgency: 'HIGH',
        source: 'REPORTED',
        createdAt: new Date().toISOString(),
      });

      await repo.insertRequest({
        id: 'req_distant',
        lat: 28.75,
        lng: 77.25,
        peopleCount: 3,
        urgency: 'HIGH',
        source: 'REPORTED',
        createdAt: new Date().toISOString(),
      });

      const within300m = await repo.findNearbyRequests(originLat, originLng, 300);
      expect(within300m.map((r) => r.id)).toContain('req_nearby');
      expect(within300m.map((r) => r.id)).not.toContain('req_distant');
    });
  });

  describe('3. Idempotent Insert & Unique-Violation Concurrency Race', () => {
    it('returns original on replay, rejects changed payload with 409, and handles concurrent race', async () => {
      const payload1 = CreateRequestSchema.parse({
        lat: 28.704,
        lng: 77.21,
        peopleCount: 4,
        urgency: 'MEDIUM',
        idempotencyKey: 'race_test_key_1',
      });

      // 1. Initial insert
      const res1 = await requestService.submitRequest(payload1);
      expect(res1.idempotent).toBe(false);
      const originalId = res1.request.id;

      // 2. Same key + same body -> replay original
      const res2 = await requestService.submitRequest(payload1);
      expect(res2.idempotent).toBe(true);
      expect(res2.request.id).toBe(originalId);

      // 3. Same key + different body -> 409
      const differentPayload = CreateRequestSchema.parse({
        ...payload1,
        peopleCount: 10,
      });
      await expect(requestService.submitRequest(differentPayload)).rejects.toMatchObject({
        code: 'IDEMPOTENCY_KEY_REUSED',
        statusCode: 409,
      });

      // 4. Concurrent insert race with same key
      const racePayload = CreateRequestSchema.parse({
        lat: 28.71,
        lng: 77.22,
        peopleCount: 2,
        urgency: 'LOW',
        idempotencyKey: 'concurrent_race_key',
      });

      const [race1, race2] = await Promise.all([
        requestService.submitRequest(racePayload),
        requestService.submitRequest(racePayload),
      ]);

      expect(race1.request.id).toBe(race2.request.id);
      expect([race1.idempotent, race2.idempotent].sort()).toEqual([false, true]);
    });
  });

  describe('4. Duplicate Detection', () => {
    it('flags nearby report with similar passenger count within time window as duplicate', async () => {
      const primaryRes = await requestService.submitRequest(
        CreateRequestSchema.parse({
          lat: 28.695,
          lng: 77.23,
          peopleCount: 4,
          urgency: 'HIGH',
        }),
      );
      expect(primaryRes.isFlaggedDuplicate).toBe(false);

      const duplicateRes = await requestService.submitRequest(
        CreateRequestSchema.parse({
          lat: 28.6952,
          lng: 77.2302,
          peopleCount: 5,
          urgency: 'HIGH',
        }),
      );

      expect(duplicateRes.isFlaggedDuplicate).toBe(true);
      expect(duplicateRes.duplicateOfId).toBe(primaryRes.request.id);
    });
  });

  describe('5. commitAssignment Transaction, Rollback, and Concurrency', () => {
    it('rolls back database state when request validation fails before writes', async () => {
      const resource: RescueResource = {
        id: 'res_txn_1',
        name: 'Boat Alpha',
        type: 'BOAT',
        capacity: 6,
        speedKmH: 25,
        lat: 28.7,
        lng: 77.2,
        status: 'AVAILABLE',
      };
      const shelter: Shelter = {
        id: 'sh_txn_1',
        name: 'Relief Camp 1',
        lat: 28.71,
        lng: 77.21,
        capacity: 100,
      };
      const req1: RescueRequest = {
        id: 'req_txn_1',
        lat: 28.705,
        lng: 77.205,
        peopleCount: 3,
        urgency: 'HIGH',
        source: 'REPORTED',
        status: 'PENDING',
        createdAt: new Date().toISOString(),
      };

      await repo.insertResource(resource, 'REAL');
      await repo.insertShelter(shelter, 'REAL');
      await repo.insertRequest(req1);

      const plan = await assignmentService.proposeAssignment(ProposeAssignmentSchema.parse({}));
      expect(plan.status).toBe('PROPOSED');

      const client = await pool.connect();
      try {
        await client.query("UPDATE requests SET status = 'RESCUED' WHERE id = $1", [req1.id]);
      } finally {
        client.release();
      }

      await expect(
        assignmentService.commitAssignment(plan.id, { operatorId: 'op_test' }),
      ).rejects.toMatchObject({
        code: 'REQUEST_ALREADY_ASSIGNED',
        statusCode: 409,
      });

      const after = await assignmentService.getAssignment(plan.id);
      expect(after?.status).toBe('PROPOSED');
      expect(after?.committedAt).toBeNull();
    });

    it('rolls back all database state after partial writes when late audit-event insert fails', async () => {
      const resource: RescueResource = {
        id: 'res_rb_partial',
        name: 'Rollback Boat',
        type: 'BOAT',
        capacity: 6,
        speedKmH: 25,
        lat: 28.7,
        lng: 77.2,
        status: 'AVAILABLE',
      };
      const shelter: Shelter = {
        id: 'sh_rb_partial',
        name: 'Rollback Shelter',
        lat: 28.71,
        lng: 77.21,
        capacity: 100,
      };
      const req: RescueRequest = {
        id: 'req_rb_partial',
        lat: 28.705,
        lng: 77.205,
        peopleCount: 3,
        urgency: 'HIGH',
        source: 'REPORTED',
        status: 'PENDING',
        createdAt: new Date().toISOString(),
      };

      await repo.insertResource(resource, 'REAL');
      await repo.insertShelter(shelter, 'REAL');
      await repo.insertRequest(req);

      const plan = await assignmentService.proposeAssignment(ProposeAssignmentSchema.parse({}));
      expect(plan.status).toBe('PROPOSED');

      // Verify pre-commit state
      const preAssign = await repo.getAssignmentWithStops(plan.id);
      expect(preAssign?.assignment.status).toBe('PROPOSED');
      expect(preAssign?.assignment.committed_at).toBeNull();
      expect(preAssign?.stops.every((s) => !s.is_frozen)).toBe(true);

      const preReq = await repo.getRequestById(req.id);
      expect(preReq?.status).toBe('PENDING');

      // Install a PostgreSQL trigger on audit_events to force an error on ASSIGNMENT_COMMITTED
      const client = await pool.connect();
      try {
        await client.query(`
          CREATE OR REPLACE FUNCTION trigger_fail_assignment_audit()
          RETURNS TRIGGER AS $$
          BEGIN
            IF NEW.entity_type = 'ASSIGNMENT' AND NEW.event_type = 'ASSIGNMENT_COMMITTED' THEN
              RAISE EXCEPTION 'Simulated SQL failure on audit-event insert for transaction rollback test';
            END IF;
            RETURN NEW;
          END;
          $$ LANGUAGE plpgsql;
        `);

        await client.query(`
          DROP TRIGGER IF EXISTS trigger_audit_fail ON audit_events;
          CREATE TRIGGER trigger_audit_fail
          BEFORE INSERT ON audit_events
          FOR EACH ROW
          EXECUTE FUNCTION trigger_fail_assignment_audit();
        `);

        // Attempt to commit assignment - this performs partial writes:
        // 1. UPDATE assignments SET status = 'COMMITTED'
        // 2. UPDATE assignment_stops SET is_frozen = TRUE
        // 3. UPDATE requests SET status = 'ASSIGNED'
        // 4. INSERT INTO audit_events -> FAILS and triggers ROLLBACK
        await expect(
          assignmentService.commitAssignment(plan.id, { operatorId: 'op_rollback_test' }),
        ).rejects.toThrow('Simulated SQL failure on audit-event insert');

        // Verify that ALL database modifications were reverted to their pre-commit state:
        // 1. Assignment status remains PROPOSED, committed_at is null
        const postAssign = await repo.getAssignmentWithStops(plan.id);
        expect(postAssign?.assignment.status).toBe('PROPOSED');
        expect(postAssign?.assignment.committed_at).toBeNull();
        expect(postAssign?.assignment.committed_by).toBeNull();

        // 2. Stops remain unfrozen
        expect(postAssign?.stops.every((s) => !s.is_frozen)).toBe(true);

        // 3. Request status remains PENDING (not ASSIGNED)
        const postReq = await repo.getRequestById(req.id);
        expect(postReq?.status).toBe('PENDING');

        // 4. Audit events contain no committed record (reverted to only ASSIGNMENT_PROPOSED)
        const auditRes = await client.query(
          "SELECT event_type FROM audit_events WHERE entity_type = 'ASSIGNMENT' AND entity_id = $1;",
          [plan.id],
        );
        expect(auditRes.rows.map((r: { event_type: string }) => r.event_type)).toEqual([
          'ASSIGNMENT_PROPOSED',
        ]);
      } finally {
        // Clean up test-specific database triggers and functions reliably
        try {
          await client.query('DROP TRIGGER IF EXISTS trigger_audit_fail ON audit_events;');
          await client.query('DROP FUNCTION IF EXISTS trigger_fail_assignment_audit();');
        } finally {
          client.release();
        }
      }

      // Proving cleanup: Now commit should succeed completely
      const successCommit = await assignmentService.commitAssignment(plan.id, {
        operatorId: 'op_clean',
      });
      expect(successCommit).toBe(true);
      const finalAssign = await repo.getAssignmentWithStops(plan.id);
      expect(finalAssign?.assignment.status).toBe('COMMITTED');
      expect(finalAssign?.stops.every((s) => s.is_frozen)).toBe(true);
      const finalReq = await repo.getRequestById(req.id);
      expect(finalReq?.status).toBe('ASSIGNED');

      const clientAfter = await pool.connect();
      try {
        const finalAudit = await clientAfter.query(
          "SELECT event_type FROM audit_events WHERE entity_type = 'ASSIGNMENT' AND entity_id = $1;",
          [plan.id],
        );
        expect(finalAudit.rows.map((r: { event_type: string }) => r.event_type)).toContain(
          'ASSIGNMENT_COMMITTED',
        );
      } finally {
        clientAfter.release();
      }
    });

    it('allows only one of two concurrent commits of the same proposal', async () => {
      const resource: RescueResource = {
        id: 'res_conc_1',
        name: 'Boat Beta',
        type: 'BOAT',
        capacity: 6,
        speedKmH: 25,
        lat: 28.7,
        lng: 77.2,
        status: 'AVAILABLE',
      };
      const shelter: Shelter = {
        id: 'sh_conc_1',
        name: 'Relief Camp 2',
        lat: 28.71,
        lng: 77.21,
        capacity: 100,
      };
      const req: RescueRequest = {
        id: 'req_conc_1',
        lat: 28.705,
        lng: 77.205,
        peopleCount: 2,
        urgency: 'CRITICAL',
        source: 'REPORTED',
        status: 'PENDING',
        createdAt: new Date().toISOString(),
      };

      await repo.insertResource(resource, 'REAL');
      await repo.insertShelter(shelter, 'REAL');
      await repo.insertRequest(req);

      const plan = await assignmentService.proposeAssignment(ProposeAssignmentSchema.parse({}));

      const results = await Promise.allSettled([
        assignmentService.commitAssignment(plan.id, { operatorId: 'op_1' }),
        assignmentService.commitAssignment(plan.id, { operatorId: 'op_2' }),
      ]);

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');

      expect(fulfilled.length).toBe(1);
      expect(rejected.length).toBe(1);
    });

    it('prevents two different proposals containing the same request from both committing', async () => {
      const resource: RescueResource = {
        id: 'res_dup_prop',
        name: 'Boat Gamma',
        type: 'BOAT',
        capacity: 6,
        speedKmH: 25,
        lat: 28.7,
        lng: 77.2,
        status: 'AVAILABLE',
      };
      const shelter: Shelter = {
        id: 'sh_dup_prop',
        name: 'Relief Camp 3',
        lat: 28.71,
        lng: 77.21,
        capacity: 100,
      };
      const req: RescueRequest = {
        id: 'req_shared_proposal',
        lat: 28.705,
        lng: 77.205,
        peopleCount: 2,
        urgency: 'HIGH',
        source: 'REPORTED',
        status: 'PENDING',
        createdAt: new Date().toISOString(),
      };

      await repo.insertResource(resource, 'REAL');
      await repo.insertShelter(shelter, 'REAL');
      await repo.insertRequest(req);

      const plan1 = await assignmentService.proposeAssignment(ProposeAssignmentSchema.parse({}));
      const plan2 = await assignmentService.proposeAssignment(ProposeAssignmentSchema.parse({}));

      const commit1 = await assignmentService.commitAssignment(plan1.id, { operatorId: 'op_1' });
      expect(commit1).toBe(true);

      await expect(
        assignmentService.commitAssignment(plan2.id, { operatorId: 'op_2' }),
      ).rejects.toMatchObject({
        code: 'REQUEST_ALREADY_ASSIGNED',
        statusCode: 409,
      });
    });

    it('proves identical lock acquisition ordering between JS .sort() and PostgreSQL COLLATE "C" across mixed-case, numbers, and underscores', async () => {
      const ids = ['res_a', 'res_A', 'res_1', 'res_B', 'res_b', 'RES_1', 'res__', 'res-1'];
      for (const id of ids) {
        await repo.insertResource(
          {
            id,
            name: `Resource ${id}`,
            type: 'BOAT',
            capacity: 5,
            speedKmH: 25,
            lat: 28.7,
            lng: 77.2,
            status: 'AVAILABLE',
          },
          'REAL',
        );
      }

      const jsSorted = [...ids].sort();
      const client = await pool.connect();
      try {
        const dbResult = await client.query<{ id: string }>(
          'SELECT id FROM resources WHERE id = ANY($1::text[]) ORDER BY id COLLATE "C" ASC;',
          [ids],
        );
        const dbSorted = dbResult.rows.map((r) => r.id);
        expect(dbSorted).toEqual(jsSorted);
      } finally {
        client.release();
      }
    });

    it('prevents two different proposals using the same resource for different requests from committing concurrently via genuine overlapping transactions', async () => {
      const resource: RescueResource = {
        id: 'res_shared_lock',
        name: 'Shared Rescue Boat',
        type: 'BOAT',
        capacity: 6,
        speedKmH: 25,
        lat: 28.7,
        lng: 77.2,
        status: 'AVAILABLE',
      };
      const shelter: Shelter = {
        id: 'sh_shared_lock',
        name: 'Relief Shelter X',
        lat: 28.71,
        lng: 77.21,
        capacity: 100,
      };
      const reqA: RescueRequest = {
        id: 'req_lock_a',
        lat: 28.705,
        lng: 77.205,
        peopleCount: 2,
        urgency: 'HIGH',
        source: 'REPORTED',
        status: 'PENDING',
        createdAt: new Date().toISOString(),
      };
      const reqB: RescueRequest = {
        id: 'req_lock_b',
        lat: 28.708,
        lng: 77.208,
        peopleCount: 2,
        urgency: 'CRITICAL',
        source: 'REPORTED',
        status: 'PENDING',
        createdAt: new Date().toISOString(),
      };

      await repo.insertResource(resource, 'REAL');
      await repo.insertShelter(shelter, 'REAL');
      await repo.insertRequest(reqA);
      await repo.insertRequest(reqB);

      // Create two distinct proposals using the SAME resource (res_shared_lock) for DIFFERENT requests
      const planAId = 'plan_conflict_a';
      await repo.insertAssignmentWithStops(
        {
          id: planAId,
          scenario_id: 'test-concurrency',
          status: 'PROPOSED',
          metrics: null,
          unserved: null,
          committed_at: null,
          committed_by: null,
          created_at: new Date(),
          updated_at: new Date(),
        },
        [
          {
            id: `stop_${planAId}_1`,
            assignment_id: planAId,
            resource_id: resource.id,
            stop_number: 1,
            type: 'PICKUP',
            target_id: reqA.id,
            location: `POINT(${reqA.lng} ${reqA.lat})`,
            passengers_picked_up: reqA.peopleCount,
            passengers_dropped_off: 0,
            estimated_arrival_minutes: 10,
            is_frozen: false,
            created_at: new Date(),
          },
          {
            id: `stop_${planAId}_2`,
            assignment_id: planAId,
            resource_id: resource.id,
            stop_number: 2,
            type: 'DROPOFF',
            target_id: shelter.id,
            location: `POINT(${shelter.lng} ${shelter.lat})`,
            passengers_picked_up: 0,
            passengers_dropped_off: reqA.peopleCount,
            estimated_arrival_minutes: 20,
            is_frozen: false,
            created_at: new Date(),
          },
        ],
      );

      const planBId = 'plan_conflict_b';
      await repo.insertAssignmentWithStops(
        {
          id: planBId,
          scenario_id: 'test-concurrency',
          status: 'PROPOSED',
          metrics: null,
          unserved: null,
          committed_at: null,
          committed_by: null,
          created_at: new Date(),
          updated_at: new Date(),
        },
        [
          {
            id: `stop_${planBId}_1`,
            assignment_id: planBId,
            resource_id: resource.id,
            stop_number: 1,
            type: 'PICKUP',
            target_id: reqB.id,
            location: `POINT(${reqB.lng} ${reqB.lat})`,
            passengers_picked_up: reqB.peopleCount,
            passengers_dropped_off: 0,
            estimated_arrival_minutes: 12,
            is_frozen: false,
            created_at: new Date(),
          },
          {
            id: `stop_${planBId}_2`,
            assignment_id: planBId,
            resource_id: resource.id,
            stop_number: 2,
            type: 'DROPOFF',
            target_id: shelter.id,
            location: `POINT(${shelter.lng} ${shelter.lat})`,
            passengers_picked_up: 0,
            passengers_dropped_off: reqB.peopleCount,
            estimated_arrival_minutes: 25,
            is_frozen: false,
            created_at: new Date(),
          },
        ],
      );

      // Execute conflicting commits concurrently with guaranteed overlap:
      // Client A locks the resource row and commits plan A inside its open transaction.
      // Client B calls repoB.commitAssignment(planBId) and blocks on Client A's lock.
      // A monitor connection inspects pg_stat_activity to confirm Client B is blocked on 'Lock'.
      // Then Client A commits, unblocking Client B which detects the conflict and rejects with 409.
      const clientA = await pool.connect();
      const clientB = await pool.connect();
      const clientMonitor = await pool.connect();
      const repoB = new PostgisRepository(clientB);

      try {
        const pidResult = await clientB.query<{ pid: number }>('SELECT pg_backend_pid() as pid;');
        const pidB = pidResult.rows[0]!.pid;

        await clientA.query('BEGIN');
        await clientA.query('SELECT id, status FROM resources WHERE id = $1 FOR UPDATE;', [
          resource.id,
        ]);

        // Commit plan A within Client A's open transaction
        await clientA.query(
          "UPDATE assignments SET status = 'COMMITTED', committed_at = NOW(), committed_by = $2, updated_at = NOW() WHERE id = $1;",
          [planAId, 'operator_A'],
        );
        await clientA.query(
          'UPDATE assignment_stops SET is_frozen = TRUE WHERE assignment_id = $1;',
          [planAId],
        );
        await clientA.query(
          "UPDATE requests SET status = 'ASSIGNED', updated_at = NOW() WHERE id = $1;",
          [reqA.id],
        );
        await clientA.query(
          "INSERT INTO audit_events (entity_type, entity_id, event_type, actor, payload, created_at) VALUES ('ASSIGNMENT', $1, 'ASSIGNMENT_COMMITTED', $2, $3, NOW());",
          [planAId, 'operator_A', JSON.stringify({ assignmentId: planAId })],
        );

        // Client B tries to commit plan B and will block on Client A's row lock on resources
        const commitBPromise = repoB.commitAssignment(planBId, 'operator_B');

        // Poll pg_stat_activity with timeout to prove Client B is blocked on 'Lock'
        const startTime = Date.now();
        const maxWaitMs = 1500;
        let isWaitingOnLock = false;
        while (Date.now() - startTime < maxWaitMs) {
          const act = await clientMonitor.query<{ wait_event_type: string | null }>(
            'SELECT wait_event_type FROM pg_stat_activity WHERE pid = $1;',
            [pidB],
          );
          if (act.rows[0]?.wait_event_type === 'Lock') {
            isWaitingOnLock = true;
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 20));
        }

        expect(isWaitingOnLock).toBe(true);

        // Release Client A by committing transaction
        await clientA.query('COMMIT');

        // Client B unblocks, rechecks conflicts, and must fail with 409 RESOURCE_ALREADY_COMMITTED
        let bError: { code?: string; statusCode?: number } | null = null;
        try {
          await commitBPromise;
        } catch (err) {
          bError = err as { code?: string; statusCode?: number };
        }

        expect(bError).not.toBeNull();
        expect(bError?.code).toBe('RESOURCE_ALREADY_COMMITTED');
        expect(bError?.statusCode).toBe(409);

        // Verify database state: exactly 1 committed assignment, no conflicting committed assignments
        const dbClient = await pool.connect();
        try {
          const committedAssignments = await dbClient.query<{ id: string }>(
            "SELECT id FROM assignments WHERE status = 'COMMITTED';",
          );
          expect(committedAssignments.rows.length).toBe(1);
          expect(committedAssignments.rows[0]!.id).toBe(planAId);

          const uncommitted = await dbClient.query<{ status: string }>(
            'SELECT status FROM assignments WHERE id = $1;',
            [planBId],
          );
          expect(uncommitted.rows[0]!.status).toBe('PROPOSED');

          const reqRows = await dbClient.query<{ id: string; status: string }>(
            'SELECT id, status FROM requests ORDER BY id ASC;',
          );
          const reqStatusMap = new Map(reqRows.rows.map((r) => [r.id, r.status]));
          expect(reqStatusMap.get('req_lock_a')).toBe('ASSIGNED');
          expect(reqStatusMap.get('req_lock_b')).toBe('PENDING');
        } finally {
          dbClient.release();
        }
      } finally {
        clientA.release();
        clientB.release();
        clientMonitor.release();
      }
    }, 15000);

    it('proves legitimate frozen-stop continuation of the same assignment is not rejected by post-lock recheck', async () => {
      const resource: RescueResource = {
        id: 'res_frozen_cont',
        name: 'Continuation Boat',
        type: 'BOAT',
        capacity: 10,
        speedKmH: 25,
        lat: 28.7,
        lng: 77.2,
        status: 'AVAILABLE',
      };
      const shelter: Shelter = {
        id: 'sh_frozen_cont',
        name: 'Continuation Shelter',
        lat: 28.71,
        lng: 77.21,
        capacity: 100,
      };
      const req1: RescueRequest = {
        id: 'req_frozen_cont_1',
        lat: 28.704,
        lng: 77.204,
        peopleCount: 2,
        urgency: 'HIGH',
        source: 'REPORTED',
        status: 'PENDING',
        createdAt: new Date().toISOString(),
      };
      const req2: RescueRequest = {
        id: 'req_frozen_cont_2',
        lat: 28.708,
        lng: 77.208,
        peopleCount: 3,
        urgency: 'MEDIUM',
        source: 'REPORTED',
        status: 'PENDING',
        createdAt: new Date().toISOString(),
      };

      await repo.insertResource(resource, 'REAL');
      await repo.insertShelter(shelter, 'REAL');
      await repo.insertRequest(req1);
      await repo.insertRequest(req2);

      // 1. Initial assignment committed with stop for req1
      const initialPlanId = 'plan_initial_committed';
      await repo.insertAssignmentWithStops(
        {
          id: initialPlanId,
          scenario_id: 'test-frozen-continuation',
          status: 'PROPOSED',
          metrics: null,
          unserved: null,
          committed_at: null,
          committed_by: null,
          created_at: new Date(),
          updated_at: new Date(),
        },
        [
          {
            id: `stop_${initialPlanId}_1`,
            assignment_id: initialPlanId,
            resource_id: resource.id,
            stop_number: 1,
            type: 'PICKUP',
            target_id: req1.id,
            location: `POINT(${req1.lng} ${req1.lat})`,
            passengers_picked_up: req1.peopleCount,
            passengers_dropped_off: 0,
            estimated_arrival_minutes: 10,
            is_frozen: false,
            created_at: new Date(),
          },
          {
            id: `stop_${initialPlanId}_2`,
            assignment_id: initialPlanId,
            resource_id: resource.id,
            stop_number: 2,
            type: 'DROPOFF',
            target_id: shelter.id,
            location: `POINT(${shelter.lng} ${shelter.lat})`,
            passengers_picked_up: 0,
            passengers_dropped_off: req1.peopleCount,
            estimated_arrival_minutes: 20,
            is_frozen: false,
            created_at: new Date(),
          },
        ],
      );

      // Commit initial assignment (freezes its stops)
      await repo.commitAssignment(initialPlanId, 'operator_init');

      // 2. Replanned assignment continues with the same frozen stops and adds req2
      const replanPlanId = 'plan_replan_continuation';
      await repo.insertAssignmentWithStops(
        {
          id: replanPlanId,
          scenario_id: 'test-frozen-continuation',
          status: 'PROPOSED',
          metrics: null,
          unserved: null,
          committed_at: null,
          committed_by: null,
          created_at: new Date(),
          updated_at: new Date(),
        },
        [
          {
            id: `stop_${replanPlanId}_1`,
            assignment_id: replanPlanId,
            resource_id: resource.id,
            stop_number: 1,
            type: 'PICKUP',
            target_id: req1.id,
            location: `POINT(${req1.lng} ${req1.lat})`,
            passengers_picked_up: req1.peopleCount,
            passengers_dropped_off: 0,
            estimated_arrival_minutes: 10,
            is_frozen: true, // Incorporated as frozen stop
            created_at: new Date(),
          },
          {
            id: `stop_${replanPlanId}_2`,
            assignment_id: replanPlanId,
            resource_id: resource.id,
            stop_number: 2,
            type: 'DROPOFF',
            target_id: shelter.id,
            location: `POINT(${shelter.lng} ${shelter.lat})`,
            passengers_picked_up: 0,
            passengers_dropped_off: req1.peopleCount,
            estimated_arrival_minutes: 20,
            is_frozen: true, // Incorporated as frozen stop
            created_at: new Date(),
          },
          {
            id: `stop_${replanPlanId}_3`,
            assignment_id: replanPlanId,
            resource_id: resource.id,
            stop_number: 3,
            type: 'PICKUP',
            target_id: req2.id,
            location: `POINT(${req2.lng} ${req2.lat})`,
            passengers_picked_up: req2.peopleCount,
            passengers_dropped_off: 0,
            estimated_arrival_minutes: 30,
            is_frozen: false,
            created_at: new Date(),
          },
          {
            id: `stop_${replanPlanId}_4`,
            assignment_id: replanPlanId,
            resource_id: resource.id,
            stop_number: 4,
            type: 'DROPOFF',
            target_id: shelter.id,
            location: `POINT(${shelter.lng} ${shelter.lat})`,
            passengers_picked_up: 0,
            passengers_dropped_off: req2.peopleCount,
            estimated_arrival_minutes: 40,
            is_frozen: false,
            created_at: new Date(),
          },
        ],
      );

      // Committing the replanned assignment with legitimate frozen-stop continuation must succeed
      const commitSuccess = await repo.commitAssignment(replanPlanId, 'operator_replan');
      expect(commitSuccess).toBe(true);

      // Verify req2 is now ASSIGNED and replan is COMMITTED
      const dbClient = await pool.connect();
      try {
        const replanRow = await dbClient.query<{ status: string }>(
          'SELECT status FROM assignments WHERE id = $1;',
          [replanPlanId],
        );
        expect(replanRow.rows[0]!.status).toBe('COMMITTED');

        const req2Row = await dbClient.query<{ status: string }>(
          'SELECT status FROM requests WHERE id = $1;',
          [req2.id],
        );
        expect(req2Row.rows[0]!.status).toBe('ASSIGNED');
      } finally {
        dbClient.release();
      }
    });

    it('allows sequential multi-replan chaining across plan 1, plan 2, and plan 3 on the same resource', async () => {
      const resource: RescueResource = {
        id: 'res_chain_multi',
        name: 'Multi-Replan Boat',
        type: 'BOAT',
        capacity: 10,
        speedKmH: 25,
        lat: 28.7,
        lng: 77.2,
        status: 'AVAILABLE',
      };
      const shelter: Shelter = {
        id: 'sh_chain_multi',
        name: 'Chain Relief Shelter',
        lat: 28.71,
        lng: 77.21,
        capacity: 100,
      };
      const req1: RescueRequest = {
        id: 'req_chain_1',
        lat: 28.702,
        lng: 77.202,
        peopleCount: 2,
        urgency: 'HIGH',
        source: 'REPORTED',
        status: 'PENDING',
        createdAt: new Date().toISOString(),
      };
      const req2: RescueRequest = {
        id: 'req_chain_2',
        lat: 28.704,
        lng: 77.204,
        peopleCount: 2,
        urgency: 'HIGH',
        source: 'REPORTED',
        status: 'PENDING',
        createdAt: new Date().toISOString(),
      };
      const req3: RescueRequest = {
        id: 'req_chain_3',
        lat: 28.706,
        lng: 77.206,
        peopleCount: 2,
        urgency: 'HIGH',
        source: 'REPORTED',
        status: 'PENDING',
        createdAt: new Date().toISOString(),
      };

      await repo.insertResource(resource, 'REAL');
      await repo.insertShelter(shelter, 'REAL');
      await repo.insertRequest(req1);
      await repo.insertRequest(req2);
      await repo.insertRequest(req3);

      // --- 1. Commit Plan 1 (servicing req1) ---
      const plan1Id = 'plan_chain_1';
      await repo.insertAssignmentWithStops(
        {
          id: plan1Id,
          scenario_id: 'test-chain-multi',
          status: 'PROPOSED',
          metrics: null,
          unserved: null,
          committed_at: null,
          committed_by: null,
          created_at: new Date(),
          updated_at: new Date(),
        },
        [
          {
            id: `stop_${plan1Id}_1`,
            assignment_id: plan1Id,
            resource_id: resource.id,
            stop_number: 1,
            type: 'PICKUP',
            target_id: req1.id,
            location: `POINT(${req1.lng} ${req1.lat})`,
            passengers_picked_up: req1.peopleCount,
            passengers_dropped_off: 0,
            estimated_arrival_minutes: 10,
            is_frozen: false,
            created_at: new Date(),
          },
          {
            id: `stop_${plan1Id}_2`,
            assignment_id: plan1Id,
            resource_id: resource.id,
            stop_number: 2,
            type: 'DROPOFF',
            target_id: shelter.id,
            location: `POINT(${shelter.lng} ${shelter.lat})`,
            passengers_picked_up: 0,
            passengers_dropped_off: req1.peopleCount,
            estimated_arrival_minutes: 20,
            is_frozen: false,
            created_at: new Date(),
          },
        ],
      );
      const commit1Success = await repo.commitAssignment(plan1Id, 'operator_1');
      expect(commit1Success).toBe(true);

      // --- 2. Replan and Commit Plan 2 (preserves Plan 1 frozen stops, adds req2) ---
      const plan2Id = 'plan_chain_2';
      await repo.insertAssignmentWithStops(
        {
          id: plan2Id,
          scenario_id: 'test-chain-multi',
          status: 'PROPOSED',
          metrics: null,
          unserved: null,
          committed_at: null,
          committed_by: null,
          created_at: new Date(),
          updated_at: new Date(),
        },
        [
          {
            id: `stop_${plan2Id}_1`,
            assignment_id: plan2Id,
            resource_id: resource.id,
            stop_number: 1,
            type: 'PICKUP',
            target_id: req1.id,
            location: `POINT(${req1.lng} ${req1.lat})`,
            passengers_picked_up: req1.peopleCount,
            passengers_dropped_off: 0,
            estimated_arrival_minutes: 10,
            is_frozen: true,
            created_at: new Date(),
          },
          {
            id: `stop_${plan2Id}_2`,
            assignment_id: plan2Id,
            resource_id: resource.id,
            stop_number: 2,
            type: 'DROPOFF',
            target_id: shelter.id,
            location: `POINT(${shelter.lng} ${shelter.lat})`,
            passengers_picked_up: 0,
            passengers_dropped_off: req1.peopleCount,
            estimated_arrival_minutes: 20,
            is_frozen: true,
            created_at: new Date(),
          },
          {
            id: `stop_${plan2Id}_3`,
            assignment_id: plan2Id,
            resource_id: resource.id,
            stop_number: 3,
            type: 'PICKUP',
            target_id: req2.id,
            location: `POINT(${req2.lng} ${req2.lat})`,
            passengers_picked_up: req2.peopleCount,
            passengers_dropped_off: 0,
            estimated_arrival_minutes: 30,
            is_frozen: false,
            created_at: new Date(),
          },
          {
            id: `stop_${plan2Id}_4`,
            assignment_id: plan2Id,
            resource_id: resource.id,
            stop_number: 4,
            type: 'DROPOFF',
            target_id: shelter.id,
            location: `POINT(${shelter.lng} ${shelter.lat})`,
            passengers_picked_up: 0,
            passengers_dropped_off: req2.peopleCount,
            estimated_arrival_minutes: 40,
            is_frozen: false,
            created_at: new Date(),
          },
        ],
      );
      const commit2Success = await repo.commitAssignment(plan2Id, 'operator_2');
      expect(commit2Success).toBe(true);

      // --- 3. Replan and Commit Plan 3 (preserves Plan 2 frozen stops, adds req3) ---
      const plan3Id = 'plan_chain_3';
      await repo.insertAssignmentWithStops(
        {
          id: plan3Id,
          scenario_id: 'test-chain-multi',
          status: 'PROPOSED',
          metrics: null,
          unserved: null,
          committed_at: null,
          committed_by: null,
          created_at: new Date(),
          updated_at: new Date(),
        },
        [
          {
            id: `stop_${plan3Id}_1`,
            assignment_id: plan3Id,
            resource_id: resource.id,
            stop_number: 1,
            type: 'PICKUP',
            target_id: req1.id,
            location: `POINT(${req1.lng} ${req1.lat})`,
            passengers_picked_up: req1.peopleCount,
            passengers_dropped_off: 0,
            estimated_arrival_minutes: 10,
            is_frozen: true,
            created_at: new Date(),
          },
          {
            id: `stop_${plan3Id}_2`,
            assignment_id: plan3Id,
            resource_id: resource.id,
            stop_number: 2,
            type: 'DROPOFF',
            target_id: shelter.id,
            location: `POINT(${shelter.lng} ${shelter.lat})`,
            passengers_picked_up: 0,
            passengers_dropped_off: req1.peopleCount,
            estimated_arrival_minutes: 20,
            is_frozen: true,
            created_at: new Date(),
          },
          {
            id: `stop_${plan3Id}_3`,
            assignment_id: plan3Id,
            resource_id: resource.id,
            stop_number: 3,
            type: 'PICKUP',
            target_id: req2.id,
            location: `POINT(${req2.lng} ${req2.lat})`,
            passengers_picked_up: req2.peopleCount,
            passengers_dropped_off: 0,
            estimated_arrival_minutes: 30,
            is_frozen: true,
            created_at: new Date(),
          },
          {
            id: `stop_${plan3Id}_4`,
            assignment_id: plan3Id,
            resource_id: resource.id,
            stop_number: 4,
            type: 'DROPOFF',
            target_id: shelter.id,
            location: `POINT(${shelter.lng} ${shelter.lat})`,
            passengers_picked_up: 0,
            passengers_dropped_off: req2.peopleCount,
            estimated_arrival_minutes: 40,
            is_frozen: true,
            created_at: new Date(),
          },
          {
            id: `stop_${plan3Id}_5`,
            assignment_id: plan3Id,
            resource_id: resource.id,
            stop_number: 5,
            type: 'PICKUP',
            target_id: req3.id,
            location: `POINT(${req3.lng} ${req3.lat})`,
            passengers_picked_up: req3.peopleCount,
            passengers_dropped_off: 0,
            estimated_arrival_minutes: 50,
            is_frozen: false,
            created_at: new Date(),
          },
          {
            id: `stop_${plan3Id}_6`,
            assignment_id: plan3Id,
            resource_id: resource.id,
            stop_number: 6,
            type: 'DROPOFF',
            target_id: shelter.id,
            location: `POINT(${shelter.lng} ${shelter.lat})`,
            passengers_picked_up: 0,
            passengers_dropped_off: req3.peopleCount,
            estimated_arrival_minutes: 60,
            is_frozen: false,
            created_at: new Date(),
          },
        ],
      );
      const commit3Success = await repo.commitAssignment(plan3Id, 'operator_3');
      expect(commit3Success).toBe(true);

      // Verify all 3 requests are now ASSIGNED and plan 3 is COMMITTED
      const dbClient = await pool.connect();
      try {
        const plan3Row = await dbClient.query<{ status: string }>(
          'SELECT status FROM assignments WHERE id = $1;',
          [plan3Id],
        );
        expect(plan3Row.rows[0]!.status).toBe('COMMITTED');

        // Confirm earlier plans' requests (req1, req2) and current request (req3) remain ASSIGNED
        const reqRows = await dbClient.query<{ id: string; status: string }>(
          'SELECT id, status FROM requests WHERE id = ANY($1::text[]);',
          [[req1.id, req2.id, req3.id]],
        );
        expect(reqRows.rows.length).toBe(3);
        for (const row of reqRows.rows) {
          expect(row.status).toBe('ASSIGNED');
        }

        // Verify plan 3 stops:
        // 1. No duplicate stops in plan 3: 6 unique stop IDs, sequential stop numbers 1..6
        const stopsResult = await dbClient.query<{
          id: string;
          stop_number: number;
          type: string;
          target_id: string;
          is_frozen: boolean;
        }>(
          'SELECT id, stop_number, type, target_id, is_frozen FROM assignment_stops WHERE assignment_id = $1 ORDER BY stop_number ASC;',
          [plan3Id],
        );
        expect(stopsResult.rows.length).toBe(6);
        const stopNumbers = stopsResult.rows.map((s) => s.stop_number);
        expect(stopNumbers).toEqual([1, 2, 3, 4, 5, 6]);
        const stopIds = new Set(stopsResult.rows.map((s) => s.id));
        expect(stopIds.size).toBe(6);

        // 2. Before commit, plan 3 stops were all frozen except new ones (stops 1-4 were frozen, stops 5-6 were unfrozen)
        // Post-commit, commitAssignment sets is_frozen = TRUE on all stops of the committed assignment
        for (const stop of stopsResult.rows) {
          expect(stop.is_frozen).toBe(true);
        }
      } finally {
        dbClient.release();
      }
    });

    it('rejects committing an assignment where a frozen pickup references a request in CANCELLED status', async () => {
      const resource: RescueResource = {
        id: 'res_neg_cancelled',
        name: 'Rescue Unit Cancelled Test',
        type: 'BOAT',
        capacity: 6,
        speedKmH: 25,
        lat: 28.7,
        lng: 77.2,
        status: 'AVAILABLE',
      };
      const shelter: Shelter = {
        id: 'sh_neg_cancelled',
        name: 'Relief Shelter C',
        lat: 28.71,
        lng: 77.21,
        capacity: 100,
      };
      const reqCancelled: RescueRequest = {
        id: 'req_neg_cancelled',
        lat: 28.705,
        lng: 77.205,
        peopleCount: 2,
        urgency: 'HIGH',
        source: 'REPORTED',
        status: 'CANCELLED',
        createdAt: new Date().toISOString(),
      };

      await repo.insertResource(resource, 'REAL');
      await repo.insertShelter(shelter, 'REAL');
      await repo.insertRequest(reqCancelled);

      const planId = 'plan_neg_cancelled';
      await repo.insertAssignmentWithStops(
        {
          id: planId,
          scenario_id: 'test-neg-frozen',
          status: 'PROPOSED',
          metrics: null,
          unserved: null,
          committed_at: null,
          committed_by: null,
          created_at: new Date(),
          updated_at: new Date(),
        },
        [
          {
            id: `stop_${planId}_1`,
            assignment_id: planId,
            resource_id: resource.id,
            stop_number: 1,
            type: 'PICKUP',
            target_id: reqCancelled.id,
            location: `POINT(${reqCancelled.lng} ${reqCancelled.lat})`,
            passengers_picked_up: reqCancelled.peopleCount,
            passengers_dropped_off: 0,
            estimated_arrival_minutes: 10,
            is_frozen: true,
            created_at: new Date(),
          },
        ],
      );

      let commitErr: { code?: string; statusCode?: number } | null = null;
      try {
        await repo.commitAssignment(planId, 'operator_test');
      } catch (err) {
        commitErr = err as { code?: string; statusCode?: number };
      }

      expect(commitErr).not.toBeNull();
      expect(commitErr?.code).toBe('REQUEST_ALREADY_ASSIGNED');
      expect(commitErr?.statusCode).toBe(409);
      expect((commitErr as Error).message).toContain(
        'in frozen stop is in invalid status: CANCELLED',
      );
    });

    it('rejects committing an assignment where a new non-frozen pickup references an already ASSIGNED request', async () => {
      const resource: RescueResource = {
        id: 'res_neg_assigned',
        name: 'Rescue Unit Assigned Test',
        type: 'BOAT',
        capacity: 6,
        speedKmH: 25,
        lat: 28.7,
        lng: 77.2,
        status: 'AVAILABLE',
      };
      const shelter: Shelter = {
        id: 'sh_neg_assigned',
        name: 'Relief Shelter A',
        lat: 28.71,
        lng: 77.21,
        capacity: 100,
      };
      const reqAssigned: RescueRequest = {
        id: 'req_neg_assigned',
        lat: 28.705,
        lng: 77.205,
        peopleCount: 2,
        urgency: 'HIGH',
        source: 'REPORTED',
        status: 'ASSIGNED',
        createdAt: new Date().toISOString(),
      };

      await repo.insertResource(resource, 'REAL');
      await repo.insertShelter(shelter, 'REAL');
      await repo.insertRequest(reqAssigned);

      const planId = 'plan_neg_assigned';
      await repo.insertAssignmentWithStops(
        {
          id: planId,
          scenario_id: 'test-neg-nonfrozen',
          status: 'PROPOSED',
          metrics: null,
          unserved: null,
          committed_at: null,
          committed_by: null,
          created_at: new Date(),
          updated_at: new Date(),
        },
        [
          {
            id: `stop_${planId}_1`,
            assignment_id: planId,
            resource_id: resource.id,
            stop_number: 1,
            type: 'PICKUP',
            target_id: reqAssigned.id,
            location: `POINT(${reqAssigned.lng} ${reqAssigned.lat})`,
            passengers_picked_up: reqAssigned.peopleCount,
            passengers_dropped_off: 0,
            estimated_arrival_minutes: 10,
            is_frozen: false,
            created_at: new Date(),
          },
        ],
      );

      let commitErr: { code?: string; statusCode?: number } | null = null;
      try {
        await repo.commitAssignment(planId, 'operator_test');
      } catch (err) {
        commitErr = err as { code?: string; statusCode?: number };
      }

      expect(commitErr).not.toBeNull();
      expect(commitErr?.code).toBe('REQUEST_ALREADY_ASSIGNED');
      expect(commitErr?.statusCode).toBe(409);
      expect((commitErr as Error).message).toContain('is no longer in PENDING status');
    });

    it('rejects committing an assignment where the same request appears in both a frozen and a non-frozen pickup within one plan', async () => {
      const resA: RescueResource = {
        id: 'res_dup_a',
        name: 'Boat Alpha Duplicate Test',
        type: 'BOAT',
        capacity: 6,
        speedKmH: 25,
        lat: 28.7,
        lng: 77.2,
        status: 'AVAILABLE',
      };
      const resB: RescueResource = {
        id: 'res_dup_b',
        name: 'Boat Bravo Duplicate Test',
        type: 'BOAT',
        capacity: 6,
        speedKmH: 25,
        lat: 28.71,
        lng: 77.21,
        status: 'AVAILABLE',
      };
      const shelter: Shelter = {
        id: 'sh_dup_test',
        name: 'Duplicate Shelter',
        lat: 28.72,
        lng: 77.22,
        capacity: 100,
      };
      const reqDup: RescueRequest = {
        id: 'req_dup_target',
        lat: 28.705,
        lng: 77.205,
        peopleCount: 2,
        urgency: 'HIGH',
        source: 'REPORTED',
        status: 'PENDING',
        createdAt: new Date().toISOString(),
      };

      await repo.insertResource(resA, 'REAL');
      await repo.insertResource(resB, 'REAL');
      await repo.insertShelter(shelter, 'REAL');
      await repo.insertRequest(reqDup);

      // Commit initial plan for resA servicing reqDup
      const planAId = 'plan_dup_init_a';
      await repo.insertAssignmentWithStops(
        {
          id: planAId,
          scenario_id: 'test-dup-pickup',
          status: 'PROPOSED',
          metrics: null,
          unserved: null,
          committed_at: null,
          committed_by: null,
          created_at: new Date(),
          updated_at: new Date(),
        },
        [
          {
            id: `stop_${planAId}_1`,
            assignment_id: planAId,
            resource_id: resA.id,
            stop_number: 1,
            type: 'PICKUP',
            target_id: reqDup.id,
            location: `POINT(${reqDup.lng} ${reqDup.lat})`,
            passengers_picked_up: reqDup.peopleCount,
            passengers_dropped_off: 0,
            estimated_arrival_minutes: 10,
            is_frozen: false,
            created_at: new Date(),
          },
          {
            id: `stop_${planAId}_2`,
            assignment_id: planAId,
            resource_id: resA.id,
            stop_number: 2,
            type: 'DROPOFF',
            target_id: shelter.id,
            location: `POINT(${shelter.lng} ${shelter.lat})`,
            passengers_picked_up: 0,
            passengers_dropped_off: reqDup.peopleCount,
            estimated_arrival_minutes: 20,
            is_frozen: false,
            created_at: new Date(),
          },
        ],
      );
      await repo.commitAssignment(planAId, 'operator_init');

      // Now create a replan that has:
      // - resA keeping reqDup frozen (legitimate continuation)
      // - resB ALSO attempting a non-frozen pickup of the SAME reqDup
      const planReplanId = 'plan_dup_replan_conflict';
      await repo.insertAssignmentWithStops(
        {
          id: planReplanId,
          scenario_id: 'test-dup-pickup',
          status: 'PROPOSED',
          metrics: null,
          unserved: null,
          committed_at: null,
          committed_by: null,
          created_at: new Date(),
          updated_at: new Date(),
        },
        [
          {
            id: `stop_${planReplanId}_1`,
            assignment_id: planReplanId,
            resource_id: resA.id,
            stop_number: 1,
            type: 'PICKUP',
            target_id: reqDup.id,
            location: `POINT(${reqDup.lng} ${reqDup.lat})`,
            passengers_picked_up: reqDup.peopleCount,
            passengers_dropped_off: 0,
            estimated_arrival_minutes: 10,
            is_frozen: true,
            created_at: new Date(),
          },
          {
            id: `stop_${planReplanId}_2`,
            assignment_id: planReplanId,
            resource_id: resA.id,
            stop_number: 2,
            type: 'DROPOFF',
            target_id: shelter.id,
            location: `POINT(${shelter.lng} ${shelter.lat})`,
            passengers_picked_up: 0,
            passengers_dropped_off: reqDup.peopleCount,
            estimated_arrival_minutes: 20,
            is_frozen: true,
            created_at: new Date(),
          },
          {
            id: `stop_${planReplanId}_3`,
            assignment_id: planReplanId,
            resource_id: resB.id,
            stop_number: 1,
            type: 'PICKUP',
            target_id: reqDup.id, // Conflict: already picked up in frozen stop on resA
            location: `POINT(${reqDup.lng} ${reqDup.lat})`,
            passengers_picked_up: reqDup.peopleCount,
            passengers_dropped_off: 0,
            estimated_arrival_minutes: 15,
            is_frozen: false,
            created_at: new Date(),
          },
          {
            id: `stop_${planReplanId}_4`,
            assignment_id: planReplanId,
            resource_id: resB.id,
            stop_number: 2,
            type: 'DROPOFF',
            target_id: shelter.id,
            location: `POINT(${shelter.lng} ${shelter.lat})`,
            passengers_picked_up: 0,
            passengers_dropped_off: reqDup.peopleCount,
            estimated_arrival_minutes: 25,
            is_frozen: false,
            created_at: new Date(),
          },
        ],
      );

      let dupErr: { code?: string; statusCode?: number; message?: string } | null = null;
      try {
        await repo.commitAssignment(planReplanId, 'operator_test');
      } catch (err) {
        dupErr = err as { code?: string; statusCode?: number; message?: string };
      }

      expect(dupErr).not.toBeNull();
      expect(dupErr?.code).toBe('REQUEST_ALREADY_ASSIGNED');
      expect(dupErr?.statusCode).toBe(409);
      expect(dupErr?.message).toContain(
        `Duplicate PICKUP stop for request "${reqDup.id}" in assignment plan`,
      );
    });

    it('rejects committing an assignment with a frozen pickup for a request belonging to another vehicle (Check 3 - PICKUP)', async () => {
      const resA: RescueResource = {
        id: 'res_lineage_a',
        name: 'Boat Alpha',
        type: 'BOAT',
        capacity: 6,
        speedKmH: 25,
        lat: 28.7,
        lng: 77.2,
        status: 'AVAILABLE',
      };
      const resB: RescueResource = {
        id: 'res_lineage_b',
        name: 'Boat Bravo',
        type: 'BOAT',
        capacity: 6,
        speedKmH: 25,
        lat: 28.71,
        lng: 77.21,
        status: 'AVAILABLE',
      };
      const shelter: Shelter = {
        id: 'sh_lineage_cross',
        name: 'Lineage Shelter',
        lat: 28.72,
        lng: 77.22,
        capacity: 100,
      };
      const reqA: RescueRequest = {
        id: 'req_lineage_a',
        lat: 28.705,
        lng: 77.205,
        peopleCount: 2,
        urgency: 'HIGH',
        source: 'REPORTED',
        status: 'PENDING',
        createdAt: new Date().toISOString(),
      };
      const reqB: RescueRequest = {
        id: 'req_lineage_b',
        lat: 28.708,
        lng: 77.208,
        peopleCount: 2,
        urgency: 'HIGH',
        source: 'REPORTED',
        status: 'PENDING',
        createdAt: new Date().toISOString(),
      };

      await repo.insertResource(resA, 'REAL');
      await repo.insertResource(resB, 'REAL');
      await repo.insertShelter(shelter, 'REAL');
      await repo.insertRequest(reqA);
      await repo.insertRequest(reqB);

      // Commit initial plan for resA servicing reqA
      const planAId = 'plan_lineage_a';
      await repo.insertAssignmentWithStops(
        {
          id: planAId,
          scenario_id: 'test-lineage-cross',
          status: 'PROPOSED',
          metrics: null,
          unserved: null,
          committed_at: null,
          committed_by: null,
          created_at: new Date(),
          updated_at: new Date(),
        },
        [
          {
            id: `stop_${planAId}_1`,
            assignment_id: planAId,
            resource_id: resA.id,
            stop_number: 1,
            type: 'PICKUP',
            target_id: reqA.id,
            location: `POINT(${reqA.lng} ${reqA.lat})`,
            passengers_picked_up: reqA.peopleCount,
            passengers_dropped_off: 0,
            estimated_arrival_minutes: 10,
            is_frozen: false,
            created_at: new Date(),
          },
          {
            id: `stop_${planAId}_2`,
            assignment_id: planAId,
            resource_id: resA.id,
            stop_number: 2,
            type: 'DROPOFF',
            target_id: shelter.id,
            location: `POINT(${shelter.lng} ${shelter.lat})`,
            passengers_picked_up: 0,
            passengers_dropped_off: reqA.peopleCount,
            estimated_arrival_minutes: 20,
            is_frozen: false,
            created_at: new Date(),
          },
        ],
      );
      await repo.commitAssignment(planAId, 'operator_a');

      // Commit initial plan for resB servicing reqB so resB has prior committed lineage (Check 1 passes)
      const planBInitId = 'plan_lineage_b_init';
      await repo.insertAssignmentWithStops(
        {
          id: planBInitId,
          scenario_id: 'test-lineage-cross',
          status: 'PROPOSED',
          metrics: null,
          unserved: null,
          committed_at: null,
          committed_by: null,
          created_at: new Date(),
          updated_at: new Date(),
        },
        [
          {
            id: `stop_${planBInitId}_1`,
            assignment_id: planBInitId,
            resource_id: resB.id,
            stop_number: 1,
            type: 'PICKUP',
            target_id: reqB.id,
            location: `POINT(${reqB.lng} ${reqB.lat})`,
            passengers_picked_up: reqB.peopleCount,
            passengers_dropped_off: 0,
            estimated_arrival_minutes: 10,
            is_frozen: false,
            created_at: new Date(),
          },
          {
            id: `stop_${planBInitId}_2`,
            assignment_id: planBInitId,
            resource_id: resB.id,
            stop_number: 2,
            type: 'DROPOFF',
            target_id: shelter.id,
            location: `POINT(${shelter.lng} ${shelter.lat})`,
            passengers_picked_up: 0,
            passengers_dropped_off: reqB.peopleCount,
            estimated_arrival_minutes: 20,
            is_frozen: false,
            created_at: new Date(),
          },
        ],
      );
      await repo.commitAssignment(planBInitId, 'operator_b_init');

      // Now create a replan for resB: keeps its own stops frozen (Check 2 passes)
      // PLUS an extra fabricated frozen stop for reqA (belonging to resA)
      const planBReplanId = 'plan_lineage_b_replan';
      await repo.insertAssignmentWithStops(
        {
          id: planBReplanId,
          scenario_id: 'test-lineage-cross',
          status: 'PROPOSED',
          metrics: null,
          unserved: null,
          committed_at: null,
          committed_by: null,
          created_at: new Date(),
          updated_at: new Date(),
        },
        [
          {
            id: `stop_${planBReplanId}_1`,
            assignment_id: planBReplanId,
            resource_id: resB.id,
            stop_number: 1,
            type: 'PICKUP',
            target_id: reqB.id,
            location: `POINT(${reqB.lng} ${reqB.lat})`,
            passengers_picked_up: reqB.peopleCount,
            passengers_dropped_off: 0,
            estimated_arrival_minutes: 10,
            is_frozen: true,
            created_at: new Date(),
          },
          {
            id: `stop_${planBReplanId}_2`,
            assignment_id: planBReplanId,
            resource_id: resB.id,
            stop_number: 2,
            type: 'DROPOFF',
            target_id: shelter.id,
            location: `POINT(${shelter.lng} ${shelter.lat})`,
            passengers_picked_up: 0,
            passengers_dropped_off: reqB.peopleCount,
            estimated_arrival_minutes: 20,
            is_frozen: true,
            created_at: new Date(),
          },
          {
            id: `stop_${planBReplanId}_3`,
            assignment_id: planBReplanId,
            resource_id: resB.id,
            stop_number: 3,
            type: 'PICKUP',
            target_id: reqA.id, // Fabricated: belongs to resA, not resB
            location: `POINT(${reqA.lng} ${reqA.lat})`,
            passengers_picked_up: reqA.peopleCount,
            passengers_dropped_off: 0,
            estimated_arrival_minutes: 30,
            is_frozen: true,
            created_at: new Date(),
          },
        ],
      );

      let stealErr: { code?: string; statusCode?: number; message?: string } | null = null;
      try {
        await repo.commitAssignment(planBReplanId, 'operator_b');
      } catch (err) {
        stealErr = err as { code?: string; statusCode?: number; message?: string };
      }

      expect(stealErr).not.toBeNull();
      expect(stealErr?.code).toBe('RESOURCE_ALREADY_COMMITTED');
      expect(stealErr?.statusCode).toBe(409);
      expect(stealErr?.message).toBe(
        `Frozen PICKUP stop with target "${reqA.id}" does not belong to resource "${resB.id}"'s prior committed assignment lineage`,
      );
    });

    it('rejects committing an assignment with a frozen stop on a resource with no prior commitment (Check 1)', async () => {
      const resFresh: RescueResource = {
        id: 'res_fresh_noprior',
        name: 'Fresh Rescue Boat',
        type: 'BOAT',
        capacity: 6,
        speedKmH: 25,
        lat: 28.7,
        lng: 77.2,
        status: 'AVAILABLE',
      };
      const shelter: Shelter = {
        id: 'sh_fresh_noprior',
        name: 'Fresh Shelter',
        lat: 28.71,
        lng: 77.21,
        capacity: 100,
      };
      const reqFresh: RescueRequest = {
        id: 'req_fresh_noprior',
        lat: 28.705,
        lng: 77.205,
        peopleCount: 2,
        urgency: 'HIGH',
        source: 'REPORTED',
        status: 'PENDING',
        createdAt: new Date().toISOString(),
      };

      await repo.insertResource(resFresh, 'REAL');
      await repo.insertShelter(shelter, 'REAL');
      await repo.insertRequest(reqFresh);

      const planId = 'plan_fresh_noprior';
      await repo.insertAssignmentWithStops(
        {
          id: planId,
          scenario_id: 'test-fresh-noprior',
          status: 'PROPOSED',
          metrics: null,
          unserved: null,
          committed_at: null,
          committed_by: null,
          created_at: new Date(),
          updated_at: new Date(),
        },
        [
          {
            id: `stop_${planId}_1`,
            assignment_id: planId,
            resource_id: resFresh.id,
            stop_number: 1,
            type: 'DROPOFF',
            target_id: shelter.id,
            location: `POINT(${shelter.lng} ${shelter.lat})`,
            passengers_picked_up: 0,
            passengers_dropped_off: 0,
            estimated_arrival_minutes: 10,
            is_frozen: true,
            created_at: new Date(),
          },
        ],
      );

      let freshErr: { code?: string; statusCode?: number; message?: string } | null = null;
      try {
        await repo.commitAssignment(planId, 'operator_test');
      } catch (err) {
        freshErr = err as { code?: string; statusCode?: number; message?: string };
      }

      expect(freshErr).not.toBeNull();
      expect(freshErr?.code).toBe('RESOURCE_ALREADY_COMMITTED');
      expect(freshErr?.statusCode).toBe(409);
      expect(freshErr?.message).toBe(
        `Resource "${resFresh.id}" has frozen stops in proposed plan but has no prior committed assignment lineage`,
      );
    });

    it('rejects committing an assignment with a frozen DROPOFF not in lineage (Check 3 - DROPOFF)', async () => {
      const resource: RescueResource = {
        id: 'res_dropoff_lineage',
        name: 'Dropoff Lineage Boat',
        type: 'BOAT',
        capacity: 6,
        speedKmH: 25,
        lat: 28.7,
        lng: 77.2,
        status: 'AVAILABLE',
      };
      const shelterReal: Shelter = {
        id: 'sh_real_lineage',
        name: 'Real Shelter',
        lat: 28.71,
        lng: 77.21,
        capacity: 100,
      };
      const shelterAlien: Shelter = {
        id: 'sh_alien_lineage',
        name: 'Alien Shelter',
        lat: 28.73,
        lng: 77.23,
        capacity: 100,
      };
      const req: RescueRequest = {
        id: 'req_dropoff_lineage',
        lat: 28.705,
        lng: 77.205,
        peopleCount: 2,
        urgency: 'HIGH',
        source: 'REPORTED',
        status: 'PENDING',
        createdAt: new Date().toISOString(),
      };

      await repo.insertResource(resource, 'REAL');
      await repo.insertShelter(shelterReal, 'REAL');
      await repo.insertShelter(shelterAlien, 'REAL');
      await repo.insertRequest(req);

      // Commit initial plan with DROPOFF to shelterReal
      const planInitialId = 'plan_dropoff_init';
      await repo.insertAssignmentWithStops(
        {
          id: planInitialId,
          scenario_id: 'test-dropoff-lineage',
          status: 'PROPOSED',
          metrics: null,
          unserved: null,
          committed_at: null,
          committed_by: null,
          created_at: new Date(),
          updated_at: new Date(),
        },
        [
          {
            id: `stop_${planInitialId}_1`,
            assignment_id: planInitialId,
            resource_id: resource.id,
            stop_number: 1,
            type: 'PICKUP',
            target_id: req.id,
            location: `POINT(${req.lng} ${req.lat})`,
            passengers_picked_up: req.peopleCount,
            passengers_dropped_off: 0,
            estimated_arrival_minutes: 10,
            is_frozen: false,
            created_at: new Date(),
          },
          {
            id: `stop_${planInitialId}_2`,
            assignment_id: planInitialId,
            resource_id: resource.id,
            stop_number: 2,
            type: 'DROPOFF',
            target_id: shelterReal.id,
            location: `POINT(${shelterReal.lng} ${shelterReal.lat})`,
            passengers_picked_up: 0,
            passengers_dropped_off: req.peopleCount,
            estimated_arrival_minutes: 20,
            is_frozen: false,
            created_at: new Date(),
          },
        ],
      );
      await repo.commitAssignment(planInitialId, 'operator_init');

      // Create a replanned proposal incorporating legitimate pickup and dropoff (Check 2 passes)
      // PLUS an extra fabricated frozen DROPOFF to shelterAlien
      const planReplanId = 'plan_dropoff_alien';
      await repo.insertAssignmentWithStops(
        {
          id: planReplanId,
          scenario_id: 'test-dropoff-lineage',
          status: 'PROPOSED',
          metrics: null,
          unserved: null,
          committed_at: null,
          committed_by: null,
          created_at: new Date(),
          updated_at: new Date(),
        },
        [
          {
            id: `stop_${planReplanId}_1`,
            assignment_id: planReplanId,
            resource_id: resource.id,
            stop_number: 1,
            type: 'PICKUP',
            target_id: req.id,
            location: `POINT(${req.lng} ${req.lat})`,
            passengers_picked_up: req.peopleCount,
            passengers_dropped_off: 0,
            estimated_arrival_minutes: 10,
            is_frozen: true,
            created_at: new Date(),
          },
          {
            id: `stop_${planReplanId}_2`,
            assignment_id: planReplanId,
            resource_id: resource.id,
            stop_number: 2,
            type: 'DROPOFF',
            target_id: shelterReal.id,
            location: `POINT(${shelterReal.lng} ${shelterReal.lat})`,
            passengers_picked_up: 0,
            passengers_dropped_off: req.peopleCount,
            estimated_arrival_minutes: 20,
            is_frozen: true,
            created_at: new Date(),
          },
          {
            id: `stop_${planReplanId}_3`,
            assignment_id: planReplanId,
            resource_id: resource.id,
            stop_number: 3,
            type: 'DROPOFF',
            target_id: shelterAlien.id, // Alien dropoff never in prior lineage
            location: `POINT(${shelterAlien.lng} ${shelterAlien.lat})`,
            passengers_picked_up: 0,
            passengers_dropped_off: 0,
            estimated_arrival_minutes: 30,
            is_frozen: true,
            created_at: new Date(),
          },
        ],
      );

      let alienErr: { code?: string; statusCode?: number; message?: string } | null = null;
      try {
        await repo.commitAssignment(planReplanId, 'operator_replan');
      } catch (err) {
        alienErr = err as { code?: string; statusCode?: number; message?: string };
      }

      expect(alienErr).not.toBeNull();
      expect(alienErr?.code).toBe('RESOURCE_ALREADY_COMMITTED');
      expect(alienErr?.statusCode).toBe(409);
      expect(alienErr?.message).toBe(
        `Frozen DROPOFF stop with target "${shelterAlien.id}" does not belong to resource "${resource.id}"'s prior committed assignment lineage`,
      );
    });

    it('rejects committing an assignment if an operator unfreezes (isFrozen=false) a legitimate prior committed stop (Check 2)', async () => {
      const resUnfreeze: RescueResource = {
        id: 'res_unfreeze_test',
        name: 'Unfreeze Test Boat',
        type: 'BOAT',
        capacity: 6,
        speedKmH: 25,
        lat: 28.7,
        lng: 77.2,
        status: 'AVAILABLE',
      };
      const shelterUnfreeze: Shelter = {
        id: 'sh_unfreeze_test',
        name: 'Unfreeze Shelter',
        lat: 28.71,
        lng: 77.21,
        capacity: 100,
      };
      const reqUnfreeze: RescueRequest = {
        id: 'req_unfreeze_test',
        lat: 28.705,
        lng: 77.205,
        peopleCount: 2,
        urgency: 'HIGH',
        source: 'REPORTED',
        status: 'PENDING',
        createdAt: new Date().toISOString(),
      };

      await repo.insertResource(resUnfreeze, 'REAL');
      await repo.insertShelter(shelterUnfreeze, 'REAL');
      await repo.insertRequest(reqUnfreeze);

      const planInitId = 'plan_unfreeze_init';
      await repo.insertAssignmentWithStops(
        {
          id: planInitId,
          scenario_id: 'test-unfreeze',
          status: 'PROPOSED',
          metrics: null,
          unserved: null,
          committed_at: null,
          committed_by: null,
          created_at: new Date(),
          updated_at: new Date(),
        },
        [
          {
            id: `stop_${planInitId}_1`,
            assignment_id: planInitId,
            resource_id: resUnfreeze.id,
            stop_number: 1,
            type: 'PICKUP',
            target_id: reqUnfreeze.id,
            location: `POINT(${reqUnfreeze.lng} ${reqUnfreeze.lat})`,
            passengers_picked_up: reqUnfreeze.peopleCount,
            passengers_dropped_off: 0,
            estimated_arrival_minutes: 10,
            is_frozen: false,
            created_at: new Date(),
          },
          {
            id: `stop_${planInitId}_2`,
            assignment_id: planInitId,
            resource_id: resUnfreeze.id,
            stop_number: 2,
            type: 'DROPOFF',
            target_id: shelterUnfreeze.id,
            location: `POINT(${shelterUnfreeze.lng} ${shelterUnfreeze.lat})`,
            passengers_picked_up: 0,
            passengers_dropped_off: reqUnfreeze.peopleCount,
            estimated_arrival_minutes: 20,
            is_frozen: false,
            created_at: new Date(),
          },
        ],
      );
      await repo.commitAssignment(planInitId, 'operator_init');

      // Create replanned proposal that initially includes both stops frozen
      const planReplanId = 'plan_unfreeze_replan';
      await repo.insertAssignmentWithStops(
        {
          id: planReplanId,
          scenario_id: 'test-unfreeze',
          status: 'PROPOSED',
          metrics: null,
          unserved: null,
          committed_at: null,
          committed_by: null,
          created_at: new Date(),
          updated_at: new Date(),
        },
        [
          {
            id: `stop_${planReplanId}_1`,
            assignment_id: planReplanId,
            resource_id: resUnfreeze.id,
            stop_number: 1,
            type: 'PICKUP',
            target_id: reqUnfreeze.id,
            location: `POINT(${reqUnfreeze.lng} ${reqUnfreeze.lat})`,
            passengers_picked_up: reqUnfreeze.peopleCount,
            passengers_dropped_off: 0,
            estimated_arrival_minutes: 10,
            is_frozen: true,
            created_at: new Date(),
          },
          {
            id: `stop_${planReplanId}_2`,
            assignment_id: planReplanId,
            resource_id: resUnfreeze.id,
            stop_number: 2,
            type: 'DROPOFF',
            target_id: shelterUnfreeze.id,
            location: `POINT(${shelterUnfreeze.lng} ${shelterUnfreeze.lat})`,
            passengers_picked_up: 0,
            passengers_dropped_off: reqUnfreeze.peopleCount,
            estimated_arrival_minutes: 20,
            is_frozen: true,
            created_at: new Date(),
          },
        ],
      );

      // Simulate operator unfreezing dropoff stop 2 (e.g. PATCH /assignments/:id/stops/:stopId { isFrozen: false })
      await repo.updateAssignmentStop(planReplanId, `stop_${planReplanId}_2`, { is_frozen: false });

      let unfreezeErr: { code?: string; statusCode?: number; message?: string } | null = null;
      try {
        await repo.commitAssignment(planReplanId, 'operator_replan');
      } catch (err) {
        unfreezeErr = err as { code?: string; statusCode?: number; message?: string };
      }

      expect(unfreezeErr).not.toBeNull();
      expect(unfreezeErr?.code).toBe('RESOURCE_ALREADY_COMMITTED');
      expect(unfreezeErr?.statusCode).toBe(409);
      expect(unfreezeErr?.message).toContain(
        `Resource "${resUnfreeze.id}" has active stops in another committed/dispatched assignment "${planInitId}" that were not incorporated as frozen stops in this plan`,
      );
    });

    it('rejects committing an assignment at the pickup-status step if an operator unfreezes (isFrozen=false) a legitimate prior committed pickup stop', async () => {
      const resUnfreeze: RescueResource = {
        id: 'res_unfreeze_pick',
        name: 'Unfreeze Pickup Boat',
        type: 'BOAT',
        capacity: 6,
        speedKmH: 25,
        lat: 28.7,
        lng: 77.2,
        status: 'AVAILABLE',
      };
      const shelterUnfreeze: Shelter = {
        id: 'sh_unfreeze_pick',
        name: 'Unfreeze Pickup Shelter',
        lat: 28.71,
        lng: 77.21,
        capacity: 100,
      };
      const reqUnfreeze: RescueRequest = {
        id: 'req_unfreeze_pick',
        lat: 28.705,
        lng: 77.205,
        peopleCount: 2,
        urgency: 'HIGH',
        source: 'REPORTED',
        status: 'PENDING',
        createdAt: new Date().toISOString(),
      };

      await repo.insertResource(resUnfreeze, 'REAL');
      await repo.insertShelter(shelterUnfreeze, 'REAL');
      await repo.insertRequest(reqUnfreeze);

      const planInitId = 'plan_unfreeze_pick_init';
      await repo.insertAssignmentWithStops(
        {
          id: planInitId,
          scenario_id: 'test-unfreeze-pick',
          status: 'PROPOSED',
          metrics: null,
          unserved: null,
          committed_at: null,
          committed_by: null,
          created_at: new Date(),
          updated_at: new Date(),
        },
        [
          {
            id: `stop_${planInitId}_1`,
            assignment_id: planInitId,
            resource_id: resUnfreeze.id,
            stop_number: 1,
            type: 'PICKUP',
            target_id: reqUnfreeze.id,
            location: `POINT(${reqUnfreeze.lng} ${reqUnfreeze.lat})`,
            passengers_picked_up: reqUnfreeze.peopleCount,
            passengers_dropped_off: 0,
            estimated_arrival_minutes: 10,
            is_frozen: false,
            created_at: new Date(),
          },
          {
            id: `stop_${planInitId}_2`,
            assignment_id: planInitId,
            resource_id: resUnfreeze.id,
            stop_number: 2,
            type: 'DROPOFF',
            target_id: shelterUnfreeze.id,
            location: `POINT(${shelterUnfreeze.lng} ${shelterUnfreeze.lat})`,
            passengers_picked_up: 0,
            passengers_dropped_off: reqUnfreeze.peopleCount,
            estimated_arrival_minutes: 20,
            is_frozen: false,
            created_at: new Date(),
          },
        ],
      );
      await repo.commitAssignment(planInitId, 'operator_init');

      // Create replanned proposal that initially includes both stops frozen
      const planReplanId = 'plan_unfreeze_pick_replan';
      await repo.insertAssignmentWithStops(
        {
          id: planReplanId,
          scenario_id: 'test-unfreeze-pick',
          status: 'PROPOSED',
          metrics: null,
          unserved: null,
          committed_at: null,
          committed_by: null,
          created_at: new Date(),
          updated_at: new Date(),
        },
        [
          {
            id: `stop_${planReplanId}_1`,
            assignment_id: planReplanId,
            resource_id: resUnfreeze.id,
            stop_number: 1,
            type: 'PICKUP',
            target_id: reqUnfreeze.id,
            location: `POINT(${reqUnfreeze.lng} ${reqUnfreeze.lat})`,
            passengers_picked_up: reqUnfreeze.peopleCount,
            passengers_dropped_off: 0,
            estimated_arrival_minutes: 10,
            is_frozen: true,
            created_at: new Date(),
          },
          {
            id: `stop_${planReplanId}_2`,
            assignment_id: planReplanId,
            resource_id: resUnfreeze.id,
            stop_number: 2,
            type: 'DROPOFF',
            target_id: shelterUnfreeze.id,
            location: `POINT(${shelterUnfreeze.lng} ${shelterUnfreeze.lat})`,
            passengers_picked_up: 0,
            passengers_dropped_off: reqUnfreeze.peopleCount,
            estimated_arrival_minutes: 20,
            is_frozen: true,
            created_at: new Date(),
          },
        ],
      );

      // Simulate operator unfreezing pickup stop 1 (e.g. PATCH /assignments/:id/stops/:stopId { isFrozen: false })
      await repo.updateAssignmentStop(planReplanId, `stop_${planReplanId}_1`, { is_frozen: false });

      let unfreezeErr: { code?: string; statusCode?: number; message?: string } | null = null;
      try {
        await repo.commitAssignment(planReplanId, 'operator_replan');
      } catch (err) {
        unfreezeErr = err as { code?: string; statusCode?: number; message?: string };
      }

      expect(unfreezeErr).not.toBeNull();
      expect(unfreezeErr?.code).toBe('REQUEST_ALREADY_ASSIGNED');
      expect(unfreezeErr?.statusCode).toBe(409);
      expect(unfreezeErr?.message).toContain(
        `Request "${reqUnfreeze.id}" is no longer in PENDING status (current status: ASSIGNED)`,
      );
    });

    it('allows concurrent commits using different resources to both succeed', async () => {
      const res1: RescueResource = {
        id: 'res_diff_1',
        name: 'Boat Alpha',
        type: 'BOAT',
        capacity: 6,
        speedKmH: 25,
        lat: 28.7,
        lng: 77.2,
        status: 'AVAILABLE',
      };
      const res2: RescueResource = {
        id: 'res_diff_2',
        name: 'Truck Beta',
        type: 'HIGH_WATER_VEHICLE',
        capacity: 10,
        speedKmH: 35,
        lat: 28.72,
        lng: 77.22,
        status: 'AVAILABLE',
      };
      const shelter: Shelter = {
        id: 'sh_diff',
        name: 'Relief Shelter Y',
        lat: 28.71,
        lng: 77.21,
        capacity: 100,
      };
      const req1: RescueRequest = {
        id: 'req_diff_1',
        lat: 28.705,
        lng: 77.205,
        peopleCount: 2,
        urgency: 'HIGH',
        source: 'REPORTED',
        status: 'PENDING',
        createdAt: new Date().toISOString(),
      };
      const req2: RescueRequest = {
        id: 'req_diff_2',
        lat: 28.725,
        lng: 77.225,
        peopleCount: 3,
        urgency: 'MEDIUM',
        source: 'REPORTED',
        status: 'PENDING',
        createdAt: new Date().toISOString(),
      };

      await repo.insertResource(res1, 'REAL');
      await repo.insertResource(res2, 'REAL');
      await repo.insertShelter(shelter, 'REAL');
      await repo.insertRequest(req1);
      await repo.insertRequest(req2);

      const plan1Id = 'plan_diff_res_1';
      await repo.insertAssignmentWithStops(
        {
          id: plan1Id,
          scenario_id: 'test-diff-resources',
          status: 'PROPOSED',
          metrics: null,
          unserved: null,
          committed_at: null,
          committed_by: null,
          created_at: new Date(),
          updated_at: new Date(),
        },
        [
          {
            id: `stop_${plan1Id}_1`,
            assignment_id: plan1Id,
            resource_id: res1.id,
            stop_number: 1,
            type: 'PICKUP',
            target_id: req1.id,
            location: `POINT(${req1.lng} ${req1.lat})`,
            passengers_picked_up: req1.peopleCount,
            passengers_dropped_off: 0,
            estimated_arrival_minutes: 10,
            is_frozen: false,
            created_at: new Date(),
          },
          {
            id: `stop_${plan1Id}_2`,
            assignment_id: plan1Id,
            resource_id: res1.id,
            stop_number: 2,
            type: 'DROPOFF',
            target_id: shelter.id,
            location: `POINT(${shelter.lng} ${shelter.lat})`,
            passengers_picked_up: 0,
            passengers_dropped_off: req1.peopleCount,
            estimated_arrival_minutes: 20,
            is_frozen: false,
            created_at: new Date(),
          },
        ],
      );

      const plan2Id = 'plan_diff_res_2';
      await repo.insertAssignmentWithStops(
        {
          id: plan2Id,
          scenario_id: 'test-diff-resources',
          status: 'PROPOSED',
          metrics: null,
          unserved: null,
          committed_at: null,
          committed_by: null,
          created_at: new Date(),
          updated_at: new Date(),
        },
        [
          {
            id: `stop_${plan2Id}_1`,
            assignment_id: plan2Id,
            resource_id: res2.id,
            stop_number: 1,
            type: 'PICKUP',
            target_id: req2.id,
            location: `POINT(${req2.lng} ${req2.lat})`,
            passengers_picked_up: req2.peopleCount,
            passengers_dropped_off: 0,
            estimated_arrival_minutes: 15,
            is_frozen: false,
            created_at: new Date(),
          },
          {
            id: `stop_${plan2Id}_2`,
            assignment_id: plan2Id,
            resource_id: res2.id,
            stop_number: 2,
            type: 'DROPOFF',
            target_id: shelter.id,
            location: `POINT(${shelter.lng} ${shelter.lat})`,
            passengers_picked_up: 0,
            passengers_dropped_off: req2.peopleCount,
            estimated_arrival_minutes: 30,
            is_frozen: false,
            created_at: new Date(),
          },
        ],
      );

      const client1 = await pool.connect();
      const client2 = await pool.connect();
      const repo1 = new PostgisRepository(client1);
      const repo2 = new PostgisRepository(client2);

      try {
        const results = await Promise.allSettled([
          repo1.commitAssignment(plan1Id, 'operator_1'),
          repo2.commitAssignment(plan2Id, 'operator_2'),
        ]);

        const fulfilled = results.filter((r) => r.status === 'fulfilled');
        const rejected = results.filter((r) => r.status === 'rejected');

        expect(fulfilled.length).toBe(2);
        expect(rejected.length).toBe(0);

        const dbClient = await pool.connect();
        try {
          const committed = await dbClient.query<{ id: string }>(
            "SELECT id FROM assignments WHERE status = 'COMMITTED' ORDER BY id ASC;",
          );
          expect(committed.rows.map((r) => r.id).sort()).toEqual([plan1Id, plan2Id].sort());
        } finally {
          dbClient.release();
        }
      } finally {
        client1.release();
        client2.release();
      }
    });
  });

  describe('6. Scenario Provenance and Dynamic Region Regression Tests', () => {
    it('correctly labels purely real operational scenarios with simulated: false and provenance: REAL', async () => {
      const realResource: RescueResource = {
        id: 'res_real_op',
        name: 'NDRF Rescue Unit 1',
        type: 'BOAT',
        capacity: 8,
        speedKmH: 25,
        lat: 28.71,
        lng: 77.21,
        status: 'AVAILABLE',
      };
      const realShelter: Shelter = {
        id: 'sh_real_op',
        name: 'Government Relief Center',
        lat: 28.72,
        lng: 77.22,
        capacity: 200,
      };
      const realRequest: RescueRequest = {
        id: 'req_real_op',
        lat: 28.715,
        lng: 77.215,
        peopleCount: 4,
        urgency: 'HIGH',
        source: 'REPORTED',
        status: 'PENDING',
        createdAt: new Date().toISOString(),
      };

      await repo.insertResource(realResource, 'REAL');
      await repo.insertShelter(realShelter, 'REAL');
      await repo.insertRequest(realRequest);

      const requests = await repo.listRequests({ status: 'PENDING' });
      const resources = await repo.listResources();
      const shelters = await repo.listShelters();

      const scenario = assignmentService.constructOperationalScenario(
        'real-ops-test',
        requests,
        resources,
        shelters,
      );

      expect(scenario.simulated).toBe(false);
      expect(scenario.provenance).toBe('REAL');
      expect(scenario.metadata.simulated).toBe(false);
      expect(scenario.metadata.provenance).toBe('REAL');
      expect(scenario.syntheticDataNote).toBeUndefined();
      expect(scenario.metadata.region).toBe('Delhi NCR / Yamuna Floodplain');
    });

    it('correctly labels purely simulated scenarios with simulated: true and provenance: SIMULATED', async () => {
      const simResource: RescueResource = {
        id: 'res_sim_op',
        name: 'Simulated Boat Alpha',
        type: 'BOAT',
        capacity: 6,
        speedKmH: 25,
        lat: 28.71,
        lng: 77.21,
        status: 'AVAILABLE',
      };
      const simShelter: Shelter = {
        id: 'sh_sim_op',
        name: 'Simulated Relief Camp',
        lat: 28.72,
        lng: 77.22,
        capacity: 100,
      };
      const simRequest: RescueRequest = {
        id: 'req_sim_op',
        lat: 28.715,
        lng: 77.215,
        peopleCount: 2,
        urgency: 'LOW',
        source: 'SIMULATED',
        status: 'PENDING',
        createdAt: new Date().toISOString(),
      };

      await repo.insertResource(simResource, 'SIMULATED');
      await repo.insertShelter(simShelter, 'SIMULATED');
      await repo.insertRequest(simRequest);

      const requests = await repo.listRequests({ status: 'PENDING' });
      const resources = await repo.listResources();
      const shelters = await repo.listShelters();

      const scenario = assignmentService.constructOperationalScenario(
        'sim-ops-test',
        requests,
        resources,
        shelters,
      );

      expect(scenario.simulated).toBe(true);
      expect(scenario.provenance).toBe('SIMULATED');
      expect(scenario.metadata.simulated).toBe(true);
      expect(scenario.metadata.provenance).toBe('SIMULATED');
      expect(scenario.syntheticDataNote).toContain(
        'PROPOSED dispatch scenario generated on simulated platform data',
      );
    });

    it('explicitly classifies mixed-provenance scenarios with provenance: MIXED without mislabeling as pure simulated or real', async () => {
      const simResource: RescueResource = {
        id: 'res_mixed_sim',
        name: 'Synthetic Boat',
        type: 'BOAT',
        capacity: 6,
        speedKmH: 25,
        lat: 28.71,
        lng: 77.21,
        status: 'AVAILABLE',
      };
      const realShelter: Shelter = {
        id: 'sh_mixed_real',
        name: 'Permanent Shelter',
        lat: 28.72,
        lng: 77.22,
        capacity: 150,
      };
      const realCitizenRequest: RescueRequest = {
        id: 'req_mixed_real',
        lat: 28.715,
        lng: 77.215,
        peopleCount: 3,
        urgency: 'CRITICAL',
        source: 'REPORTED',
        status: 'PENDING',
        createdAt: new Date().toISOString(),
      };

      await repo.insertResource(simResource, 'SIMULATED');
      await repo.insertShelter(realShelter, 'REAL');
      await repo.insertRequest(realCitizenRequest);

      const requests = await repo.listRequests({ status: 'PENDING' });
      const resources = await repo.listResources();
      const shelters = await repo.listShelters();

      const scenario = assignmentService.constructOperationalScenario(
        'mixed-ops-test',
        requests,
        resources,
        shelters,
      );

      expect(scenario.provenance).toBe('MIXED');
      expect(scenario.metadata.provenance).toBe('MIXED');
      // Neither true nor false to avoid mislabeling
      expect(scenario.simulated).toBeUndefined();
      expect(scenario.metadata.simulated).toBeUndefined();
      expect(scenario.syntheticDataNote).toContain('MIXED PROVENANCE');
      expect(scenario.syntheticDataNote).toContain('real-world (2)');
      expect(scenario.syntheticDataNote).toContain('simulated (1)');
    });

    it('dynamically derives distinct regional metadata and valid bounds across diverse geographies', async () => {
      // 1. Assam / Brahmaputra Basin
      const assamScenario = assignmentService.constructOperationalScenario(
        'assam-flood',
        [
          {
            id: 'req_assam_1',
            lat: 26.18,
            lng: 91.73,
            peopleCount: 4,
            urgency: 'HIGH',
            source: 'REPORTED',
            createdAt: new Date().toISOString(),
          },
        ],
        [
          {
            id: 'res_assam_1',
            name: 'River Patrol 1',
            type: 'BOAT',
            capacity: 10,
            speedKmH: 30,
            lat: 26.19,
            lng: 91.74,
            status: 'AVAILABLE',
            source: 'REAL',
          },
        ],
        [
          {
            id: 'sh_assam_1',
            name: 'Guwahati High Ground Shelter',
            lat: 26.2,
            lng: 91.75,
            capacity: 300,
            source: 'REAL',
          },
        ],
      );
      expect(assamScenario.metadata.region).toBe('Assam / Brahmaputra Basin');
      expect(assamScenario.metadata.bounds.minLat).toBeLessThanOrEqual(26.18);
      expect(assamScenario.metadata.bounds.maxLat).toBeGreaterThanOrEqual(26.2);

      // 2. Mumbai Metropolitan / Konkan Coast
      const mumbaiScenario = assignmentService.constructOperationalScenario(
        'mumbai-flood',
        [
          {
            id: 'req_mumbai_1',
            lat: 19.07,
            lng: 72.87,
            peopleCount: 2,
            urgency: 'CRITICAL',
            source: 'REPORTED',
            createdAt: new Date().toISOString(),
          },
        ],
        [],
        [],
      );
      expect(mumbaiScenario.metadata.region).toBe('Mumbai Metropolitan / Konkan Coast');

      // 3. Kerala Flood Region
      const keralaScenario = assignmentService.constructOperationalScenario(
        'kerala-flood',
        [
          {
            id: 'req_kerala_1',
            lat: 9.93,
            lng: 76.26,
            peopleCount: 5,
            urgency: 'HIGH',
            source: 'REPORTED',
            createdAt: new Date().toISOString(),
          },
        ],
        [],
        [],
      );
      expect(keralaScenario.metadata.region).toBe('Kerala Flood Region');

      // 4. Custom coordinate area outside predefined lists (e.g., Houston / Florida or international)
      const foreignScenario = assignmentService.constructOperationalScenario(
        'london-response',
        [
          {
            id: 'req_london_1',
            lat: 51.51,
            lng: -0.12,
            peopleCount: 1,
            urgency: 'LOW',
            source: 'REPORTED',
            createdAt: new Date().toISOString(),
          },
        ],
        [],
        [],
      );
      expect(foreignScenario.metadata.region).toBe('Operational Area (51.51°N, 0.12°W)');
      expect(foreignScenario.metadata.bounds.minLat).toBeLessThan(51.51);
      expect(foreignScenario.metadata.bounds.maxLat).toBeGreaterThan(51.51);
    });
  });
});
