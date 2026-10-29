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

    it('prevents two different proposals using the same resource for different requests from committing concurrently', async () => {
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

      // Execute conflicting commits concurrently using independent database connections
      const client1 = await pool.connect();
      const client2 = await pool.connect();
      const repo1 = new PostgisRepository(client1);
      const repo2 = new PostgisRepository(client2);

      try {
        const results = await Promise.allSettled([
          repo1.commitAssignment(planAId, 'operator_1'),
          repo2.commitAssignment(planBId, 'operator_2'),
        ]);

        const fulfilled = results.filter((r) => r.status === 'fulfilled');
        const rejected = results.filter((r) => r.status === 'rejected');

        expect(fulfilled.length).toBe(1);
        expect(rejected.length).toBe(1);

        const rejectedReason = (rejected[0] as PromiseRejectedResult).reason;
        expect(rejectedReason.code).toBe('RESOURCE_ALREADY_COMMITTED');
        expect(rejectedReason.statusCode).toBe(409);

        // Verify database contains NO conflicting committed assignments
        const dbClient = await pool.connect();
        try {
          const committedAssignments = await dbClient.query<{ id: string }>(
            "SELECT id FROM assignments WHERE status = 'COMMITTED';",
          );
          expect(committedAssignments.rows.length).toBe(1);
          const committedId = committedAssignments.rows[0]!.id;
          expect([planAId, planBId]).toContain(committedId);

          const uncommittedId = committedId === planAId ? planBId : planAId;
          const uncommitted = await dbClient.query<{ status: string }>(
            'SELECT status FROM assignments WHERE id = $1;',
            [uncommittedId],
          );
          expect(uncommitted.rows[0]!.status).toBe('PROPOSED');

          // Check that only the committed proposal's request was updated to ASSIGNED
          const reqRows = await dbClient.query<{ id: string; status: string }>(
            'SELECT id, status FROM requests ORDER BY id ASC;',
          );
          const reqStatusMap = new Map(reqRows.rows.map((r) => [r.id, r.status]));
          if (committedId === planAId) {
            expect(reqStatusMap.get('req_lock_a')).toBe('ASSIGNED');
            expect(reqStatusMap.get('req_lock_b')).toBe('PENDING');
          } else {
            expect(reqStatusMap.get('req_lock_a')).toBe('PENDING');
            expect(reqStatusMap.get('req_lock_b')).toBe('ASSIGNED');
          }
        } finally {
          dbClient.release();
        }
      } finally {
        client1.release();
        client2.release();
      }
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
