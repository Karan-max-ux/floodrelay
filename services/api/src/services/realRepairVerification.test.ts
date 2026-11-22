import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../app.js';
import { getPool } from '../db/connection.js';
import { PostgisRepository } from '../db/repository.js';
import { AuthService } from './authService.js';
import type { DbAssignmentStop } from '../db/schema.js';
import { classifyRepairOutcome } from '../../../../tests/load/helpers/repairClassifier.js';
import {
  assertDisposableTestDatabase,
  FixtureRegistry,
  fetchAssignmentStopsWithCoordinates,
  assertFrozenStopsPreserved,
  type AuthoritativeFrozenStopBaseline,
  type PersistedProposalStop,
} from './realRepairVerificationHelper.js';

const requireDb = Boolean(
  process.env.REQUIRE_DB && process.env.REQUIRE_DB !== '0' && process.env.REQUIRE_DB !== 'false',
);
const hasDatabaseUrl = Boolean(process.env.DATABASE_URL);
const hasAllowFlag = Boolean(
  process.env.ALLOW_DISPOSABLE_REPAIR_TEST_DB === '1' ||
  process.env.ALLOW_DISPOSABLE_REPAIR_TEST_DB === 'true',
);
const shouldRun = (requireDb || hasDatabaseUrl) && hasAllowFlag;

describe.runIf(shouldRun)(
  'Real Seeded Repair Integration & Exact Frozen-Stop Invariants (PR #29)',
  () => {
    let app: Express;
    let repo: PostgisRepository;
    let authService: AuthService;
    let currentRegistry: FixtureRegistry | null = null;

    beforeAll(async () => {
      const pool = getPool();
      // Guard 1: Verify connected database identity and safety before ANY actions
      await assertDisposableTestDatabase(pool);

      repo = new PostgisRepository(pool);
      authService = new AuthService(repo);
      app = createApp({ repository: repo, authService });
    });

    afterEach(async () => {
      // Precise targeted cleanup of ONLY tracked fixtures created in the test
      if (currentRegistry) {
        const pool = getPool();
        await currentRegistry.cleanup(pool);
        currentRegistry = null;
      }
    });

    it('executes real solver-backed repair end-to-end, persists PROPOSED plan without auto-commit, and verifies classification', async () => {
      const pool = getPool();
      const registry = new FixtureRegistry();
      currentRegistry = registry;

      // 1. Provision authorized DISPATCHER role with unique test-run username
      const username = registry.generateId('disp_op');
      registry.operatorUsernames.add(username);

      const dOp = await authService.createOperator({
        username,
        name: 'Real Integration Dispatcher',
        role: 'DISPATCHER',
        password: 'SecureTestPassword123!',
      });
      const dLogin = await authService.authenticate(dOp.username, 'SecureTestPassword123!');
      registry.operatorSessionTokens.add(dLogin.token);
      const dispatcherToken = dLogin.token;

      // 2. Seed unique operational shelter and resource
      const shelterId = registry.generateId('shelter');
      registry.shelterIds.add(shelterId);

      const resourceId = registry.generateId('res_boat');
      registry.resourceIds.add(resourceId);

      await pool.query(
        `INSERT INTO shelters (id, name, location, capacity, current_occupancy, source)
         VALUES ($1, 'Test Safe Haven', ST_SetSRID(ST_MakePoint(77.25, 28.55), 4326), 100, 0, 'SIMULATED');`,
        [shelterId],
      );

      await pool.query(
        `INSERT INTO resources (id, name, type, capacity, speed_km_h, status, location, source)
         VALUES ($1, 'Alpha Rescue Boat', 'BOAT', 6, 30, 'AVAILABLE', ST_SetSRID(ST_MakePoint(77.20, 28.50), 4326), 'SIMULATED');`,
        [resourceId],
      );

      // 3. Seed deterministic operational request in PostgreSQL
      const reqId = registry.generateId('req');
      registry.requestIds.add(reqId);

      await repo.insertRequest(
        {
          id: reqId,
          lat: 28.52,
          lng: 77.22,
          peopleCount: 2,
          urgency: 'HIGH',
          source: 'SIMULATED',
          createdAt: new Date().toISOString(),
        },
        { verificationStatus: 'VERIFIED' },
      );

      // 4. Record operational event (REQUEST_CREATED) in database
      const eventId = registry.generateId('evt');
      registry.operationalEventIds.add(eventId);

      await repo.insertOperationalEvent({
        id: eventId,
        type: 'REQUEST_CREATED',
        entityType: 'REQUEST',
        entityId: reqId,
        actorId: null,
        actorType: 'CITIZEN',
        payload: { id: reqId, urgency: 'HIGH', peopleCount: 2 },
        occurredAt: new Date().toISOString(),
      });

      // 5. Call REAL POST /operations/repair API using authorized credentials (NO MOCKED SOLVER)
      const repairHttpRes = await request(app)
        .post('/operations/repair')
        .set('Authorization', `Bearer ${dispatcherToken}`)
        .send({ eventId })
        .expect(200);

      expect(repairHttpRes.body.success).toBe(true);
      const repairData = repairHttpRes.body.data;
      expect(repairData.status).toBe('PROPOSED');
      expect(repairData.proposalId).toBeDefined();
      expect(repairData.proposalId).toMatch(/^prop-repair-/);
      expect(repairData.churn).toBeDefined();
      expect(repairData.hasFrozenViolations).toBeFalsy();

      const proposalId = repairData.proposalId;
      registry.trackAssignment(proposalId);

      // 6. Retrieve proposal from authoritative GET /assignments/:id API
      const verifyHttpRes = await request(app)
        .get(`/assignments/${encodeURIComponent(proposalId)}`)
        .set('Authorization', `Bearer ${dispatcherToken}`)
        .expect(200);

      expect(verifyHttpRes.body.success).toBe(true);
      expect(verifyHttpRes.body.data.id).toBe(proposalId);
      expect(verifyHttpRes.body.data.status).toBe('PROPOSED');

      // 7. Verify outcome classification using load-test pure classifier
      const classification = classifyRepairOutcome(
        { status: 200, body: JSON.stringify(repairHttpRes.body) },
        { status: 200, body: JSON.stringify(verifyHttpRes.body) },
      );

      expect(classification.category).toBe('PROPOSED_VERIFIED');
      expect(classification.proposalId).toBe(proposalId);
      expect(classification.isFrozenPreserved).toBe(true);
      expect(classification.isUncommitted).toBe(true);

      // 8. Direct PostgreSQL Invariant Validation:
      //    A. Proposal exists with status PROPOSED
      //    B. committed_at is NULL (Proves: NO automatic commitment occurred!)
      //    C. Stops exist and match safety constraints
      const asgnDbRes = await pool.query('SELECT * FROM assignments WHERE id = $1;', [proposalId]);
      expect(asgnDbRes.rows.length).toBe(1);
      const dbAsgn = asgnDbRes.rows[0];
      expect(dbAsgn.status).toBe('PROPOSED');
      expect(dbAsgn.committed_at).toBeNull();

      const stopsDbRes = await pool.query(
        'SELECT * FROM assignment_stops WHERE assignment_id = $1 ORDER BY stop_number ASC;',
        [proposalId],
      );
      expect(stopsDbRes.rows.length).toBeGreaterThanOrEqual(2);
      const stops = stopsDbRes.rows;
      const pickupStop = stops.find((s) => s.type === 'PICKUP' && s.target_id === reqId);
      expect(pickupStop).toBeDefined();
      expect(pickupStop.passengers_picked_up).toBe(2);

      // 9. Verify audit event was logged and track it for cleanup
      const auditRes = await pool.query(
        "SELECT id FROM audit_events WHERE entity_id = $1 AND event_type = 'REPAIR_PROPOSAL_GENERATED';",
        [proposalId],
      );
      expect(auditRes.rows.length).toBe(1);
      registry.auditEventIds.add(auditRes.rows[0].id);
    });

    it('captures authoritative committed frozen stops and proves 100% preservation across repair of a new event', async () => {
      const pool = getPool();
      const registry = new FixtureRegistry();
      currentRegistry = registry;

      // 1. Setup operator
      const username = registry.generateId('disp_op');
      registry.operatorUsernames.add(username);

      const dOp = await authService.createOperator({
        username,
        name: 'Real Integration Dispatcher',
        role: 'DISPATCHER',
        password: 'SecureTestPassword123!',
      });
      const dLogin = await authService.authenticate(dOp.username, 'SecureTestPassword123!');
      registry.operatorSessionTokens.add(dLogin.token);
      const dispatcherToken = dLogin.token;

      // 2. Setup shelter and resource
      const shelterId = registry.generateId('shelter');
      registry.shelterIds.add(shelterId);

      const resourceId = registry.generateId('res_boat');
      registry.resourceIds.add(resourceId);

      await pool.query(
        `INSERT INTO shelters (id, name, location, capacity, current_occupancy, source)
         VALUES ($1, 'Test Safe Haven South', ST_SetSRID(ST_MakePoint(77.25, 28.55), 4326), 100, 0, 'SIMULATED');`,
        [shelterId],
      );

      await pool.query(
        `INSERT INTO resources (id, name, type, capacity, speed_km_h, status, location, source)
         VALUES ($1, 'Beta Rescue Boat', 'BOAT', 6, 30, 'AVAILABLE', ST_SetSRID(ST_MakePoint(77.20, 28.50), 4326), 'SIMULATED');`,
        [resourceId],
      );

      // 3. Seed frozen request and new request
      const reqFrozenId = registry.generateId('req_frozen');
      const reqNewId = registry.generateId('req_new');
      registry.requestIds.add(reqFrozenId);
      registry.requestIds.add(reqNewId);

      await repo.insertRequest(
        {
          id: reqFrozenId,
          lat: 28.51,
          lng: 77.21,
          peopleCount: 2,
          urgency: 'HIGH',
          source: 'SIMULATED',
          createdAt: new Date().toISOString(),
        },
        { verificationStatus: 'VERIFIED' },
      );

      await repo.insertRequest(
        {
          id: reqNewId,
          lat: 28.53,
          lng: 77.23,
          peopleCount: 3,
          urgency: 'HIGH',
          source: 'SIMULATED',
          createdAt: new Date().toISOString(),
        },
        { verificationStatus: 'VERIFIED' },
      );

      // 4. Seed an initial COMMITTED plan with 2 frozen stops (pickup and dropoff)
      const baseAssignId = registry.generateId('asgn_base');
      registry.trackAssignment(baseAssignId);

      const stop1Id = registry.generateId('stop_f1');
      const stop2Id = registry.generateId('stop_f2');
      registry.assignmentStopIds.add(stop1Id);
      registry.assignmentStopIds.add(stop2Id);

      const committedStops: DbAssignmentStop[] = [
        {
          id: stop1Id,
          assignment_id: baseAssignId,
          resource_id: resourceId,
          stop_number: 1,
          type: 'PICKUP',
          target_id: reqFrozenId,
          location: 'POINT(77.21 28.51)',
          passengers_picked_up: 2,
          passengers_dropped_off: 0,
          estimated_arrival_minutes: 10,
          is_frozen: true,
          created_at: new Date(),
        },
        {
          id: stop2Id,
          assignment_id: baseAssignId,
          resource_id: resourceId,
          stop_number: 2,
          type: 'DROPOFF',
          target_id: shelterId,
          location: 'POINT(77.25 28.55)',
          passengers_picked_up: 0,
          passengers_dropped_off: 2,
          estimated_arrival_minutes: 25,
          is_frozen: true,
          created_at: new Date(),
        },
      ];

      await repo.insertAssignmentWithStops(
        {
          id: baseAssignId,
          scenario_id: 'real-repair-scenario-frozen',
          status: 'COMMITTED',
          metrics: {
            coveragePercent: 100,
            totalTravelTimeMinutes: 25,
            totalTravelDistanceKm: 15,
            highPriorityWaitTimeMinutes: 10,
            solveDurationMs: 5,
            servedRequestsCount: 1,
            unservedRequestsCount: 0,
          },
          unserved: [],
          committed_at: new Date(),
          committed_by: 'ADMIN',
          created_at: new Date(),
          updated_at: new Date(),
        },
        committedStops,
      );

      // 5. Authoritative baseline capture: read directly from PostgreSQL with PostGIS coordinates
      const baselineStops = await fetchAssignmentStopsWithCoordinates(pool, baseAssignId);
      expect(baselineStops.length).toBe(2);
      expect(baselineStops.every((s) => s.isFrozen)).toBe(true);

      // 6. Record new operational event (REQUEST_CREATED)
      const eventId = registry.generateId('evt_new');
      registry.operationalEventIds.add(eventId);

      await repo.insertOperationalEvent({
        id: eventId,
        type: 'REQUEST_CREATED',
        entityType: 'REQUEST',
        entityId: reqNewId,
        actorId: null,
        actorType: 'CITIZEN',
        payload: { id: reqNewId, urgency: 'HIGH', peopleCount: 3 },
        occurredAt: new Date().toISOString(),
      });

      // 7. Execute real solver-backed repair API call
      const repairHttpRes = await request(app)
        .post('/operations/repair')
        .set('Authorization', `Bearer ${dispatcherToken}`)
        .send({ eventId })
        .expect(200);

      expect(repairHttpRes.body.success).toBe(true);
      const proposalId = repairHttpRes.body.data.proposalId;
      expect(proposalId).toBeDefined();
      registry.trackAssignment(proposalId);

      // 8. Fetch proposed stops directly from PostgreSQL with numeric coordinates
      const proposalStops = await fetchAssignmentStopsWithCoordinates(pool, proposalId);

      // 9. Exact frozen-stop preservation assertion:
      //    Verifies resource identity, stop sequence, types, targets, coordinates, and passenger counts
      assertFrozenStopsPreserved(baselineStops, proposalStops, 'PROPOSED');

      // 10. Verify original committed assignment remains unchanged in database
      const baseCheck = await pool.query(
        'SELECT status, committed_at FROM assignments WHERE id = $1;',
        [baseAssignId],
      );
      expect(baseCheck.rows[0].status).toBe('COMMITTED');
      expect(baseCheck.rows[0].committed_at).not.toBeNull();

      // 11. Verify new request was inserted without violating capacity or frozen stops
      const newPickup = proposalStops.find((s) => s.type === 'PICKUP' && s.targetId === reqNewId);
      expect(newPickup).toBeDefined();
      expect(newPickup!.passengersPickedUp).toBe(3);

      // 12. Classification verification via pure load test classifier
      const verifyHttpRes = await request(app)
        .get(`/assignments/${encodeURIComponent(proposalId)}`)
        .set('Authorization', `Bearer ${dispatcherToken}`)
        .expect(200);

      const classification = classifyRepairOutcome(
        { status: 200, body: JSON.stringify(repairHttpRes.body) },
        { status: 200, body: JSON.stringify(verifyHttpRes.body) },
      );

      expect(classification.category).toBe('PROPOSED_VERIFIED');
      expect(classification.isFrozenPreserved).toBe(true);
      expect(classification.isUncommitted).toBe(true);
    });

    describe('Negative Frozen-Stop Preservation Checks (Correction 2 Fix C)', () => {
      const baselineMock: AuthoritativeFrozenStopBaseline[] = [
        {
          resourceId: 'res-alpha',
          stopNumber: 1,
          type: 'PICKUP',
          targetId: 'req-1',
          lat: 28.51,
          lng: 77.21,
          passengersPickedUp: 2,
          passengersDroppedOff: 0,
          isFrozen: true,
        },
        {
          resourceId: 'res-alpha',
          stopNumber: 2,
          type: 'DROPOFF',
          targetId: 'shelter-1',
          lat: 28.55,
          lng: 77.25,
          passengersPickedUp: 0,
          passengersDroppedOff: 2,
          isFrozen: true,
        },
      ];

      const validProposalMock: PersistedProposalStop[] = [
        {
          id: 'p-stop-1',
          assignmentId: 'prop-1',
          resourceId: 'res-alpha',
          stopNumber: 1,
          type: 'PICKUP',
          targetId: 'req-1',
          lat: 28.51,
          lng: 77.21,
          passengersPickedUp: 2,
          passengersDroppedOff: 0,
          isFrozen: true,
        },
        {
          id: 'p-stop-2',
          assignmentId: 'prop-1',
          resourceId: 'res-alpha',
          stopNumber: 2,
          type: 'DROPOFF',
          targetId: 'shelter-1',
          lat: 28.55,
          lng: 77.25,
          passengersPickedUp: 0,
          passengersDroppedOff: 2,
          isFrozen: true,
        },
      ];

      it('passes validation when all frozen stops are identically preserved in PROPOSED status', () => {
        expect(() =>
          assertFrozenStopsPreserved(baselineMock, validProposalMock, 'PROPOSED'),
        ).not.toThrow();
      });

      it('fails when a frozen stop is removed from proposed plan', () => {
        const mutated = [validProposalMock[0]!]; // Dropoff removed!
        expect(() => assertFrozenStopsPreserved(baselineMock, mutated, 'PROPOSED')).toThrow(
          /was removed from proposed plan/,
        );
      });

      it('fails when a frozen stop is duplicated on the route', () => {
        const mutated = [
          ...validProposalMock,
          { ...validProposalMock[0]!, id: 'p-dup', stopNumber: 3 },
        ];
        expect(() => assertFrozenStopsPreserved(baselineMock, mutated, 'PROPOSED')).toThrow(
          /is duplicated 2 times/,
        );
      });

      it('fails when a frozen stop changes resource', () => {
        const mutated = [
          validProposalMock[0]!,
          { ...validProposalMock[1]!, resourceId: 'res-beta' }, // Changed resource!
        ];
        expect(() => assertFrozenStopsPreserved(baselineMock, mutated, 'PROPOSED')).toThrow(
          /changed resource from "res-alpha" to "res-beta"/,
        );
      });

      it('fails when two frozen stops are reordered in sequence', () => {
        const mutated = [
          { ...validProposalMock[0]!, stopNumber: 2 },
          { ...validProposalMock[1]!, stopNumber: 1 },
        ];
        expect(() => assertFrozenStopsPreserved(baselineMock, mutated, 'PROPOSED')).toThrow(
          /sequence reordered/,
        );
      });

      it('fails when coordinates change beyond permitted tolerance', () => {
        const mutated = [
          { ...validProposalMock[0]!, lat: 28.515 }, // Shifted ~550m beyond 1e-4 tolerance
          validProposalMock[1]!,
        ];
        expect(() => assertFrozenStopsPreserved(baselineMock, mutated, 'PROPOSED')).toThrow(
          /exceed tolerance/,
        );
      });

      it('fails when pickup passenger counts change', () => {
        const mutated = [
          { ...validProposalMock[0]!, passengersPickedUp: 3 }, // Changed from 2 to 3
          validProposalMock[1]!,
        ];
        expect(() => assertFrozenStopsPreserved(baselineMock, mutated, 'PROPOSED')).toThrow(
          /passengers picked up changed: was 2, now 3/,
        );
      });

      it('fails when drop-off passenger counts change', () => {
        const mutated = [
          validProposalMock[0]!,
          { ...validProposalMock[1]!, passengersDroppedOff: 1 }, // Changed from 2 to 1
        ];
        expect(() => assertFrozenStopsPreserved(baselineMock, mutated, 'PROPOSED')).toThrow(
          /passengers dropped off changed: was 2, now 1/,
        );
      });

      it('fails when frozen stop target ID changes', () => {
        const mutated = [
          { ...validProposalMock[0]!, targetId: 'req-different' },
          validProposalMock[1]!,
        ];
        expect(() => assertFrozenStopsPreserved(baselineMock, mutated, 'PROPOSED')).toThrow(
          /was removed from proposed plan/,
        );
      });

      it('fails when repaired proposal is illegally COMMITTED', () => {
        expect(() =>
          assertFrozenStopsPreserved(baselineMock, validProposalMock, 'COMMITTED'),
        ).toThrow(/Repaired proposal has status COMMITTED! Prohibited automatic commitment./);
      });
    });
  },
);
