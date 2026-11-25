import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import express, { type Express } from 'express';
import { PostgisRepository, type Queryable } from '../db/repository.js';
import { OperationalEventService } from '../services/operationalEventService.js';
import { RepairOrchestrationService } from '../services/repairOrchestrationService.js';
import { ServiceAreaService } from '../services/serviceAreaService.js';
import { createOperationsRouter } from './operations.js';
import { AuthService, InMemoryAuthRepository } from '../services/authService.js';
import { requireOperatorAuth } from '../middleware/authMiddleware.js';
import type { DbResource, DbOperator, DbOperationalEvent } from '../db/schema.js';
import { APPROVED_VEHICLE_CATALOG } from '@floodrelay/shared';

class MockFleetQueryable implements Queryable {
  public resources = new Map<string, DbResource>();
  public auditEvents: Array<{
    entity_type: string;
    entity_id: string;
    event_type: string;
    actor: string;
    payload: unknown;
  }> = [];
  public operators = new Map<string, DbOperator>();
  public committedAssignments = new Map<
    string,
    { id: string; status: string; resourceId: string }
  >();
  public operationalEvents = new Map<string, DbOperationalEvent>();

  async query<R = unknown>(
    queryTextOrConfig: string | { text: string; values?: unknown[] },
    values?: unknown[],
  ): Promise<{ rows: R[]; command: string; rowCount: number; oid: number; fields: [] }> {
    const rawSql =
      typeof queryTextOrConfig === 'string' ? queryTextOrConfig : queryTextOrConfig.text;
    const sql = rawSql.replace(/\s+/g, ' ').trim();
    const vals = (typeof queryTextOrConfig === 'string' ? values : queryTextOrConfig.values) || [];

    // Transaction controls
    if (/^(BEGIN|COMMIT|ROLLBACK)(;)?$/i.test(sql)) {
      return { rows: [], command: 'TX', rowCount: 0, oid: 0, fields: [] };
    }

    // Operators
    if (sql.includes('FROM operators WHERE username = $1')) {
      const op = this.operators.get(vals[0] as string);
      return {
        rows: (op ? [op] : []) as unknown as R[],
        command: 'SELECT',
        rowCount: op ? 1 : 0,
        oid: 0,
        fields: [],
      };
    }

    // Audit Events
    if (sql.includes('INSERT INTO audit_events')) {
      const event = {
        entity_type: vals[0] as string,
        entity_id: vals[1] as string,
        event_type: vals[2] as string,
        actor: vals[3] as string,
        payload: JSON.parse(vals[4] as string),
      };
      this.auditEvents.push(event);
      return {
        rows: [{ id: this.auditEvents.length }] as unknown as R[],
        command: 'INSERT',
        rowCount: 1,
        oid: 0,
        fields: [],
      };
    }

    // Operational Events
    if (sql.includes('INSERT INTO operational_events')) {
      const id = vals[0] as string;
      const row: DbOperationalEvent = {
        id,
        event_type: vals[1] as DbOperationalEvent['event_type'],
        entity_type: vals[2] as DbOperationalEvent['entity_type'],
        entity_id: vals[3] as string,
        actor_id: (vals[4] as string) || null,
        actor_type: vals[5] as DbOperationalEvent['actor_type'],
        payload:
          typeof vals[6] === 'string'
            ? JSON.parse(vals[6])
            : ((vals[6] || {}) as Record<string, unknown>),
        correlation_id: (vals[7] as string) || null,
        idempotency_key: (vals[8] as string) || null,
        entity_version: (vals[9] as number) || 1,
        processing_status: (vals[10] as DbOperationalEvent['processing_status']) || 'RECORDED',
        processing_attempts: (vals[11] as number) || 0,
        last_error_code: null,
        occurred_at: new Date(),
        created_at: new Date(),
        processed_at: null,
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

    // Update operational event status
    if (sql.includes('UPDATE operational_events SET')) {
      const id = vals[0] as string;
      const row = this.operationalEvents.get(id);
      if (row) {
        row.processing_status = vals[1] as DbOperationalEvent['processing_status'];
      }
      return { rows: [], command: 'UPDATE', rowCount: row ? 1 : 0, oid: 0, fields: [] };
    }

    // Active committed assignments for resource
    if (sql.includes('assignments')) {
      const resourceId = vals[0] as string;
      const matching: Array<{
        id: string;
        status: string;
        stopCount: number;
        frozenCount: number;
      }> = [];
      for (const assign of this.committedAssignments.values()) {
        if (assign.resourceId === resourceId) {
          matching.push({ id: assign.id, status: assign.status, stopCount: 3, frozenCount: 2 });
        }
      }
      return {
        rows: matching as unknown as R[],
        command: 'SELECT',
        rowCount: matching.length,
        oid: 0,
        fields: [],
      };
    }

    // Row lock query: SELECT id, name, ... FROM resources WHERE id = $1 FOR UPDATE
    if (sql.includes('FROM resources WHERE id = $1 FOR UPDATE')) {
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
            speed_km_h: r.speed_km_h,
            source: r.source,
            status: r.status,
            version: r.version || 1,
            verification_status: r.verification_status || 'VERIFIED',
          } as unknown as R,
        ],
        command: 'SELECT',
        rowCount: 1,
        oid: 0,
        fields: [],
      };
    }

    // Resource by ID query
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
            lat: 28.668,
            lng: 77.232,
            status: r.status,
            depotId: r.depot_id,
            source: r.source,
            modelId: r.model_id,
            notes: r.notes,
            version: r.version || 1,
            verificationStatus: r.verification_status || 'VERIFIED',
            verifiedAt: r.verified_at ? r.verified_at.toISOString() : undefined,
            verifiedBy: r.verified_by,
            createdBy: r.created_by,
            updatedBy: r.updated_by,
          } as unknown as R,
        ],
        command: 'SELECT',
        rowCount: 1,
        oid: 0,
        fields: [],
      };
    }

    // List resources
    if (sql.includes('FROM resources')) {
      const rows = Array.from(this.resources.values());
      const mapped = rows.map((r) => ({
        id: r.id,
        name: r.name,
        type: r.type,
        capacity: r.capacity,
        speedKmH: r.speed_km_h,
        lat: 28.668,
        lng: 77.232,
        status: r.status,
        depotId: r.depot_id,
        source: r.source,
        modelId: r.model_id,
        notes: r.notes,
        version: r.version || 1,
      }));
      return {
        rows: mapped as unknown as R[],
        command: 'SELECT',
        rowCount: mapped.length,
        oid: 0,
        fields: [],
      };
    }

    // Insert resource (create-only)
    if (sql.includes('INSERT INTO resources')) {
      const id = vals[0] as string;
      if (this.resources.has(id)) {
        const err = new Error(`duplicate key value violates unique constraint "resources_pkey"`);
        (err as unknown as { code: string }).code = '23505';
        throw err;
      }
      const initialVerification =
        (vals[13] as string) || (vals[10] === 'REAL' ? 'UNVERIFIED' : 'VERIFIED');
      const newRes: DbResource = {
        id,
        name: vals[1] as string,
        type: vals[2] as DbResource['type'],
        capacity: vals[3] as number,
        speed_km_h: vals[4] as number,
        location: 'POINT(77.232 28.668)',
        status: vals[7] as DbResource['status'],
        depot_id: (vals[8] as string) || null,
        shift_max_duration_min: 480,
        source: vals[10] as 'REAL' | 'SIMULATED',
        model_id: (vals[11] as string) || null,
        notes: (vals[12] as string) || null,
        version: 1,
        verification_status: initialVerification as DbResource['verification_status'],
        verified_at: initialVerification === 'VERIFIED' ? new Date() : null,
        verified_by: initialVerification === 'VERIFIED' ? 'system' : null,
        created_by: (vals[14] as string) || null,
        updated_by: (vals[14] as string) || null,
        created_at: new Date(),
        updated_at: new Date(),
      };
      this.resources.set(id, newRes);
      return {
        rows: [
          {
            id: newRes.id,
            name: newRes.name,
            type: newRes.type,
            capacity: newRes.capacity,
            speedKmH: newRes.speed_km_h,
            lat: 28.668,
            lng: 77.232,
            status: newRes.status,
            depotId: newRes.depot_id,
            source: newRes.source,
            modelId: newRes.model_id,
            notes: newRes.notes,
            version: newRes.version,
            verificationStatus: newRes.verification_status,
            verifiedAt: newRes.verified_at ? newRes.verified_at.toISOString() : undefined,
            verifiedBy: newRes.verified_by ?? undefined,
          } as unknown as R,
        ],
        command: 'INSERT',
        rowCount: 1,
        oid: 0,
        fields: [],
      };
    }

    // Verify resource
    if (sql.includes("SET verification_status = 'VERIFIED'")) {
      const id = vals[0] as string;
      const operatorId = vals[1] as string;
      const notes = (vals[2] as string) || null;
      const r = this.resources.get(id);
      if (r) {
        r.verification_status = 'VERIFIED';
        r.verified_at = new Date();
        r.verified_by = operatorId;
        if (notes) r.notes = notes;
        r.version = (r.version || 1) + 1;
        return {
          rows: [
            {
              id: r.id,
              name: r.name,
              type: r.type,
              capacity: r.capacity,
              speedKmH: r.speed_km_h,
              lat: 28.668,
              lng: 77.232,
              status: r.status,
              depotId: r.depot_id,
              source: r.source,
              modelId: r.model_id,
              notes: r.notes,
              version: r.version,
              verificationStatus: r.verification_status,
              verifiedAt: r.verified_at.toISOString(),
              verifiedBy: r.verified_by,
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

    // Update resource details
    if (
      sql.includes('UPDATE resources') &&
      sql.includes('version = version + 1') &&
      !sql.includes('SET status = $2')
    ) {
      const id = vals[0] as string;
      const r = this.resources.get(id);
      if (r) {
        r.version = (r.version || 1) + 1;
        if (vals[2] !== undefined) r.name = vals[2] as string;
        if (vals[3] !== undefined) r.capacity = vals[3] as number;
        return {
          rows: [
            {
              id: r.id,
              name: r.name,
              type: r.type,
              capacity: r.capacity,
              speedKmH: r.speed_km_h,
              lat: 28.668,
              lng: 77.232,
              status: r.status,
              source: r.source,
              version: r.version,
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

    // Update resource status
    if (sql.includes('UPDATE resources') && sql.includes('SET status = $2')) {
      const id = vals[0] as string;
      const r = this.resources.get(id);
      if (r) {
        r.status = vals[1] as DbResource['status'];
        r.version = (r.version || 1) + 1;
        return {
          rows: [
            {
              id: r.id,
              name: r.name,
              type: r.type,
              capacity: r.capacity,
              speedKmH: r.speed_km_h,
              lat: 28.668,
              lng: 77.232,
              status: r.status,
              source: r.source,
              version: r.version,
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

    return { rows: [], command: 'UNKNOWN', rowCount: 0, oid: 0, fields: [] };
  }
}

describe('Rescue Fleet Management Portal API & Security Invariants', () => {
  let app: Express;
  let mockQueryable: MockFleetQueryable;
  let authService: AuthService;
  let adminToken: string;
  let dispatcherToken: string;
  let operatorToken: string;

  beforeEach(async () => {
    mockQueryable = new MockFleetQueryable();
    const repo = new PostgisRepository(mockQueryable);
    const authRepo = new InMemoryAuthRepository();
    authService = new AuthService(authRepo);

    // Create 3 operators with different roles
    await authService.createOperator({
      username: 'admin_user',
      password: 'Password123!',
      name: 'EOC Commander',
      role: 'ADMIN',
    });
    const adminLogin = await authService.authenticate('admin_user', 'Password123!');
    adminToken = adminLogin.token;

    await authService.createOperator({
      username: 'dispatcher_user',
      password: 'Password123!',
      name: 'Duty Dispatcher',
      role: 'DISPATCHER',
    });
    const dispLogin = await authService.authenticate('dispatcher_user', 'Password123!');
    dispatcherToken = dispLogin.token;

    await authService.createOperator({
      username: 'operator_user',
      password: 'Password123!',
      name: 'Logistics Observer',
      role: 'OPERATOR',
    });
    const opLogin = await authService.authenticate('operator_user', 'Password123!');
    operatorToken = opLogin.token;

    // Seed baseline resources (REAL and SIMULATED)
    mockQueryable.resources.set('res-boat-real', {
      id: 'res-boat-real',
      name: 'Yamuna Patrol 1',
      type: 'BOAT',
      capacity: 8,
      speed_km_h: 25,
      location: 'POINT(77.232 28.668)',
      status: 'AVAILABLE',
      depot_id: 'shelter-kashmere-gate',
      shift_max_duration_min: 480,
      source: 'REAL',
      model_id: 'boat-irb-standard',
      notes: 'Active duty unit',
      version: 1,
      verification_status: 'VERIFIED',
      created_by: 'admin_user',
      updated_by: 'admin_user',
      created_at: new Date(),
      updated_at: new Date(),
    });

    mockQueryable.resources.set('res-boat-sim', {
      id: 'res-boat-sim',
      name: 'Simulated Boat Alpha',
      type: 'BOAT',
      capacity: 8,
      speed_km_h: 25,
      location: 'POINT(77.232 28.668)',
      status: 'AVAILABLE',
      depot_id: null,
      shift_max_duration_min: 480,
      source: 'SIMULATED',
      model_id: 'boat-irb-standard',
      notes: 'Benchmark asset',
      version: 1,
      verification_status: 'VERIFIED',
      created_by: 'system',
      updated_by: 'system',
      created_at: new Date(),
      updated_at: new Date(),
    });

    const eventService = new OperationalEventService(repo);
    const repairService = {} as unknown as RepairOrchestrationService;

    // Mock ServiceAreaService that allows Delhi NCR coords (28.6, 77.2) and rejects Mumbai (19.0, 72.8)
    const mockServiceAreaService = {
      assertWithinServiceArea: async (lat: number, lng: number) => {
        if (lat < 28.0 || lat > 29.5 || lng < 76.5 || lng > 78.0) {
          const err = new Error('Coordinates outside Delhi NCR service area');
          (err as unknown as { code: string; statusCode: number }).code = 'OUTSIDE_SERVICE_AREA';
          (err as unknown as { code: string; statusCode: number }).statusCode = 422;
          throw err;
        }
        return { eligible: true };
      },
    } as unknown as ServiceAreaService;

    app = express();
    app.use(express.json());

    app.use(
      '/operations',
      requireOperatorAuth(authService),
      createOperationsRouter(repo, eventService, repairService, mockServiceAreaService),
    );

    app.use(
      (err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
        void _next;
        const statusCode = (err as { statusCode?: number }).statusCode || 500;
        const code = (err as { code?: string }).code || 'INTERNAL_ERROR';
        res.status(statusCode).json({
          error: {
            code,
            message: err.message,
          },
        });
      },
    );
  }, 30000);

  describe('GET /operations/vehicle-models (Vehicle Catalog)', () => {
    it('returns approved catalog options with categories, types, and limits', async () => {
      const res = await request(app)
        .get('/operations/vehicle-models')
        .set('Authorization', `Bearer ${operatorToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBe(APPROVED_VEHICLE_CATALOG.length);

      const irb = res.body.data.find((m: { id: string }) => m.id === 'boat-irb-standard');
      expect(irb).toBeDefined();
      expect(irb.category).toBe('Rescue Boat');
      expect(irb.type).toBe('BOAT');
      expect(irb.defaultCapacity).toBe(8);
      expect(irb.defaultSpeedKmH).toBe(25);
    });

    it('rejects unauthenticated requests with 401', async () => {
      const res = await request(app).get('/operations/vehicle-models');
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });
  });

  describe('POST /operations/resources (Vehicle Registration)', () => {
    it('allows ADMIN to register a new vehicle with automatic collision-resistant ID', async () => {
      const res = await request(app)
        .post('/operations/resources')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          modelId: 'boat-irb-standard',
          name: 'Delhi Rapid Boat 01',
          lat: 28.668,
          lng: 77.232,
          depotId: 'shelter-kashmere-gate',
          status: 'OFFLINE',
          notes: 'Brand new IRB',
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.resource.id).toMatch(/^res-[a-f0-9]{8}$/);
      expect(res.body.data.resource.name).toBe('Delhi Rapid Boat 01');
      expect(res.body.data.resource.type).toBe('BOAT');
      expect(res.body.data.resource.capacity).toBe(8);
      expect(res.body.data.resource.speedKmH).toBe(25);
      expect(res.body.data.resource.status).toBe('OFFLINE');
      expect(res.body.data.resource.source).toBe('REAL');

      // Verify audit event was logged
      const audit = mockQueryable.auditEvents.find((e) => e.event_type === 'RESOURCE_REGISTERED');
      expect(audit).toBeDefined();
      expect(audit?.actor).toBe('admin_user');
    });

    it('allows ADMIN to register a vehicle with custom ID when unique', async () => {
      const res = await request(app)
        .post('/operations/resources')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          modelId: 'high-water-truck-heavy',
          name: 'Rescue Truck Unit 5',
          id: 'res-delhi-truck-005',
          capacity: 16,
          speedKmH: 40,
          lat: 28.668,
          lng: 77.232,
          status: 'OFFLINE',
        });

      expect(res.status).toBe(201);
      expect(res.body.data.resource.id).toBe('res-delhi-truck-005');
      expect(res.body.data.resource.type).toBe('HIGH_WATER_VEHICLE');
    });

    it('rejects duplicate custom ID with 409 DUPLICATE_RESOURCE_ID', async () => {
      const res = await request(app)
        .post('/operations/resources')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          modelId: 'boat-irb-standard',
          id: 'res-boat-real', // Already exists!
          lat: 28.668,
          lng: 77.232,
        });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('DUPLICATE_RESOURCE_ID');
    });

    it('rejects registration from DISPATCHER with 403 FORBIDDEN', async () => {
      const res = await request(app)
        .post('/operations/resources')
        .set('Authorization', `Bearer ${dispatcherToken}`)
        .send({
          modelId: 'boat-irb-standard',
          lat: 28.668,
          lng: 77.232,
        });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('rejects registration from OPERATOR with 403 FORBIDDEN', async () => {
      const res = await request(app)
        .post('/operations/resources')
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({
          modelId: 'boat-irb-standard',
          lat: 28.668,
          lng: 77.232,
        });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('rejects invalid catalog model selection with 400', async () => {
      const res = await request(app)
        .post('/operations/resources')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          modelId: 'unapproved-hovercraft-9000',
          lat: 28.668,
          lng: 77.232,
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('rejects out-of-range capacity with 400', async () => {
      const res = await request(app)
        .post('/operations/resources')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          modelId: 'boat-irb-standard',
          capacity: 999, // Max for IRB is 12
          lat: 28.668,
          lng: 77.232,
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('CAPACITY_OUT_OF_RANGE');
    });

    it('rejects location outside Delhi NCR with 422 OUTSIDE_SERVICE_AREA', async () => {
      const res = await request(app)
        .post('/operations/resources')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          modelId: 'boat-irb-standard',
          lat: 19.076, // Mumbai
          lng: 72.877,
        });

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('OUTSIDE_SERVICE_AREA');
    });

    it('rejects registration with status AVAILABLE directly with 400', async () => {
      const res = await request(app)
        .post('/operations/resources')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          modelId: 'boat-irb-standard',
          lat: 28.668,
          lng: 77.232,
          status: 'AVAILABLE', // Not allowed at registration!
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('PATCH /operations/resources/:id (Editing Vehicle Details)', () => {
    it('allows ADMIN to edit details of a REAL vehicle', async () => {
      const res = await request(app)
        .patch('/operations/resources/res-boat-real')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Yamuna Patrol 1 (Overhauled)',
          capacity: 10,
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.resource.name).toBe('Yamuna Patrol 1 (Overhauled)');
      expect(res.body.data.resource.capacity).toBe(10);
      expect(res.body.data.resource.version).toBe(2);

      // Verify audit trail
      const audit = mockQueryable.auditEvents.find(
        (e) => e.event_type === 'RESOURCE_DETAILS_UPDATED',
      );
      expect(audit).toBeDefined();
    });

    it('rejects editing a SIMULATED vehicle with 409 SIMULATED_RESOURCE_MUTATION_BLOCKED', async () => {
      const res = await request(app)
        .patch('/operations/resources/res-boat-sim')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Renamed Simulated Craft',
        });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('SIMULATED_RESOURCE_MUTATION_BLOCKED');
    });

    it('rejects editing when expectedVersion mismatches with 409 CONCURRENCY_CONFLICT', async () => {
      const res = await request(app)
        .patch('/operations/resources/res-boat-real')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Conflicting Name Change',
          expectedVersion: 99, // Current version is 1!
        });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('CONCURRENCY_CONFLICT');
    });

    it('rejects altering capacity or speed of a resource in an active committed assignment with 409', async () => {
      // Assign res-boat-real to an active committed plan
      mockQueryable.committedAssignments.set('plan-1', {
        id: 'plan-1',
        status: 'COMMITTED',
        resourceId: 'res-boat-real',
      });

      const res = await request(app)
        .patch('/operations/resources/res-boat-real')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          capacity: 4, // Modifying capacity while committed!
        });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('RESOURCE_ACTIVE_IN_COMMITTED_PLAN');
    });

    it('rejects DISPATCHER or OPERATOR from editing vehicle details with 403 FORBIDDEN', async () => {
      const dispRes = await request(app)
        .patch('/operations/resources/res-boat-real')
        .set('Authorization', `Bearer ${dispatcherToken}`)
        .send({ name: 'Unauthorized edit' });
      expect(dispRes.status).toBe(403);

      const opRes = await request(app)
        .patch('/operations/resources/res-boat-real')
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({ name: 'Unauthorized edit' });
      expect(opRes.status).toBe(403);
    });
  });

  describe('PATCH /operations/resources/:id/status (Status Transitions)', () => {
    it('allows DISPATCHER to update REAL resource status from AVAILABLE to OFFLINE', async () => {
      const res = await request(app)
        .patch('/operations/resources/res-boat-real/status')
        .set('Authorization', `Bearer ${dispatcherToken}`)
        .send({
          status: 'OFFLINE',
          reason: 'Engine maintenance inspection',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.resource.status).toBe('OFFLINE');
      expect(res.body.data.event).toBeDefined();
      expect(res.body.data.event.type).toBe('RESOURCE_OFFLINE');
    });

    it('allows ADMIN to activate OFFLINE vehicle to AVAILABLE', async () => {
      mockQueryable.resources.get('res-boat-real')!.status = 'OFFLINE';

      const res = await request(app)
        .patch('/operations/resources/res-boat-real/status')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          status: 'AVAILABLE',
          reason: 'Passed pre-deployment inspection',
        });

      expect(res.status).toBe(200);
      expect(res.body.data.resource.status).toBe('AVAILABLE');
      expect(res.body.data.event.type).toBe('RESOURCE_AVAILABLE');
    });

    it('rejects manual transition to ASSIGNED or EN_ROUTE with 400', async () => {
      const res = await request(app)
        .patch('/operations/resources/res-boat-real/status')
        .set('Authorization', `Bearer ${dispatcherToken}`)
        .send({
          status: 'ASSIGNED',
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('rejects status mutation on SIMULATED resource with 409', async () => {
      const res = await request(app)
        .patch('/operations/resources/res-boat-sim/status')
        .set('Authorization', `Bearer ${dispatcherToken}`)
        .send({
          status: 'OFFLINE',
          reason: 'Testing boundary block',
        });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('SIMULATED_RESOURCE_MUTATION_BLOCKED');
    });

    it('rejects setting status to AVAILABLE when vehicle has active committed assignments with 409', async () => {
      mockQueryable.committedAssignments.set('plan-committed-avail-1', {
        id: 'plan-committed-avail-1',
        status: 'COMMITTED',
        resourceId: 'res-boat-real',
      });

      const res = await request(app)
        .patch('/operations/resources/res-boat-real/status')
        .set('Authorization', `Bearer ${dispatcherToken}`)
        .send({
          status: 'AVAILABLE',
          reason: 'Attempting invalid status transition while assigned',
        });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('RESOURCE_ACTIVE_IN_COMMITTED_PLAN');
    });
  });

  describe('Vehicle Verification & Dispatch Eligibility Guards (Defect B & C)', () => {
    it('initializes newly registered vehicle with verificationStatus UNVERIFIED', async () => {
      const res = await request(app)
        .post('/operations/resources')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          modelId: 'boat-irb-standard',
          name: 'Newly Registered Unverified Boat',
          id: 'res-unverified-1',
          lat: 28.65,
          lng: 77.22,
          capacity: 6,
          speedKmH: 22,
          status: 'OFFLINE',
        });

      expect(res.status).toBe(201);
      expect(res.body.data.resource.verificationStatus).toBe('UNVERIFIED');
    });

    it('rejects unverified vehicle from transitioning to AVAILABLE with 409 RESOURCE_NOT_VERIFIED', async () => {
      // Register new unverified vehicle
      await request(app)
        .post('/operations/resources')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          modelId: 'boat-irb-standard',
          name: 'Unverified Test Boat',
          id: 'res-unverified-2',
          lat: 28.65,
          lng: 77.22,
          capacity: 6,
          speedKmH: 22,
          status: 'OFFLINE',
        });

      // Attempt to directly mark it AVAILABLE without verification
      const statusRes = await request(app)
        .patch('/operations/resources/res-unverified-2/status')
        .set('Authorization', `Bearer ${dispatcherToken}`)
        .send({
          status: 'AVAILABLE',
          reason: 'Bypassing verification check',
        });

      expect(statusRes.status).toBe(409);
      expect(statusRes.body.error.code).toBe('RESOURCE_NOT_VERIFIED');
      expect(statusRes.body.error.message).toContain('has not been verified');
    });

    it('rejects unauthenticated and unauthorized requests to verify a vehicle', async () => {
      const unauthRes = await request(app)
        .post('/operations/resources/res-unverified-1/verify')
        .send({});
      expect(unauthRes.status).toBe(401);

      const dispRes = await request(app)
        .post('/operations/resources/res-unverified-1/verify')
        .set('Authorization', `Bearer ${dispatcherToken}`)
        .send({});
      expect(dispRes.status).toBe(403);

      const opRes = await request(app)
        .post('/operations/resources/res-unverified-1/verify')
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({});
      expect(opRes.status).toBe(403);
    });

    it('rejects verifying a SIMULATED resource with 409 SIMULATED_RESOURCE_MUTATION_BLOCKED', async () => {
      const res = await request(app)
        .post('/operations/resources/res-boat-sim/verify')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ notes: 'Should fail on simulated fixture' });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('SIMULATED_RESOURCE_MUTATION_BLOCKED');
    });

    it('allows ADMIN to verify an unverified vehicle, making it eligible for AVAILABLE status', async () => {
      // 1. Register unverified vehicle
      const regRes = await request(app)
        .post('/operations/resources')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          modelId: 'boat-irb-standard',
          name: 'Boat Alpha 99',
          id: 'res-alpha-99',
          lat: 28.65,
          lng: 77.22,
          capacity: 6,
          speedKmH: 22,
          status: 'OFFLINE',
        });
      expect(regRes.status).toBe(201);
      expect(regRes.body.data.resource.verificationStatus).toBe('UNVERIFIED');

      // 2. Complete verification step as ADMIN
      const verifyRes = await request(app)
        .post('/operations/resources/res-alpha-99/verify')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ notes: 'Physical inspection completed. Outboard motor and lifejackets verified.' });

      expect(verifyRes.status).toBe(200);
      expect(verifyRes.body.success).toBe(true);
      expect(verifyRes.body.data.resource.verificationStatus).toBe('VERIFIED');
      expect(verifyRes.body.data.resource.verifiedBy).toBe('admin_user');
      expect(verifyRes.body.data.resource.version).toBe(2);

      // Verify audit event was logged
      const auditLog = mockQueryable.auditEvents.find(
        (e) => e.entity_id === 'res-alpha-99' && e.event_type === 'RESOURCE_VERIFIED',
      );
      expect(auditLog).toBeDefined();
      expect(auditLog?.actor).toBe('admin_user');

      // 3. Now transition to AVAILABLE succeeds!
      const availRes = await request(app)
        .patch('/operations/resources/res-alpha-99/status')
        .set('Authorization', `Bearer ${dispatcherToken}`)
        .send({
          status: 'AVAILABLE',
          reason: 'Pre-deployment check verified; activating for rescue dispatch',
        });

      expect(availRes.status).toBe(200);
      expect(availRes.body.data.resource.status).toBe('AVAILABLE');
      expect(availRes.body.data.event.type).toBe('RESOURCE_AVAILABLE');
    });
  });
});
