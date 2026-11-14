import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApp } from '../app.js';
import { PostgisRepository, type Queryable } from '../db/repository.js';
import { AssignmentService } from '../services/assignmentService.js';
import { AuthService, InMemoryAuthRepository } from '../services/authService.js';
import type {
  DbAssignment,
  DbAssignmentStop,
  DbRequest,
  DbResource,
  DbShelter,
} from '../db/schema.js';

class InMemoryAssignmentDbStub implements Queryable {
  public requests: Map<string, DbRequest> = new Map();
  public resources: Map<string, DbResource> = new Map();
  public shelters: Map<string, DbShelter> = new Map();
  public assignments: Map<string, DbAssignment> = new Map();
  public stops: Map<string, DbAssignmentStop> = new Map();
  public auditEvents: Array<{
    entityType: string;
    entityId: string;
    eventType: string;
    payload: Record<string, unknown>;
  }> = [];

  async query<R extends Record<string, unknown> = Record<string, unknown>>(
    sqlOrConfig: string | { text: string; values?: unknown[] },
    values?: unknown[],
  ): Promise<{ rows: R[]; command: string; rowCount: number; oid: number; fields: [] }> {
    const sql = typeof sqlOrConfig === 'string' ? sqlOrConfig : sqlOrConfig.text;
    const vals = values ?? (sqlOrConfig as { values?: unknown[] }).values ?? [];

    if (sql.trim() === 'BEGIN' || sql.trim() === 'COMMIT' || sql.trim() === 'ROLLBACK') {
      return { rows: [], command: sql.trim(), rowCount: 0, oid: 0, fields: [] };
    }

    if (sql.includes('SELECT') && sql.includes('FROM requests')) {
      const rows = Array.from(this.requests.values()).map((r) => ({
        ...r,
        peopleCount: r.people_count,
        lat: 28.69,
        lng: 77.23,
      }));
      return {
        rows: rows as unknown as R[],
        command: 'SELECT',
        rowCount: rows.length,
        oid: 0,
        fields: [],
      };
    }

    if (sql.includes('SELECT') && sql.includes('FROM resources')) {
      const rows = Array.from(this.resources.values()).map((r) => ({
        ...r,
        speedKmH: r.speed_km_h,
        lat: 28.68,
        lng: 77.22,
      }));
      return {
        rows: rows as unknown as R[],
        command: 'SELECT',
        rowCount: rows.length,
        oid: 0,
        fields: [],
      };
    }

    if (sql.includes('SELECT') && sql.includes('FROM shelters')) {
      const rows = Array.from(this.shelters.values()).map((s) => ({
        ...s,
        currentOccupancy: s.current_occupancy,
        lat: 28.7,
        lng: 77.25,
      }));
      return {
        rows: rows as unknown as R[],
        command: 'SELECT',
        rowCount: rows.length,
        oid: 0,
        fields: [],
      };
    }

    if (
      sql.includes('SELECT') &&
      sql.includes('FROM assignments') &&
      sql.includes('ORDER BY committed_at DESC')
    ) {
      return { rows: [], command: 'SELECT', rowCount: 0, oid: 0, fields: [] };
    }

    if (sql.includes('INSERT INTO assignments')) {
      const a = vals[0] as DbAssignment;
      this.assignments.set(a.id, a);
      return { rows: [a as unknown as R], command: 'INSERT', rowCount: 1, oid: 0, fields: [] };
    }

    if (sql.includes('INSERT INTO assignment_stops')) {
      return { rows: [], command: 'INSERT', rowCount: 1, oid: 0, fields: [] };
    }

    if (sql.includes('INSERT INTO audit_events')) {
      this.auditEvents.push({
        entityType: vals[0] as string,
        entityId: vals[1] as string,
        eventType: vals[2] as string,
        payload: typeof vals[4] === 'string' ? JSON.parse(vals[4]) : vals[4],
      });
      return { rows: [], command: 'INSERT', rowCount: 1, oid: 0, fields: [] };
    }

    return { rows: [], command: 'UNKNOWN', rowCount: 0, oid: 0, fields: [] };
  }
}

describe('Assignment API OSRM & BlockedZones Integration Tests', () => {
  let authService: AuthService;
  let authToken: string;
  let server: http.Server;
  let serverPort: number;
  let fakeOsrmUrl: string;
  let dbStub: InMemoryAssignmentDbStub;
  let repository: PostgisRepository;

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      // Mock OSRM Table API response
      const url = new URL(req.url ?? '/', `http://127.0.0.1:${serverPort}`);
      const sourcesParam = url.searchParams.get('sources');
      const destinationsParam = url.searchParams.get('destinations');
      const pathParts = url.pathname.split('/');
      const rawCoords = (pathParts[4] ?? '').split(';');

      const sourceCount = sourcesParam ? sourcesParam.split(';').length : rawCoords.length;
      const destCount = destinationsParam ? destinationsParam.split(';').length : rawCoords.length;

      const durations = Array.from({ length: sourceCount }, () =>
        Array.from({ length: destCount }, () => 120),
      );
      const distances = Array.from({ length: sourceCount }, () =>
        Array.from({ length: destCount }, () => 1500),
      );

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ code: 'Ok', durations, distances }));
    });

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        serverPort = (server.address() as AddressInfo).port;
        fakeOsrmUrl = `http://127.0.0.1:${serverPort}`;
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  beforeEach(async () => {
    const authRepo = new InMemoryAuthRepository();
    authService = new AuthService(authRepo);
    await authService.createOperator({
      username: 'eoc_test_op',
      password: 'TestPassword123!',
      name: 'Test Officer',
      role: 'OPERATOR',
    });
    const session = await authService.authenticate('eoc_test_op', 'TestPassword123!');
    authToken = session.token;

    dbStub = new InMemoryAssignmentDbStub();
    repository = new PostgisRepository(dbStub as unknown as Queryable);

    // Populate stub data
    dbStub.requests.set('req_01', {
      id: 'req_01',
      location: 'POINT(77.230 28.690)',
      people_count: 2,
      urgency: 'HIGH',
      status: 'PENDING',
      source: 'REPORTED',
      verification_status: 'VERIFIED',
      medical_needs: false,
      notes: null,
      idempotency_key: 'idemp1',
      idempotency_request_hash: 'hash1',
      is_flagged_duplicate: false,
      duplicate_of_id: null,
      created_at: new Date(),
      updated_at: new Date(),
    });

    dbStub.resources.set('res_01', {
      id: 'res_01',
      name: 'Rescue Truck Alpha',
      type: 'HIGH_WATER_VEHICLE',
      capacity: 6,
      status: 'AVAILABLE',
      speed_km_h: 25,
      source: 'REAL',
      location: 'POINT(77.220 28.680)',
      depot_id: null,
      shift_max_duration_min: 480,
      created_at: new Date(),
      updated_at: new Date(),
    });

    dbStub.shelters.set('sh_01', {
      id: 'sh_01',
      name: 'Central Shelter',
      capacity: 100,
      current_occupancy: 0,
      is_active: true,
      source: 'REAL',
      location: 'POINT(77.250 28.700)',
      created_at: new Date(),
      updated_at: new Date(),
    });
  });

  it('runs all three algorithms with OSRM and returns travelTime in response and audit log', async () => {
    const assignmentService = new AssignmentService(repository, {
      osrm: { baseUrl: fakeOsrmUrl },
    });
    const app = createApp({ repository, assignmentService, authService });

    const algorithms = ['nearest-first', 'savings', 'cluster-allocation'] as const;

    for (const algorithm of algorithms) {
      const res = await request(app)
        .post('/assignments/propose')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ algorithm });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.travelTime).toBeDefined();

      const travelTime = res.body.data.travelTime;
      expect(travelTime.effectiveSource).toBe('OSRM');
      expect(travelTime.osrmConfigured).toBe(true);
      expect(travelTime.lookupsOsrm).toBeGreaterThan(0);
      expect(travelTime.lookupsStraightLinePolicy).toBe(0);
      expect(travelTime.lookupsFallback).toBe(0);
      expect(travelTime.lookupsOutsideCoverage).toBe(0);
      expect(travelTime.regions).toEqual([
        {
          id: 'default',
          requests: travelTime.osrmRequests,
          failedRequests: 0,
          lookupsOsrm: travelTime.lookupsOsrm,
        },
      ]);
      expect(travelTime.roadCoveragePercent).toBe(100);

      // Verify audit event payload includes travelTime
      const audit = dbStub.auditEvents.find((e) => e.payload?.algorithm === algorithm);
      expect(audit).toBeDefined();
      expect(audit?.payload.travelTime).toEqual(travelTime);
    }
  });

  it('gracefully falls back to straight-line when OSRM is down', async () => {
    // Non-existent server
    const assignmentService = new AssignmentService(repository, {
      osrm: { baseUrl: 'http://127.0.0.1:59998', timeoutMs: 200 },
    });
    const app = createApp({ repository, assignmentService, authService });

    const res = await request(app)
      .post('/assignments/propose')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ algorithm: 'cluster-allocation' });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);

    const travelTime = res.body.data.travelTime;
    expect(travelTime.effectiveSource).toBe('STRAIGHT_LINE');
    expect(travelTime.osrmConfigured).toBe(true);
    expect(travelTime.osrmFailedRequests).toBeGreaterThan(0);
    expect(travelTime.lookupsFallback).toBeGreaterThan(0);
    expect(travelTime.lookupsStraightLinePolicy).toBe(0);
    expect(travelTime.lookupsOutsideCoverage).toBe(0);
    expect(travelTime.regions).toHaveLength(1);
    expect(travelTime.roadCoveragePercent).toBe(0);
    expect(travelTime.warnings.length).toBeGreaterThan(0);
  });

  it('configures OSRM via process.env.OSRM_BASE_URL when options are not passed', async () => {
    const oldUrl = process.env.OSRM_BASE_URL;
    try {
      process.env.OSRM_BASE_URL = fakeOsrmUrl;
      const assignmentService = new AssignmentService(repository); // options undefined -> reads process.env
      const app = createApp({ repository, assignmentService, authService });

      const res = await request(app)
        .post('/assignments/propose')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ algorithm: 'nearest-first' });

      expect(res.status).toBe(201);
      expect(res.body.data.travelTime.osrmConfigured).toBe(true);
      expect(res.body.data.travelTime.effectiveSource).toBe('OSRM');
    } finally {
      if (oldUrl !== undefined) {
        process.env.OSRM_BASE_URL = oldUrl;
      } else {
        delete process.env.OSRM_BASE_URL;
      }
    }
  });

  it('forces straight-line when options.osrm is null, even if process.env.OSRM_BASE_URL is set', async () => {
    const oldUrl = process.env.OSRM_BASE_URL;
    try {
      process.env.OSRM_BASE_URL = fakeOsrmUrl;
      const assignmentService = new AssignmentService(repository, { osrm: null }); // null forces straight-line
      const app = createApp({ repository, assignmentService, authService });

      const res = await request(app)
        .post('/assignments/propose')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ algorithm: 'nearest-first' });

      expect(res.status).toBe(201);
      expect(res.body.data.travelTime.osrmConfigured).toBe(false);
      expect(res.body.data.travelTime.effectiveSource).toBe('STRAIGHT_LINE');
      expect(res.body.data.travelTime.roadCoveragePercent).toBeNull();
    } finally {
      if (oldUrl !== undefined) {
        process.env.OSRM_BASE_URL = oldUrl;
      } else {
        delete process.env.OSRM_BASE_URL;
      }
    }
  });

  it('routes BOAT resources via straight-line policy with zero OSRM requests and null road coverage', async () => {
    dbStub.resources.set('res_boat', {
      id: 'res_boat',
      name: 'Boat Charlie',
      type: 'BOAT',
      capacity: 6,
      status: 'AVAILABLE',
      speed_km_h: 25,
      source: 'REAL',
      location: 'POINT(77.220 28.680)',
      depot_id: null,
      shift_max_duration_min: 480,
      created_at: new Date(),
      updated_at: new Date(),
    });
    // Remove the road vehicle so this scenario has only a boat
    dbStub.resources.delete('res_01');

    const assignmentService = new AssignmentService(repository, {
      osrm: { baseUrl: fakeOsrmUrl },
    });
    const app = createApp({ repository, assignmentService, authService });

    const res = await request(app)
      .post('/assignments/propose')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ algorithm: 'nearest-first' });

    expect(res.status).toBe(201);
    const travelTime = res.body.data.travelTime;
    expect(travelTime.effectiveSource).toBe('STRAIGHT_LINE');
    expect(travelTime.osrmConfigured).toBe(true);
    expect(travelTime.osrmRequests).toBe(0); // Zero OSRM requests dispatched for boat-only scenario
    expect(travelTime.lookupsOsrm).toBe(0);
    expect(travelTime.lookupsStraightLinePolicy).toBeGreaterThan(0);
    expect(travelTime.lookupsFallback).toBe(0);
    expect(travelTime.lookupsOutsideCoverage).toBe(0);
    expect(travelTime.regions).toEqual([
      { id: 'default', requests: 0, failedRequests: 0, lookupsOsrm: 0 },
    ]);
    expect(travelTime.roadCoveragePercent).toBeNull();
  });

  it('respects OSRM_REGIONS from process.env and reports regions[] and outside-coverage warnings', async () => {
    const oldRegions = process.env.OSRM_REGIONS;
    const oldUrl = process.env.OSRM_BASE_URL;
    try {
      delete process.env.OSRM_BASE_URL;
      process.env.OSRM_REGIONS = JSON.stringify([
        {
          id: 'delhi-core',
          baseUrl: fakeOsrmUrl,
          // Includes req_01 (28.69, 77.23) & sh_01 (28.70, 77.25); excludes res_01 (28.68, 77.22)
          bbox: '28.685,77.225,28.71,77.26',
        },
      ]);

      const assignmentService = new AssignmentService(repository);
      const app = createApp({ repository, assignmentService, authService });

      const res = await request(app)
        .post('/assignments/propose')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ algorithm: 'nearest-first' });

      expect(res.status).toBe(201);
      const travelTime = res.body.data.travelTime;
      expect(travelTime.osrmConfigured).toBe(true);
      expect(travelTime.effectiveSource).toBe('MIXED');
      expect(travelTime.lookupsOsrm).toBeGreaterThan(0);
      expect(travelTime.lookupsOutsideCoverage).toBeGreaterThan(0);
      expect(travelTime.regions).toEqual([
        {
          id: 'delhi-core',
          requests: 1,
          failedRequests: 0,
          lookupsOsrm: travelTime.lookupsOsrm,
        },
      ]);
      expect(travelTime.warnings).toContain(
        '1 of 3 scenario points are outside every configured OSRM region; straight-line estimates used',
      );
    } finally {
      if (oldRegions !== undefined) {
        process.env.OSRM_REGIONS = oldRegions;
      } else {
        delete process.env.OSRM_REGIONS;
      }
      if (oldUrl !== undefined) {
        process.env.OSRM_BASE_URL = oldUrl;
      } else {
        delete process.env.OSRM_BASE_URL;
      }
    }
  });

  describe('blockedZones request validation', () => {
    let app: ReturnType<typeof createApp>;

    beforeEach(() => {
      const assignmentService = new AssignmentService(repository, { osrm: null });
      app = createApp({ repository, assignmentService, authService });
    });

    it('rejects blocked zone with polygon having fewer than 3 vertices', async () => {
      const res = await request(app)
        .post('/assignments/propose')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          blockedZones: [
            {
              id: 'bz_short',
              severity: 'BLOCKED',
              polygon: [
                { lat: 28.69, lng: 77.23 },
                { lat: 28.7, lng: 77.24 },
              ],
            },
          ],
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('rejects blocked zone with invalid coordinates (out of range)', async () => {
      const res = await request(app)
        .post('/assignments/propose')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          blockedZones: [
            {
              id: 'bz_oob',
              severity: 'CAUTION',
              polygon: [
                { lat: 95.0, lng: 77.23 }, // lat > 90
                { lat: 28.7, lng: 77.24 },
                { lat: 28.71, lng: 77.25 },
              ],
            },
          ],
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('rejects blocked zone with invalid severity', async () => {
      const res = await request(app)
        .post('/assignments/propose')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          blockedZones: [
            {
              id: 'bz_bad_sev',
              severity: 'DANGEROUS', // Not one of BLOCKED, WATER_SURGE, CAUTION
              polygon: [
                { lat: 28.69, lng: 77.23 },
                { lat: 28.7, lng: 77.24 },
                { lat: 28.71, lng: 77.25 },
              ],
            },
          ],
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('rejects polygon with more than 200 vertices', async () => {
      const polygon = Array.from({ length: 201 }, (_, i) => ({
        lat: 28.6 + i * 0.0001,
        lng: 77.2 + i * 0.0001,
      }));

      const res = await request(app)
        .post('/assignments/propose')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          blockedZones: [
            {
              id: 'bz_too_many_vertices',
              severity: 'CAUTION',
              polygon,
            },
          ],
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('rejects polygon with fewer than 3 distinct vertices (degenerate ring)', async () => {
      const res = await request(app)
        .post('/assignments/propose')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          blockedZones: [
            {
              id: 'bz_degenerate',
              severity: 'BLOCKED',
              polygon: [
                { lat: 28.69, lng: 77.23 },
                { lat: 28.69, lng: 77.23 },
                { lat: 28.7, lng: 77.24 },
              ],
            },
          ],
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('rejects polygon with non-finite coordinates', async () => {
      const res = await request(app)
        .post('/assignments/propose')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          blockedZones: [
            {
              id: 'bz_infinite',
              severity: 'BLOCKED',
              polygon: [
                { lat: 28.69, lng: 77.23 },
                { lat: Infinity as unknown as number, lng: 77.24 },
                { lat: 28.71, lng: 77.25 },
              ],
            },
          ],
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('rejects longitude out of range [-180, 180]', async () => {
      const res = await request(app)
        .post('/assignments/propose')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          blockedZones: [
            {
              id: 'bz_lng_oob',
              severity: 'WATER_SURGE',
              polygon: [
                { lat: 28.69, lng: 77.23 },
                { lat: 28.7, lng: 185.0 }, // lng > 180
                { lat: 28.71, lng: 77.25 },
              ],
            },
          ],
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('rejects request with more than 100 blocked zones', async () => {
      const blockedZones = Array.from({ length: 101 }, (_, i) => ({
        id: `zone_${i}`,
        severity: 'CAUTION' as const,
        polygon: [
          { lat: 28.6, lng: 77.2 },
          { lat: 28.61, lng: 77.2 },
          { lat: 28.61, lng: 77.21 },
        ],
      }));

      const res = await request(app)
        .post('/assignments/propose')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ blockedZones });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('rejects request exceeding cumulative limit of 2000 total vertices across zones', async () => {
      // 11 zones with 190 vertices each = 2090 vertices (> 2000)
      const blockedZones = Array.from({ length: 11 }, (_, z) => ({
        id: `zone_large_${z}`,
        severity: 'CAUTION' as const,
        polygon: Array.from({ length: 190 }, (_, v) => ({
          lat: 28.6 + z * 0.01 + v * 0.00001,
          lng: 77.2 + z * 0.01 + v * 0.00001,
        })),
      }));

      const res = await request(app)
        .post('/assignments/propose')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ blockedZones });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('accepts valid blockedZones and reflects them in the travelTime report', async () => {
      const res = await request(app)
        .post('/assignments/propose')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          blockedZones: [
            {
              id: 'bz_valid',
              name: 'Submerged Bridge',
              severity: 'WATER_SURGE',
              polygon: [
                { lat: 28.685, lng: 77.225 },
                { lat: 28.695, lng: 77.225 },
                { lat: 28.695, lng: 77.235 },
              ],
            },
          ],
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.travelTime.hazardZoneCount).toBe(1);
    });
    it('stores validated hazardZones and SHA-256 hash in ASSIGNMENT_PROPOSED audit payload matching request input', async () => {
      const sampleBlockedZones = [
        {
          id: 'zone-audit-1',
          name: 'Audit Test Zone',
          severity: 'BLOCKED' as const,
          polygon: [
            { lat: 28.685, lng: 77.225 },
            { lat: 28.695, lng: 77.225 },
            { lat: 28.695, lng: 77.235 },
          ],
        },
      ];

      const res = await request(app)
        .post('/assignments/propose')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          blockedZones: sampleBlockedZones,
        });

      expect(res.status).toBe(201);
      const assignmentId = res.body.data.id;
      expect(assignmentId).toBeDefined();

      const proposedEvent = dbStub.auditEvents.find(
        (e) => e.eventType === 'ASSIGNMENT_PROPOSED' && e.entityId === assignmentId,
      );
      expect(proposedEvent).toBeDefined();

      const payload = proposedEvent!.payload as {
        hazardZones: unknown;
        hazardZonesHash: string;
      };
      // Stored hazardZones must equal request input
      expect(payload.hazardZones).toEqual(sampleBlockedZones);
      expect(payload.hazardZonesHash).toMatch(/^[a-f0-9]{64}$/);
    });
  });

  describe('OSRM route geometry proposal & GET restoration', () => {
    it('attaches OSRM road-following geometry on POST /assignments/propose and restores it on GET /assignments/:id', async () => {
      let routeCalls = 0;
      const dualServer = http.createServer((req, res) => {
        const url = new URL(req.url ?? '/', 'http://127.0.0.1');
        if (url.pathname.startsWith('/route/v1/')) {
          routeCalls++;
          const coordsSeg = url.pathname.split('/')[4] ?? '';
          const [fromRaw = '77.22,28.68', toRaw = '77.23,28.69'] = coordsSeg.split(';');
          const [fLng = 77.22, fLat = 28.68] = fromRaw.split(',').map(Number);
          const [tLng = 77.23, tLat = 28.69] = toRaw.split(',').map(Number);

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              code: 'Ok',
              routes: [
                {
                  distance: 2100,
                  duration: 180,
                  geometry: {
                    type: 'LineString',
                    coordinates: [
                      [fLng, fLat],
                      [
                        Number(((fLng + tLng) / 2 + 0.002).toFixed(6)),
                        Number(((fLat + tLat) / 2 + 0.001).toFixed(6)),
                      ],
                      [tLng, tLat],
                    ],
                  },
                },
              ],
            }),
          );
          return;
        }

        const sourcesParam = url.searchParams.get('sources');
        const destinationsParam = url.searchParams.get('destinations');
        const rawCoords = (url.pathname.split('/')[4] ?? '').split(';');
        const sourceCount = sourcesParam ? sourcesParam.split(';').length : rawCoords.length;
        const destCount = destinationsParam
          ? destinationsParam.split(';').length
          : rawCoords.length;

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            code: 'Ok',
            durations: Array.from({ length: sourceCount }, () =>
              Array.from({ length: destCount }, () => 150),
            ),
            distances: Array.from({ length: sourceCount }, () =>
              Array.from({ length: destCount }, () => 2100),
            ),
          }),
        );
      });

      const dualUrl = await new Promise<string>((resolve) => {
        dualServer.listen(0, '127.0.0.1', () => {
          const addr = dualServer.address() as AddressInfo;
          resolve(`http://127.0.0.1:${addr.port}`);
        });
      });

      // Wrap dbStub queryable to also support GET /assignments/:id & audit_events readback
      const persistedStops: DbAssignmentStop[] = [];
      const readbackQueryable: Queryable = {
        async query<R extends Record<string, unknown> = Record<string, unknown>>(
          sqlOrConfig: string | { text: string; values?: unknown[] },
          values?: unknown[],
        ) {
          const sql = typeof sqlOrConfig === 'string' ? sqlOrConfig : sqlOrConfig.text;
          const vals = values ?? (sqlOrConfig as { values?: unknown[] }).values ?? [];

          if (sql.includes('INSERT INTO assignments')) {
            const row: DbAssignment = {
              id: vals[0] as string,
              scenario_id: (vals[1] as string | null) ?? null,
              status: vals[2] as DbAssignment['status'],
              metrics: vals[3] ? JSON.parse(vals[3] as string) : null,
              unserved: vals[4] ? JSON.parse(vals[4] as string) : null,
              committed_at: (vals[5] as Date | null) ?? null,
              committed_by: (vals[6] as string | null) ?? null,
              created_at: new Date(),
              updated_at: new Date(),
            };
            dbStub.assignments.set(row.id, row);
            return {
              rows: [row as unknown as R],
              command: 'INSERT',
              rowCount: 1,
              oid: 0,
              fields: [],
            };
          }

          if (sql.includes('INSERT INTO assignment_stops')) {
            persistedStops.push({
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
            });
            return { rows: [], command: 'INSERT', rowCount: 1, oid: 0, fields: [] };
          }

          if (sql.includes('FROM assignments') && sql.includes('WHERE id = $1')) {
            const assign = dbStub.assignments.get(vals[0] as string);
            return {
              rows: assign ? [assign as unknown as R] : [],
              command: 'SELECT',
              rowCount: assign ? 1 : 0,
              oid: 0,
              fields: [],
            };
          }

          if (sql.includes('FROM assignment_stops') && sql.includes('WHERE assignment_id = $1')) {
            const matching = persistedStops.filter((s) => s.assignment_id === vals[0]);
            return {
              rows: matching as unknown as R[],
              command: 'SELECT',
              rowCount: matching.length,
              oid: 0,
              fields: [],
            };
          }

          if (sql.includes('FROM audit_events')) {
            const entityId = vals[1] as string;
            const rows = dbStub.auditEvents
              .filter((e) => e.entityId === entityId)
              .map((e, idx) => ({
                id: String(idx + 1),
                entity_type: e.entityType,
                entity_id: e.entityId,
                event_type: e.eventType,
                actor: 'SYSTEM',
                payload: e.payload,
                created_at: new Date(),
              }))
              .reverse();
            return {
              rows: rows as unknown as R[],
              command: 'SELECT',
              rowCount: rows.length,
              oid: 0,
              fields: [],
            };
          }

          return dbStub.query<R>(sqlOrConfig, values);
        },
      };

      try {
        const repoWithReadback = new PostgisRepository(readbackQueryable);
        const assignmentService = new AssignmentService(repoWithReadback, {
          osrm: { baseUrl: dualUrl },
        });
        const app = createApp({ repository: repoWithReadback, assignmentService, authService });

        const proposeRes = await request(app)
          .post('/assignments/propose')
          .set('Authorization', `Bearer ${authToken}`)
          .send({ algorithm: 'nearest-first' });

        expect(proposeRes.status).toBe(201);
        const proposedRoute = proposeRes.body.data.routes[0];
        expect(proposedRoute.geometry).toBeDefined();
        expect(proposedRoute.geometry.source).toBe('OSRM');
        expect(proposedRoute.geometry.coordinates.length).toBeGreaterThan(2);
        expect(routeCalls).toBeGreaterThan(0);

        const callsAfterPropose = routeCalls;
        const getRes = await request(app)
          .get(`/assignments/${proposeRes.body.data.id}`)
          .set('Authorization', `Bearer ${authToken}`);

        expect(getRes.status).toBe(200);
        // Restored from audit payload cache without extra OSRM calls
        expect(routeCalls).toBe(callsAfterPropose);
        const retrievedRoute = getRes.body.data.routes[0];
        expect(retrievedRoute.geometry).toEqual(proposedRoute.geometry);
        expect(retrievedRoute.totalTravelDistanceKm).toBe(proposedRoute.totalTravelDistanceKm);
      } finally {
        await new Promise<void>((r) => dualServer.close(() => r()));
      }
    });
  });
});
