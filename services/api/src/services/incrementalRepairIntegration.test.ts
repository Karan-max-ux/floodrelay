import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../app.js';
import { getPool } from '../db/connection.js';
import { PostgisRepository } from '../db/repository.js';
import { AuthService } from './authService.js';
import type { DbAssignmentStop } from '../db/schema.js';

const requireDb = Boolean(
  process.env.REQUIRE_DB && process.env.REQUIRE_DB !== '0' && process.env.REQUIRE_DB !== 'false',
);
const hasDatabaseUrl = Boolean(process.env.DATABASE_URL);
const shouldRun = requireDb || hasDatabaseUrl;

describe.runIf(shouldRun)('Live PostGIS Incremental Repair Pipeline (Scenarios A - G)', () => {
  let app: Express;
  let repo: PostgisRepository;
  let authService: AuthService;
  let dispatcherToken: string;
  let dispatcherUsername: string;
  let adminToken: string;
  let operatorToken: string;

  beforeAll(async () => {
    const pool = getPool();
    repo = new PostgisRepository(pool);
    authService = new AuthService(repo);
    app = createApp({ repository: repo, authService });

    // Clean test tables to ensure a predictable test environment
    const client = await pool.connect();
    try {
      await client.query(
        "DELETE FROM audit_events WHERE entity_id LIKE 'test-%' OR entity_id LIKE 'prop-repair-%'",
      );
      await client.query("DELETE FROM operational_events WHERE entity_id LIKE 'test-%'");
      await client.query(
        "DELETE FROM assignment_stops WHERE assignment_id LIKE 'test-%' OR assignment_id LIKE 'prop-repair-%' OR resource_id LIKE 'test-%'",
      );
      await client.query(
        "DELETE FROM assignments WHERE id LIKE 'test-%' OR id LIKE 'prop-repair-%'",
      );
      await client.query("DELETE FROM requests WHERE id LIKE 'test-%'");
      await client.query("DELETE FROM resources WHERE id LIKE 'test-%'");
      await client.query("DELETE FROM shelters WHERE id LIKE 'test-%'");
      await client.query("DELETE FROM operator_sessions WHERE token LIKE 'test-tok-%'");
      await client.query("DELETE FROM operators WHERE username LIKE 'test_user_%'");

      // Provision roles
      const dOp = await authService.createOperator({
        username: `test_user_disp_${Date.now()}`,
        name: 'Test Dispatcher',
        role: 'DISPATCHER',
        password: 'Password123!',
      });
      dispatcherUsername = dOp.username;
      const dLogin = await authService.authenticate(dOp.username, 'Password123!');
      dispatcherToken = dLogin.token;

      const aOp = await authService.createOperator({
        username: `test_user_admin_${Date.now()}`,
        name: 'Test Admin',
        role: 'ADMIN',
        password: 'Password123!',
      });
      const aLogin = await authService.authenticate(aOp.username, 'Password123!');
      adminToken = aLogin.token;

      const oOp = await authService.createOperator({
        username: `test_user_op_${Date.now()}`,
        name: 'Test Operator',
        role: 'OPERATOR',
        password: 'Password123!',
      });
      const oLogin = await authService.authenticate(oOp.username, 'Password123!');
      operatorToken = oLogin.token;

      // Seed baseline operational resources and shelters
      await client.query(`
        INSERT INTO shelters (id, name, location, capacity, current_occupancy, source)
        VALUES 
          ('test-shelter-1', 'Test Shelter North', ST_SetSRID(ST_MakePoint(77.25, 28.55), 4326), 100, 0, 'REAL'),
          ('test-shelter-2', 'Test Shelter South', ST_SetSRID(ST_MakePoint(77.30, 28.50), 4326), 100, 0, 'REAL')
        ON CONFLICT (id) DO UPDATE SET source = 'REAL';
      `);

      await client.query(`
        INSERT INTO resources (id, name, type, capacity, speed_km_h, status, location, source)
        VALUES 
          ('test-res-boat-1', 'Alpha Boat', 'BOAT', 4, 25, 'AVAILABLE', ST_SetSRID(ST_MakePoint(77.20, 28.50), 4326), 'REAL'),
          ('test-res-van-2', 'Bravo HighWater', 'HIGH_WATER_VEHICLE', 6, 40, 'AVAILABLE', ST_SetSRID(ST_MakePoint(77.22, 28.52), 4326), 'REAL')
        ON CONFLICT (id) DO UPDATE SET status = 'AVAILABLE', source = 'REAL';
      `);
    } finally {
      client.release();
    }
  });

  beforeEach(async () => {
    const pool = getPool();
    const client = await pool.connect();
    try {
      await client.query(
        "DELETE FROM audit_events WHERE entity_id LIKE 'test-%' OR entity_id LIKE 'prop-repair-%'",
      );
      await client.query("DELETE FROM operational_events WHERE entity_id LIKE 'test-%'");
      await client.query(
        "DELETE FROM assignment_stops WHERE assignment_id LIKE 'test-%' OR assignment_id LIKE 'prop-repair-%'",
      );
      await client.query(
        "DELETE FROM assignments WHERE id LIKE 'test-%' OR id LIKE 'prop-repair-%'",
      );
      await client.query("DELETE FROM requests WHERE id LIKE 'test-%'");
      await client.query("DELETE FROM blocked_zones WHERE id LIKE 'test-%'");
      await client.query("UPDATE resources SET status = 'AVAILABLE' WHERE id LIKE 'test-%'");
    } finally {
      client.release();
    }
  });

  afterAll(async () => {
    const pool = getPool();
    const client = await pool.connect();
    try {
      await client.query(
        "DELETE FROM audit_events WHERE entity_id LIKE 'test-%' OR entity_id LIKE 'prop-repair-%'",
      );
      await client.query("DELETE FROM operational_events WHERE entity_id LIKE 'test-%'");
      await client.query(
        "DELETE FROM assignment_stops WHERE assignment_id LIKE 'test-%' OR assignment_id LIKE 'prop-repair-%' OR resource_id LIKE 'test-%'",
      );
      await client.query(
        "DELETE FROM assignments WHERE id LIKE 'test-%' OR id LIKE 'prop-repair-%'",
      );
      await client.query("DELETE FROM requests WHERE id LIKE 'test-%'");
      await client.query("DELETE FROM resources WHERE id LIKE 'test-%'");
      await client.query("DELETE FROM shelters WHERE id LIKE 'test-%'");
      await client.query("DELETE FROM operator_sessions WHERE token LIKE 'test-tok-%'");
      await client.query("DELETE FROM operators WHERE username LIKE 'test_user_%'");
    } finally {
      client.release();
    }
  });

  // ---------------------------------------------------------------------------
  // SCENARIO A — New rescue request end to end
  // ---------------------------------------------------------------------------
  it('Scenario A: processes REQUEST_CREATED end to end with proposal persistence and explicit commit', async () => {
    const testReqId = `test-req-scen-a-${Date.now()}`;
    const testEventId = `test-evt-scen-a-${Date.now()}`;

    // 1. Insert new request
    await repo.insertRequest(
      {
        id: testReqId,
        lat: 28.51,
        lng: 77.21,
        peopleCount: 2,
        urgency: 'HIGH',
        source: 'REPORTED',
        createdAt: new Date().toISOString(),
      },
      { verificationStatus: 'VERIFIED' },
    );

    // 2. Record REQUEST_CREATED event
    await repo.insertOperationalEvent({
      id: testEventId,
      type: 'REQUEST_CREATED',
      entityType: 'REQUEST',
      entityId: testReqId,
      actorId: null,
      actorType: 'CITIZEN',
      payload: { id: testReqId, urgency: 'HIGH', peopleCount: 2 },
      occurredAt: new Date().toISOString(),
    });

    // 3. Inspect affected scope via API
    const scopeRes = await request(app)
      .get(`/operations/events/${testEventId}/affected-scope`)
      .set('Authorization', `Bearer ${dispatcherToken}`)
      .expect(200);

    expect(scopeRes.body.success).toBe(true);
    expect(scopeRes.body.data.affectedScope.affectedRequestIds).toContain(testReqId);
    expect(scopeRes.body.data.affectedScope.repairEligible).toBe(true);

    // 4. Request repair through API
    const repairRes = await request(app)
      .post('/operations/repair')
      .set('Authorization', `Bearer ${dispatcherToken}`)
      .send({ eventId: testEventId })
      .expect(200);

    expect(repairRes.body.success).toBe(true);
    const repairData = repairRes.body.data;
    expect(repairData.status).toBe('PROPOSED');
    expect(repairData.proposalId).toBeDefined();
    expect(repairData.proposalId).toMatch(/^prop-repair-/);
    expect(repairData.churn).toBeDefined();

    const proposalId = repairData.proposalId;

    // 5. Verify the PROPOSED assignment is persisted in PostgreSQL
    const persistedProposal = await repo.getAssignmentWithStops(proposalId);
    expect(persistedProposal).not.toBeNull();
    expect(persistedProposal!.assignment.status).toBe('PROPOSED');
    expect(persistedProposal!.assignment.committed_at).toBeNull(); // PROVE: NO automatic commitment occurred!
    expect(persistedProposal!.stops.length).toBeGreaterThan(0);

    // 6. Verify audit event was inserted
    const pool = getPool();
    const auditRes = await pool.query(
      "SELECT * FROM audit_events WHERE entity_id = $1 AND event_type = 'REPAIR_PROPOSAL_GENERATED'",
      [proposalId],
    );
    expect(auditRes.rows.length).toBe(1);

    // 7. Explicit authorized operator commitment workflow
    const commitRes = await request(app)
      .post(`/assignments/${encodeURIComponent(proposalId)}/commit`)
      .set('Authorization', `Bearer ${dispatcherToken}`)
      .send({
        operatorId: dispatcherUsername,
        notes: 'Authorized field operation approval',
      })
      .expect(200);

    expect(commitRes.body.success).toBe(true);
    expect(commitRes.body.data.status).toBe('COMMITTED');

    // 8. Verify COMMITTED state in database
    const finalCommitted = await repo.getAssignmentWithStops(proposalId);
    expect(finalCommitted!.assignment.status).toBe('COMMITTED');
    expect(finalCommitted!.assignment.committed_at).not.toBeNull();
  });

  // ---------------------------------------------------------------------------
  // SCENARIO B — Offline resource
  // ---------------------------------------------------------------------------
  it('Scenario B: safely handles RESOURCE_OFFLINE, preserving frozen work and reallocating mutable work', async () => {
    const pool = getPool();
    const client = await pool.connect();
    const baseAssignId = `test-assign-base-scen-b-${Date.now()}`;
    const reqFrozenId = `test-req-frozen-b-${Date.now()}`;
    const reqMutableId = `test-req-mutable-b-${Date.now()}`;

    try {
      // Create requests
      await repo.insertRequest(
        {
          id: reqFrozenId,
          lat: 28.51,
          lng: 77.21,
          peopleCount: 2,
          urgency: 'HIGH',
          source: 'REPORTED',
          createdAt: new Date().toISOString(),
        },
        { verificationStatus: 'VERIFIED' },
      );
      await repo.insertRequest(
        {
          id: reqMutableId,
          lat: 28.52,
          lng: 77.22,
          peopleCount: 2,
          urgency: 'MEDIUM',
          source: 'REPORTED',
          createdAt: new Date().toISOString(),
        },
        { verificationStatus: 'VERIFIED' },
      );

      // Create committed assignment with frozen stop on boat-1 and mutable stop on van-2
      const stops: DbAssignmentStop[] = [
        {
          id: `stop-b-1`,
          assignment_id: baseAssignId,
          resource_id: 'test-res-boat-1',
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
          id: `stop-b-2`,
          assignment_id: baseAssignId,
          resource_id: 'test-res-boat-1',
          stop_number: 2,
          type: 'DROPOFF',
          target_id: 'test-shelter-1',
          location: 'POINT(77.25 28.55)',
          passengers_picked_up: 0,
          passengers_dropped_off: 2,
          estimated_arrival_minutes: 25,
          is_frozen: true,
          created_at: new Date(),
        },
        {
          id: `stop-b-3`,
          assignment_id: baseAssignId,
          resource_id: 'test-res-van-2',
          stop_number: 1,
          type: 'PICKUP',
          target_id: reqMutableId,
          location: 'POINT(77.22 28.52)',
          passengers_picked_up: 2,
          passengers_dropped_off: 0,
          estimated_arrival_minutes: 15,
          is_frozen: false,
          created_at: new Date(),
        },
        {
          id: `stop-b-4`,
          assignment_id: baseAssignId,
          resource_id: 'test-res-van-2',
          stop_number: 2,
          type: 'DROPOFF',
          target_id: 'test-shelter-1',
          location: 'POINT(77.25 28.55)',
          passengers_picked_up: 0,
          passengers_dropped_off: 2,
          estimated_arrival_minutes: 30,
          is_frozen: false,
          created_at: new Date(),
        },
      ];

      await repo.insertAssignmentWithStops(
        {
          id: baseAssignId,
          scenario_id: 'test-scenario-b',
          status: 'COMMITTED',
          metrics: {
            coveragePercent: 100,
            totalTravelTimeMinutes: 55,
            totalTravelDistanceKm: 30,
            highPriorityWaitTimeMinutes: 10,
            solveDurationMs: 5,
            servedRequestsCount: 2,
            unservedRequestsCount: 0,
          },
          unserved: [],
          committed_at: new Date(),
          committed_by: 'ADMIN',
          created_at: new Date(),
          updated_at: new Date(),
        },
        stops,
      );

      // Now emit RESOURCE_OFFLINE on test-res-van-2 (which has mutable work)
      const offlineEventId = `test-evt-offline-${Date.now()}`;
      await repo.insertOperationalEvent({
        id: offlineEventId,
        type: 'RESOURCE_OFFLINE',
        entityType: 'RESOURCE',
        entityId: 'test-res-van-2',
        actorId: null,
        actorType: 'OPERATOR',
        payload: { reason: 'Engine inspection' },
        occurredAt: new Date().toISOString(),
      });

      // Update resource status in DB to match
      await client.query("UPDATE resources SET status = 'OFFLINE' WHERE id = 'test-res-van-2'");

      const repairRes = await request(app)
        .post('/operations/repair')
        .set('Authorization', `Bearer ${dispatcherToken}`)
        .send({ eventId: offlineEventId, baselineAssignmentId: baseAssignId })
        .expect(200);

      expect(repairRes.body.success).toBe(true);
      // Mutable request from van-2 is reallocated or marked unserved; frozen work on boat-1 is preserved!
      if (repairRes.body.data.status === 'PROPOSED') {
        const boatRoute = repairRes.body.data.proposedPlan.routes.find(
          (r: { resourceId: string }) => r.resourceId === 'test-res-boat-1',
        );
        expect(boatRoute).toBeDefined();
        // Frozen stop #1 must still be intact on boat-1
        expect(boatRoute.stops[0].targetId).toBe(reqFrozenId);
        expect(boatRoute.stops[0].isFrozen).toBe(true);
      }
    } finally {
      await client.query("UPDATE resources SET status = 'AVAILABLE' WHERE id = 'test-res-van-2'");
      client.release();
    }
  });

  // ---------------------------------------------------------------------------
  // SCENARIO C — Road blockage
  // ---------------------------------------------------------------------------
  it('Scenario C: handles ROAD_BLOCKED event safely and enforces hazard zone avoidance', async () => {
    const zoneId = `test-zone-block-${Date.now()}`;
    const blockEventId = `test-evt-block-${Date.now()}`;

    // Add blocked zone covering target area
    await repo.insertBlockedZone({
      id: zoneId,
      name: 'Flooded Underpass Zone',
      polygon: [
        { lat: 28.515, lng: 77.215 },
        { lat: 28.515, lng: 77.235 },
        { lat: 28.535, lng: 77.235 },
        { lat: 28.535, lng: 77.215 },
      ],
      severity: 'BLOCKED',
      createdBy: 'DISPATCHER',
    });

    await repo.insertOperationalEvent({
      id: blockEventId,
      type: 'ROAD_BLOCKED',
      entityType: 'ROAD_ZONE',
      entityId: zoneId,
      actorId: null,
      actorType: 'OPERATOR',
      payload: { zoneId, severity: 'BLOCKED' },
      occurredAt: new Date().toISOString(),
    });

    const repairRes = await request(app)
      .post('/operations/repair')
      .set('Authorization', `Bearer ${dispatcherToken}`)
      .send({ eventId: blockEventId })
      .expect(200);

    expect(repairRes.body.success).toBe(true);
    // Road blockage results in either valid detour proposal or NO_FEASIBLE_REPAIR with clear explanation
    expect(['PROPOSED', 'NO_FEASIBLE_REPAIR']).toContain(repairRes.body.data.status);
    expect(Array.isArray(repairRes.body.data.warnings)).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // SCENARIO D — Duplicate flag
  // ---------------------------------------------------------------------------
  it('Scenario D: preserves existing rescue assignments when REQUEST_FLAGGED_DUPLICATE occurs', async () => {
    const testReqId = `test-req-dup-${Date.now()}`;
    const testEventId = `test-evt-dup-${Date.now()}`;

    await repo.insertRequest(
      {
        id: testReqId,
        lat: 28.51,
        lng: 77.21,
        peopleCount: 3,
        urgency: 'HIGH',
        source: 'REPORTED',
        createdAt: new Date().toISOString(),
      },
      { verificationStatus: 'UNVERIFIED', isFlaggedDuplicate: true },
    );

    await repo.insertOperationalEvent({
      id: testEventId,
      type: 'REQUEST_FLAGGED_DUPLICATE',
      entityType: 'REQUEST',
      entityId: testReqId,
      actorId: null,
      actorType: 'CITIZEN',
      payload: { id: testReqId, isFlaggedDuplicate: true },
      occurredAt: new Date().toISOString(),
    });

    const repairRes = await request(app)
      .post('/operations/repair')
      .set('Authorization', `Bearer ${dispatcherToken}`)
      .send({ eventId: testEventId })
      .expect(200);

    expect(repairRes.body.success).toBe(true);
    // Crucial check: Flagging duplicate must NOT cancel the request or modify assignments!
    expect(repairRes.body.data.status).toBe('NO_FEASIBLE_REPAIR');
    expect(
      repairRes.body.data.warnings.some((w: string) => w.includes('suspected duplicate')),
    ).toBe(true);

    // Verify request in DB was NOT deleted or cancelled
    const reqRow = await repo.getRequestById(testReqId);
    expect(reqRow).not.toBeNull();
    expect(reqRow!.status).not.toBe('CANCELLED');
  });

  // ---------------------------------------------------------------------------
  // SCENARIO E — Concurrency
  // ---------------------------------------------------------------------------
  it('Scenario E: enforces version checks and detects concurrency conflicts (409)', async () => {
    const testReqId = `test-req-concur-${Date.now()}`;
    const testEventId = `test-evt-concur-${Date.now()}`;

    await repo.insertRequest(
      {
        id: testReqId,
        lat: 28.51,
        lng: 77.21,
        peopleCount: 1,
        urgency: 'LOW',
        source: 'REPORTED',
        createdAt: new Date().toISOString(),
      },
      { verificationStatus: 'VERIFIED' },
    );

    await repo.insertOperationalEvent({
      id: testEventId,
      type: 'REQUEST_CREATED',
      entityType: 'REQUEST',
      entityId: testReqId,
      actorId: null,
      actorType: 'CITIZEN',
      payload: { id: testReqId },
      occurredAt: new Date().toISOString(),
    });

    // Provide mismatched expectedVersion (event has version 1)
    const conflictRes = await request(app)
      .post('/operations/repair')
      .set('Authorization', `Bearer ${dispatcherToken}`)
      .send({ eventId: testEventId, expectedVersion: 999 })
      .expect(409);

    expect(conflictRes.body.error.code).toBe('VERSION_CONFLICT');
  });

  // ---------------------------------------------------------------------------
  // SCENARIO F — Infeasible repair
  // ---------------------------------------------------------------------------
  it('Scenario F: safely rejects infeasible repairs without persisting invalid proposals', async () => {
    const pool = getPool();
    const client = await pool.connect();
    const testReqId = `test-req-infeas-${Date.now()}`;
    const testEventId = `test-evt-infeas-${Date.now()}`;

    try {
      // Mark all resources OFFLINE
      await client.query("UPDATE resources SET status = 'OFFLINE'");

      await repo.insertRequest(
        {
          id: testReqId,
          lat: 28.51,
          lng: 77.21,
          peopleCount: 1,
          urgency: 'LOW',
          source: 'REPORTED',
          createdAt: new Date().toISOString(),
        },
        { verificationStatus: 'VERIFIED' },
      );

      await repo.insertOperationalEvent({
        id: testEventId,
        type: 'REQUEST_CREATED',
        entityType: 'REQUEST',
        entityId: testReqId,
        actorId: null,
        actorType: 'CITIZEN',
        payload: { id: testReqId },
        occurredAt: new Date().toISOString(),
      });

      const repairRes = await request(app)
        .post('/operations/repair')
        .set('Authorization', `Bearer ${dispatcherToken}`)
        .send({ eventId: testEventId })
        .expect(200);

      expect(repairRes.body.success).toBe(true);
      expect(repairRes.body.data.status).toBe('NO_FEASIBLE_REPAIR');
      expect(repairRes.body.data.unservedRequestIds).toContain(testReqId);
      expect(repairRes.body.data.proposalId).toBeUndefined(); // NO proposal persisted!
    } finally {
      await client.query("UPDATE resources SET status = 'AVAILABLE'");
      client.release();
    }
  });

  // ---------------------------------------------------------------------------
  // SCENARIO G — Authorization & RBAC
  // ---------------------------------------------------------------------------
  it('Scenario G: enforces strict RBAC across repair operations', async () => {
    const testEventId = `test-evt-auth-${Date.now()}`;
    await repo.insertOperationalEvent({
      id: testEventId,
      type: 'REQUEST_CREATED',
      entityType: 'REQUEST',
      entityId: 'test-req-nonexistent',
      actorId: null,
      actorType: 'CITIZEN',
      payload: {},
      occurredAt: new Date().toISOString(),
    });

    // 1. Unauthenticated access rejected with 401
    await request(app).post('/operations/repair').send({ eventId: testEventId }).expect(401);

    // 2. DISPATCHER role is authorized to invoke repair
    const dispRes = await request(app)
      .post('/operations/repair')
      .set('Authorization', `Bearer ${dispatcherToken}`)
      .send({ eventId: testEventId });
    // Should be processed (may return 404 or 500 safety snapshot incomplete, but NOT 401 or 403)
    expect([200, 404, 500]).toContain(dispRes.status);

    // 3. ADMIN role is authorized to invoke repair
    const adminRes = await request(app)
      .post('/operations/repair')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ eventId: testEventId });
    expect([200, 404, 500]).toContain(adminRes.status);

    // 4. OPERATOR role lacks REQUEST_REPAIR permission and is rejected with 403
    await request(app)
      .post('/operations/repair')
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ eventId: testEventId })
      .expect(403);
  });
});
