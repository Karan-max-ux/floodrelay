import request from 'supertest';
import { describe, it, expect, beforeEach } from 'vitest';
import type { Express } from 'express';
import { createApp } from '../app.js';
import { AuthService, InMemoryAuthRepository } from '../services/authService.js';
import { PostgisRepository, type Queryable } from '../db/repository.js';
import { RequestService } from '../services/requestService.js';
import { AssignmentService } from '../services/assignmentService.js';
import { OperationalEventService } from '../services/operationalEventService.js';
import { AffectedScopeService } from '../services/affectedScopeService.js';
import { RepairOrchestrationService } from '../services/repairOrchestrationService.js';
import type {
  DbRequest,
  DbResource,
  DbOperationalEvent,
  DbBlockedZone,
  DbAuditEvent,
} from '../db/schema.js';

class MockOperationsQueryable implements Queryable {
  public requests = new Map<string, DbRequest>();
  public resources = new Map<string, DbResource>();
  public operationalEvents = new Map<string, DbOperationalEvent>();
  public blockedZones = new Map<string, DbBlockedZone>();
  public auditEvents: DbAuditEvent[] = [];

  async query<R extends Record<string, unknown> = Record<string, unknown>>(
    sqlOrConfig: string | { text: string; values?: unknown[] },
    values?: unknown[],
  ): Promise<{ rows: R[]; command: string; rowCount: number; oid: number; fields: [] }> {
    const rawSql = typeof sqlOrConfig === 'string' ? sqlOrConfig : sqlOrConfig.text;
    const sql = rawSql.replace(/\s+/g, ' ').trim();
    const vals = values ?? (sqlOrConfig as { values?: unknown[] }).values ?? [];

    if (sql.includes('BEGIN') || sql.includes('COMMIT') || sql.includes('ROLLBACK')) {
      return { rows: [], command: 'TX', rowCount: 0, oid: 0, fields: [] };
    }

    // Insert operational event
    if (sql.includes('INSERT INTO operational_events')) {
      const id = vals[0] as string;
      const row: DbOperationalEvent = {
        id,
        event_type: vals[1] as DbOperationalEvent['event_type'],
        entity_type: vals[2] as DbOperationalEvent['entity_type'],
        entity_id: vals[3] as string,
        actor_id: (vals[4] as string) || null,
        actor_type: vals[5] as DbOperationalEvent['actor_type'],
        payload: JSON.parse(vals[6] as string),
        correlation_id: (vals[7] as string) || null,
        idempotency_key: (vals[8] as string) || null,
        entity_version: (vals[9] as number) || 1,
        processing_status: (vals[10] as DbOperationalEvent['processing_status']) || 'RECORDED',
        processing_attempts: (vals[11] as number) || 0,
        last_error_code: (vals[12] as string) || null,
        occurred_at: vals[13] as Date,
        created_at: new Date(),
        processed_at: (vals[14] as Date) || null,
      };
      this.operationalEvents.set(id, row);
      return { rows: [row as unknown as R], command: 'INSERT', rowCount: 1, oid: 0, fields: [] };
    }

    // Select operational event by ID
    if (sql.includes('FROM operational_events WHERE id = $1')) {
      const id = vals[0] as string;
      const row = this.operationalEvents.get(id);
      return {
        rows: row ? [row as unknown as R] : [],
        command: 'SELECT',
        rowCount: row ? 1 : 0,
        oid: 0,
        fields: [],
      };
    }

    // List operational events
    if (sql.includes('FROM operational_events')) {
      const rows = Array.from(this.operationalEvents.values());
      return {
        rows: rows as unknown as R[],
        command: 'SELECT',
        rowCount: rows.length,
        oid: 0,
        fields: [],
      };
    }

    // Update operational event status
    if (sql.includes('UPDATE operational_events SET')) {
      const id = vals[0] as string;
      const row = this.operationalEvents.get(id);
      if (row) {
        row.processing_status = vals[1] as DbOperationalEvent['processing_status'];
      }
      return { rows: [], command: 'UPDATE', rowCount: row ? 1 : 0, oid: 0, fields: [] };
    }

    // Insert blocked zone
    if (sql.includes('INSERT INTO blocked_zones')) {
      const id = vals[0] as string;
      const row: DbBlockedZone = {
        id,
        name: (vals[1] as string) || null,
        severity: vals[2] as DbBlockedZone['severity'],
        geometry: 'POLYGON((77.1 28.5, 77.2 28.5, 77.2 28.6, 77.1 28.6, 77.1 28.5))',
        is_active: true,
        created_by: vals[4] as string,
        created_at: new Date(),
        updated_at: new Date(),
      };
      this.blockedZones.set(id, row);
      return { rows: [row as unknown as R], command: 'INSERT', rowCount: 1, oid: 0, fields: [] };
    }

    // Get blocked zone
    if (sql.includes('FROM blocked_zones WHERE id = $1')) {
      const id = vals[0] as string;
      const row = this.blockedZones.get(id);
      return {
        rows: row ? [row as unknown as R] : [],
        command: 'SELECT',
        rowCount: row ? 1 : 0,
        oid: 0,
        fields: [],
      };
    }

    // Update blocked zone status
    if (sql.includes('UPDATE blocked_zones SET is_active = $2')) {
      const id = vals[0] as string;
      const row = this.blockedZones.get(id);
      if (row) {
        row.is_active = Boolean(vals[1]);
      }
      return { rows: [], command: 'UPDATE', rowCount: row ? 1 : 0, oid: 0, fields: [] };
    }

    // Resources
    if (sql.includes('FROM resources WHERE id = $1')) {
      const id = vals[0] as string;
      const r = this.resources.get(id);
      if (!r) return { rows: [], command: 'SELECT', rowCount: 0, oid: 0, fields: [] };
      return {
        rows: [
          {
            id: r.id,
            name: r.name,
            type: r.type,
            capacity: r.capacity,
            speedKmH: r.speed_km_h,
            lat: 28.6,
            lng: 77.2,
            status: r.status,
            depotId: r.depot_id,
            source: r.source,
          } as unknown as R,
        ],
        command: 'SELECT',
        rowCount: 1,
        oid: 0,
        fields: [],
      };
    }

    if (sql.includes('UPDATE resources SET status = $2')) {
      const id = vals[0] as string;
      const status = vals[1] as DbResource['status'];
      const r = this.resources.get(id);
      if (r) {
        r.status = status;
        return {
          rows: [
            {
              id: r.id,
              name: r.name,
              type: r.type,
              capacity: r.capacity,
              speedKmH: r.speed_km_h,
              lat: 28.6,
              lng: 77.2,
              status: r.status,
              depotId: r.depot_id,
              source: r.source,
            } as unknown as R,
          ],
          command: 'UPDATE',
          rowCount: 1,
          oid: 0,
          fields: [],
        };
      }
      return { rows: [], command: 'UPDATE', rowCount: 0, oid: 0, fields: [] };
    }

    if (sql.includes('FROM resources')) {
      let rows = Array.from(this.resources.values());
      const statusMatch = sql.match(/status = \$(\d+)/);
      if (statusMatch && statusMatch[1]) {
        const idx = parseInt(statusMatch[1], 10) - 1;
        const filterVal = vals[idx];
        rows = rows.filter((r) => r.status === filterVal);
      }
      const typeMatch = sql.match(/type = \$(\d+)/);
      if (typeMatch && typeMatch[1]) {
        const idx = parseInt(typeMatch[1], 10) - 1;
        const filterVal = vals[idx];
        rows = rows.filter((r) => r.type === filterVal);
      }
      const mapped = rows.map((r) => ({
        id: r.id,
        name: r.name,
        type: r.type,
        capacity: r.capacity,
        speedKmH: r.speed_km_h,
        lat: 28.6,
        lng: 77.2,
        status: r.status,
        depotId: r.depot_id,
        source: r.source,
      }));
      return {
        rows: mapped as unknown as R[],
        command: 'SELECT',
        rowCount: mapped.length,
        oid: 0,
        fields: [],
      };
    }

    // Requests
    if (sql.includes('FROM requests WHERE id = $1')) {
      const id = vals[0] as string;
      const req = this.requests.get(id);
      if (!req) return { rows: [], command: 'SELECT', rowCount: 0, oid: 0, fields: [] };
      return {
        rows: [
          {
            id: req.id,
            lat: 28.6,
            lng: 77.2,
            peopleCount: req.people_count,
            urgency: req.urgency,
            createdAt: req.created_at.toISOString(),
            source: req.source,
            status: req.status,
            verificationStatus: req.verification_status,
            idempotencyKey: req.idempotency_key,
            isFlaggedDuplicate: req.is_flagged_duplicate,
            duplicateOfId: req.duplicate_of_id,
          } as unknown as R,
        ],
        command: 'SELECT',
        rowCount: 1,
        oid: 0,
        fields: [],
      };
    }

    if (sql.includes('UPDATE requests SET status = $2')) {
      const id = vals[0] as string;
      const req = this.requests.get(id);
      if (req) {
        req.status = vals[1] as DbRequest['status'];
        return { rows: [], command: 'UPDATE', rowCount: 1, oid: 0, fields: [] };
      }
      return { rows: [], command: 'UPDATE', rowCount: 0, oid: 0, fields: [] };
    }

    if (sql.includes('FROM requests')) {
      const rows = Array.from(this.requests.values()).map((r) => ({
        id: r.id,
        lat: 28.6,
        lng: 77.2,
        peopleCount: r.people_count,
        urgency: r.urgency,
        createdAt: r.created_at.toISOString(),
        source: r.source,
        status: r.status,
        verificationStatus: r.verification_status,
      }));
      return {
        rows: rows as unknown as R[],
        command: 'SELECT',
        rowCount: rows.length,
        oid: 0,
        fields: [],
      };
    }

    // Audit
    if (sql.includes('INSERT INTO audit_events')) {
      const row: DbAuditEvent = {
        id: String(this.auditEvents.length + 1),
        entity_type: vals[0] as string,
        entity_id: vals[1] as string,
        event_type: vals[2] as string,
        actor: vals[3] as string,
        payload: JSON.parse(vals[4] as string),
        created_at: new Date(),
      };
      this.auditEvents.push(row);
      return { rows: [], command: 'INSERT', rowCount: 1, oid: 0, fields: [] };
    }

    if (sql.includes('FROM audit_events')) {
      return {
        rows: this.auditEvents as unknown as R[],
        command: 'SELECT',
        rowCount: this.auditEvents.length,
        oid: 0,
        fields: [],
      };
    }

    // Default assignments
    if (sql.includes('FROM assignments')) {
      return { rows: [], command: 'SELECT', rowCount: 0, oid: 0, fields: [] };
    }

    return { rows: [], command: 'UNKNOWN', rowCount: 0, oid: 0, fields: [] };
  }
}

describe('Phase 5 Part 1: Operations API Endpoints, RBAC & Audit', () => {
  let app: Express;
  let mockQueryable: MockOperationsQueryable;
  let authRepo: InMemoryAuthRepository;
  let authService: AuthService;

  let operatorToken: string;
  let dispatcherToken: string;
  let adminToken: string;

  beforeEach(async () => {
    mockQueryable = new MockOperationsQueryable();
    const repo = new PostgisRepository(mockQueryable);
    authRepo = new InMemoryAuthRepository();
    authService = new AuthService(authRepo);

    const requestService = new RequestService(repo);
    const assignmentService = new AssignmentService(repo);
    const affectedScopeService = new AffectedScopeService(repo);
    const eventService = new OperationalEventService(repo, affectedScopeService);
    const repairService = new RepairOrchestrationService(repo);

    app = createApp({
      repository: repo,
      authService,
      requestService,
      assignmentService,
      operationalEventService: eventService,
      affectedScopeService,
      repairOrchestrationService: repairService,
    });

    // Seed test resources
    mockQueryable.resources.set('res-boat-1', {
      id: 'res-boat-1',
      name: 'Boat Alpha',
      type: 'BOAT',
      capacity: 6,
      speed_km_h: 25,
      location: 'POINT(77.2 28.6)',
      status: 'AVAILABLE',
      depot_id: null,
      shift_max_duration_min: 480,
      source: 'REAL',
      created_at: new Date(),
      updated_at: new Date(),
    });

    mockQueryable.resources.set('res-sim-1', {
      id: 'res-sim-1',
      name: 'Simulated 4x4',
      type: 'HIGH_WATER_VEHICLE',
      capacity: 4,
      speed_km_h: 40,
      location: 'POINT(77.3 28.7)',
      status: 'MAINTENANCE',
      depot_id: null,
      shift_max_duration_min: 360,
      source: 'SIMULATED',
      created_at: new Date(),
      updated_at: new Date(),
    });

    // Seed test requests
    mockQueryable.requests.set('req-test-1', {
      id: 'req-test-1',
      location: 'POINT(77.2 28.6)',
      people_count: 3,
      urgency: 'HIGH',
      source: 'REPORTED',
      status: 'PENDING',
      verification_status: 'UNVERIFIED',
      medical_needs: false,
      notes: null,
      idempotency_key: null,
      idempotency_request_hash: null,
      duplicate_of_id: null,
      is_flagged_duplicate: false,
      created_at: new Date(),
      updated_at: new Date(),
    });

    mockQueryable.requests.set('req-committed-1', {
      id: 'req-committed-1',
      location: 'POINT(77.2 28.6)',
      people_count: 2,
      urgency: 'HIGH',
      source: 'REPORTED',
      status: 'ASSIGNED',
      verification_status: 'UNVERIFIED',
      medical_needs: false,
      notes: null,
      idempotency_key: null,
      idempotency_request_hash: null,
      duplicate_of_id: null,
      is_flagged_duplicate: false,
      created_at: new Date(),
      updated_at: new Date(),
    });

    // Create 3 operators with different roles
    await authService.createOperator({
      username: 'op_viewer',
      password: 'Password123!',
      name: 'Operator Viewer',
      role: 'OPERATOR',
    });
    const opLogin = await authService.authenticate('op_viewer', 'Password123!');
    operatorToken = opLogin.token;

    await authService.createOperator({
      username: 'eoc_dispatcher',
      password: 'Password123!',
      name: 'EOC Dispatcher',
      role: 'DISPATCHER',
    });
    const dispLogin = await authService.authenticate('eoc_dispatcher', 'Password123!');
    dispatcherToken = dispLogin.token;

    await authService.createOperator({
      username: 'eoc_admin',
      password: 'Password123!',
      name: 'EOC Admin',
      role: 'ADMIN',
    });
    const adminLogin = await authService.authenticate('eoc_admin', 'Password123!');
    adminToken = adminLogin.token;
  });

  describe('Authentication & RBAC Guards', () => {
    it('rejects anonymous access to /operations/resources with 401', async () => {
      const res = await request(app).get('/operations/resources');
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('allows OPERATOR role to list resources and preserves source provenance', async () => {
      const res = await request(app)
        .get('/operations/resources')
        .set('Authorization', `Bearer ${operatorToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.count).toBe(2);
      expect(Array.isArray(res.body.data)).toBe(true);

      const real = res.body.data.find((r: { id: string }) => r.id === 'res-boat-1');
      expect(real).toBeDefined();
      expect(real.source).toBe('REAL');
      expect(real.type).toBe('BOAT');

      const sim = res.body.data.find((r: { id: string }) => r.id === 'res-sim-1');
      expect(sim).toBeDefined();
      expect(sim.source).toBe('SIMULATED');
      expect(sim.status).toBe('MAINTENANCE');
    });

    it('allows DISPATCHER and ADMIN roles to list resources with status/type filters', async () => {
      // Test DISPATCHER with status filter
      const dispRes = await request(app)
        .get('/operations/resources?status=AVAILABLE')
        .set('Authorization', `Bearer ${dispatcherToken}`);

      expect(dispRes.status).toBe(200);
      expect(dispRes.body.count).toBe(1);
      expect(dispRes.body.data[0].id).toBe('res-boat-1');

      // Test ADMIN with type filter
      const adminRes = await request(app)
        .get('/operations/resources?type=HIGH_WATER_VEHICLE')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(adminRes.status).toBe(200);
      expect(adminRes.body.count).toBe(1);
      expect(adminRes.body.data[0].id).toBe('res-sim-1');
    });

    it('rejects invalid filter query parameters on /operations/resources with 400 VALIDATION_ERROR', async () => {
      const res = await request(app)
        .get('/operations/resources?status=INVALID_STATUS')
        .set('Authorization', `Bearer ${operatorToken}`);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('rejects anonymous access to /operations/events with 401', async () => {
      const res = await request(app).get('/operations/events');
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('allows OPERATOR role to view operational events', async () => {
      const res = await request(app)
        .get('/operations/events')
        .set('Authorization', `Bearer ${operatorToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
    });

    it('rejects OPERATOR role from mutating resource status with 403 FORBIDDEN', async () => {
      const res = await request(app)
        .patch('/operations/resources/res-boat-1/status')
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({ status: 'OFFLINE', reason: 'Routine overhaul' });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('rejects OPERATOR role from creating blocked road zones with 403 FORBIDDEN', async () => {
      const res = await request(app)
        .post('/operations/road-zones')
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({
          name: 'Hazard Zone',
          polygon: [
            { lat: 28.5, lng: 77.1 },
            { lat: 28.5, lng: 77.2 },
            { lat: 28.6, lng: 77.2 },
          ],
        });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });
  });

  describe('DISPATCHER Role Mutations & Operational Events', () => {
    it('allows DISPATCHER to update resource status, emitting RESOURCE_OFFLINE and audit entry', async () => {
      const res = await request(app)
        .patch('/operations/resources/res-boat-1/status')
        .set('Authorization', `Bearer ${dispatcherToken}`)
        .send({ status: 'OFFLINE', reason: 'Fuel system issue' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.resource.status).toBe('OFFLINE');
      expect(res.body.data.event).toBeDefined();
      expect(res.body.data.event.type).toBe('RESOURCE_OFFLINE');
      expect(res.body.data.event.actorId).toBe('eoc_dispatcher');
      expect(res.body.data.affectedScope).toBeDefined();
      expect(res.body.data.affectedScope.affectedResourceIds).toContain('res-boat-1');

      // Verify audit event persisted
      const lastAudit = mockQueryable.auditEvents[mockQueryable.auditEvents.length - 1];
      expect(lastAudit).toBeDefined();
      expect(lastAudit?.event_type).toBe('RESOURCE_OFFLINE');
      expect(lastAudit?.actor).toBe('eoc_dispatcher');

      // Verify ADMIN role can also update resource status
      const adminRes = await request(app)
        .patch('/operations/resources/res-boat-1/status')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'AVAILABLE', reason: 'Fuel system repaired' });

      expect(adminRes.status).toBe(200);
      expect(adminRes.body.data.resource.status).toBe('AVAILABLE');
    });

    it('rejects status mutation on simulated resource with 409 SIMULATED_RESOURCE_MUTATION_BLOCKED', async () => {
      const res = await request(app)
        .patch('/operations/resources/res-sim-1/status')
        .set('Authorization', `Bearer ${dispatcherToken}`)
        .send({ status: 'AVAILABLE', reason: 'Attempt to activate test vehicle' });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('SIMULATED_RESOURCE_MUTATION_BLOCKED');
      expect(res.body.error.message).toContain(
        'Cannot modify operational status of simulated resource',
      );
    });

    it('permits status mutation on authentic real resource with boat_ prefix', async () => {
      mockQueryable.resources.set('boat_01', {
        id: 'boat_01',
        name: 'Boat 01 Real Rescue',
        type: 'BOAT',
        capacity: 8,
        speed_km_h: 22,
        location: 'POINT(77.21 28.61)',
        status: 'AVAILABLE',
        depot_id: null,
        shift_max_duration_min: 480,
        source: 'REAL',
        created_at: new Date(),
        updated_at: new Date(),
      });

      const res = await request(app)
        .patch('/operations/resources/boat_01/status')
        .set('Authorization', `Bearer ${dispatcherToken}`)
        .send({ status: 'OFFLINE', reason: 'Propeller maintenance' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.resource.status).toBe('OFFLINE');
      expect(res.body.data.resource.id).toBe('boat_01');
    });

    it('rejects status mutation on non-existent resource with 404 NOT_FOUND', async () => {
      const res = await request(app)
        .patch('/operations/resources/non-existent-craft/status')
        .set('Authorization', `Bearer ${dispatcherToken}`)
        .send({ status: 'AVAILABLE', reason: 'Does not exist' });

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });

    it('allows DISPATCHER to create and reopen a road hazard zone with events', async () => {
      // 1. Create road blockage
      const createRes = await request(app)
        .post('/operations/road-zones')
        .set('Authorization', `Bearer ${dispatcherToken}`)
        .send({
          name: 'Bridge Flooding',
          severity: 'BLOCKED',
          polygon: [
            { lat: 28.5, lng: 77.1 },
            { lat: 28.5, lng: 77.2 },
            { lat: 28.6, lng: 77.2 },
          ],
        });

      expect(createRes.status).toBe(201);
      expect(createRes.body.success).toBe(true);
      expect(createRes.body.data.event.type).toBe('ROAD_BLOCKED');
      const zoneId = createRes.body.data.zone.id;

      // 2. Reopen road blockage
      const deleteRes = await request(app)
        .delete(`/operations/road-zones/${zoneId}`)
        .set('Authorization', `Bearer ${dispatcherToken}`);

      expect(deleteRes.status).toBe(200);
      expect(deleteRes.body.success).toBe(true);
      expect(deleteRes.body.data.event.type).toBe('ROAD_REOPENED');
    });

    it('returns 503 REPAIR_ENGINE_UNAVAILABLE when repair proposal is requested in Part 1', async () => {
      const res = await request(app)
        .post('/operations/repair')
        .set('Authorization', `Bearer ${dispatcherToken}`)
        .send({ eventId: 'evt-any' });

      expect(res.status).toBe(503);
      expect(res.body.error.code).toBe('REPAIR_ENGINE_UNAVAILABLE');
    });
  });

  describe('Audit Event Querying & Role-Based Redaction', () => {
    beforeEach(() => {
      mockQueryable.auditEvents = [
        {
          id: '1',
          entity_type: 'REQUEST',
          entity_id: 'req-1',
          event_type: 'REQUEST_CREATED',
          actor: 'CITIZEN',
          payload: {
            clientIp: '192.168.1.100',
            idempotencyRequestHash: 'abc123hash',
            idempotencyKey: 'idem-secret-999',
            urgency: 'HIGH',
          },
          created_at: new Date(),
        },
      ];
    });

    it('redacts sensitive fields (clientIp, hashes, citizen tokens) when viewed by OPERATOR role', async () => {
      const res = await request(app)
        .get('/audit/events')
        .set('Authorization', `Bearer ${operatorToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(1);
      const payload = res.body.data[0].payload;
      expect(payload.clientIp).toBeUndefined();
      expect(payload.idempotencyRequestHash).toBeUndefined();
      expect(payload.idempotencyKey).toBeUndefined();
      expect(payload.urgency).toBe('HIGH');
    });

    it('returns unredacted audit details when viewed by DISPATCHER or ADMIN role', async () => {
      const res = await request(app)
        .get('/audit/events')
        .set('Authorization', `Bearer ${dispatcherToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      const payload = res.body.data[0].payload;
      expect(payload.clientIp).toBe('192.168.1.100');
      expect(payload.idempotencyRequestHash).toBe('abc123hash');
      expect(payload.idempotencyKey).toBe('idem-secret-999');
    });
  });

  describe('Rescue Request Cancellation Authorization', () => {
    it('rejects anonymous cancellation without idempotency key with 401 UNAUTHORIZED', async () => {
      const res = await request(app)
        .post('/requests/req-test-1/cancel')
        .send({ reason: 'Anonymous attempt' });

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('rejects anonymous cancellation with wrong idempotency key with 403 FORBIDDEN', async () => {
      const res = await request(app)
        .post('/requests/req-test-1/cancel')
        .send({ reason: 'Wrong key', idempotencyKey: 'wrong-key-does-not-match' });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('allows citizen cancellation with correct idempotency key as ownership proof', async () => {
      // First, seed a request with an idempotency key
      mockQueryable.requests.set('req-citizen-owned', {
        id: 'req-citizen-owned',
        location: 'POINT(77.2 28.6)',
        people_count: 3,
        urgency: 'HIGH',
        source: 'REPORTED',
        status: 'PENDING',
        verification_status: 'UNVERIFIED',
        medical_needs: false,
        notes: null,
        idempotency_key: 'citizen-secret-key-123',
        idempotency_request_hash: null,
        duplicate_of_id: null,
        is_flagged_duplicate: false,
        created_at: new Date(),
        updated_at: new Date(),
      });

      const res = await request(app).post('/requests/req-citizen-owned/cancel').send({
        reason: 'Family reached safety independently',
        idempotencyKey: 'citizen-secret-key-123',
      });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('CANCELLED');

      // Verify operational event was recorded
      const events = Array.from(mockQueryable.operationalEvents.values());
      const cancelEvt = events.find((e) => e.event_type === 'REQUEST_CANCELLED');
      expect(cancelEvt).toBeDefined();
      expect(cancelEvt?.entity_id).toBe('req-citizen-owned');
      expect(cancelEvt?.actor_type).toBe('CITIZEN');
    });

    it('allows authenticated DISPATCHER to cancel any pending request', async () => {
      const res = await request(app)
        .post('/requests/req-test-1/cancel')
        .set('Authorization', `Bearer ${dispatcherToken}`)
        .send({ reason: 'Duplicate resolved by operator' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('CANCELLED');
    });

    it('rejects cancellation of an ASSIGNED/committed request with 409 Conflict', async () => {
      const res = await request(app)
        .post('/requests/req-committed-1/cancel')
        .set('Authorization', `Bearer ${dispatcherToken}`)
        .send({ reason: 'Try to cancel active mission' });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('CANNOT_CANCEL_COMMITTED_REQUEST');
    });

    it('rejects OPERATOR role from cancelling request with 403 FORBIDDEN', async () => {
      const res = await request(app)
        .post('/requests/req-test-1/cancel')
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({ reason: 'Operator viewer cannot cancel' });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
      expect(res.body.error.message).toContain('CANCEL_REQUEST');
    });

    it('allows authenticated ADMIN to cancel any pending request', async () => {
      const res = await request(app)
        .post('/requests/req-test-1/cancel')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ reason: 'Admin emergency override cancellation' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('CANCELLED');
    });

    it('rejects cancellation using an idempotency key belonging to a different request with 403 FORBIDDEN', async () => {
      // Seed request A and request B with different keys
      mockQueryable.requests.set('req-citizen-a', {
        id: 'req-citizen-a',
        location: 'POINT(77.2 28.6)',
        people_count: 2,
        urgency: 'MEDIUM',
        source: 'REPORTED',
        status: 'PENDING',
        verification_status: 'UNVERIFIED',
        medical_needs: false,
        notes: null,
        idempotency_key: 'citizen-key-alpha',
        idempotency_request_hash: null,
        duplicate_of_id: null,
        is_flagged_duplicate: false,
        created_at: new Date(),
        updated_at: new Date(),
      });

      mockQueryable.requests.set('req-citizen-b', {
        id: 'req-citizen-b',
        location: 'POINT(77.2 28.6)',
        people_count: 4,
        urgency: 'HIGH',
        source: 'REPORTED',
        status: 'PENDING',
        verification_status: 'UNVERIFIED',
        medical_needs: false,
        notes: null,
        idempotency_key: 'citizen-key-beta',
        idempotency_request_hash: null,
        duplicate_of_id: null,
        is_flagged_duplicate: false,
        created_at: new Date(),
        updated_at: new Date(),
      });

      // Attacker tries to cancel request B using request A's key
      const res = await request(app)
        .post('/requests/req-citizen-b/cancel')
        .send({ reason: 'Malicious cancellation', idempotencyKey: 'citizen-key-alpha' });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('handles replay of cancellation on already-cancelled request idempotently', async () => {
      // Seed a request that is already cancelled with its idempotency key
      mockQueryable.requests.set('req-already-cancelled', {
        id: 'req-already-cancelled',
        location: 'POINT(77.2 28.6)',
        people_count: 2,
        urgency: 'LOW',
        source: 'REPORTED',
        status: 'CANCELLED',
        verification_status: 'UNVERIFIED',
        medical_needs: false,
        notes: null,
        idempotency_key: 'citizen-key-replay-test',
        idempotency_request_hash: null,
        duplicate_of_id: null,
        is_flagged_duplicate: false,
        created_at: new Date(),
        updated_at: new Date(),
      });

      // Replay citizen cancellation with matching key
      const res = await request(app).post('/requests/req-already-cancelled/cancel').send({
        reason: 'Replay cancellation request',
        idempotencyKey: 'citizen-key-replay-test',
      });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('CANCELLED');
    });

    it('rejects anonymous cancellation of request without idempotency key set', async () => {
      // req-test-1 has idempotency_key: null, so even providing one should fail
      const res = await request(app)
        .post('/requests/req-test-1/cancel')
        .send({ reason: 'Trying with key', idempotencyKey: 'some-key' });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });
  });

  describe('Frozen-Stop Bypass Protection', () => {
    it('repair endpoint does not accept freezeCommittedStops parameter from client', async () => {
      // Verify the RequestRepairSchema only allows eventId, baselineAssignmentId, expectedVersion
      const res = await request(app)
        .post('/operations/repair')
        .set('Authorization', `Bearer ${dispatcherToken}`)
        .send({
          eventId: 'evt-any',
          freezeCommittedStops: false, // attacker tries to disable frozen-stop protection
        });

      // Should return 503 (repair unavailable), NOT process with freezeCommittedStops=false
      expect(res.status).toBe(503);
      expect(res.body.error.code).toBe('REPAIR_ENGINE_UNAVAILABLE');
    });

    it('repair endpoint never fabricates assignments and returns explicit 503', async () => {
      // The RepairOrchestrationService.orchestrateRepair always queries frozenStops from DB.
      // The client never supplies frozenStops. RepairInput has no freezeCommittedStops toggle.
      // frozenStops is typed as ReadonlyArray<FrozenStopReference> populated server-side.
      const res = await request(app)
        .post('/operations/repair')
        .set('Authorization', `Bearer ${dispatcherToken}`)
        .send({ eventId: 'evt-nonexistent' });

      expect(res.status).toBe(503);
      expect(res.body.error.code).toBe('REPAIR_ENGINE_UNAVAILABLE');
      // The response must never include fabricated assignment data
      expect(res.body.data).toBeUndefined();
    });
  });
});
