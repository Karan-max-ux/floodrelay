import { createHash } from 'node:crypto';
import request from 'supertest';
import { describe, it, expect, beforeEach } from 'vitest';
import { createApp } from '../app.js';
import { PostgisRepository, type Queryable } from '../db/repository.js';
import { RequestService } from '../services/requestService.js';
import { ServiceAreaService } from '../services/serviceAreaService.js';
import { AssignmentService } from '../services/assignmentService.js';
import { AuthService, InMemoryAuthRepository } from '../services/authService.js';
import {
  DELHI_NCR_BOUNDARY_VERSION,
  DELHI_NCR_EXPECTED_DATASET_SHA256,
  DELHI_NCR_REGION_ID,
  DELHI_NCR_REGION_NAME,
  evaluateDelhiNcrCoverage,
  loadDelhiNcrBoundaryDataset,
  validateAndIndexNcrDataset,
  resetCachedBoundaryDatasetForTest,
} from '../geo/delhiNcrBoundary.js';

class ServiceAreaMockDb implements Queryable {
  public insertedRequests: unknown[] = [];
  public insertedEvents: unknown[] = [];
  public insertedAudits: unknown[] = [];
  public byIdempotencyKey = new Map<string, Record<string, unknown>>();
  public mode:
    | 'ACTIVE'
    | 'MISSING_BOUNDARY'
    | 'INVALID_GEOMETRY'
    | 'DB_ERROR'
    | 'WRONG_REGION_ID'
    | 'WRONG_VERSION'
    | 'WRONG_CHECKSUM'
    | 'INVALID_SRID'
    | 'MULTIPLE_BOUNDARIES'
    | 'TOPOLOGICAL_MISMATCH'
    | 'TAMPERED_GEOMETRY_HASH' = 'ACTIVE';

  async query<R extends Record<string, unknown> = Record<string, unknown>>(
    sqlOrConfig: string | { text: string; values?: unknown[] },
    values?: unknown[],
  ): Promise<{ rows: R[]; command: string; rowCount: number; oid: number; fields: [] }> {
    const sql = typeof sqlOrConfig === 'string' ? sqlOrConfig : sqlOrConfig.text;
    const vals = values ?? (sqlOrConfig as { values?: unknown[] }).values ?? [];

    if (sql.includes('FROM service_areas')) {
      if (this.mode === 'DB_ERROR') {
        throw new Error('ECONNREFUSED: PostgreSQL PostGIS unavailable');
      }
      if (this.mode === 'MISSING_BOUNDARY') {
        return { rows: [], command: 'SELECT', rowCount: 0, oid: 0, fields: [] };
      }

      if (sql.includes('WITH canonical AS') || sql.includes('ST_Equals')) {
        if (this.mode === 'MULTIPLE_BOUNDARIES') {
          return {
            rows: [
              {
                region_id: DELHI_NCR_REGION_ID,
                region_name: DELHI_NCR_REGION_NAME,
                boundary_version: DELHI_NCR_BOUNDARY_VERSION,
                dataset_sha256: DELHI_NCR_EXPECTED_DATASET_SHA256,
                is_valid: true,
                srid: 4326,
                point_count: 9510,
                area_sq_km: 55223.3,
                geometry_wkb_hash: 'c8f7d9a1e2b3c4d5e6f708192a3b4c5d',
                is_topologically_equal: true,
                is_mutually_covered: true,
              } as unknown as R,
              {
                region_id: 'IN-NCR-2',
                region_name: 'Delhi NCR Duplicate',
                boundary_version: DELHI_NCR_BOUNDARY_VERSION,
                dataset_sha256: DELHI_NCR_EXPECTED_DATASET_SHA256,
                is_valid: true,
                srid: 4326,
                point_count: 9510,
                area_sq_km: 55223.3,
                geometry_wkb_hash: 'c8f7d9a1e2b3c4d5e6f708192a3b4c5d',
                is_topologically_equal: true,
                is_mutually_covered: true,
              } as unknown as R,
            ],
            command: 'SELECT',
            rowCount: 2,
            oid: 0,
            fields: [],
          };
        }

        return {
          rows: [
            {
              region_id: this.mode === 'WRONG_REGION_ID' ? 'IN-MUMBAI' : DELHI_NCR_REGION_ID,
              region_name: DELHI_NCR_REGION_NAME,
              boundary_version:
                this.mode === 'WRONG_VERSION' ? 'legacy-v0' : DELHI_NCR_BOUNDARY_VERSION,
              dataset_sha256:
                this.mode === 'WRONG_CHECKSUM'
                  ? '0000000000000000000000000000000000000000000000000000000000000000'
                  : DELHI_NCR_EXPECTED_DATASET_SHA256,
              is_valid: this.mode !== 'INVALID_GEOMETRY',
              srid: this.mode === 'INVALID_SRID' ? 3857 : 4326,
              point_count: 9510,
              area_sq_km: 55223.3,
              geometry_wkb_hash:
                this.mode === 'TAMPERED_GEOMETRY_HASH'
                  ? 'altered_wkb_hash_99999999'
                  : 'c8f7d9a1e2b3c4d5e6f708192a3b4c5d',
              is_topologically_equal: this.mode !== 'TOPOLOGICAL_MISMATCH',
              is_mutually_covered: this.mode !== 'TOPOLOGICAL_MISMATCH',
            } as unknown as R,
          ],
          command: 'SELECT',
          rowCount: 1,
          oid: 0,
          fields: [],
        };
      }

      if (this.mode === 'MULTIPLE_BOUNDARIES') {
        return {
          rows: [
            {
              region_id: DELHI_NCR_REGION_ID,
              region_name: DELHI_NCR_REGION_NAME,
              boundary_version: DELHI_NCR_BOUNDARY_VERSION,
              dataset_sha256: DELHI_NCR_EXPECTED_DATASET_SHA256,
              is_valid: true,
              srid: 4326,
              geometry_wkb_hash: 'c8f7d9a1e2b3c4d5e6f708192a3b4c5d',
              is_covered: true,
              distance_meters: 0,
            } as unknown as R,
            {
              region_id: 'IN-NCR-2',
              region_name: 'Delhi NCR Duplicate',
              boundary_version: DELHI_NCR_BOUNDARY_VERSION,
              dataset_sha256: DELHI_NCR_EXPECTED_DATASET_SHA256,
              is_valid: true,
              srid: 4326,
              geometry_wkb_hash: 'c8f7d9a1e2b3c4d5e6f708192a3b4c5d',
              is_covered: true,
              distance_meters: 0,
            } as unknown as R,
          ],
          command: 'SELECT',
          rowCount: 2,
          oid: 0,
          fields: [],
        };
      }

      const lng = vals[0] as number;
      const lat = vals[1] as number;

      if (this.mode === 'INVALID_GEOMETRY') {
        return {
          rows: [
            {
              region_id: DELHI_NCR_REGION_ID,
              region_name: DELHI_NCR_REGION_NAME,
              boundary_version: DELHI_NCR_BOUNDARY_VERSION,
              dataset_sha256: DELHI_NCR_EXPECTED_DATASET_SHA256,
              is_valid: false,
              srid: 4326,
              geometry_wkb_hash: 'c8f7d9a1e2b3c4d5e6f708192a3b4c5d',
              is_covered: false,
            } as unknown as R,
          ],
          command: 'SELECT',
          rowCount: 1,
          oid: 0,
          fields: [],
        };
      }

      const evalRes = evaluateDelhiNcrCoverage(lat, lng);
      return {
        rows: [
          {
            region_id: this.mode === 'WRONG_REGION_ID' ? 'IN-MUMBAI' : DELHI_NCR_REGION_ID,
            region_name: DELHI_NCR_REGION_NAME,
            boundary_version:
              this.mode === 'WRONG_VERSION' ? 'legacy-v0' : DELHI_NCR_BOUNDARY_VERSION,
            dataset_sha256:
              this.mode === 'WRONG_CHECKSUM'
                ? '0000000000000000000000000000000000000000000000000000000000000000'
                : DELHI_NCR_EXPECTED_DATASET_SHA256,
            is_valid: true,
            srid: this.mode === 'INVALID_SRID' ? 3857 : 4326,
            geometry_wkb_hash:
              this.mode === 'TAMPERED_GEOMETRY_HASH'
                ? 'altered_wkb_hash_99999999'
                : 'c8f7d9a1e2b3c4d5e6f708192a3b4c5d',
            is_covered: evalRes.covered,
            distance_meters: evalRes.distanceToBoundaryMeters,
          } as unknown as R,
        ],
        command: 'SELECT',
        rowCount: 1,
        oid: 0,
        fields: [],
      };
    }

    if (sql.trim() === 'BEGIN' || sql.trim() === 'COMMIT' || sql.trim() === 'ROLLBACK') {
      return { rows: [], command: sql.trim(), rowCount: 0, oid: 0, fields: [] };
    }

    if (sql.includes('FROM requests') && sql.includes('WHERE idempotency_key = $1')) {
      const key = vals[0] as string;
      const row = this.byIdempotencyKey.get(key);
      return {
        rows: row ? [row as R] : [],
        command: 'SELECT',
        rowCount: row ? 1 : 0,
        oid: 0,
        fields: [],
      };
    }

    if (sql.includes('ST_DWithin')) {
      return { rows: [], command: 'SELECT', rowCount: 0, oid: 0, fields: [] };
    }

    if (sql.includes('INSERT INTO requests')) {
      const record = {
        id: vals[0],
        lng: vals[1],
        lat: vals[2],
        peopleCount: vals[3],
        urgency: vals[4],
        source: vals[5],
        status: vals[6],
        verificationStatus: vals[7],
        medicalNeeds: vals[8],
        notes: vals[9],
        idempotencyKey: vals[10],
        idempotencyRequestHash: vals[11],
        createdAt: new Date(),
      };
      this.insertedRequests.push(record);
      if (typeof vals[10] === 'string' && vals[10]) {
        this.byIdempotencyKey.set(vals[10], record);
      }
      return { rows: [record as unknown as R], command: 'INSERT', rowCount: 1, oid: 0, fields: [] };
    }

    if (sql.includes('INSERT INTO operational_events')) {
      const evtRow = {
        id: vals[0],
        event_type: vals[1],
        entity_type: vals[2],
        entity_id: vals[3],
        actor_id: vals[4],
        actor_type: vals[5],
        payload: typeof vals[6] === 'string' ? JSON.parse(vals[6]) : (vals[6] ?? {}),
        correlation_id: vals[7] ?? null,
        idempotency_key: vals[8] ?? null,
        entity_version: vals[9] ?? 1,
        processing_status: vals[10] ?? 'RECORDED',
        processing_attempts: 0,
        last_error_code: null,
        occurred_at: vals[11] ?? new Date(),
        created_at: new Date(),
        processed_at: null,
      };
      this.insertedEvents.push(evtRow);
      return { rows: [evtRow as unknown as R], command: 'INSERT', rowCount: 1, oid: 0, fields: [] };
    }

    if (sql.includes('INSERT INTO audit_events')) {
      this.insertedAudits.push(vals);
      return { rows: [], command: 'INSERT', rowCount: 1, oid: 0, fields: [] };
    }

    return { rows: [], command: 'SELECT', rowCount: 0, oid: 0, fields: [] };
  }
}

describe('Phase 9 — Delhi NCR Service-Area Enforcement & Fail-Closed Guardrails', () => {
  let db: ServiceAreaMockDb;
  let app: ReturnType<typeof createApp>;
  let serviceAreaService: ServiceAreaService;

  beforeEach(async () => {
    resetCachedBoundaryDatasetForTest();
    ServiceAreaService.resetAttestationForTest();
    db = new ServiceAreaMockDb();
    const repo = new PostgisRepository(db);
    serviceAreaService = new ServiceAreaService(repo);
    const requestService = new RequestService(repo);
    const assignmentService = new AssignmentService(repo, { osrm: null });
    const authService = new AuthService(new InMemoryAuthRepository());
    app = createApp({ repository: repo, requestService, assignmentService, authService });
  });

  it('verifies Delhi NCR boundary GeoJSON checksum, 34 constituent polygons, and all 4 sub-regions', () => {
    const { dataset, sha256 } = loadDelhiNcrBoundaryDataset();
    expect(sha256).toBe(DELHI_NCR_EXPECTED_DATASET_SHA256);
    expect(dataset.features).toHaveLength(34);
    expect(dataset.metadata.regionId).toBe('IN-NCR');
    expect(dataset.metadata.crs).toBe('EPSG:4326');

    const subRegions = new Set(dataset.features.map((f) => f.properties.subRegion));
    expect(subRegions).toEqual(new Set(['NCT of Delhi', 'Haryana', 'Uttar Pradesh', 'Rajasthan']));
  });

  it('rejects outside-NCR POST /requests with HTTP 422 OUTSIDE_SERVICE_AREA and zero DB/event/audit writes', async () => {
    const res = await request(app).post('/requests').send({
      lat: 19.076,
      lng: 72.8777, // Mumbai (outside NCR)
      peopleCount: 3,
      urgency: 'HIGH',
    });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('OUTSIDE_SERVICE_AREA');
    expect(res.body.error.message).toBe(
      'FloodRelay currently accepts rescue requests only within its supported Delhi NCR service area.',
    );
    expect(db.insertedRequests).toHaveLength(0);
    expect(db.insertedEvents).toHaveLength(0);
    expect(db.insertedAudits).toHaveLength(0);
  });

  it('rejects nearby non-NCR cities (Mathura, Aligarh, Jaipur, Kurukshetra, Saharanpur, Hisar) with HTTP 422', async () => {
    const nearbyOutside: Array<[string, number, number]> = [
      ['Mathura (UP)', 27.4924, 77.6737],
      ['Aligarh (UP)', 27.8974, 78.088],
      ['Jaipur (RJ)', 26.9124, 75.7873],
      ['Kurukshetra (HR)', 29.9695, 76.8783],
      ['Saharanpur (UP)', 29.968, 77.5552],
      ['Hisar (HR)', 29.1492, 75.7217],
    ];

    for (const [city, lat, lng] of nearbyOutside) {
      const res = await request(app).post('/requests').send({
        lat,
        lng,
        peopleCount: 2,
        urgency: 'CRITICAL',
      });
      expect(res.status, `${city} must be rejected`).toBe(422);
      expect(res.body.error.code).toBe('OUTSIDE_SERVICE_AREA');
    }
    expect(db.insertedRequests).toHaveLength(0);
  });

  it('accepts verified locations across NCT Delhi, Haryana, Uttar Pradesh, and Rajasthan NCR sub-regions', async () => {
    const verifiedInside: Array<[string, number, number]> = [
      ['Central Delhi (Connaught Place)', 28.6315, 77.2167],
      ['Gurugram Cyber City (Haryana NCR)', 28.4949, 77.0895],
      ['Karnal (Haryana NCR)', 29.6857, 76.9905],
      ['Charkhi Dadri (Haryana NCR)', 28.5921, 76.2653],
      ['Noida Sector 18 (UP NCR)', 28.5708, 77.3261],
      ['Meerut (UP NCR)', 28.9845, 77.7064],
      ['Shamli (UP NCR)', 29.4502, 77.3127],
      ['Alwar (Rajasthan NCR)', 27.553, 76.6346],
      ['Bharatpur (Rajasthan NCR)', 27.2152, 77.503],
    ];

    for (const [label, lat, lng] of verifiedInside) {
      const res = await request(app).post('/requests').send({
        lat,
        lng,
        peopleCount: 3,
        urgency: 'HIGH',
      });
      expect(res.status, `${label} must be accepted`).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toMatch(/^req-/);
    }
    expect(db.insertedRequests).toHaveLength(verifiedInside.length);
  });

  it('handles exact boundary vertex inclusively (ST_Covers policy) and rejects 110m outside boundary', async () => {
    // Verified northernmost Karnal outer boundary vertex from delhi-ncr-boundary.geojson
    const onBoundary = await request(app).post('/requests/service-area-check').send({
      lat: 29.99324,
      lng: 77.11808,
    });
    expect(onBoundary.status).toBe(200);
    expect(onBoundary.body.data.eligible).toBe(true);
    expect(onBoundary.body.data.inclusiveBoundaryPolicy).toBe('ST_COVERS');

    const justOutside = await request(app).post('/requests/service-area-check').send({
      lat: 29.99424,
      lng: 77.11808,
    });
    expect(justOutside.status).toBe(200);
    expect(justOutside.body.data.eligible).toBe(false);
  });

  it('fails closed with HTTP 503 SERVICE_AREA_UNAVAILABLE when boundary is missing, invalid, or DB fails', async () => {
    for (const mode of ['MISSING_BOUNDARY', 'INVALID_GEOMETRY', 'DB_ERROR'] as const) {
      db.mode = mode;
      const res = await request(app).post('/requests').send({
        lat: 28.6315,
        lng: 77.2167,
        peopleCount: 2,
        urgency: 'HIGH',
      });
      expect(res.status, `mode=${mode} must return 503`).toBe(503);
      expect(res.body.error.code).toBe('SERVICE_AREA_UNAVAILABLE');
      expect(res.body.error.message).not.toMatch(/ECONNREFUSED|SQL|PostGIS|service_areas/i);
    }
    expect(db.insertedRequests).toHaveLength(0);
    expect(db.insertedEvents).toHaveLength(0);
    expect(db.insertedAudits).toHaveLength(0);
  });

  it('rejects out-of-range latitudes/longitudes and non-finite coordinates with HTTP 400 VALIDATION_ERROR', async () => {
    const invalidCoords: Array<{ lat: unknown; lng: unknown }> = [
      { lat: 91, lng: 77.2 },
      { lat: -90.1, lng: 77.2 },
      { lat: 28.6, lng: 180.5 },
      { lat: 28.6, lng: -181 },
      { lat: 'NaN', lng: 77.2 },
      { lat: null, lng: 77.2 },
    ];

    for (const coords of invalidCoords) {
      const postRes = await request(app)
        .post('/requests')
        .send({ ...coords, peopleCount: 2, urgency: 'HIGH' });
      expect(postRes.status).toBe(400);
      expect(postRes.body.error.code).toBe('VALIDATION_ERROR');

      const checkRes = await request(app).post('/requests/service-area-check').send(coords);
      expect(checkRes.status).toBe(400);
      expect(checkRes.body.error.code).toBe('VALIDATION_ERROR');
    }

    // Direct service-level non-finite guard (JSON cannot transport Infinity/NaN directly)
    const repo = new PostgisRepository(db);
    const requestService = new RequestService(repo);
    await expect(requestService.checkServiceArea(Number.NaN, 77.2)).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      statusCode: 400,
    });
    await expect(
      requestService.checkServiceArea(28.6, Number.POSITIVE_INFINITY),
    ).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      statusCode: 400,
    });
    expect(db.insertedRequests).toHaveLength(0);
  });

  it('preserves eligible idempotent retry (200), changed-payload conflict (409), and blocks historical out-of-NCR idempotent replay (422)', async () => {
    // 1. Eligible in-NCR creation -> 201
    const first = await request(app).post('/requests').send({
      lat: 28.6315,
      lng: 77.2167,
      peopleCount: 4,
      urgency: 'HIGH',
      idempotencyKey: 'key-ncr-1',
    });
    expect(first.status).toBe(201);
    const createdId = first.body.data.id;

    // 2. Identical eligible retry -> 200 idempotent: true
    const replay = await request(app).post('/requests').send({
      lat: 28.6315,
      lng: 77.2167,
      peopleCount: 4,
      urgency: 'HIGH',
      idempotencyKey: 'key-ncr-1',
    });
    expect(replay.status).toBe(200);
    expect(replay.body.idempotent).toBe(true);
    expect(replay.body.data.id).toBe(createdId);
    expect(db.insertedRequests).toHaveLength(1);

    // 3. Reused idempotency key with changed payload (both inside and outside NCR) -> 409
    const changedInNcr = await request(app).post('/requests').send({
      lat: 28.6315,
      lng: 77.2167,
      peopleCount: 9,
      urgency: 'CRITICAL',
      idempotencyKey: 'key-ncr-1',
    });
    expect(changedInNcr.status).toBe(409);
    expect(changedInNcr.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');

    const changedOutsideNcr = await request(app).post('/requests').send({
      lat: 19.076,
      lng: 72.8777,
      peopleCount: 4,
      urgency: 'HIGH',
      idempotencyKey: 'key-ncr-1',
    });
    expect(changedOutsideNcr.status).toBe(409);
    expect(changedOutsideNcr.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');

    // 4. Historical pre-policy out-of-NCR idempotent record cannot be silently replayed as 200
    const histPayload = {
      lat: 19.076,
      lng: 72.8777,
      peopleCount: 2,
      urgency: 'MEDIUM' as const,
      medicalNeeds: false,
      notes: undefined,
      source: 'REPORTED' as const,
      verificationStatus: 'UNVERIFIED' as const,
    };
    const { computeCanonicalRequestHash } = await import('./requestService.js');
    const histHash = computeCanonicalRequestHash(histPayload);
    db.byIdempotencyKey.set('key-historical-mumbai', {
      id: 'req-historical-mumbai',
      lat: 19.076,
      lng: 72.8777,
      peopleCount: 2,
      urgency: 'MEDIUM',
      source: 'REPORTED',
      status: 'PENDING',
      verificationStatus: 'UNVERIFIED',
      medicalNeeds: false,
      notes: null,
      idempotencyKey: 'key-historical-mumbai',
      idempotencyRequestHash: histHash,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    });

    const histReplay = await request(app)
      .post('/requests')
      .send({ ...histPayload, idempotencyKey: 'key-historical-mumbai' });
    expect(histReplay.status).toBe(422);
    expect(histReplay.body.error.code).toBe('OUTSIDE_SERVICE_AREA');
  });

  it('excludes historical out-of-NCR operational requests, resources, and shelters from proposals without deleting them and preserves SIMULATED scenarios', async () => {
    const repo = new PostgisRepository(db);
    const insertedAssignments: Array<{ id: string; unserved: unknown[] }> = [];
    const insertedAuditPayloads: unknown[] = [];

    // Spy on repository list/write methods to simulate historical DB records cleanly
    const historicalOutReq = {
      id: 'req-hist-mumbai',
      lat: 19.076,
      lng: 72.8777,
      peopleCount: 3,
      urgency: 'HIGH' as const,
      source: 'REPORTED' as const,
      status: 'PENDING' as const,
      verificationStatus: 'UNVERIFIED' as const,
      medicalNeeds: false,
      createdAt: '2026-01-01T00:00:00.000Z',
    };
    const inNcrReq = {
      id: 'req-ncr-delhi',
      lat: 28.65,
      lng: 77.23,
      peopleCount: 3,
      urgency: 'HIGH' as const,
      source: 'REPORTED' as const,
      status: 'PENDING' as const,
      verificationStatus: 'UNVERIFIED' as const,
      medicalNeeds: false,
      createdAt: '2026-11-18T10:00:00.000Z',
    };
    const outResource = {
      id: 'res-hist-mumbai',
      name: 'Historical Mumbai Boat',
      type: 'BOAT' as const,
      capacity: 6,
      speedKmH: 25,
      lat: 19.08,
      lng: 72.88,
      status: 'AVAILABLE' as const,
      source: 'REAL' as const,
    };
    const inNcrResource = {
      id: 'res-ncr-delhi',
      name: 'Yamuna NDRF Boat 1',
      type: 'BOAT' as const,
      capacity: 6,
      speedKmH: 25,
      lat: 28.66,
      lng: 77.24,
      status: 'AVAILABLE' as const,
      source: 'REAL' as const,
    };
    const outShelter = {
      id: 'sh-hist-mumbai',
      name: 'Historical Mumbai Camp',
      lat: 19.09,
      lng: 72.89,
      capacity: 100,
      currentOccupancy: 0,
      source: 'REAL' as const,
    };
    const inNcrShelter = {
      id: 'sh-ncr-delhi',
      name: 'Kashmere Gate Relief Camp',
      lat: 28.667,
      lng: 77.228,
      capacity: 100,
      currentOccupancy: 0,
      source: 'REAL' as const,
    };

    const requestsStore = [historicalOutReq, inNcrReq];
    const resourcesStore = [outResource, inNcrResource];
    const sheltersStore = [outShelter, inNcrShelter];

    repo.listRequests = async () => requestsStore;
    repo.listResources = async () => resourcesStore;
    repo.listShelters = async () => sheltersStore;
    repo.listBlockedZones = async () => [];
    repo.insertAssignmentWithStops = async (assign) => {
      insertedAssignments.push({ id: assign.id, unserved: (assign.unserved as unknown[]) ?? [] });
    };
    repo.insertAuditEvent = async (evt) => {
      insertedAuditPayloads.push(evt.payload);
    };

    const assignmentService = new AssignmentService(repo, { osrm: null });
    const proposal = await assignmentService.proposeAssignment({
      scenarioId: 'delhi-ops-test',
      algorithm: 'nearest-first',
      preserveFrozen: false,
      includeUnverified: false,
      maxShiftMinutes: 480,
    });

    // Only the in-NCR request/resource/shelter should appear in proposed routes
    const servedIds = proposal.routes.flatMap((r) => r.servedRequestIds);
    expect(servedIds).toContain('req-ncr-delhi');
    expect(servedIds).not.toContain('req-hist-mumbai');
    expect(proposal.routes.every((r) => r.resourceId !== 'res-hist-mumbai')).toBe(true);
    expect(
      proposal.routes
        .flatMap((r) => r.stops)
        .every((s) => s.targetId !== 'sh-hist-mumbai' && s.targetId !== 'req-hist-mumbai'),
    ).toBe(true);

    // Excluded historical request is explained accurately in unserved list & warnings, and DB rows untouched
    expect(proposal.unserved).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          requestId: 'req-hist-mumbai',
          reason: 'ISOLATED_ZONE',
          details: expect.stringMatching(/outside the active Delhi NCR service area/i),
        }),
      ]),
    );
    expect(proposal.travelTime?.warnings.join(' ')).toMatch(
      /Service-area policy excluded out-of-NCR operational records/i,
    );
    expect(requestsStore).toHaveLength(2);
    expect(resourcesStore).toHaveLength(2);
    expect(sheltersStore).toHaveLength(2);
    expect(insertedAssignments).toHaveLength(1);
    expect(insertedAuditPayloads[0]).toMatchObject({
      excludedOutOfServiceArea: {
        requestIds: ['req-hist-mumbai'],
        resourceIds: ['res-hist-mumbai'],
        shelterIds: ['sh-hist-mumbai'],
      },
    });

    // Controlled SIMULATED scenario remains allowed when explicitly opted in via allowSimulated: true
    const simReq = { ...historicalOutReq, id: 'req-sim-1', source: 'SIMULATED' as const };
    const simRes = { ...outResource, id: 'res-sim-1', source: 'SIMULATED' as const };
    const simSh = { ...outShelter, id: 'sh-sim-1', source: 'SIMULATED' as const };
    repo.listRequests = async () => [simReq];
    repo.listResources = async () => [simRes];
    repo.listShelters = async () => [simSh];

    const simProposal = await assignmentService.proposeAssignment({
      scenarioId: 'sim-ops-test',
      algorithm: 'nearest-first',
      preserveFrozen: false,
      includeUnverified: false,
      maxShiftMinutes: 480,
    });
    expect(simProposal.routes.flatMap((r) => r.servedRequestIds)).toContain('req-sim-1');
  });

  it('rejects commitAssignment() defense-in-depth when an operational assignment references out-of-NCR coordinates or boundary is unavailable', async () => {
    const commitMockClient: Queryable = {
      async query<R extends Record<string, unknown> = Record<string, unknown>>(
        sqlOrConfig: string | { text: string; values?: unknown[] },
        values?: unknown[],
      ) {
        const sql = typeof sqlOrConfig === 'string' ? sqlOrConfig : sqlOrConfig.text;
        const vals = values ?? (sqlOrConfig as { values?: unknown[] }).values ?? [];
        if (sql.trim() === 'BEGIN' || sql.trim() === 'COMMIT' || sql.trim() === 'ROLLBACK') {
          return { rows: [], command: sql.trim(), rowCount: 0, oid: 0, fields: [] };
        }
        if (sql.includes('FROM assignments') && sql.includes('FOR UPDATE')) {
          return {
            rows: [{ id: 'assign-out-1', status: 'PROPOSED', scenario_id: 'live' } as unknown as R],
            command: 'SELECT',
            rowCount: 1,
            oid: 0,
            fields: [],
          };
        }
        if (sql.includes('FROM assignment_stops') && sql.includes('WHERE assignment_id')) {
          return {
            rows: [
              {
                id: 'stop-1',
                resource_id: 'res-delhi-1',
                type: 'PICKUP',
                target_id: 'req-mumbai-1',
                stop_number: 1,
                is_frozen: false,
                passengers_dropped_off: 0,
              } as unknown as R,
            ],
            command: 'SELECT',
            rowCount: 1,
            oid: 0,
            fields: [],
          };
        }
        if (sql.includes('FROM requests') && sql.includes('FOR UPDATE')) {
          return {
            rows: [
              {
                id: 'req-mumbai-1',
                status: 'PENDING',
                source: 'REPORTED',
                lat: 19.076,
                lng: 72.8777,
              } as unknown as R,
            ],
            command: 'SELECT',
            rowCount: 1,
            oid: 0,
            fields: [],
          };
        }
        if (sql.includes('FROM resources') && sql.includes('FOR UPDATE')) {
          return {
            rows: [
              {
                id: 'res-delhi-1',
                status: 'AVAILABLE',
                source: 'REAL',
                lat: 28.65,
                lng: 77.23,
              } as unknown as R,
            ],
            command: 'SELECT',
            rowCount: 1,
            oid: 0,
            fields: [],
          };
        }
        if (sql.includes('FROM service_areas')) {
          const lng = vals[0] as number;
          const lat = vals[1] as number;
          if (db.mode === 'MISSING_BOUNDARY') {
            return { rows: [], command: 'SELECT', rowCount: 0, oid: 0, fields: [] };
          }
          const evalRes = evaluateDelhiNcrCoverage(lat, lng);
          return {
            rows: [
              {
                regionId: DELHI_NCR_REGION_ID,
                isValid: true,
                srid: 4326,
                isCovered: evalRes.covered,
              } as unknown as R,
            ],
            command: 'SELECT',
            rowCount: 1,
            oid: 0,
            fields: [],
          };
        }
        return { rows: [], command: 'SELECT', rowCount: 0, oid: 0, fields: [] };
      },
    };

    const repo = new PostgisRepository(commitMockClient);
    await expect(repo.commitAssignment('assign-out-1', 'op_1')).rejects.toMatchObject({
      code: 'OUTSIDE_SERVICE_AREA',
      statusCode: 422,
    });

    db.mode = 'MISSING_BOUNDARY';
    await expect(repo.commitAssignment('assign-out-1', 'op_1')).rejects.toMatchObject({
      code: 'SERVICE_AREA_UNAVAILABLE',
      statusCode: 503,
    });
  });

  describe('Boundary Dataset Integrity & Cryptographic Checksum Guardrails', () => {
    it('throws DELHI_NCR_BOUNDARY_INTEGRITY_FAILURE when GeoJSON SHA-256 checksum mismatches', () => {
      const validDataset = loadDelhiNcrBoundaryDataset();
      const rawJson = JSON.stringify(validDataset.dataset);

      expect(() => {
        validateAndIndexNcrDataset(
          rawJson,
          '0000000000000000000000000000000000000000000000000000000000000000',
        );
      }).toThrow(/DELHI_NCR_BOUNDARY_INTEGRITY_FAILURE/i);
    });

    it('throws DELHI_NCR_BOUNDARY_INTEGRITY_FAILURE on malformed JSON or corrupted GeoJSON schema', () => {
      expect(() => {
        validateAndIndexNcrDataset('NOT_VALID_JSON', DELHI_NCR_EXPECTED_DATASET_SHA256);
      }).toThrow(/DELHI_NCR_BOUNDARY_INTEGRITY_FAILURE/i);

      expect(() => {
        validateAndIndexNcrDataset(
          JSON.stringify({ type: 'FeatureCollection', features: 'not-an-array' }),
          'mismatched-hash',
        );
      }).toThrow(/DELHI_NCR_BOUNDARY_INTEGRITY_FAILURE/i);
    });

    it('rejects unexpected geometry types and invalid coordinate structures', () => {
      const invalidGeomFeature = {
        type: 'Feature',
        properties: {
          shapeID: 'test',
          shapeName: 'test',
          officialName: 'test',
          subRegion: 'NCT of Delhi',
        },
        geometry: { type: 'Point', coordinates: [77.2, 28.6] },
      };
      const dataset = {
        type: 'FeatureCollection',
        name: 'test',
        metadata: {},
        features: [invalidGeomFeature],
      };
      const raw = JSON.stringify(dataset);
      // Hash of this invalid dataset
      const hash = createHash('sha256').update(raw).digest('hex');

      expect(() => {
        validateAndIndexNcrDataset(raw, hash);
      }).toThrow(/Unexpected geometry type "Point"/i);
    });

    it('rejects non-finite or out-of-range WGS84 coordinates', () => {
      const invalidCoordFeature = {
        type: 'Feature',
        properties: {
          shapeID: 'test',
          shapeName: 'test',
          officialName: 'test',
          subRegion: 'NCT of Delhi',
        },
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [200, 28.6], // Longitude > 180
              [77.3, 28.6],
              [77.3, 28.7],
              [200, 28.6],
            ],
          ],
        },
      };
      const dataset = {
        type: 'FeatureCollection',
        name: 'test',
        metadata: {},
        features: [invalidCoordFeature],
      };
      const raw = JSON.stringify(dataset);
      const hash = createHash('sha256').update(raw).digest('hex');

      expect(() => {
        validateAndIndexNcrDataset(raw, hash);
      }).toThrow(/Invalid coordinate values/i);
    });
  });

  describe('Near-Boundary Proximity & Spatial Uncertainty Assessment', () => {
    it('distinguishes INSIDE, NEAR_BOUNDARY_OUTSIDE (<=1000m), and OUTSIDE (>1000m)', async () => {
      // 1. Inside NCR: Connaught Place
      const insideRes = await serviceAreaService.checkCoordinates(28.6315, 77.2167);
      expect(insideRes.eligible).toBe(true);
      expect(insideRes.status).toBe('INSIDE');
      expect(insideRes.distanceToBoundaryMeters).toBe(0);
      expect(insideRes.uncertaintyAssessment.isNearBoundary).toBe(false);

      // 2. Near Boundary Outside: ~333m north of northernmost NCR point (29.99624, 77.11808)
      const nearRes = await serviceAreaService.checkCoordinates(29.99624, 77.11808);
      expect(nearRes.eligible).toBe(false);
      expect(nearRes.status).toBe('NEAR_BOUNDARY_OUTSIDE');
      expect(nearRes.distanceToBoundaryMeters).toBeGreaterThan(0);
      expect(nearRes.distanceToBoundaryMeters).toBeLessThanOrEqual(1000);
      expect(nearRes.uncertaintyAssessment.isNearBoundary).toBe(true);

      // 3. Conclusively Outside: Mumbai
      const farRes = await serviceAreaService.checkCoordinates(19.076, 72.8777);
      expect(farRes.eligible).toBe(false);
      expect(farRes.status).toBe('OUTSIDE');
      expect(farRes.distanceToBoundaryMeters).toBeGreaterThan(1000);
      expect(farRes.uncertaintyAssessment.isNearBoundary).toBe(false);
    });

    it('evaluates consumer GPS accuracy degradation (>1000m sets hasPoorAccuracy)', async () => {
      const goodGps = await serviceAreaService.checkCoordinates(28.6315, 77.2167, 15);
      expect(goodGps.uncertaintyAssessment.hasPoorAccuracy).toBe(false);

      const degradedGps = await serviceAreaService.checkCoordinates(28.6315, 77.2167, 1500);
      expect(degradedGps.uncertaintyAssessment.hasPoorAccuracy).toBe(true);
    });

    it('returns 200 with NEAR_BOUNDARY_OUTSIDE on public service-area-check, but rejects request submission with 422 and zero DB writes', async () => {
      // Public check returns 200 with status NEAR_BOUNDARY_OUTSIDE
      const checkRes = await request(app)
        .post('/requests/service-area-check')
        .send({ lat: 29.99624, lng: 77.11808, accuracy: 25 })
        .expect(200);

      expect(checkRes.body).toMatchObject({
        success: true,
        data: {
          eligible: false,
          status: 'NEAR_BOUNDARY_OUTSIDE',
          distanceToBoundaryMeters: expect.any(Number),
          uncertaintyAssessment: {
            isNearBoundary: true,
            thresholdMeters: 1000,
          },
        },
      });

      // Attempting to submit a request for this near-boundary location is strictly blocked:
      // Zero DB writes, 422 OUTSIDE_SERVICE_AREA, with status details
      const submitRes = await request(app)
        .post('/requests')
        .send({
          lat: 29.99624,
          lng: 77.11808,
          accuracy: 25,
          peopleCount: 2,
          urgency: 'HIGH',
          medicalNeeds: false,
          notes: 'Near border location test',
          idempotencyKey: 'idem-near-boundary-test-1',
        })
        .expect(422);

      expect(submitRes.body.error).toMatchObject({
        code: 'OUTSIDE_SERVICE_AREA',
        details: {
          status: 'NEAR_BOUNDARY_OUTSIDE',
          isNearBoundary: true,
          distanceToBoundaryMeters: expect.any(Number),
        },
      });

      // Strict enforcement of Zero Database Writes
      expect(db.insertedRequests).toHaveLength(0);
      expect(db.insertedEvents).toHaveLength(0);
      expect(db.insertedAudits).toHaveLength(0);
    });
  });

  describe('Active PostGIS Boundary Integrity Attestation & Anti-Tampering Suite', () => {
    // Test 1 — Correct boundary accepted: attestation succeeds with valid metadata and topology
    it('Test 1: attestation succeeds when DB boundary matches approved GeoJSON (correct region, version, checksum, ST_Equals)', async () => {
      db.mode = 'ACTIVE';
      const result = await serviceAreaService.attestActiveBoundaryIntegrity();

      expect(result.regionId).toBe(DELHI_NCR_REGION_ID);
      expect(result.boundaryVersion).toBe(DELHI_NCR_BOUNDARY_VERSION);
      expect(result.datasetSha256).toBe(DELHI_NCR_EXPECTED_DATASET_SHA256);
      expect(result.isValid).toBe(true);
      expect(result.srid).toBe(4326);
      expect(result.isTopologicallyEqual).toBe(true);
      expect(result.isMutuallyCovered).toBe(true);
      expect(result.geometryWkbHash).toBe('c8f7d9a1e2b3c4d5e6f708192a3b4c5d');
      expect(result.attestedAt).toBeInstanceOf(Date);

      // Verify static state was set
      expect(ServiceAreaService.getAttestedGeometryWkbHash()).toBe(
        'c8f7d9a1e2b3c4d5e6f708192a3b4c5d',
      );
      expect(ServiceAreaService.getAttestationResult()).toEqual(result);
    });

    // Test 2 — Wrong region ID: attestation fails when DB row has unexpected region_id
    it('Test 2: attestation rejects mismatched region_id', async () => {
      db.mode = 'WRONG_REGION_ID';
      await expect(serviceAreaService.attestActiveBoundaryIntegrity()).rejects.toThrow(
        /region_id mismatch.*expected.*IN-NCR.*actual.*IN-MUMBAI/i,
      );
      expect(ServiceAreaService.getAttestedGeometryWkbHash()).toBeNull();
    });

    // Test 3 — Wrong version: attestation fails when boundary_version doesn't match
    it('Test 3: attestation rejects mismatched boundary_version', async () => {
      db.mode = 'WRONG_VERSION';
      await expect(serviceAreaService.attestActiveBoundaryIntegrity()).rejects.toThrow(
        /version mismatch.*expected.*ncrpb-2026-gb-ind-adm2-v1.*actual.*legacy-v0/i,
      );
      expect(ServiceAreaService.getAttestedGeometryWkbHash()).toBeNull();
    });

    // Test 4 — Wrong checksum: attestation fails when dataset_sha256 doesn't match
    it('Test 4: attestation rejects mismatched dataset_sha256', async () => {
      db.mode = 'WRONG_CHECKSUM';
      await expect(serviceAreaService.attestActiveBoundaryIntegrity()).rejects.toThrow(
        /dataset_sha256 mismatch/i,
      );
      expect(ServiceAreaService.getAttestedGeometryWkbHash()).toBeNull();
    });

    // Test 5 — Modified polygon with unchanged metadata: ST_Equals detects geometry substitution
    it('Test 5: attestation rejects topological mismatch (ST_Equals=false) even when metadata matches', async () => {
      db.mode = 'TOPOLOGICAL_MISMATCH';
      await expect(serviceAreaService.attestActiveBoundaryIntegrity()).rejects.toThrow(
        /does not topologically match/i,
      );
      expect(ServiceAreaService.getAttestedGeometryWkbHash()).toBeNull();
    });

    // Test 6 — Invalid SRID: attestation rejects geometry in wrong CRS
    it('Test 6: attestation rejects SRID != 4326', async () => {
      db.mode = 'INVALID_SRID';
      await expect(serviceAreaService.attestActiveBoundaryIntegrity()).rejects.toThrow(
        /SRID mismatch.*expected 4326.*actual 3857/i,
      );
      expect(ServiceAreaService.getAttestedGeometryWkbHash()).toBeNull();
    });

    // Test 7 — Multiple active boundaries: attestation requires exactly 1 active row
    it('Test 7: attestation rejects multiple active service_areas rows', async () => {
      db.mode = 'MULTIPLE_BOUNDARIES';
      await expect(serviceAreaService.attestActiveBoundaryIntegrity()).rejects.toThrow(
        /Multiple active service-area boundaries.*2 rows/i,
      );
      expect(ServiceAreaService.getAttestedGeometryWkbHash()).toBeNull();
    });

    // Test 8 — Missing active boundary: attestation fails when no active row exists
    it('Test 8: attestation rejects when no active service-area boundary exists', async () => {
      db.mode = 'MISSING_BOUNDARY';
      await expect(serviceAreaService.attestActiveBoundaryIntegrity()).rejects.toThrow(
        /No active service-area boundary found/i,
      );
      expect(ServiceAreaService.getAttestedGeometryWkbHash()).toBeNull();
    });

    // Test 9 — PostGIS down -> 503: attestation propagates DB errors
    it('Test 9: attestation propagates database failure as Error', async () => {
      db.mode = 'DB_ERROR';
      await expect(serviceAreaService.attestActiveBoundaryIntegrity()).rejects.toThrow(
        /Database query failed during service-area boundary attestation/i,
      );
      expect(ServiceAreaService.getAttestedGeometryWkbHash()).toBeNull();
    });

    // Test 10 — Approved geometry succeeds, then checkCoordinates works normally
    it('Test 10: after successful attestation, checkCoordinates passes for inside-NCR point', async () => {
      db.mode = 'ACTIVE';
      await serviceAreaService.attestActiveBoundaryIntegrity();

      const result = await serviceAreaService.checkCoordinates(28.6315, 77.2167);
      expect(result.eligible).toBe(true);
      expect(result.status).toBe('INSIDE');
    });

    // Test 11 — Post-attestation polygon changes detected via WKB hash mismatch
    it('Test 11: checkCoordinates rejects with 503 when geometry WKB hash changes after attestation', async () => {
      // First, attest successfully
      db.mode = 'ACTIVE';
      await serviceAreaService.attestActiveBoundaryIntegrity();
      expect(ServiceAreaService.getAttestedGeometryWkbHash()).toBe(
        'c8f7d9a1e2b3c4d5e6f708192a3b4c5d',
      );

      // Now simulate the DB geometry being tampered after attestation
      db.mode = 'TAMPERED_GEOMETRY_HASH';
      try {
        await serviceAreaService.checkCoordinates(28.6315, 77.2167);
        // Should not reach here
        expect(true).toBe(false);
      } catch (err: unknown) {
        const domainErr = err as { code?: string; statusCode?: number; message?: string };
        expect(domainErr.code).toBe('SERVICE_AREA_UNAVAILABLE');
        expect(domainErr.statusCode).toBe(503);
        // Error message must NOT leak the hash values
        expect(domainErr.message).not.toContain('c8f7d9a1');
        expect(domainErr.message).not.toContain('altered_wkb_hash');
      }
    });

    // Test 12 — Zero DB writes on attestation failure: rejected attestation must not create any rows
    it('Test 12: failed attestation produces zero database writes', async () => {
      const failureModes: Array<ServiceAreaMockDb['mode']> = [
        'WRONG_REGION_ID',
        'WRONG_VERSION',
        'WRONG_CHECKSUM',
        'INVALID_SRID',
        'MULTIPLE_BOUNDARIES',
        'MISSING_BOUNDARY',
        'TOPOLOGICAL_MISMATCH',
        'DB_ERROR',
      ];

      for (const mode of failureModes) {
        db.insertedRequests = [];
        db.insertedEvents = [];
        db.insertedAudits = [];
        ServiceAreaService.resetAttestationForTest();
        db.mode = mode;

        await expect(serviceAreaService.attestActiveBoundaryIntegrity()).rejects.toThrow();
        expect(db.insertedRequests, `mode=${mode}: zero request writes`).toHaveLength(0);
        expect(db.insertedEvents, `mode=${mode}: zero event writes`).toHaveLength(0);
        expect(db.insertedAudits, `mode=${mode}: zero audit writes`).toHaveLength(0);
      }
    });

    // Additional: HTTP integration test — after WKB hash tampering, POST /requests returns 503
    it('POST /requests returns 503 SERVICE_AREA_UNAVAILABLE when geometry tampered after attestation', async () => {
      // Attest successfully first
      db.mode = 'ACTIVE';
      await serviceAreaService.attestActiveBoundaryIntegrity();

      // Simulate post-attestation tampering
      db.mode = 'TAMPERED_GEOMETRY_HASH';
      const res = await request(app).post('/requests').send({
        lat: 28.6315,
        lng: 77.2167,
        peopleCount: 2,
        urgency: 'HIGH',
      });

      expect(res.status).toBe(503);
      expect(res.body.error.code).toBe('SERVICE_AREA_UNAVAILABLE');
      // Must NOT contain internal hash or SQL details
      expect(JSON.stringify(res.body)).not.toContain('c8f7d9a1');
      expect(JSON.stringify(res.body)).not.toContain('altered_wkb_hash');
      expect(JSON.stringify(res.body)).not.toContain('ST_');
      // Zero DB writes
      expect(db.insertedRequests).toHaveLength(0);
      expect(db.insertedEvents).toHaveLength(0);
      expect(db.insertedAudits).toHaveLength(0);
    });

    // Additional: Invalid geometry (ST_IsValid=false) fails attestation
    it('attestation rejects when PostGIS reports ST_IsValid=false', async () => {
      db.mode = 'INVALID_GEOMETRY';
      await expect(serviceAreaService.attestActiveBoundaryIntegrity()).rejects.toThrow(
        /geometry topology is invalid/i,
      );
      expect(ServiceAreaService.getAttestedGeometryWkbHash()).toBeNull();
    });
  });
});
