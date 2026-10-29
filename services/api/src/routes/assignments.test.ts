import request from 'supertest';
import { describe, it, expect, beforeEach } from 'vitest';
import type { StopType } from '@floodrelay/shared';
import { createApp } from '../app.js';
import { PostgisRepository, type Queryable } from '../db/repository.js';
import { AssignmentService } from '../services/assignmentService.js';
import { RequestService } from '../services/requestService.js';
import type {
  DbAssignment,
  DbAssignmentStop,
  DbRequest,
  DbResource,
  DbShelter,
} from '../db/schema.js';

class InMemoryAssignmentDbMock implements Queryable {
  public requests: Map<string, DbRequest> = new Map();
  public resources: Map<string, DbResource> = new Map();
  public shelters: Map<string, DbShelter> = new Map();
  public assignments: Map<string, DbAssignment> = new Map();
  public stops: Map<string, DbAssignmentStop> = new Map();
  public auditEvents: unknown[] = [];
  public failOnStatement?: string;

  private snapshot?: {
    requests: Map<string, DbRequest>;
    resources: Map<string, DbResource>;
    shelters: Map<string, DbShelter>;
    assignments: Map<string, DbAssignment>;
    stops: Map<string, DbAssignmentStop>;
    auditEvents: unknown[];
  };

  async query<R extends Record<string, unknown> = Record<string, unknown>>(
    sqlOrConfig: string | { text: string; values?: unknown[] },
    values?: unknown[],
  ): Promise<{ rows: R[]; command: string; rowCount: number; oid: number; fields: [] }> {
    const sql = typeof sqlOrConfig === 'string' ? sqlOrConfig : sqlOrConfig.text;
    const vals = values ?? (sqlOrConfig as { values?: unknown[] }).values ?? [];

    if (this.failOnStatement && sql.includes(this.failOnStatement)) {
      throw new Error(`Injected failure on statement: ${this.failOnStatement}`);
    }

    if (sql.trim() === 'BEGIN') {
      this.snapshot = {
        requests: new Map(Array.from(this.requests.entries()).map(([k, v]) => [k, { ...v }])),
        resources: new Map(Array.from(this.resources.entries()).map(([k, v]) => [k, { ...v }])),
        shelters: new Map(Array.from(this.shelters.entries()).map(([k, v]) => [k, { ...v }])),
        assignments: new Map(Array.from(this.assignments.entries()).map(([k, v]) => [k, { ...v }])),
        stops: new Map(Array.from(this.stops.entries()).map(([k, v]) => [k, { ...v }])),
        auditEvents: [...this.auditEvents],
      };
      return { rows: [], command: 'BEGIN', rowCount: 0, oid: 0, fields: [] };
    }

    if (sql.trim() === 'COMMIT') {
      this.snapshot = undefined;
      return { rows: [], command: 'COMMIT', rowCount: 0, oid: 0, fields: [] };
    }

    if (sql.trim() === 'ROLLBACK') {
      if (this.snapshot) {
        this.requests = this.snapshot.requests;
        this.resources = this.snapshot.resources;
        this.shelters = this.snapshot.shelters;
        this.assignments = this.snapshot.assignments;
        this.stops = this.snapshot.stops;
        this.auditEvents = this.snapshot.auditEvents;
        this.snapshot = undefined;
      }
      return { rows: [], command: 'ROLLBACK', rowCount: 0, oid: 0, fields: [] };
    }

    if (sql.includes('FROM assignments') && sql.includes('FOR UPDATE')) {
      const id = vals[0] as string;
      const assign = this.assignments.get(id);
      if (!assign) {
        return { rows: [], command: 'SELECT', rowCount: 0, oid: 0, fields: [] };
      }
      return {
        rows: [{ id: assign.id, status: assign.status, scenario_id: assign.scenario_id } as unknown as R],
        command: 'SELECT',
        rowCount: 1,
        oid: 0,
        fields: [],
      };
    }

    if (sql.includes('FROM requests') && sql.includes('WHERE id = ANY')) {
      const ids = vals[0] as string[];
      const rows = ids
        .map((id) => this.requests.get(id))
        .filter((r): r is DbRequest => Boolean(r))
        .map((r) => ({ id: r.id, status: r.status }));
      return { rows: rows as unknown as R[], command: 'SELECT', rowCount: rows.length, oid: 0, fields: [] };
    }

    if (sql.includes('FROM assignment_stops s') && sql.includes('JOIN assignments a')) {
      const excludeAssignmentId = vals[0] as string;
      const resourceIds = (vals[1] as string[]) || [];
      const rows: Record<string, unknown>[] = [];
      for (const stop of this.stops.values()) {
        if (stop.assignment_id === excludeAssignmentId) continue;
        if (!resourceIds.includes(stop.resource_id)) continue;
        const parentAssign = this.assignments.get(stop.assignment_id);
        if (parentAssign && (parentAssign.status === 'COMMITTED' || parentAssign.status === 'DISPATCHED')) {
          rows.push({
            id: stop.id,
            resource_id: stop.resource_id,
            type: stop.type,
            target_id: stop.target_id,
            stop_number: stop.stop_number,
            is_frozen: stop.is_frozen,
            assignment_status: parentAssign.status,
            other_assignment_id: parentAssign.id,
          });
        }
      }
      return { rows: rows as unknown as R[], command: 'SELECT', rowCount: rows.length, oid: 0, fields: [] };
    }

    // 1. SELECT FROM requests
    if (sql.includes('FROM requests')) {
      const rows: Record<string, unknown>[] = [];
      const statusFilter = vals[0] as string | undefined;

      for (const req of this.requests.values()) {
        if (statusFilter && req.status !== statusFilter) {
          continue;
        }
        const match = /POINT\(([-\d.]+)\s+([-\d.]+)\)/.exec(req.location);
        rows.push({
          id: req.id,
          lat: match ? parseFloat(match[2]!) : 0,
          lng: match ? parseFloat(match[1]!) : 0,
          peopleCount: req.people_count,
          urgency: req.urgency,
          source: req.source,
          status: req.status,
          medicalNeeds: req.medical_needs,
          notes: req.notes,
          isFlaggedDuplicate: req.is_flagged_duplicate,
          duplicateOfId: req.duplicate_of_id,
          createdAt: req.created_at,
        });
      }
      return {
        rows: rows as unknown as R[],
        command: 'SELECT',
        rowCount: rows.length,
        oid: 0,
        fields: [],
      };
    }

    // 2. SELECT FROM resources
    if (sql.includes('FROM resources')) {
      const rows: Record<string, unknown>[] = [];
      for (const res of this.resources.values()) {
        const match = /POINT\(([-\d.]+)\s+([-\d.]+)\)/.exec(res.location);
        rows.push({
          id: res.id,
          name: res.name,
          type: res.type,
          capacity: res.capacity,
          speedKmH: res.speed_km_h,
          lat: match ? parseFloat(match[2]!) : 0,
          lng: match ? parseFloat(match[1]!) : 0,
          status: res.status,
          depotId: res.depot_id,
        });
      }
      return {
        rows: rows as unknown as R[],
        command: 'SELECT',
        rowCount: rows.length,
        oid: 0,
        fields: [],
      };
    }

    // 3. SELECT FROM shelters
    if (sql.includes('FROM shelters')) {
      const rows: Record<string, unknown>[] = [];
      for (const sh of this.shelters.values()) {
        const match = /POINT\(([-\d.]+)\s+([-\d.]+)\)/.exec(sh.location);
        rows.push({
          id: sh.id,
          name: sh.name,
          capacity: sh.capacity,
          currentOccupancy: sh.current_occupancy,
          lat: match ? parseFloat(match[2]!) : 0,
          lng: match ? parseFloat(match[1]!) : 0,
        });
      }
      return {
        rows: rows as unknown as R[],
        command: 'SELECT',
        rowCount: rows.length,
        oid: 0,
        fields: [],
      };
    }

    // 4. INSERT INTO assignments
    if (sql.includes('INSERT INTO assignments')) {
      const id = vals[0] as string;
      const scenario_id = vals[1] as string;
      const status = vals[2] as 'PROPOSED' | 'COMMITTED';
      const metrics = vals[3] ? JSON.parse(vals[3] as string) : null;
      const unserved = vals[4] ? JSON.parse(vals[4] as string) : null;
      const committed_at = vals[5] as Date | null;
      const committed_by = vals[6] as string | null;

      const assignmentRow: DbAssignment = {
        id,
        scenario_id,
        status,
        metrics,
        unserved,
        committed_at,
        committed_by,
        created_at: new Date(),
        updated_at: new Date(),
      };
      this.assignments.set(id, assignmentRow);
      return {
        rows: [assignmentRow as unknown as R],
        command: 'INSERT',
        rowCount: 1,
        oid: 0,
        fields: [],
      };
    }

    // 5. DELETE FROM assignment_stops
    if (sql.includes('DELETE FROM assignment_stops')) {
      const assignId = vals[0] as string;
      for (const [key, stop] of this.stops.entries()) {
        if (stop.assignment_id === assignId) {
          this.stops.delete(key);
        }
      }
      return { rows: [], command: 'DELETE', rowCount: 1, oid: 0, fields: [] };
    }

    // 6. INSERT INTO assignment_stops
    if (sql.includes('INSERT INTO assignment_stops')) {
      const id = vals[0] as string;
      const assignment_id = vals[1] as string;
      const resource_id = vals[2] as string;
      const stop_number = vals[3] as number;
      const type = vals[4] as StopType;
      const target_id = vals[5] as string;
      const location = vals[6] as string;
      const passengers_picked_up = vals[7] as number;
      const passengers_dropped_off = vals[8] as number;
      const estimated_arrival_minutes = vals[9] as number;
      const is_frozen = Boolean(vals[10]);

      const stopRow: DbAssignmentStop = {
        id,
        assignment_id,
        resource_id,
        stop_number,
        type,
        target_id,
        location,
        passengers_picked_up,
        passengers_dropped_off,
        estimated_arrival_minutes,
        is_frozen,
        created_at: new Date(),
      };
      this.stops.set(id, stopRow);
      return {
        rows: [stopRow as unknown as R],
        command: 'INSERT',
        rowCount: 1,
        oid: 0,
        fields: [],
      };
    }

    // 7. SELECT FROM assignments WHERE id = $1
    if (sql.includes('FROM assignments') && sql.includes('WHERE id = $1')) {
      const id = vals[0] as string;
      const assign = this.assignments.get(id);
      if (!assign) {
        return { rows: [], command: 'SELECT', rowCount: 0, oid: 0, fields: [] };
      }
      return {
        rows: [
          {
            id: assign.id,
            scenario_id: assign.scenario_id,
            status: assign.status,
            metrics: assign.metrics,
            unserved: assign.unserved,
            committed_at: assign.committed_at,
            committed_by: assign.committed_by,
            created_at: assign.created_at,
            updated_at: assign.updated_at,
          } as unknown as R,
        ],
        command: 'SELECT',
        rowCount: 1,
        oid: 0,
        fields: [],
      };
    }

    // 8. SELECT FROM assignment_stops WHERE assignment_id = $1
    if (
      sql.includes('SELECT') &&
      sql.includes('FROM assignment_stops') &&
      sql.includes('WHERE assignment_id = $1') &&
      !sql.includes('UPDATE')
    ) {
      const assignId = vals[0] as string;
      const stops: DbAssignmentStop[] = [];
      for (const stop of this.stops.values()) {
        if (stop.assignment_id === assignId) {
          stops.push(stop);
        }
      }
      stops.sort((a, b) => a.stop_number - b.stop_number);
      return {
        rows: stops as unknown as R[],
        command: 'SELECT',
        rowCount: stops.length,
        oid: 0,
        fields: [],
      };
    }

    // 9. SELECT FROM assignments (list assignments or get latest committed)
    if (sql.includes('FROM assignments')) {
      const rows: DbAssignment[] = Array.from(this.assignments.values());
      if (sql.includes("status = 'COMMITTED'")) {
        const committed = rows.filter((a) => a.status === 'COMMITTED');
        committed.sort((a, b) => b.created_at.getTime() - a.created_at.getTime());
        return {
          rows: committed as unknown as R[],
          command: 'SELECT',
          rowCount: committed.length,
          oid: 0,
          fields: [],
        };
      }
      if (sql.includes('status = $1')) {
        const filterStatus = vals[0] as string;
        const filtered = rows.filter((a) => a.status === filterStatus);
        return {
          rows: filtered as unknown as R[],
          command: 'SELECT',
          rowCount: filtered.length,
          oid: 0,
          fields: [],
        };
      }
      rows.sort((a, b) => b.created_at.getTime() - a.created_at.getTime());
      return {
        rows: rows as unknown as R[],
        command: 'SELECT',
        rowCount: rows.length,
        oid: 0,
        fields: [],
      };
    }

    // 10. UPDATE assignments SET status = 'COMMITTED'
    if (sql.includes('UPDATE assignments') && sql.includes("SET status = 'COMMITTED'")) {
      const assignId = vals[0] as string;
      const operatorId = vals[1] as string;
      const assign = this.assignments.get(assignId);
      if (!assign || assign.status !== 'PROPOSED') {
        return { rows: [], command: 'UPDATE', rowCount: 0, oid: 0, fields: [] };
      }
      assign.status = 'COMMITTED';
      assign.committed_at = new Date();
      assign.committed_by = operatorId;
      assign.updated_at = new Date();
      return { rows: [assign as unknown as R], command: 'UPDATE', rowCount: 1, oid: 0, fields: [] };
    }

    // 11. UPDATE assignment_stops SET is_frozen = TRUE WHERE assignment_id = $1
    if (sql.includes('UPDATE assignment_stops') && sql.includes('is_frozen = TRUE')) {
      const assignId = vals[0] as string;
      let count = 0;
      for (const stop of this.stops.values()) {
        if (stop.assignment_id === assignId) {
          stop.is_frozen = true;
          count++;
        }
      }
      return { rows: [], command: 'UPDATE', rowCount: count, oid: 0, fields: [] };
    }

    // 12. UPDATE requests SET status = 'ASSIGNED'
    if (sql.includes('UPDATE requests') && sql.includes("status = 'ASSIGNED'")) {
      let count = 0;
      if (Array.isArray(vals[0])) {
        for (const id of vals[0] as string[]) {
          const req = this.requests.get(id);
          if (req) {
            req.status = 'ASSIGNED';
            count++;
          }
        }
      } else {
        const assignId = vals[0] as string;
        for (const stop of this.stops.values()) {
          if (stop.assignment_id === assignId && stop.type === 'PICKUP') {
            const req = this.requests.get(stop.target_id);
            if (req) {
              req.status = 'ASSIGNED';
              count++;
            }
          }
        }
      }
      return { rows: [], command: 'UPDATE', rowCount: count, oid: 0, fields: [] };
    }

    // 13. UPDATE assignment_stops (stop modification)
    if (
      sql.includes('UPDATE assignment_stops') &&
      sql.includes('WHERE assignment_id = $1 AND id = $2')
    ) {
      const assignId = vals[0] as string;
      const stopId = vals[1] as string;
      const stop = this.stops.get(stopId);
      if (!stop || stop.assignment_id !== assignId) {
        return { rows: [], command: 'UPDATE', rowCount: 0, oid: 0, fields: [] };
      }

      let valIdx = 2;
      if (sql.includes('is_frozen = $')) {
        stop.is_frozen = Boolean(vals[valIdx++]);
      }
      if (sql.includes('stop_number = $')) {
        stop.stop_number = vals[valIdx++] as number;
      }
      if (sql.includes('resource_id = $')) {
        stop.resource_id = vals[valIdx] as string;
      }

      return { rows: [stop as unknown as R], command: 'UPDATE', rowCount: 1, oid: 0, fields: [] };
    }

    // 14. INSERT INTO audit_events
    if (sql.includes('INSERT INTO audit_events')) {
      this.auditEvents.push(vals);
      return { rows: [], command: 'INSERT', rowCount: 1, oid: 0, fields: [] };
    }

    return { rows: [], command: 'UNKNOWN', rowCount: 0, oid: 0, fields: [] };
  }
}

describe('Assignment Endpoints Integration Tests', () => {
  let dbMock: InMemoryAssignmentDbMock;
  let repo: PostgisRepository;
  let assignmentService: AssignmentService;
  let requestService: RequestService;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    dbMock = new InMemoryAssignmentDbMock();
    repo = new PostgisRepository(dbMock);
    assignmentService = new AssignmentService(repo);
    requestService = new RequestService(repo);
    app = createApp({ repository: repo, requestService, assignmentService });

    // Seed test shelters
    const shelter1: DbShelter = {
      id: 'shelter_north',
      name: 'North Relief Center',
      location: 'POINT(77.228 28.692)',
      capacity: 50,
      current_occupancy: 0,
      is_active: true,
      source: 'SIMULATED',
      created_at: new Date(),
      updated_at: new Date(),
    };
    dbMock.shelters.set(shelter1.id, shelter1);

    // Seed test rescue resources
    const boat1: DbResource = {
      id: 'boat_01',
      name: 'Rescue Inflatable Boat 1',
      type: 'BOAT',
      capacity: 8,
      speed_km_h: 20,
      location: 'POINT(77.225 28.690)',
      status: 'AVAILABLE',
      depot_id: 'depot_01',
      shift_max_duration_min: 480,
      source: 'SIMULATED',
      created_at: new Date(),
      updated_at: new Date(),
    };
    dbMock.resources.set(boat1.id, boat1);

    // Seed test rescue requests
    const req1: DbRequest = {
      id: 'req_01',
      location: 'POINT(77.230 28.695)',
      people_count: 3,
      urgency: 'CRITICAL',
      source: 'SIMULATED',
      status: 'PENDING',
      verification_status: 'VERIFIED',
      medical_needs: false,
      notes: 'Water rising rapidly',
      idempotency_key: null,
      duplicate_of_id: null,
      is_flagged_duplicate: false,
      created_at: new Date(),
      updated_at: new Date(),
    };
    const req2: DbRequest = {
      id: 'req_02',
      location: 'POINT(77.232 28.696)',
      people_count: 2,
      urgency: 'HIGH',
      source: 'SIMULATED',
      status: 'PENDING',
      verification_status: 'VERIFIED',
      medical_needs: false,
      notes: null,
      idempotency_key: null,
      duplicate_of_id: null,
      is_flagged_duplicate: false,
      created_at: new Date(),
      updated_at: new Date(),
    };
    dbMock.requests.set(req1.id, req1);
    dbMock.requests.set(req2.id, req2);
  });

  describe('POST /assignments/propose', () => {
    it('runs solver on stored requests and resources and returns 201 Created with status PROPOSED', async () => {
      const res = await request(app).post('/assignments/propose').send({
        scenarioId: 'test-scenario',
        algorithm: 'cluster-allocation',
      });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('PROPOSED');
      expect(res.body.data.id).toMatch(/^assign_/);
      expect(res.body.data.routes).toBeInstanceOf(Array);
      expect(res.body.data.routes.length).toBeGreaterThan(0);
      expect(res.body.data.metrics).toBeDefined();
      expect(res.body.data.metrics.coveragePercent).toBeGreaterThan(0);

      // Verify that database record status is PROPOSED (not COMMITTED)
      const stored = dbMock.assignments.get(res.body.data.id);
      expect(stored).toBeDefined();
      expect(stored?.status).toBe('PROPOSED');
      expect(stored?.committed_at).toBeNull();
      expect(stored?.committed_by).toBeNull();
    });

    it('supports selecting different algorithms (nearest-first and savings baseline)', async () => {
      const resNearest = await request(app)
        .post('/assignments/propose')
        .send({ algorithm: 'nearest-first' });
      expect(resNearest.status).toBe(201);
      expect(resNearest.body.data.status).toBe('PROPOSED');

      const resSavings = await request(app)
        .post('/assignments/propose')
        .send({ algorithm: 'savings' });
      expect(resSavings.status).toBe(201);
      expect(resSavings.body.data.status).toBe('PROPOSED');
    });

    it('rejects invalid algorithm option with 400 Bad Request', async () => {
      const res = await request(app)
        .post('/assignments/propose')
        .send({ algorithm: 'invalid-algo' });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('handles scenario with no pending requests gracefully with 0 routes and 100% coverage', async () => {
      dbMock.requests.clear();

      const res = await request(app).post('/assignments/propose').send({});

      expect(res.status).toBe(201);
      expect(res.body.data.status).toBe('PROPOSED');
      expect(res.body.data.routes.length).toBe(0);
      expect(res.body.data.metrics.servedRequestsCount).toBe(0);
      expect(res.body.data.metrics.unservedRequestsCount).toBe(0);
    });

    it('persists unserved requests with explicit reasons when no resources are available', async () => {
      // Set all resources to OFFLINE
      for (const res of dbMock.resources.values()) {
        res.status = 'OFFLINE';
      }

      const res = await request(app).post('/assignments/propose').send({});

      expect(res.status).toBe(201);
      expect(res.body.data.status).toBe('PROPOSED');
      expect(res.body.data.unserved.length).toBe(2);
      expect(res.body.data.unserved[0].reason).toBe('CAPACITY_EXCEEDED');
      expect(res.body.data.unserved[0].details).toBe('No available resources');
    });
  });

  describe('GET /assignments and GET /assignments/:id', () => {
    it('lists stored assignments and filters by status', async () => {
      // Create a proposed assignment
      const proposeRes = await request(app).post('/assignments/propose').send({});
      const assignId = proposeRes.body.data.id;

      // List all assignments
      const listAll = await request(app).get('/assignments');
      expect(listAll.status).toBe(200);
      expect(listAll.body.count).toBe(1);

      // Filter by PROPOSED
      const listProp = await request(app).get('/assignments?status=PROPOSED');
      expect(listProp.status).toBe(200);
      expect(listProp.body.count).toBe(1);

      // Filter by COMMITTED
      const listComm = await request(app).get('/assignments?status=COMMITTED');
      expect(listComm.status).toBe(200);
      expect(listComm.body.count).toBe(0);

      // Retrieve by ID
      const getSingle = await request(app).get(`/assignments/${assignId}`);
      expect(getSingle.status).toBe(200);
      expect(getSingle.body.data.id).toBe(assignId);
      expect(getSingle.body.data.routes).toBeInstanceOf(Array);
    });

    it('returns 404 Not Found for non-existent assignment ID', async () => {
      const res = await request(app).get('/assignments/assign_non_existent');
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });
  });

  describe('POST /assignments/:id/commit', () => {
    it('operator commits a proposed assignment and freezes all stops', async () => {
      const proposeRes = await request(app).post('/assignments/propose').send({});
      const assignId = proposeRes.body.data.id;

      const commitRes = await request(app).post(`/assignments/${assignId}/commit`).send({
        operatorId: 'operator_karan',
        notes: 'Approved primary river dispatch plan',
      });

      expect(commitRes.status).toBe(200);
      expect(commitRes.body.success).toBe(true);
      expect(commitRes.body.data.status).toBe('COMMITTED');
      expect(commitRes.body.data.committedBy).toBe('operator_karan');
      expect(commitRes.body.data.committedAt).toBeDefined();

      // Verify all stops in DB are frozen
      for (const stop of dbMock.stops.values()) {
        if (stop.assignment_id === assignId) {
          expect(stop.is_frozen).toBe(true);
        }
      }

      // Verify served requests are marked ASSIGNED
      expect(dbMock.requests.get('req_01')?.status).toBe('ASSIGNED');
      expect(dbMock.requests.get('req_02')?.status).toBe('ASSIGNED');
    });

    it('rejects committing an already committed assignment with 409 Conflict', async () => {
      const proposeRes = await request(app).post('/assignments/propose').send({});
      const assignId = proposeRes.body.data.id;

      await request(app)
        .post(`/assignments/${assignId}/commit`)
        .send({ operatorId: 'operator_karan' });

      // Second commit attempt
      const secondCommit = await request(app)
        .post(`/assignments/${assignId}/commit`)
        .send({ operatorId: 'operator_another' });

      expect(secondCommit.status).toBe(409);
      expect(secondCommit.body.error.code).toBe('ALREADY_COMMITTED');
    });

    it('rejects commit without operatorId with 400 Bad Request', async () => {
      const proposeRes = await request(app).post('/assignments/propose').send({});
      const assignId = proposeRes.body.data.id;

      const res = await request(app).post(`/assignments/${assignId}/commit`).send({});

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('returns 404 when attempting to commit a non-existent assignment', async () => {
      const res = await request(app)
        .post('/assignments/assign_missing/commit')
        .send({ operatorId: 'op_1' });

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });
  });

  describe('PATCH /assignments/:id/stops/:stopId (Operator changes stop)', () => {
    it('operator modifies a stop on a PROPOSED assignment', async () => {
      const proposeRes = await request(app).post('/assignments/propose').send({});
      const assignId = proposeRes.body.data.id;

      // Find first stop ID
      const firstStop = Array.from(dbMock.stops.values()).find((s) => s.assignment_id === assignId);
      expect(firstStop).toBeDefined();

      const patchRes = await request(app)
        .patch(`/assignments/${assignId}/stops/${firstStop!.id}`)
        .send({
          isFrozen: true,
        });

      expect(patchRes.status).toBe(200);
      expect(patchRes.body.success).toBe(true);
      expect(patchRes.body.data.isFrozen).toBe(true);
      expect(dbMock.stops.get(firstStop!.id)?.is_frozen).toBe(true);
    });

    it('rejects modifying stops on a COMMITTED assignment with 409 Conflict', async () => {
      const proposeRes = await request(app).post('/assignments/propose').send({});
      const assignId = proposeRes.body.data.id;
      const firstStop = Array.from(dbMock.stops.values()).find((s) => s.assignment_id === assignId);

      // Commit assignment
      await request(app)
        .post(`/assignments/${assignId}/commit`)
        .send({ operatorId: 'operator_karan' });

      // Attempt to modify after commit
      const patchRes = await request(app)
        .patch(`/assignments/${assignId}/stops/${firstStop!.id}`)
        .send({ isFrozen: false });

      expect(patchRes.status).toBe(409);
      expect(patchRes.body.error.code).toBe('CANNOT_MODIFY_COMMITTED');
    });

    it('preserves committed frozen stops when replanning with preserveFrozen: true', async () => {
      // 1. Propose first plan and commit it
      const proposeRes = await request(app).post('/assignments/propose').send({
        scenarioId: 'test-frozen-scenario',
      });
      const firstAssignId = proposeRes.body.data.id;
      await request(app)
        .post(`/assignments/${firstAssignId}/commit`)
        .send({ operatorId: 'operator_karan' });

      // 2. Add a new rescue request
      const newReq: DbRequest = {
        id: 'req_new_emergency',
        location: 'POINT(77.235 28.698)',
        people_count: 2,
        urgency: 'HIGH',
        source: 'SIMULATED',
        status: 'PENDING',
        verification_status: 'VERIFIED',
        medical_needs: false,
        notes: 'Newly stranded household',
        idempotency_key: null,
        duplicate_of_id: null,
        is_flagged_duplicate: false,
        created_at: new Date(),
        updated_at: new Date(),
      };
      dbMock.requests.set(newReq.id, newReq);

      // 3. Propose new plan with preserveFrozen: true
      const secondPropose = await request(app).post('/assignments/propose').send({
        scenarioId: 'test-frozen-scenario',
        preserveFrozen: true,
      });

      expect(secondPropose.status).toBe(201);
      const routes = secondPropose.body.data.routes;
      expect(routes.length).toBeGreaterThan(0);
      // The stops from the committed plan should be preserved at the head of the route with isFrozen = true
      const frozenStops = routes[0].stops.filter((s: { isFrozen?: boolean }) => s.isFrozen);
      expect(frozenStops.length).toBeGreaterThan(0);
    });
  });
  describe('Transaction Safety & Concurrency on commitAssignment', () => {
    it('an injected failure on each statement leaves the database unchanged', async () => {
      // 1. Failure on UPDATE assignment_stops
      const proposeRes1 = await request(app).post('/assignments/propose').send({});
      const assignId1 = proposeRes1.body.data.id;
      dbMock.failOnStatement = 'UPDATE assignment_stops SET is_frozen = TRUE';

      const resFail1 = await request(app)
        .post(`/assignments/${assignId1}/commit`)
        .send({ operatorId: 'op_test' });

      expect(resFail1.status).toBe(409);
      expect(dbMock.assignments.get(assignId1)?.status).toBe('PROPOSED');
      const sampleStop = Array.from(dbMock.stops.values()).find((s) => s.assignment_id === assignId1);
      expect(sampleStop?.is_frozen).toBe(false);

      // 2. Failure on UPDATE requests
      dbMock.failOnStatement = "UPDATE requests SET status = 'ASSIGNED'";
      const resFail2 = await request(app)
        .post(`/assignments/${assignId1}/commit`)
        .send({ operatorId: 'op_test' });

      expect(resFail2.status).toBe(409);
      expect(dbMock.assignments.get(assignId1)?.status).toBe('PROPOSED');
      expect(dbMock.requests.get('req_01')?.status).toBe('PENDING');

      // 3. Failure on INSERT INTO audit_events
      dbMock.failOnStatement = 'INSERT INTO audit_events';
      const resFail3 = await request(app)
        .post(`/assignments/${assignId1}/commit`)
        .send({ operatorId: 'op_test' });

      expect(resFail3.status).toBe(409);
      expect(dbMock.assignments.get(assignId1)?.status).toBe('PROPOSED');

      // Clean up failure injection
      dbMock.failOnStatement = undefined;
      // Now commit should succeed completely
      const successRes = await request(app)
        .post(`/assignments/${assignId1}/commit`)
        .send({ operatorId: 'op_test' });
      expect(successRes.status).toBe(200);
      expect(dbMock.assignments.get(assignId1)?.status).toBe('COMMITTED');
      expect(dbMock.requests.get('req_01')?.status).toBe('ASSIGNED');
    });

    it('two concurrent commits of the same assignment give one 200 and one 409', async () => {
      const proposeRes = await request(app).post('/assignments/propose').send({});
      const assignId = proposeRes.body.data.id;

      const [res1, res2] = await Promise.all([
        request(app).post(`/assignments/${assignId}/commit`).send({ operatorId: 'op_1' }),
        request(app).post(`/assignments/${assignId}/commit`).send({ operatorId: 'op_2' }),
      ]);

      const statuses = [res1.status, res2.status].sort();
      expect(statuses).toEqual([200, 409]);

      const conflictRes = res1.status === 409 ? res1 : res2;
      expect(conflictRes.body.error.code).toBe('ALREADY_COMMITTED');
    });

    it('two different proposals containing the same request cannot both be committed', async () => {
      // Both proposals will include the same initial pending requests (e.g. req_1)
      const prop1 = await request(app).post('/assignments/propose').send({});
      const prop2 = await request(app).post('/assignments/propose').send({});

      const id1 = prop1.body.data.id;
      const id2 = prop2.body.data.id;
      expect(id1).not.toBe(id2);

      // Commit first proposal -> succeeds
      const commit1 = await request(app)
        .post(`/assignments/${id1}/commit`)
        .send({ operatorId: 'op_1' });
      expect(commit1.status).toBe(200);

      // Attempt to commit second proposal containing the now-ASSIGNED requests -> must fail with 409
      const commit2 = await request(app)
        .post(`/assignments/${id2}/commit`)
        .send({ operatorId: 'op_2' });
      expect(commit2.status).toBe(409);
      expect(commit2.body.error.code).toBe('REQUEST_ALREADY_ASSIGNED');
    });
  });
});