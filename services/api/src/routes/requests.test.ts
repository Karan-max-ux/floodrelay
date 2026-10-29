import request from 'supertest';
import { describe, it, expect, beforeEach } from 'vitest';
import type { RescueRequest, UrgencyLevel, RequestSource, RequestStatus } from '@floodrelay/shared';
import { createApp } from '../app.js';
import { PostgisRepository, type Queryable } from '../db/repository.js';
import { RequestService } from '../services/requestService.js';
import type { DbRequest, VerificationStatus } from '../db/schema.js';

// In-memory queryable mock simulating database storage with spatial distance calculations
class InMemoryDbMock implements Queryable {
  public requests: Map<string, DbRequest> = new Map();
  public auditEvents: unknown[] = [];

  // Rough spherical distance in meters between two lat/lng points
  private calculateDistanceMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const R = 6371000;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLng = ((lng2 - lng1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos((lat1 * Math.PI) / 180) *
        Math.cos((lat2 * Math.PI) / 180) *
        Math.sin(dLng / 2) *
        Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  async query<R extends Record<string, unknown> = Record<string, unknown>>(
    sqlOrConfig: string | { text: string; values?: unknown[] },
    values?: unknown[],
  ): Promise<{ rows: R[]; command: string; rowCount: number; oid: number; fields: [] }> {
    const sql = typeof sqlOrConfig === 'string' ? sqlOrConfig : sqlOrConfig.text;
    const vals = values ?? (sqlOrConfig as { values?: unknown[] }).values ?? [];

    if (sql.includes('INSERT INTO requests')) {
      const id = vals[0] as string;
      const lng = vals[1] as number;
      const lat = vals[2] as number;
      const people_count = vals[3] as number;
      const urgency = vals[4] as UrgencyLevel;
      const source = vals[5] as string;
      const status = vals[6] as string;
      const verification_status = vals[7] as string;
      const medical_needs = vals[8] as boolean;
      const notes = vals[9] as string | null;
      const idempotency_key = (vals[10] as string) || null;
      const idempotency_request_hash = (vals[11] as string) || null;
      const duplicate_of_id = (vals[12] as string) || null;
      const is_flagged_duplicate = Boolean(vals[13]);
      const created_at = (vals[14] as Date) || new Date();

      if (idempotency_key) {
        for (const existing of this.requests.values()) {
          if (existing.idempotency_key === idempotency_key) {
            const err = new Error(
              'duplicate key value violates unique constraint "requests_idempotency_key_key"',
            );
            (err as unknown as { code: string }).code = '23505';
            throw err;
          }
        }
      }

      const dbRow: DbRequest = {
        id,
        location: `POINT(${lng} ${lat})`,
        people_count,
        urgency,
        source: source as RequestSource,
        status: status as RequestStatus,
        verification_status: verification_status as VerificationStatus,
        medical_needs,
        notes,
        idempotency_key,
        idempotency_request_hash,
        duplicate_of_id,
        is_flagged_duplicate,
        created_at,
        updated_at: new Date(),
      };

      this.requests.set(id, dbRow);
      return { rows: [dbRow as unknown as R], command: 'INSERT', rowCount: 1, oid: 0, fields: [] };
    }

    if (sql.includes('FROM requests') && sql.includes('WHERE idempotency_key = $1')) {
      const key = vals[0] as string;
      for (const row of this.requests.values()) {
        if (row.idempotency_key === key) {
          const match = /POINT\(([-\d.]+)\s+([-\d.]+)\)/.exec(row.location);
          return {
            rows: [
              {
                id: row.id,
                lat: match ? parseFloat(match[2]!) : 0,
                lng: match ? parseFloat(match[1]!) : 0,
                peopleCount: row.people_count,
                urgency: row.urgency,
                source: row.source,
                status: row.status,
                medicalNeeds: row.medical_needs,
                notes: row.notes,
                idempotencyRequestHash: row.idempotency_request_hash,
                createdAt: row.created_at,
              } as unknown as R,
            ],
            command: 'SELECT',
            rowCount: 1,
            oid: 0,
            fields: [],
          };
        }
      }
      return { rows: [], command: 'SELECT', rowCount: 0, oid: 0, fields: [] };
    }

    if (sql.includes('ST_DWithin')) {
      const targetLng = vals[0] as number;
      const targetLat = vals[1] as number;
      const radiusMeters = vals[2] as number;

      const matchingRows: R[] = [];
      for (const row of this.requests.values()) {
        const match = /POINT\(([-\d.]+)\s+([-\d.]+)\)/.exec(row.location);
        if (!match) continue;
        const rowLng = parseFloat(match[1]!);
        const rowLat = parseFloat(match[2]!);
        const dist = this.calculateDistanceMeters(targetLat, targetLng, rowLat, rowLng);

        if (dist <= radiusMeters) {
          matchingRows.push({
            id: row.id,
            lat: rowLat,
            lng: rowLng,
            peopleCount: row.people_count,
            urgency: row.urgency,
            source: row.source,
            status: row.status,
            medicalNeeds: row.medical_needs,
            notes: row.notes,
            duplicateOfId: row.duplicate_of_id,
            isFlaggedDuplicate: row.is_flagged_duplicate,
            createdAt: row.created_at,
            distanceMeters: dist,
          } as unknown as R);
        }
      }

      return {
        rows: matchingRows,
        command: 'SELECT',
        rowCount: matchingRows.length,
        oid: 0,
        fields: [],
      };
    }

    if (sql.includes('WHERE id = $1')) {
      const id = vals[0] as string;
      const row = this.requests.get(id);
      if (!row) {
        return { rows: [], command: 'SELECT', rowCount: 0, oid: 0, fields: [] };
      }
      const match = /POINT\(([-\d.]+)\s+([-\d.]+)\)/.exec(row.location);
      return {
        rows: [
          {
            id: row.id,
            lat: match ? parseFloat(match[2]!) : 0,
            lng: match ? parseFloat(match[1]!) : 0,
            peopleCount: row.people_count,
            urgency: row.urgency,
            source: row.source,
            status: row.status,
            medicalNeeds: row.medical_needs,
            notes: row.notes,
            createdAt: row.created_at,
          } as unknown as R,
        ],
        command: 'SELECT',
        rowCount: 1,
        oid: 0,
        fields: [],
      };
    }

    if (sql.includes('FROM requests') && !sql.includes('WHERE')) {
      const all: R[] = [];
      for (const row of this.requests.values()) {
        const match = /POINT\(([-\d.]+)\s+([-\d.]+)\)/.exec(row.location);
        all.push({
          id: row.id,
          lat: match ? parseFloat(match[2]!) : 0,
          lng: match ? parseFloat(match[1]!) : 0,
          peopleCount: row.people_count,
          urgency: row.urgency,
          source: row.source,
          status: row.status,
          medicalNeeds: row.medical_needs,
          notes: row.notes,
          createdAt: row.created_at,
        } as unknown as R);
      }
      return { rows: all, command: 'SELECT', rowCount: all.length, oid: 0, fields: [] };
    }

    if (sql.includes('INSERT INTO audit_events')) {
      this.auditEvents.push(vals);
      return { rows: [], command: 'INSERT', rowCount: 1, oid: 0, fields: [] };
    }

    return { rows: [], command: 'SELECT', rowCount: 0, oid: 0, fields: [] };
  }
}

describe('Request Intake API (POST /requests)', () => {
  let dbMock: InMemoryDbMock;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    dbMock = new InMemoryDbMock();
    const repo = new PostgisRepository(dbMock);
    const requestService = new RequestService(repo);
    app = createApp({ repository: repo, requestService });
  });

  it('submits a valid citizen rescue request with 201 Created and unverified status', async () => {
    const payload = {
      lat: 28.665,
      lng: 77.228,
      peopleCount: 4,
      urgency: 'HIGH',
      medicalNeeds: true,
      notes: 'Water reaching 1st floor terrace',
    };

    const res = await request(app).post('/requests').send(payload);

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.idempotent).toBe(false);
    expect(res.body.data.isFlaggedDuplicate).toBe(false);
    expect(res.body.data.duplicateOfId).toBeNull();

    const data: RescueRequest = res.body.data;
    expect(data.id).toMatch(/^req-/);
    expect(data.lat).toBe(28.665);
    expect(data.lng).toBe(77.228);
    expect(data.peopleCount).toBe(4);
    expect(data.urgency).toBe('HIGH');
    expect(data.medicalNeeds).toBe(true);
    expect(data.status).toBe('PENDING');
    expect(data.source).toBe('REPORTED');

    // Confirm stored in database
    const stored = dbMock.requests.get(data.id);
    expect(stored).toBeDefined();
    expect(stored?.verification_status).toBe('UNVERIFIED');
    expect(stored?.is_flagged_duplicate).toBe(false);
  });

  describe('Validation Failures (400 Bad Request)', () => {
    it('rejects missing body or empty payload', async () => {
      const res = await request(app).post('/requests').send({});
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.details.lat).toBeDefined();
      expect(res.body.error.details.lng).toBeDefined();
      expect(res.body.error.details.peopleCount).toBeDefined();
      expect(res.body.error.details.urgency).toBeDefined();
    });

    it('rejects out-of-range coordinates', async () => {
      const invalidLat = await request(app).post('/requests').send({
        lat: 95.0, // Invalid: > 90
        lng: 77.2,
        peopleCount: 2,
        urgency: 'LOW',
      });
      expect(invalidLat.status).toBe(400);
      expect(invalidLat.body.error.code).toBe('VALIDATION_ERROR');

      const invalidLng = await request(app).post('/requests').send({
        lat: 28.5,
        lng: 200.0, // Invalid: > 180
        peopleCount: 2,
        urgency: 'LOW',
      });
      expect(invalidLng.status).toBe(400);
      expect(invalidLng.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('rejects non-positive or decimal peopleCount', async () => {
      const zeroPeople = await request(app).post('/requests').send({
        lat: 28.5,
        lng: 77.2,
        peopleCount: 0,
        urgency: 'LOW',
      });
      expect(zeroPeople.status).toBe(400);

      const floatPeople = await request(app).post('/requests').send({
        lat: 28.5,
        lng: 77.2,
        peopleCount: 3.5,
        urgency: 'LOW',
      });
      expect(floatPeople.status).toBe(400);
    });

    it('rejects invalid urgency levels', async () => {
      const res = await request(app).post('/requests').send({
        lat: 28.5,
        lng: 77.2,
        peopleCount: 3,
        urgency: 'EXTREME', // Invalid enum
      });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('Idempotency Behavior', () => {
    it('returns 201 on first request and 200 with identical data on duplicate idempotencyKey', async () => {
      const payload = {
        lat: 28.67,
        lng: 77.23,
        peopleCount: 5,
        urgency: 'CRITICAL',
        idempotencyKey: 'mobile-client-uuid-999',
      };

      // 1. Initial submission
      const firstRes = await request(app).post('/requests').send(payload);
      expect(firstRes.status).toBe(201);
      expect(firstRes.body.idempotent).toBe(false);
      const originalId = firstRes.body.data.id;

      // 2. Exact same submission with same idempotency key
      const secondRes = await request(app).post('/requests').send(payload);
      expect(secondRes.status).toBe(200);
      expect(secondRes.body.idempotent).toBe(true);
      expect(secondRes.body.data.id).toBe(originalId);

      // Verify no second row was created
      expect(dbMock.requests.size).toBe(1);
    });

    it('accepts idempotency key via Idempotency-Key HTTP header', async () => {
      const payload = {
        lat: 28.68,
        lng: 77.24,
        peopleCount: 2,
        urgency: 'MEDIUM',
      };

      const firstRes = await request(app)
        .post('/requests')
        .set('Idempotency-Key', 'header-key-777')
        .send(payload);
      expect(firstRes.status).toBe(201);
      const originalId = firstRes.body.data.id;

      const secondRes = await request(app)
        .post('/requests')
        .set('X-Idempotency-Key', 'header-key-777')
        .send(payload);
      expect(secondRes.status).toBe(200);
      expect(secondRes.body.idempotent).toBe(true);
      expect(secondRes.body.data.id).toBe(originalId);
    });
  });

  describe('Duplicate Detection (Nearby, Recent, Similar Passenger Count)', () => {
    it('flags nearby similar recent request as duplicate without dropping it', async () => {
      // 1. Primary request submitted
      const primaryRes = await request(app).post('/requests').send({
        lat: 28.665,
        lng: 77.228,
        peopleCount: 4,
        urgency: 'HIGH',
        notes: 'House #12 flooded',
      });
      expect(primaryRes.status).toBe(201);
      expect(primaryRes.body.data.isFlaggedDuplicate).toBe(false);
      const primaryId = primaryRes.body.data.id;

      // 2. Second request submitted 30 meters away with 5 people (+1 difference)
      const duplicateRes = await request(app).post('/requests').send({
        lat: 28.6652, // ~22 meters north
        lng: 77.2281, // ~10 meters east
        peopleCount: 5, // |5 - 4| = 1 <= 2
        urgency: 'HIGH',
        notes: 'Help needed at House #12 corner',
      });

      expect(duplicateRes.status).toBe(201);
      expect(duplicateRes.body.data.isFlaggedDuplicate).toBe(true);
      expect(duplicateRes.body.data.duplicateOfId).toBe(primaryId);

      // CRITICAL: Ensure the duplicate request was NOT discarded or dropped
      const duplicateId = duplicateRes.body.data.id;
      expect(dbMock.requests.has(duplicateId)).toBe(true);
      expect(dbMock.requests.get(duplicateId)?.is_flagged_duplicate).toBe(true);
      expect(dbMock.requests.get(duplicateId)?.duplicate_of_id).toBe(primaryId);
    });

    it('does not flag duplicate if location is far away (> 100 meters)', async () => {
      await request(app).post('/requests').send({
        lat: 28.665,
        lng: 77.228,
        peopleCount: 4,
        urgency: 'HIGH',
      });

      // 1.5 km away
      const distantRes = await request(app).post('/requests').send({
        lat: 28.68,
        lng: 77.23,
        peopleCount: 4,
        urgency: 'HIGH',
      });

      expect(distantRes.status).toBe(201);
      expect(distantRes.body.data.isFlaggedDuplicate).toBe(false);
      expect(distantRes.body.data.duplicateOfId).toBeNull();
    });

    it('does not flag duplicate if passenger count differs significantly (> +/- 2 people)', async () => {
      await request(app).post('/requests').send({
        lat: 28.665,
        lng: 77.228,
        peopleCount: 3,
        urgency: 'HIGH',
      });

      // Same location but 15 people (|15 - 3| = 12 > 2)
      const groupRes = await request(app).post('/requests').send({
        lat: 28.6651,
        lng: 77.228,
        peopleCount: 15,
        urgency: 'HIGH',
      });

      expect(groupRes.status).toBe(201);
      expect(groupRes.body.data.isFlaggedDuplicate).toBe(false);
      expect(groupRes.body.data.duplicateOfId).toBeNull();
    });
  });

  describe('Retrieval Endpoints (GET /requests, GET /requests/:id)', () => {
    it('retrieves created request by ID', async () => {
      const created = await request(app).post('/requests').send({
        lat: 28.65,
        lng: 77.22,
        peopleCount: 2,
        urgency: 'LOW',
        notes: 'Elderly resident',
      });

      const id = created.body.data.id;
      const getRes = await request(app).get(`/requests/${id}`);

      expect(getRes.status).toBe(200);
      expect(getRes.body.success).toBe(true);
      expect(getRes.body.data.id).toBe(id);
      expect(getRes.body.data.peopleCount).toBe(2);
    });

    it('returns 404 for non-existent request ID', async () => {
      const res = await request(app).get('/requests/req-non-existent-999');
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });

    it('lists all requests with count', async () => {
      await request(app).post('/requests').send({
        lat: 28.65,
        lng: 77.22,
        peopleCount: 1,
        urgency: 'LOW',
      });
      await request(app).post('/requests').send({
        lat: 28.66,
        lng: 77.23,
        peopleCount: 2,
        urgency: 'HIGH',
      });

      const res = await request(app).get('/requests');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.count).toBe(2);
      expect(res.body.data.length).toBe(2);
    });
  });

  describe('Health Check Endpoint (GET /health)', () => {
    it('returns 200 OK with timestamp', async () => {
      const res = await request(app).get('/health');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
      expect(res.body.timestamp).toBeDefined();
    });
  });
});
