import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { getPool, closePool } from './connection.js';
import { PostgisRepository } from './repository.js';
import { RequestService } from '../services/requestService.js';
import { AssignmentService } from '../services/assignmentService.js';
import { CreateRequestSchema } from '../validation/requestSchema.js';
import { ProposeAssignmentSchema } from '../validation/assignmentSchema.js';
import type { RescueRequest, RescueResource, Shelter } from '@floodrelay/shared';

const hasDatabase = Boolean(process.env.DATABASE_URL);

describe.runIf(hasDatabase)('PostGIS Live Database Integration Tests', () => {
  const pool = getPool();
  const repo = new PostgisRepository(pool);
  const requestService = new RequestService(repo);
  const assignmentService = new AssignmentService(repo);

  beforeAll(async () => {
    const client = await pool.connect();
    client.release();
  });

  afterAll(async () => {
    await closePool();
  });

  beforeEach(async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        'TRUNCATE TABLE route_stops, assignments, requests, resources, shelters, audit_events CASCADE;',
      );
      await client.query('COMMIT');
    } catch {
      await client.query('ROLLBACK');
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

  describe('5. commitAssignment Transaction and Concurrency', () => {
    it('rolls back database state when a statement fails inside commit transaction', async () => {
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
  });
});
