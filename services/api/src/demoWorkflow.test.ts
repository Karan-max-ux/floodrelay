import request from 'supertest';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { Express } from 'express';
import { createApp } from './app.js';
import { AuthService, InMemoryAuthRepository } from './services/authService.js';
import { PostgisRepository, type Queryable } from './db/repository.js';
import { RequestService } from './services/requestService.js';
import { AssignmentService } from './services/assignmentService.js';
import { OperationalEventService } from './services/operationalEventService.js';
import { AffectedScopeService } from './services/affectedScopeService.js';
import {
  RepairOrchestrationService,
  type RepairSolver,
} from './services/repairOrchestrationService.js';
import { ForecastService } from './services/floodForecast/forecastService.js';
import { handleMockServiceAreaQuery } from './geo/mockServiceAreaQuery.js';
import type {
  DbRequest,
  DbResource,
  DbShelter,
  DbAssignment,
  DbAssignmentStop,
  DbOperationalEvent,
  DbBlockedZone,
  DbAuditEvent,
} from './db/schema.js';
import type { RepairInput, RepairResult } from '@floodrelay/shared';

class InMemoryDemoQueryable implements Queryable {
  public requests = new Map<string, DbRequest>();
  public resources = new Map<string, DbResource>();
  public shelters = new Map<string, DbShelter>();
  public assignments = new Map<string, DbAssignment>();
  public assignmentStops: DbAssignmentStop[] = [];
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

    if (
      sql === 'BEGIN' ||
      sql === 'COMMIT' ||
      sql === 'ROLLBACK' ||
      sql === 'BEGIN;' ||
      sql === 'COMMIT;' ||
      sql === 'ROLLBACK;'
    ) {
      return { rows: [], command: 'TX', rowCount: 0, oid: 0, fields: [] };
    }

    const serviceAreaRes = handleMockServiceAreaQuery<R>(sql, vals);
    if (serviceAreaRes) {
      return serviceAreaRes;
    }

    // Insert Request
    if (sql.includes('INSERT INTO requests')) {
      const id = vals[0] as string;
      const lng = vals[1] as number;
      const lat = vals[2] as number;
      const peopleCount = vals[3] as number;
      const urgency = vals[4] as DbRequest['urgency'];
      const source = (vals[5] as DbRequest['source']) || 'SIMULATED';
      const status = (vals[6] as DbRequest['status']) || 'PENDING';
      const verificationStatus = (vals[7] as DbRequest['verification_status']) || 'UNVERIFIED';
      const medicalNeeds = Boolean(vals[8]);
      const notes = (vals[9] as string) || null;
      const idempotencyKey = (vals[10] as string) || null;
      const duplicateOf = (vals[12] as string) || null;
      const isDuplicate = Boolean(vals[13]);
      const req: DbRequest = {
        id,
        location: `POINT(${lng} ${lat})`,
        people_count: peopleCount,
        urgency,
        source,
        status,
        verification_status: verificationStatus,
        medical_needs: medicalNeeds,
        notes,
        idempotency_key: idempotencyKey,
        idempotency_request_hash: (vals[11] as string) || null,
        duplicate_of_id: duplicateOf,
        is_flagged_duplicate: isDuplicate,
        created_at: new Date(),
        updated_at: new Date(),
      };
      this.requests.set(id, req);
      return { rows: [req as unknown as R], command: 'INSERT', rowCount: 1, oid: 0, fields: [] };
    }

    // List/Select Requests
    if (sql.includes('FROM requests')) {
      if (sql.includes('WHERE id = $1')) {
        const id = vals[0] as string;
        const r = this.requests.get(id);
        if (!r) return { rows: [], command: 'SELECT', rowCount: 0, oid: 0, fields: [] };
        return {
          rows: [
            {
              id: r.id,
              lat: 28.665,
              lng: 77.228,
              peopleCount: r.people_count,
              urgency: r.urgency,
              source: r.source,
              status: r.status,
              verificationStatus: r.verification_status,
              medicalNeeds: r.medical_needs,
              notes: r.notes,
              isFlaggedDuplicate: r.is_flagged_duplicate,
              duplicateOfId: r.duplicate_of_id,
              createdAt: r.created_at,
              updatedAt: r.updated_at,
            } as unknown as R,
          ],
          command: 'SELECT',
          rowCount: 1,
          oid: 0,
          fields: [],
        };
      }
      const rows = Array.from(this.requests.values()).map((r) => ({
        id: r.id,
        lat: 28.665,
        lng: 77.228,
        peopleCount: r.people_count,
        urgency: r.urgency,
        source: r.source,
        status: r.status,
        verificationStatus: r.verification_status,
        medicalNeeds: r.medical_needs,
        notes: r.notes,
        isFlaggedDuplicate: r.is_flagged_duplicate,
        duplicateOfId: r.duplicate_of_id,
        createdAt: r.created_at.toISOString(),
        updatedAt: r.updated_at.toISOString(),
      }));
      return {
        rows: rows as unknown as R[],
        command: 'SELECT',
        rowCount: rows.length,
        oid: 0,
        fields: [],
      };
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
            lat: 28.66,
            lng: 77.22,
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
              lat: 28.66,
              lng: 77.22,
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
      const rows = Array.from(this.resources.values()).map((r) => ({
        id: r.id,
        name: r.name,
        type: r.type,
        capacity: r.capacity,
        speedKmH: r.speed_km_h,
        lat: 28.66,
        lng: 77.22,
        status: r.status,
        depotId: r.depot_id,
        source: r.source,
      }));
      return {
        rows: rows as unknown as R[],
        command: 'SELECT',
        rowCount: rows.length,
        oid: 0,
        fields: [],
      };
    }

    // Shelters
    if (sql.includes('FROM shelters')) {
      const rows = Array.from(this.shelters.values()).map((s) => ({
        id: s.id,
        name: s.name,
        lat: 28.668,
        lng: 77.232,
        capacity: s.capacity,
        currentOccupancy: s.current_occupancy,
        current_occupancy: s.current_occupancy,
        isActive: s.is_active,
        is_active: s.is_active,
        source: s.source,
      }));
      return {
        rows: rows as unknown as R[],
        command: 'SELECT',
        rowCount: rows.length,
        oid: 0,
        fields: [],
      };
    }

    // Assignments
    if (sql.includes('INSERT INTO assignments')) {
      const id = vals[0] as string;
      const scenarioId = (vals[1] as string) || null;
      const status = (vals[2] as DbAssignment['status']) || 'PROPOSED';
      const metrics = typeof vals[3] === 'string' ? JSON.parse(vals[3]) : vals[3];
      const unserved = typeof vals[4] === 'string' ? JSON.parse(vals[4]) : vals[4];
      const a: DbAssignment = {
        id,
        scenario_id: scenarioId,
        status,
        metrics,
        unserved,
        committed_at: (vals[5] as Date) || null,
        committed_by: (vals[6] as string) || null,
        created_at: new Date(),
        updated_at: new Date(),
      };
      this.assignments.set(id, a);
      return { rows: [a as unknown as R], command: 'INSERT', rowCount: 1, oid: 0, fields: [] };
    }

    if (sql.includes('FROM assignments WHERE id = $1')) {
      const id = vals[0] as string;
      const a = this.assignments.get(id);
      return {
        rows: a ? [a as unknown as R] : [],
        command: 'SELECT',
        rowCount: a ? 1 : 0,
        oid: 0,
        fields: [],
      };
    }

    if (sql.includes('UPDATE assignments SET')) {
      const id = vals[0] as string;
      const a = this.assignments.get(id);
      if (a) {
        if (sql.includes("'COMMITTED'")) {
          a.status = 'COMMITTED';
          a.committed_at = new Date();
          a.committed_by = (vals[1] as string) || 'demo_operator';
        } else {
          a.status = (vals[1] as DbAssignment['status']) || a.status;
          a.committed_at = new Date();
          a.committed_by = (vals[2] as string) || 'demo_operator';
        }
      }
      return { rows: [], command: 'UPDATE', rowCount: a ? 1 : 0, oid: 0, fields: [] };
    }

    // Assignment Stops
    if (sql.includes('INSERT INTO assignment_stops')) {
      const stop: DbAssignmentStop = {
        id: vals[0] as string,
        assignment_id: vals[1] as string,
        resource_id: vals[2] as string,
        stop_number: vals[3] as number,
        type: vals[4] as DbAssignmentStop['type'],
        target_id: vals[5] as string,
        location: vals[6] as string,
        passengers_picked_up: vals[7] as number,
        passengers_dropped_off: vals[8] as number,
        estimated_arrival_minutes: vals[9] as number,
        is_frozen: Boolean(vals[10]),
        created_at: new Date(),
      };
      this.assignmentStops.push(stop);
      return { rows: [], command: 'INSERT', rowCount: 1, oid: 0, fields: [] };
    }

    if (sql.includes('UPDATE assignment_stops SET is_frozen = TRUE')) {
      for (const stop of this.assignmentStops) {
        stop.is_frozen = true;
      }
      return {
        rows: [],
        command: 'UPDATE',
        rowCount: this.assignmentStops.length,
        oid: 0,
        fields: [],
      };
    }

    if (sql.includes('FROM assignment_stops WHERE assignment_id = $1')) {
      const assignmentId = vals[0] as string;
      const stops = this.assignmentStops.filter((s) => s.assignment_id === assignmentId);
      return {
        rows: stops as unknown as R[],
        command: 'SELECT',
        rowCount: stops.length,
        oid: 0,
        fields: [],
      };
    }

    // Blocked Zones
    if (sql.includes('INSERT INTO blocked_zones')) {
      const id = vals[0] as string;
      const zone: DbBlockedZone = {
        id,
        name: (vals[1] as string) || null,
        severity: vals[2] as DbBlockedZone['severity'],
        geometry:
          'POLYGON((77.24 28.662, 77.245 28.665, 77.247 28.661, 77.242 28.658, 77.24 28.662))',
        is_active: true,
        created_by: vals[4] as string,
        created_at: new Date(),
        updated_at: new Date(),
      };
      this.blockedZones.set(id, zone);
      return { rows: [zone as unknown as R], command: 'INSERT', rowCount: 1, oid: 0, fields: [] };
    }

    if (sql.includes('FROM blocked_zones WHERE id = $1')) {
      const id = vals[0] as string;
      const z = this.blockedZones.get(id);
      return {
        rows: z ? [z as unknown as R] : [],
        command: 'SELECT',
        rowCount: z ? 1 : 0,
        oid: 0,
        fields: [],
      };
    }

    if (sql.includes('FROM blocked_zones')) {
      const rows = Array.from(this.blockedZones.values());
      return {
        rows: rows as unknown as R[],
        command: 'SELECT',
        rowCount: rows.length,
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
        payload: JSON.parse(vals[6] as string),
        correlation_id: (vals[7] as string) || null,
        idempotency_key: (vals[8] as string) || null,
        entity_version: (vals[9] as number) || 1,
        processing_status: 'RECORDED',
        processing_attempts: 0,
        last_error_code: null,
        occurred_at: vals[13] as Date,
        created_at: new Date(),
        processed_at: null,
      };
      this.operationalEvents.set(id, row);
      return { rows: [row as unknown as R], command: 'INSERT', rowCount: 1, oid: 0, fields: [] };
    }

    if (sql.includes('FROM operational_events WHERE id = $1')) {
      const id = vals[0] as string;
      const ev = this.operationalEvents.get(id);
      return {
        rows: ev ? [ev as unknown as R] : [],
        command: 'SELECT',
        rowCount: ev ? 1 : 0,
        oid: 0,
        fields: [],
      };
    }

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

    // Audit Events
    if (sql.includes('INSERT INTO audit_events')) {
      const payloadVal = vals[4];
      let parsedPayload: Record<string, unknown> = {};
      if (typeof payloadVal === 'string' && payloadVal.length > 0) {
        try {
          parsedPayload = JSON.parse(payloadVal);
        } catch {
          parsedPayload = { raw: payloadVal };
        }
      } else if (payloadVal && typeof payloadVal === 'object') {
        parsedPayload = payloadVal as Record<string, unknown>;
      }
      const audit: DbAuditEvent = {
        id: `audit-${Date.now()}-${this.auditEvents.length}`,
        entity_type: vals[0] as string,
        entity_id: vals[1] as string,
        event_type: vals[2] as string,
        actor: (vals[3] as string) || 'SYSTEM',
        payload: parsedPayload,
        created_at: new Date(),
      };
      this.auditEvents.push(audit);
      return { rows: [audit as unknown as R], command: 'INSERT', rowCount: 1, oid: 0, fields: [] };
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

    return { rows: [], command: 'SELECT', rowCount: 0, oid: 0, fields: [] };
  }
}

class DeterministicDemoRepairSolver implements RepairSolver {
  async solveRepair(_input: RepairInput): Promise<RepairResult> {
    void _input;
    return {
      status: 'PROPOSED',
      proposalId: `demo-repair-prop-${Date.now()}`,
      proposedPlan: {
        scenarioId: 'scenario-demo-yamuna-2026',
        calculatedAt: new Date().toISOString(),
        routes: [
          {
            resourceId: 'demo-res-boat-02',
            stops: [
              {
                stopNumber: 0,
                type: 'PICKUP',
                targetId: 'demo-req-001',
                lat: 28.665,
                lng: 77.228,
                passengersPickedUp: 4,
                passengersDroppedOff: 0,
                estimatedArrivalMinutes: 12.0,
                isFrozen: true,
              },
              {
                stopNumber: 1,
                type: 'DROPOFF',
                targetId: 'demo-shelter-kashmere-gate',
                lat: 28.668,
                lng: 77.232,
                passengersPickedUp: 0,
                passengersDroppedOff: 4,
                estimatedArrivalMinutes: 20.0,
                isFrozen: true,
              },
            ],
            totalDurationMinutes: 25,
            totalTravelDistanceKm: 6.2,
            servedRequestIds: ['demo-req-001'],
          },
        ],
        metrics: {
          coveragePercent: 100,
          totalTravelTimeMinutes: 25,
          totalTravelDistanceKm: 6.2,
          highPriorityWaitTimeMinutes: 12,
          solveDurationMs: 15,
          servedRequestsCount: 1,
          unservedRequestsCount: 0,
        },
        unserved: [],
      },
      unservedRequestIds: [],
      warnings: [],
      churn: {
        reassignedRequestsCount: 1,
        newlyUnservedRequestsCount: 0,
        churnRate: 0.1,
        frozenStopsViolated: 0,
      },
    };
  }
}

describe('Deterministic End-to-End Demonstration Workflow Walkthrough', () => {
  let app: Express;
  let mockDb: InMemoryDemoQueryable;
  let adminToken: string;

  beforeEach(async () => {
    process.env.FORECAST_ENABLE_OFFLINE_FIXTURE = '1';
    mockDb = new InMemoryDemoQueryable();
    const repo = new PostgisRepository(mockDb);
    const authRepo = new InMemoryAuthRepository();
    const authService = new AuthService(authRepo);
    const requestService = new RequestService(repo);
    const assignmentService = new AssignmentService(repo);
    const affectedScopeService = new AffectedScopeService(repo);
    const eventService = new OperationalEventService(repo, affectedScopeService);
    const repairSolver = new DeterministicDemoRepairSolver();
    const repairService = new RepairOrchestrationService(repo, repairSolver);
    const forecastService = new ForecastService();

    // Seed baseline resources and shelters
    mockDb.resources.set('demo-res-boat-01', {
      id: 'demo-res-boat-01',
      name: 'NDRF Inflatable Rescue Boat Alpha',
      type: 'BOAT',
      capacity: 8,
      speed_km_h: 25,
      location: 'POINT(77.22 28.66)',
      status: 'AVAILABLE',
      depot_id: 'demo-shelter-kashmere-gate',
      shift_max_duration_min: 480,
      source: 'REAL',
      created_at: new Date(),
      updated_at: new Date(),
    });

    mockDb.resources.set('demo-res-boat-02', {
      id: 'demo-res-boat-02',
      name: 'NDRF Motorized Boat Bravo',
      type: 'BOAT',
      capacity: 10,
      speed_km_h: 25,
      location: 'POINT(77.23 28.68)',
      status: 'AVAILABLE',
      depot_id: 'demo-shelter-wazirabad',
      shift_max_duration_min: 480,
      source: 'REAL',
      created_at: new Date(),
      updated_at: new Date(),
    });

    mockDb.shelters.set('demo-shelter-kashmere-gate', {
      id: 'demo-shelter-kashmere-gate',
      name: 'Kashmere Gate Relief Camp',
      location: 'POINT(77.232 28.668)',
      capacity: 120,
      current_occupancy: 20,
      is_active: true,
      source: 'REAL',
      created_at: new Date(),
      updated_at: new Date(),
    });

    // Create demonstration dispatcher operator with least-privilege DISPATCHER role
    const testDemoPassword = 'Demo-Dispatcher-TestPass#2026';
    await authService.createOperator({
      username: 'demo_operator',
      password: testDemoPassword,
      name: 'Lead Disaster Operations Dispatcher',
      role: 'DISPATCHER',
    });
    const authRes = await authService.authenticate('demo_operator', testDemoPassword);
    adminToken = authRes.token;

    app = createApp({
      repository: repo,
      authService,
      requestService,
      assignmentService,
      operationalEventService: eventService,
      affectedScopeService,
      repairOrchestrationService: repairService,
      forecastService,
    });
  });

  afterEach(() => {
    delete process.env.FORECAST_ENABLE_OFFLINE_FIXTURE;
  });

  it('executes full 8-step disaster response scenario deterministically', async () => {
    // -------------------------------------------------------------------------
    // STEP 1: Submit Citizen Rescue Request (POST /requests)
    // -------------------------------------------------------------------------
    const citizenReqRes = await request(app).post('/requests').send({
      lat: 28.665,
      lng: 77.228,
      peopleCount: 4,
      urgency: 'CRITICAL',
      medicalNeeds: true,
      notes: 'Elderly couple and 2 children stranded on terrace, insulin required.',
    });

    expect(citizenReqRes.status).toBe(201);
    expect(citizenReqRes.body.success).toBe(true);
    const requestId = citizenReqRes.body.data.id;
    expect(requestId).toBeDefined();
    expect(citizenReqRes.body.data.status).toBe('PENDING');

    // -------------------------------------------------------------------------
    // STEP 2: Operator Request Monitoring & Duplicate Triage (GET /requests)
    // -------------------------------------------------------------------------
    const requestsListRes = await request(app)
      .get('/requests')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(requestsListRes.status).toBe(200);
    expect(requestsListRes.body.data.length).toBeGreaterThan(0);
    const foundReq = requestsListRes.body.data.find((r: { id: string }) => r.id === requestId);
    expect(foundReq).toBeDefined();

    // -------------------------------------------------------------------------
    // STEP 3: Propose Resource Assignment (POST /assignments/propose)
    // -------------------------------------------------------------------------
    const proposeRes = await request(app)
      .post('/assignments/propose')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        scenarioId: 'scenario-demo-yamuna-2026',
        algorithm: 'cluster-allocation',
      });

    expect(proposeRes.status).toBe(201);
    expect(proposeRes.body.success).toBe(true);
    const assignmentId = proposeRes.body.data.id;
    expect(assignmentId).toBeDefined();
    expect(proposeRes.body.data.status).toBe('PROPOSED');

    // -------------------------------------------------------------------------
    // STEP 4: Commit Assignment & Freeze Stops (POST /assignments/:id/commit)
    // -------------------------------------------------------------------------
    const commitRes = await request(app)
      .post(`/assignments/${assignmentId}/commit`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        operatorId: 'demo_operator',
        notes: 'Authorized deployment by demo operator',
      });

    expect(commitRes.status).toBe(200);
    expect(commitRes.body.success).toBe(true);

    // Verify stops are now frozen
    const committedStops = mockDb.assignmentStops.filter((s) => s.assignment_id === assignmentId);
    expect(committedStops.every((s) => s.is_frozen)).toBe(true);

    // -------------------------------------------------------------------------
    // STEP 5: Disruption Event Injection (PATCH /operations/resources/:id/status & POST /operations/road-zones)
    // -------------------------------------------------------------------------
    // A. Craft offline event
    const statusRes = await request(app)
      .patch('/operations/resources/demo-res-boat-01/status')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        status: 'OFFLINE',
        reason: 'Outboard motor flooded in debris',
      });

    expect(statusRes.status).toBe(200);
    expect(statusRes.body.success).toBe(true);
    const offlineEvent = statusRes.body.data.event;
    expect(offlineEvent).toBeDefined();
    expect(offlineEvent.type).toBe('RESOURCE_OFFLINE');

    // B. Road hazard event
    const hazardRes = await request(app)
      .post('/operations/road-zones')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Ring Road Submerged Underpass',
        severity: 'BLOCKED',
        polygon: [
          { lat: 28.662, lng: 77.24 },
          { lat: 28.665, lng: 77.245 },
          { lat: 28.661, lng: 77.247 },
          { lat: 28.658, lng: 77.242 },
        ],
        reason: 'Rising Yamuna floodwaters submerged underpass',
      });

    expect(hazardRes.status).toBe(201);
    expect(hazardRes.body.success).toBe(true);
    expect(hazardRes.body.data.event.type).toBe('ROAD_BLOCKED');

    // -------------------------------------------------------------------------
    // STEP 6: Incremental Plan Repair (POST /operations/repair)
    // -------------------------------------------------------------------------
    const repairRes = await request(app)
      .post('/operations/repair')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        eventId: offlineEvent.id,
        baselineAssignmentId: assignmentId,
      });

    expect(repairRes.status).toBe(200);
    expect(repairRes.body.success).toBe(true);
    const repairData = repairRes.body.data;
    expect(repairData.status).toBe('PROPOSED');
    expect(repairData.churn.frozenStopsViolated).toBe(0);
    expect(repairData.churn.reassignedRequestsCount).toBe(1);

    // -------------------------------------------------------------------------
    // STEP 7: GIS River Flood Forecast Context Retrieval (GET /forecast/context)
    // -------------------------------------------------------------------------
    const forecastRes = await request(app)
      .get('/forecast/context')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(forecastRes.status).toBe(200);
    expect(forecastRes.body.success).toBe(true);
    const forecast = forecastRes.body.data;
    expect(forecast.region.name).toContain('Yamuna');
    expect(forecast.riskCategory).toBeDefined();
    expect(forecast.daily.length).toBeGreaterThan(0);
    expect(forecast.disclaimer).toContain('does not trigger autonomous rescue dispatch');

    // -------------------------------------------------------------------------
    // STEP 8: Operational Audit Log Inspection (GET /audit/events)
    // -------------------------------------------------------------------------
    const auditRes = await request(app)
      .get('/audit/events')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(auditRes.status).toBe(200);
    expect(auditRes.body.success).toBe(true);
    expect(auditRes.body.data.length).toBeGreaterThan(0);

    // -------------------------------------------------------------------------
    // STEP 9: Safe Cleanup Verification
    // -------------------------------------------------------------------------
    mockDb.requests.delete(requestId);
    mockDb.assignments.delete(assignmentId);
    mockDb.assignmentStops = [];
    expect(mockDb.requests.has(requestId)).toBe(false);
    expect(mockDb.assignments.has(assignmentId)).toBe(false);
  });
});
