import pg from 'pg';
import {
  validateScenario,
  type RescueRequest,
  type RescueResource,
  type Shelter,
  type Scenario,
  type RequestStatus,
  type UrgencyLevel,
  type RequestSource,
  type ResourceStatus,
  type ResourceType,
  type OperationalEvent,
  type OperationalEventType,
  type EventEntityType,
  type EventActorType,
  type EventProcessingStatus,
  type HazardLevel,
  type GeoPoint,
  type FrozenStopReference,
} from '@floodrelay/shared';
import {
  type DbRequest,
  type DbResource,
  type DbShelter,
  type DbAssignment,
  type DbAssignmentStop,
  type VerificationStatus,
  type DbOperator,
  type DbOperatorSession,
  type OperatorProfile,
  type OperatorRole,
  type DbOperationalEvent,
  type DbBlockedZone,
  type DbAuditEvent,
  toPolygonWkt,
} from './schema.js';

// Queryable interface allowing either pg.Pool or pg.PoolClient (for transactions)
export interface Queryable {
  query<R extends pg.QueryResultRow = pg.QueryResultRow, I extends unknown[] = unknown[]>(
    queryTextOrConfig: string | pg.QueryConfig<I>,
    values?: I,
  ): Promise<pg.QueryResult<R>>;
}

export const MAX_QUERY_OFFSET = 10000;
export const MAX_QUERY_LIMIT = 500;

export interface NearbyRequestFilter {
  offset?: number;
  excludeId?: string;
  since?: Date;
  status?: RequestStatus;
  limit?: number;
}

export interface RequestCreateOptions {
  verificationStatus?: VerificationStatus;
  idempotencyKey?: string | null;
  idempotencyRequestHash?: string | null;
  duplicateOfId?: string | null;
  isFlaggedDuplicate?: boolean;
}

export interface ListAuditEventsFilter {
  entityType?: string;
  entityId?: string;
  eventType?: string;
  actor?: string;
  since?: Date;
  until?: Date;
  limit?: number;
  offset?: number;
}

export interface ListOperationalEventsFilter {
  eventType?: OperationalEventType;
  entityType?: EventEntityType;
  entityId?: string;
  actorType?: EventActorType;
  actorId?: string;
  processingStatus?: EventProcessingStatus;
  since?: Date;
  until?: Date;
  limit?: number;
  offset?: number;
}

export interface BlockedZoneCreateInput {
  id?: string;
  name?: string;
  severity?: HazardLevel;
  polygon: GeoPoint[];
  createdBy: string;
}

export interface ServiceAreaCoverageRow {
  region_id: string;
  region_name: string;
  boundary_version: string;
  dataset_sha256: string;
  is_valid: boolean;
  srid: number;
  geometry_wkb_hash: string;
  is_covered: boolean;
  distance_meters?: number;
}

export interface ServiceAreaAttestationRow {
  region_id: string;
  region_name: string;
  boundary_version: string;
  dataset_sha256: string;
  is_valid: boolean;
  srid: number;
  point_count: number;
  area_sq_km: number;
  geometry_wkb_hash: string;
  is_topologically_equal: boolean;
  is_mutually_covered: boolean;
}

export class PostgisRepository {
  constructor(private readonly client: Queryable) {}

  getClient(): Queryable {
    return this.client;
  }

  async withTransaction<T>(
    fn: (txRepo: PostgisRepository, client: Queryable) => Promise<T>,
  ): Promise<T> {
    const isPool = this.client instanceof pg.Pool;
    if (!isPool) {
      return fn(this, this.client);
    }
    const poolClient = await (this.client as pg.Pool).connect();
    try {
      await poolClient.query('BEGIN');
      const txRepo = new PostgisRepository(poolClient);
      const result = await fn(txRepo, poolClient);
      await poolClient.query('COMMIT');
      return result;
    } catch (err) {
      try {
        await poolClient.query('ROLLBACK');
      } catch (rollbackErr) {
        console.error('Error rolling back transaction:', rollbackErr);
      }
      throw err;
    } finally {
      poolClient.release();
    }
  }

  // ==========================================
  // Requests Data Access
  // ==========================================

  async insertRequest(req: RescueRequest, options?: RequestCreateOptions): Promise<DbRequest> {
    const verificationStatus = options?.verificationStatus ?? 'UNVERIFIED';
    const idempotencyKey = options?.idempotencyKey ?? null;
    const idempotencyRequestHash = options?.idempotencyRequestHash ?? null;
    const duplicateOfId = options?.duplicateOfId ?? null;
    const isFlaggedDuplicate = options?.isFlaggedDuplicate ?? false;
    const medicalNeeds = req.medicalNeeds ?? false;
    const notes = req.notes ?? null;
    const status = req.status ?? 'PENDING';
    const createdAt = req.createdAt ? new Date(req.createdAt) : new Date();

    const sql = `
      INSERT INTO requests (
        id, location, people_count, urgency, source, status,
        verification_status, medical_needs, notes, idempotency_key,
        idempotency_request_hash, duplicate_of_id, is_flagged_duplicate, created_at, updated_at
      ) VALUES (
        $1,
        ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography,
        $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, NOW()
      )
      ON CONFLICT (id) DO UPDATE SET
        location = EXCLUDED.location,
        people_count = EXCLUDED.people_count,
        urgency = EXCLUDED.urgency,
        source = EXCLUDED.source,
        status = EXCLUDED.status,
        verification_status = EXCLUDED.verification_status,
        medical_needs = EXCLUDED.medical_needs,
        notes = EXCLUDED.notes,
        updated_at = NOW()
      RETURNING
        id,
        ST_AsText(location) as location,
        people_count,
        urgency,
        source,
        status,
        verification_status,
        medical_needs,
        notes,
        idempotency_key,
        idempotency_request_hash,
        duplicate_of_id,
        is_flagged_duplicate,
        created_at,
        updated_at;
    `;

    // Note: ST_MakePoint takes (longitude, latitude)
    const result = await this.client.query<DbRequest>(sql, [
      req.id,
      req.lng,
      req.lat,
      req.peopleCount,
      req.urgency,
      req.source,
      status,
      verificationStatus,
      medicalNeeds,
      notes,
      idempotencyKey,
      idempotencyRequestHash,
      duplicateOfId,
      isFlaggedDuplicate,
      createdAt,
    ]);

    const row = result.rows[0];
    if (!row) {
      throw new Error(`Failed to insert rescue request "${req.id}"`);
    }
    return row;
  }

  async getRequestById(id: string): Promise<RescueRequest | null> {
    const sql = `
      SELECT
        id,
        ST_Y(location::geometry) as lat,
        ST_X(location::geometry) as lng,
        people_count as "peopleCount",
        urgency,
        source,
        status,
        verification_status as "verificationStatus",
        medical_needs as "medicalNeeds",
        notes,
        idempotency_key as "idempotencyKey",
        is_flagged_duplicate as "isFlaggedDuplicate",
        duplicate_of_id as "duplicateOfId",
        created_at as "createdAt"
      FROM requests
      WHERE id = $1;
    `;

    const result = await this.client.query(sql, [id]);
    const row = result.rows[0];
    if (!row) return null;

    return {
      id: row.id,
      lat: Number(row.lat),
      lng: Number(row.lng),
      peopleCount: Number(row.peopleCount),
      urgency: row.urgency,
      source: row.source,
      status: row.status,
      verificationStatus: row.verificationStatus ?? 'UNVERIFIED',
      medicalNeeds: Boolean(row.medicalNeeds),
      notes: row.notes ?? undefined,
      idempotencyKey: row.idempotencyKey ?? null,
      isFlaggedDuplicate: Boolean(row.isFlaggedDuplicate),
      duplicateOfId: row.duplicateOfId ?? null,
      createdAt:
        row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
    };
  }

  async getRequestByIdempotencyKey(
    idempotencyKey: string,
  ): Promise<(RescueRequest & { idempotencyRequestHash?: string | null }) | null> {
    const sql = `
      SELECT
        id,
        ST_Y(location::geometry) as lat,
        ST_X(location::geometry) as lng,
        people_count as "peopleCount",
        urgency,
        source,
        status,
        medical_needs as "medicalNeeds",
        notes,
        idempotency_request_hash as "idempotencyRequestHash",
        created_at as "createdAt"
      FROM requests
      WHERE idempotency_key = $1;
    `;

    const result = await this.client.query(sql, [idempotencyKey]);
    const row = result.rows[0];
    if (!row) return null;

    return {
      id: row.id,
      lat: Number(row.lat),
      lng: Number(row.lng),
      peopleCount: Number(row.peopleCount),
      urgency: row.urgency,
      source: row.source,
      status: row.status,
      medicalNeeds: Boolean(row.medicalNeeds),
      notes: row.notes ?? undefined,
      idempotencyRequestHash: (row.idempotencyRequestHash as string) ?? null,
      createdAt:
        row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
    };
  }

  async listRequests(filter?: {
    status?: RequestStatus;
    urgency?: UrgencyLevel;
    source?: RequestSource;
    excludeFlaggedDuplicates?: boolean;
    limit?: number;
    offset?: number;
  }): Promise<RescueRequest[]> {
    const conditions: string[] = [];
    const values: unknown[] = [];

    if (filter?.status) {
      values.push(filter.status);
      conditions.push(`status = $${values.length}`);
    }
    if (filter?.urgency) {
      values.push(filter.urgency);
      conditions.push(`urgency = $${values.length}`);
    }
    if (filter?.source) {
      values.push(filter.source);
      conditions.push(`source = $${values.length}`);
    }
    if (filter?.excludeFlaggedDuplicates) {
      conditions.push(`is_flagged_duplicate = FALSE`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    let limitClause = '';
    if (filter?.limit !== undefined) {
      const limit = Math.max(1, Math.min(Math.floor(filter.limit), MAX_QUERY_LIMIT));
      values.push(limit);
      limitClause = `LIMIT $${values.length}`;
    }

    let offsetClause = '';
    if (filter?.offset !== undefined) {
      if (
        !Number.isFinite(filter.offset) ||
        filter.offset < 0 ||
        filter.offset > MAX_QUERY_OFFSET
      ) {
        throw new Error(
          `Invalid query offset: must be a finite integer between 0 and ${MAX_QUERY_OFFSET} (received: ${filter.offset})`,
        );
      }
      values.push(Math.floor(filter.offset));
      offsetClause = `OFFSET $${values.length}`;
    }

    const sql = `
      SELECT
        id,
        ST_Y(location::geometry) as lat,
        ST_X(location::geometry) as lng,
        people_count as "peopleCount",
        urgency,
        source,
        status,
        verification_status as "verificationStatus",
        medical_needs as "medicalNeeds",
        notes,
        idempotency_key as "idempotencyKey",
        is_flagged_duplicate as "isFlaggedDuplicate",
        duplicate_of_id as "duplicateOfId",
        created_at as "createdAt"
      FROM requests
      ${whereClause}
      ORDER BY created_at DESC
      ${limitClause} ${offsetClause};
    `;

    const result = await this.client.query(sql, values);
    return result.rows.map((row) => ({
      id: row.id,
      lat: Number(row.lat),
      lng: Number(row.lng),
      peopleCount: Number(row.peopleCount),
      urgency: row.urgency,
      source: row.source,
      status: row.status,
      verificationStatus: row.verificationStatus ?? 'UNVERIFIED',
      medicalNeeds: Boolean(row.medicalNeeds),
      notes: row.notes ?? undefined,
      idempotencyKey: row.idempotencyKey ?? null,
      isFlaggedDuplicate: Boolean(row.isFlaggedDuplicate),
      duplicateOfId: row.duplicateOfId ?? null,
      createdAt:
        row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
    }));
  }

  async findNearbyRequests(
    lat: number,
    lng: number,
    radiusMeters: number,
    options?: NearbyRequestFilter,
  ): Promise<
    Array<
      RescueRequest & {
        distanceMeters: number;
        duplicateOfId?: string | null;
        isFlaggedDuplicate?: boolean;
      }
    >
  > {
    const conditions: string[] = [
      `ST_DWithin(location, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, $3)`,
    ];
    const values: unknown[] = [lng, lat, radiusMeters];

    if (options?.excludeId) {
      values.push(options.excludeId);
      conditions.push(`id != $${values.length}`);
    }
    if (options?.since) {
      values.push(options.since);
      conditions.push(`created_at >= $${values.length}`);
    }
    if (options?.status) {
      values.push(options.status);
      conditions.push(`status = $${values.length}`);
    }

    const rawLimit = options?.limit ?? 50;
    const limit = Math.max(1, Math.min(Math.floor(rawLimit), MAX_QUERY_LIMIT));
    values.push(limit);
    const limitClause = `LIMIT $${values.length}`;

    let offsetClause = '';
    if (options?.offset !== undefined) {
      if (
        !Number.isFinite(options.offset) ||
        options.offset < 0 ||
        options.offset > MAX_QUERY_OFFSET
      ) {
        throw new Error(
          `Invalid query offset: must be a finite integer between 0 and ${MAX_QUERY_OFFSET} (received: ${options.offset})`,
        );
      }
      values.push(Math.floor(options.offset));
      offsetClause = `OFFSET $${values.length}`;
    }

    const sql = `
      SELECT
        id,
        ST_Y(location::geometry) as lat,
        ST_X(location::geometry) as lng,
        people_count as "peopleCount",
        urgency,
        source,
        status,
        medical_needs as "medicalNeeds",
        notes,
        duplicate_of_id as "duplicateOfId",
        is_flagged_duplicate as "isFlaggedDuplicate",
        created_at as "createdAt",
        ST_Distance(location, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography) as "distanceMeters"
      FROM requests
      WHERE ${conditions.join(' AND ')}
      ORDER BY "distanceMeters" ASC
      ${limitClause} ${offsetClause};
    `;

    const result = await this.client.query(sql, values);
    return result.rows.map((row) => ({
      id: row.id,
      lat: Number(row.lat),
      lng: Number(row.lng),
      peopleCount: Number(row.peopleCount),
      urgency: row.urgency,
      source: row.source,
      status: row.status,
      medicalNeeds: Boolean(row.medicalNeeds),
      notes: row.notes ?? undefined,
      duplicateOfId: row.duplicateOfId ?? null,
      isFlaggedDuplicate: Boolean(row.isFlaggedDuplicate),
      distanceMeters: Number(row.distanceMeters),
      createdAt:
        row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
    }));
  }

  async updateRequestStatus(id: string, status: RequestStatus): Promise<boolean> {
    const sql = `
      UPDATE requests
      SET status = $2, updated_at = NOW()
      WHERE id = $1;
    `;
    const result = await this.client.query(sql, [id, status]);
    return (result.rowCount ?? 0) > 0;
  }

  async flagRequestDuplicate(id: string, duplicateOfId: string): Promise<boolean> {
    const sql = `
      UPDATE requests
      SET duplicate_of_id = $2,
          is_flagged_duplicate = TRUE,
          updated_at = NOW()
      WHERE id = $1;
    `;
    const result = await this.client.query(sql, [id, duplicateOfId]);
    return (result.rowCount ?? 0) > 0;
  }

  // ==========================================
  // Resources Data Access
  // ==========================================

  async insertResource(
    res: RescueResource,
    source: 'SIMULATED' | 'REAL',
    shiftMaxDurationMin = 480,
  ): Promise<DbResource> {
    const sql = `
      INSERT INTO resources (
        id, name, type, capacity, speed_km_h, location, status,
        depot_id, shift_max_duration_min, source, created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5,
        ST_SetSRID(ST_MakePoint($6, $7), 4326)::geography,
        $8, $9, $10, $11, NOW(), NOW()
      )
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        type = EXCLUDED.type,
        capacity = EXCLUDED.capacity,
        speed_km_h = EXCLUDED.speed_km_h,
        location = EXCLUDED.location,
        status = EXCLUDED.status,
        depot_id = EXCLUDED.depot_id,
        shift_max_duration_min = EXCLUDED.shift_max_duration_min,
        source = EXCLUDED.source,
        updated_at = NOW()
      RETURNING
        id, name, type, capacity, speed_km_h,
        ST_AsText(location) as location,
        status, depot_id, shift_max_duration_min, source,
        created_at, updated_at;
    `;

    const result = await this.client.query<DbResource>(sql, [
      res.id,
      res.name,
      res.type,
      res.capacity,
      res.speedKmH,
      res.lng,
      res.lat,
      res.status,
      res.depotId ?? null,
      shiftMaxDurationMin,
      source,
    ]);

    const row = result.rows[0];
    if (!row) {
      throw new Error(`Failed to insert rescue resource "${res.id}"`);
    }
    return row;
  }

  async getResourceById(id: string): Promise<RescueResource | null> {
    const sql = `
      SELECT
        id, name, type, capacity, speed_km_h as "speedKmH",
        ST_Y(location::geometry) as lat,
        ST_X(location::geometry) as lng,
        status, depot_id as "depotId",
        source
      FROM resources
      WHERE id = $1;
    `;
    const result = await this.client.query(sql, [id]);
    const row = result.rows[0];
    if (!row) return null;

    return {
      id: row.id,
      name: row.name,
      type: row.type,
      capacity: Number(row.capacity),
      speedKmH: Number(row.speedKmH),
      lat: Number(row.lat),
      lng: Number(row.lng),
      status: row.status,
      depotId: row.depotId ?? undefined,
      source: (row.source as 'SIMULATED' | 'REAL') ?? undefined,
    };
  }

  async listResources(filter?: {
    status?: ResourceStatus;
    type?: ResourceType;
  }): Promise<RescueResource[]> {
    const conditions: string[] = [];
    const values: unknown[] = [];

    if (filter?.status) {
      values.push(filter.status);
      conditions.push(`status = $${values.length}`);
    }
    if (filter?.type) {
      values.push(filter.type);
      conditions.push(`type = $${values.length}`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const sql = `
      SELECT
        id, name, type, capacity, speed_km_h as "speedKmH",
        ST_Y(location::geometry) as lat,
        ST_X(location::geometry) as lng,
        status, depot_id as "depotId",
        source
      FROM resources
      ${whereClause}
      ORDER BY id ASC;
    `;

    const result = await this.client.query(sql, values);
    return result.rows.map((row) => ({
      id: row.id,
      name: row.name,
      type: row.type,
      capacity: Number(row.capacity),
      speedKmH: Number(row.speedKmH),
      lat: Number(row.lat),
      lng: Number(row.lng),
      status: row.status,
      depotId: row.depotId ?? undefined,
      source: (row.source as 'SIMULATED' | 'REAL') ?? undefined,
    }));
  }

  async updateResourceStatus(id: string, status: ResourceStatus): Promise<RescueResource | null> {
    const sql = `
      UPDATE resources
      SET status = $2, updated_at = NOW()
      WHERE id = $1 AND source = 'REAL'
      RETURNING
        id, name, type, capacity, speed_km_h as "speedKmH",
        ST_Y(location::geometry) as lat,
        ST_X(location::geometry) as lng,
        status, depot_id as "depotId",
        source;
    `;
    const result = await this.client.query(sql, [id, status]);
    const row = result.rows[0];
    if (!row) return null;
    return {
      id: row.id,
      name: row.name,
      type: row.type,
      capacity: Number(row.capacity),
      speedKmH: Number(row.speedKmH),
      lat: Number(row.lat),
      lng: Number(row.lng),
      status: row.status,
      depotId: row.depotId ?? undefined,
      source: (row.source as 'SIMULATED' | 'REAL') ?? undefined,
    };
  }

  // ==========================================
  // Shelters Data Access
  // ==========================================

  async insertShelter(sh: Shelter, source: 'SIMULATED' | 'REAL'): Promise<DbShelter> {
    const sql = `
      INSERT INTO shelters (
        id, name, location, capacity, current_occupancy, is_active, source, created_at, updated_at
      ) VALUES (
        $1, $2,
        ST_SetSRID(ST_MakePoint($3, $4), 4326)::geography,
        $5, $6, TRUE, $7, NOW(), NOW()
      )
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        location = EXCLUDED.location,
        capacity = EXCLUDED.capacity,
        current_occupancy = EXCLUDED.current_occupancy,
        is_active = EXCLUDED.is_active,
        source = EXCLUDED.source,
        updated_at = NOW()
      RETURNING
        id, name,
        ST_AsText(location) as location,
        capacity, current_occupancy, is_active, source,
        created_at, updated_at;
    `;

    const result = await this.client.query<DbShelter>(sql, [
      sh.id,
      sh.name,
      sh.lng,
      sh.lat,
      sh.capacity,
      sh.currentOccupancy ?? 0,
      source,
    ]);

    const row = result.rows[0];
    if (!row) {
      throw new Error(`Failed to insert shelter "${sh.id}"`);
    }
    return row;
  }

  async getShelterById(id: string): Promise<Shelter | null> {
    const sql = `
      SELECT
        id, name, capacity, current_occupancy as "currentOccupancy",
        ST_Y(location::geometry) as lat,
        ST_X(location::geometry) as lng,
        source
      FROM shelters
      WHERE id = $1;
    `;
    const result = await this.client.query(sql, [id]);
    const row = result.rows[0];
    if (!row) return null;

    return {
      id: row.id,
      name: row.name,
      lat: Number(row.lat),
      lng: Number(row.lng),
      capacity: Number(row.capacity),
      currentOccupancy: Number(row.currentOccupancy),
      source: (row.source as 'SIMULATED' | 'REAL') ?? undefined,
    };
  }

  async listShelters(filter?: { activeOnly?: boolean }): Promise<Shelter[]> {
    const activeCondition = (filter?.activeOnly ?? true) ? 'WHERE is_active = TRUE' : '';
    const sql = `
      SELECT
        id, name, capacity, current_occupancy as "currentOccupancy",
        ST_Y(location::geometry) as lat,
        ST_X(location::geometry) as lng,
        source
      FROM shelters
      ${activeCondition}
      ORDER BY id ASC;
    `;
    const result = await this.client.query(sql);
    return result.rows.map((row) => ({
      id: row.id,
      name: row.name,
      lat: Number(row.lat),
      lng: Number(row.lng),
      capacity: Number(row.capacity),
      currentOccupancy: row.currentOccupancy !== null ? Number(row.currentOccupancy) : undefined,
      source: (row.source as 'SIMULATED' | 'REAL') ?? undefined,
    }));
  }

  async findNearestShelters(
    lat: number,
    lng: number,
    limit = 5,
  ): Promise<Array<Shelter & { distanceMeters: number }>> {
    const sql = `
      SELECT
        id, name, capacity, current_occupancy as "currentOccupancy",
        ST_Y(location::geometry) as lat,
        ST_X(location::geometry) as lng,
        ST_Distance(location, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography) as "distanceMeters"
      FROM shelters
      WHERE is_active = TRUE
      ORDER BY "distanceMeters" ASC
      LIMIT $3;
    `;
    const result = await this.client.query(sql, [lng, lat, limit]);
    return result.rows.map((row) => ({
      id: row.id,
      name: row.name,
      lat: Number(row.lat),
      lng: Number(row.lng),
      capacity: Number(row.capacity),
      currentOccupancy: Number(row.currentOccupancy),
      distanceMeters: Number(row.distanceMeters),
    }));
  }

  // ==========================================
  // Assignments & Stops Data Access
  // ==========================================

  async insertAssignmentWithStops(
    assignment: DbAssignment,
    stops: DbAssignmentStop[],
  ): Promise<void> {
    const assignSql = `
      INSERT INTO assignments (
        id, scenario_id, status, metrics, unserved, committed_at, committed_by, created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, NOW(), NOW()
      )
      ON CONFLICT (id) DO UPDATE SET
        status = EXCLUDED.status,
        metrics = EXCLUDED.metrics,
        unserved = EXCLUDED.unserved,
        committed_at = EXCLUDED.committed_at,
        committed_by = EXCLUDED.committed_by,
        updated_at = NOW();
    `;

    await this.client.query(assignSql, [
      assignment.id,
      assignment.scenario_id,
      assignment.status,
      assignment.metrics ? JSON.stringify(assignment.metrics) : null,
      assignment.unserved ? JSON.stringify(assignment.unserved) : null,
      assignment.committed_at,
      assignment.committed_by,
    ]);

    if (stops.length > 0) {
      // Clear prior stops if updating
      await this.client.query('DELETE FROM assignment_stops WHERE assignment_id = $1;', [
        assignment.id,
      ]);

      for (const stop of stops) {
        const stopSql = `
          INSERT INTO assignment_stops (
            id, assignment_id, resource_id, stop_number, type, target_id,
            location, passengers_picked_up, passengers_dropped_off,
            estimated_arrival_minutes, is_frozen, created_at
          ) VALUES (
            $1, $2, $3, $4, $5, $6,
            ST_GeogFromText($7),
            $8, $9, $10, $11, NOW()
          );
        `;
        await this.client.query(stopSql, [
          stop.id,
          stop.assignment_id,
          stop.resource_id,
          stop.stop_number,
          stop.type,
          stop.target_id,
          stop.location,
          stop.passengers_picked_up,
          stop.passengers_dropped_off,
          stop.estimated_arrival_minutes,
          stop.is_frozen,
        ]);
      }
    }
  }

  async getAssignmentWithStops(
    id: string,
  ): Promise<{ assignment: DbAssignment; stops: DbAssignmentStop[] } | null> {
    const assignSql = `
      SELECT
        id, scenario_id, status, metrics, unserved, committed_at, committed_by, created_at, updated_at
      FROM assignments
      WHERE id = $1;
    `;
    const assignResult = await this.client.query(assignSql, [id]);
    const assignRow = assignResult.rows[0];
    if (!assignRow) return null;

    const stopsSql = `
      SELECT
        id, assignment_id, resource_id, stop_number, type, target_id,
        ST_AsText(location) as location,
        passengers_picked_up, passengers_dropped_off,
        estimated_arrival_minutes, is_frozen, created_at
      FROM assignment_stops
      WHERE assignment_id = $1
      ORDER BY resource_id ASC, stop_number ASC;
    `;
    const stopsResult = await this.client.query<DbAssignmentStop>(stopsSql, [id]);

    return {
      assignment: {
        id: assignRow.id,
        scenario_id: assignRow.scenario_id,
        status: assignRow.status,
        metrics:
          typeof assignRow.metrics === 'string' ? JSON.parse(assignRow.metrics) : assignRow.metrics,
        unserved:
          typeof assignRow.unserved === 'string'
            ? JSON.parse(assignRow.unserved)
            : assignRow.unserved,
        committed_at: assignRow.committed_at,
        committed_by: assignRow.committed_by,
        created_at: assignRow.created_at,
        updated_at: assignRow.updated_at,
      },
      stops: stopsResult.rows,
    };
  }

  async commitAssignment(
    assignmentId: string,
    operatorId: string,
    notes?: string,
  ): Promise<boolean> {
    const isPool = this.client instanceof pg.Pool;
    let poolClient: pg.PoolClient | undefined;
    const client: Queryable = isPool
      ? (poolClient = await (this.client as pg.Pool).connect())
      : this.client;

    try {
      await client.query('BEGIN');

      // 1. Lock the assignment row with SELECT ... FOR UPDATE
      const assignResult = await client.query<{
        id: string;
        status: string;
        scenario_id: string;
      }>('SELECT id, status, scenario_id FROM assignments WHERE id = $1 FOR UPDATE;', [
        assignmentId,
      ]);

      const assignRow = assignResult.rows[0];
      if (!assignRow) {
        const err = new Error(`Assignment with id "${assignmentId}" not found`);
        (err as unknown as { code: string; statusCode: number }).code = 'NOT_FOUND';
        (err as unknown as { code: string; statusCode: number }).statusCode = 404;
        throw err;
      }

      if (assignRow.status !== 'PROPOSED') {
        const err = new Error(
          `Assignment "${assignmentId}" is not in PROPOSED status (current status: ${assignRow.status})`,
        );
        (err as unknown as { code: string; statusCode: number }).code = 'ALREADY_COMMITTED';
        (err as unknown as { code: string; statusCode: number }).statusCode = 409;
        throw err;
      }

      // 2. Fetch all stops belonging to this proposed assignment
      const stopsResult = await client.query<{
        id: string;
        resource_id: string;
        type: string;
        target_id: string;
        stop_number: number;
        is_frozen: boolean;
        passengers_dropped_off: number;
      }>(
        `SELECT id, resource_id, type, target_id, stop_number, is_frozen, passengers_dropped_off
         FROM assignment_stops
         WHERE assignment_id = $1
         ORDER BY resource_id ASC, stop_number ASC;`,
        [assignmentId],
      );
      const planStops = stopsResult.rows;

      // 3. Lock and validate every request in PICKUP stops:
      // Newly planned requests must be PENDING. Legitimate frozen stops must reference requests in ASSIGNED status.
      // A request must never appear in duplicate PICKUP stops within the same plan.
      const seenPickupTargets = new Set<string>();
      for (const stop of planStops) {
        if (stop.type === 'PICKUP' && stop.target_id) {
          if (seenPickupTargets.has(stop.target_id)) {
            const err = new Error(
              `Duplicate PICKUP stop for request "${stop.target_id}" in assignment plan`,
            );
            (err as unknown as { code: string; statusCode: number }).code =
              'REQUEST_ALREADY_ASSIGNED';
            (err as unknown as { code: string; statusCode: number }).statusCode = 409;
            throw err;
          }
          seenPickupTargets.add(stop.target_id);
        }
      }

      const pickupTargetIds = Array.from(seenPickupTargets).sort();

      const serviceAreaEntitiesToCheck: Array<{
        entityType: 'request' | 'resource' | 'shelter';
        id: string;
        lat: number;
        lng: number;
      }> = [];

      if (pickupTargetIds.length > 0) {
        const reqResult = await client.query<{
          id: string;
          status: string;
          source: string;
          lat: number | null;
          lng: number | null;
        }>(
          'SELECT id, status, source, ST_Y(location::geometry) as lat, ST_X(location::geometry) as lng FROM requests WHERE id = ANY($1::text[]) ORDER BY id COLLATE "C" ASC FOR UPDATE;',
          [pickupTargetIds],
        );
        const lockedRequests = new Map(reqResult.rows.map((r) => [r.id, r]));

        for (const stop of planStops) {
          if (stop.type === 'PICKUP' && stop.target_id) {
            const reqId = stop.target_id;
            const reqRow = lockedRequests.get(reqId);
            if (!reqRow) {
              const err = new Error(`Request "${reqId}" referenced in pickup stop does not exist`);
              (err as unknown as { code: string; statusCode: number }).code = 'REQUEST_NOT_FOUND';
              (err as unknown as { code: string; statusCode: number }).statusCode = 409;
              throw err;
            }

            if (reqRow.source === 'SIMULATED') {
              const err = new Error(
                `Cannot commit assignment plan containing simulated request "${reqId}" in operational dispatch mode`,
              );
              (err as unknown as { code: string; statusCode: number }).code =
                'SIMULATED_REQUEST_FORBIDDEN';
              (err as unknown as { code: string; statusCode: number }).statusCode = 409;
              throw err;
            }

            if (stop.is_frozen) {
              if (reqRow.status !== 'ASSIGNED') {
                const err = new Error(
                  `Request "${reqId}" in frozen stop is in invalid status: ${reqRow.status} (must be ASSIGNED)`,
                );
                (err as unknown as { code: string; statusCode: number }).code =
                  'REQUEST_ALREADY_ASSIGNED';
                (err as unknown as { code: string; statusCode: number }).statusCode = 409;
                throw err;
              }
            } else {
              if (reqRow.status !== 'PENDING') {
                const err = new Error(
                  `Request "${reqId}" is no longer in PENDING status (current status: ${reqRow.status})`,
                );
                (err as unknown as { code: string; statusCode: number }).code =
                  'REQUEST_ALREADY_ASSIGNED';
                (err as unknown as { code: string; statusCode: number }).statusCode = 409;
                throw err;
              }
            }

            if (reqRow.lat !== null && reqRow.lng !== null) {
              serviceAreaEntitiesToCheck.push({
                entityType: 'request',
                id: reqId,
                lat: Number(reqRow.lat),
                lng: Number(reqRow.lng),
              });
            }
          }
        }
      }

      // 4. Lock all referenced resource rows using PostgreSQL SELECT ... FOR UPDATE in deterministic order
      const resourceIds = Array.from(new Set(planStops.map((s) => s.resource_id))).sort();
      if (resourceIds.length > 0) {
        const resResult = await client.query<{
          id: string;
          status: string;
          source: string;
          lat: number | null;
          lng: number | null;
        }>(
          'SELECT id, status, source, ST_Y(location::geometry) as lat, ST_X(location::geometry) as lng FROM resources WHERE id = ANY($1::text[]) ORDER BY id COLLATE "C" ASC FOR UPDATE;',
          [resourceIds],
        );
        const lockedResources = new Map(resResult.rows.map((r) => [r.id, r]));

        for (const resId of resourceIds) {
          const resRow = lockedResources.get(resId);
          if (!resRow) {
            const err = new Error(`Resource "${resId}" referenced in assignment does not exist`);
            (err as unknown as { code: string; statusCode: number }).code = 'RESOURCE_NOT_FOUND';
            (err as unknown as { code: string; statusCode: number }).statusCode = 409;
            throw err;
          }

          if (resRow.source === 'SIMULATED') {
            const err = new Error(
              `Cannot commit assignment plan containing simulated resource "${resId}" in operational dispatch mode`,
            );
            (err as unknown as { code: string; statusCode: number }).code =
              'SIMULATED_RESOURCE_FORBIDDEN';
            (err as unknown as { code: string; statusCode: number }).statusCode = 409;
            throw err;
          }

          if (resRow.status === 'OFFLINE' || resRow.status === 'MAINTENANCE') {
            const err = new Error(
              `Resource "${resId}" is unavailable for commitment (current status: ${resRow.status})`,
            );
            (err as unknown as { code: string; statusCode: number }).code = 'RESOURCE_UNAVAILABLE';
            (err as unknown as { code: string; statusCode: number }).statusCode = 409;
            throw err;
          }

          if (resRow.lat !== null && resRow.lng !== null) {
            serviceAreaEntitiesToCheck.push({
              entityType: 'resource',
              id: resId,
              lat: Number(resRow.lat),
              lng: Number(resRow.lng),
            });
          }
        }

        // Recheck resource conflicts after acquiring locks:
        // No resource in the plan may already have stops in another COMMITTED or DISPATCHED assignment
        // unless this plan was built incorporating those frozen stops.
        const otherStopsResult = await client.query<{
          id: string;
          resource_id: string;
          type: string;
          target_id: string;
          stop_number: number;
          is_frozen: boolean;
          assignment_status: string;
          other_assignment_id: string;
        }>(
          `SELECT s.id, s.resource_id, s.type, s.target_id, s.stop_number, s.is_frozen,
                  a.status as assignment_status, a.id as other_assignment_id
           FROM assignment_stops s
           JOIN assignments a ON s.assignment_id = a.id
           WHERE a.status IN ('COMMITTED', 'DISPATCHED')
             AND a.id != $1
             AND s.resource_id = ANY($2::text[])
           ORDER BY s.resource_id ASC, s.stop_number ASC;`,
          [assignmentId, resourceIds],
        );

        const otherStopsByRes = new Map<string, typeof otherStopsResult.rows>();
        for (const stop of otherStopsResult.rows) {
          if (!otherStopsByRes.has(stop.resource_id)) {
            otherStopsByRes.set(stop.resource_id, []);
          }
          otherStopsByRes.get(stop.resource_id)!.push(stop);
        }

        for (const resId of resourceIds) {
          const thisResFrozenStops = planStops.filter(
            (s) => s.resource_id === resId && Boolean(s.is_frozen),
          );
          const otherStops = otherStopsByRes.get(resId) || [];

          // 1. If this resource has frozen stops but no prior commitment, reject
          if (thisResFrozenStops.length > 0 && otherStops.length === 0) {
            const err = new Error(
              `Resource "${resId}" has frozen stops in proposed plan but has no prior committed assignment lineage`,
            );
            (err as unknown as { code: string; statusCode: number }).code =
              'RESOURCE_ALREADY_COMMITTED';
            (err as unknown as { code: string; statusCode: number }).statusCode = 409;
            throw err;
          }

          // 2. Every prior committed stop for this resource must be preserved in this plan
          for (const otherStop of otherStops) {
            const matched = thisResFrozenStops.some(
              (s) => s.type === otherStop.type && s.target_id === otherStop.target_id,
            );
            if (!matched) {
              const err = new Error(
                `Resource "${resId}" has active stops in another committed/dispatched assignment "${otherStop.other_assignment_id}" that were not incorporated as frozen stops in this plan`,
              );
              (err as unknown as { code: string; statusCode: number }).code =
                'RESOURCE_ALREADY_COMMITTED';
              (err as unknown as { code: string; statusCode: number }).statusCode = 409;
              throw err;
            }
          }

          // 3. Every frozen stop in this plan (PICKUP and DROPOFF) must match a prior committed stop for this resource
          for (const frozenStop of thisResFrozenStops) {
            const matched = otherStops.some(
              (other) => other.type === frozenStop.type && other.target_id === frozenStop.target_id,
            );
            if (!matched) {
              const err = new Error(
                `Frozen ${frozenStop.type} stop with target "${frozenStop.target_id}" does not belong to resource "${resId}"'s prior committed assignment lineage`,
              );
              (err as unknown as { code: string; statusCode: number }).code =
                'RESOURCE_ALREADY_COMMITTED';
              (err as unknown as { code: string; statusCode: number }).statusCode = 409;
              throw err;
            }
          }
        }
      }

      // 5. Lock and validate all referenced destination shelter rows in deterministic order
      const dropoffStops = planStops.filter((s) => s.type === 'DROPOFF' && s.target_id);
      const shelterIds = Array.from(new Set(dropoffStops.map((s) => s.target_id))).sort();
      const dropoffPassengersByShelter = new Map<string, number>();
      for (const stop of dropoffStops) {
        const count = Number(stop.passengers_dropped_off || 0);
        dropoffPassengersByShelter.set(
          stop.target_id,
          (dropoffPassengersByShelter.get(stop.target_id) || 0) + count,
        );
      }

      if (shelterIds.length > 0) {
        const shelterResult = await client.query<{
          id: string;
          name: string;
          capacity: number;
          current_occupancy: number;
          is_active: boolean;
          source: string;
          lat: number | null;
          lng: number | null;
        }>(
          'SELECT id, name, capacity, current_occupancy, is_active, source, ST_Y(location::geometry) as lat, ST_X(location::geometry) as lng FROM shelters WHERE id = ANY($1::text[]) ORDER BY id COLLATE "C" ASC FOR UPDATE;',
          [shelterIds],
        );
        const lockedShelters = new Map(shelterResult.rows.map((s) => [s.id, s]));

        for (const shId of shelterIds) {
          const shRow = lockedShelters.get(shId);
          if (!shRow) {
            const err = new Error(
              `Shelter "${shId}" referenced in assignment dropoff stop does not exist`,
            );
            (err as unknown as { code: string; statusCode: number }).code = 'SHELTER_NOT_FOUND';
            (err as unknown as { code: string; statusCode: number }).statusCode = 409;
            throw err;
          }

          if (shRow.source === 'SIMULATED') {
            const err = new Error(
              `Cannot commit assignment plan containing simulated destination shelter "${shId}" in operational dispatch mode`,
            );
            (err as unknown as { code: string; statusCode: number }).code =
              'SIMULATED_SHELTER_FORBIDDEN';
            (err as unknown as { code: string; statusCode: number }).statusCode = 409;
            throw err;
          }

          if (!shRow.is_active) {
            const err = new Error(`Shelter "${shId}" is inactive and cannot accept evacuees`);
            (err as unknown as { code: string; statusCode: number }).code = 'SHELTER_UNAVAILABLE';
            (err as unknown as { code: string; statusCode: number }).statusCode = 409;
            throw err;
          }

          const incoming = dropoffPassengersByShelter.get(shId) || 0;
          const currentOcc = Number(shRow.current_occupancy || 0);
          const capacity = Number(shRow.capacity ?? 0);
          if (capacity > 0 && currentOcc + incoming > capacity) {
            const err = new Error(
              `Shelter "${shId}" capacity exceeded: capacity is ${capacity}, current occupancy is ${currentOcc}, incoming evacuees are ${incoming}`,
            );
            (err as unknown as { code: string; statusCode: number }).code =
              'SHELTER_CAPACITY_EXCEEDED';
            (err as unknown as { code: string; statusCode: number }).statusCode = 409;
            throw err;
          }

          if (shRow.lat !== null && shRow.lng !== null) {
            serviceAreaEntitiesToCheck.push({
              entityType: 'shelter',
              id: shId,
              lat: Number(shRow.lat),
              lng: Number(shRow.lng),
            });
          }
        }
      }

      // 5b. Defense-in-depth read-only service-area check (does NOT lock service_areas)
      for (const entity of serviceAreaEntitiesToCheck) {
        if (!Number.isFinite(entity.lat) || !Number.isFinite(entity.lng)) {
          continue;
        }
        const coverageRes = await client.query<{
          region_id?: string;
          regionId?: string;
          is_valid?: boolean;
          isValid?: boolean;
          srid?: number | string;
          is_covered?: boolean;
          isCovered?: boolean;
        }>(
          `SELECT
             region_id,
             ST_IsValid(geometry) as is_valid,
             ST_SRID(geometry) as srid,
             ST_Covers(geometry, ST_SetSRID(ST_MakePoint($1, $2), 4326)) as is_covered
           FROM service_areas
           WHERE is_active = TRUE
           ORDER BY region_id ASC
           LIMIT 1;`,
          [entity.lng, entity.lat],
        );
        const saRow = coverageRes.rows[0];
        const isValid = Boolean(saRow?.is_valid ?? saRow?.isValid);
        const isCovered = Boolean(saRow?.is_covered ?? saRow?.isCovered);
        const srid = Number(saRow?.srid);
        if (!saRow || !isValid || srid !== 4326) {
          const err = new Error(
            'Unable to verify Delhi NCR service-area eligibility for assignment commitment right now. Please try again shortly.',
          );
          (err as unknown as { code: string; statusCode: number }).code =
            'SERVICE_AREA_UNAVAILABLE';
          (err as unknown as { code: string; statusCode: number }).statusCode = 503;
          throw err;
        }
        if (!isCovered) {
          const err = new Error(
            `Cannot commit operational assignment referencing ${entity.entityType} "${entity.id}" outside the supported Delhi NCR service area.`,
          );
          (err as unknown as { code: string; statusCode: number }).code = 'OUTSIDE_SERVICE_AREA';
          (err as unknown as { code: string; statusCode: number }).statusCode = 422;
          throw err;
        }
      }

      // 6. Update assignment status to COMMITTED
      const updateAssignResult = await client.query(
        `UPDATE assignments
         SET status = 'COMMITTED',
             committed_at = NOW(),
             committed_by = $2,
             updated_at = NOW()
         WHERE id = $1 AND status = 'PROPOSED';`,
        [assignmentId, operatorId],
      );
      if ((updateAssignResult.rowCount ?? 0) === 0) {
        const err = new Error(`Failed to commit assignment "${assignmentId}"`);
        (err as unknown as { code: string; statusCode: number }).code = 'ALREADY_COMMITTED';
        (err as unknown as { code: string; statusCode: number }).statusCode = 409;
        throw err;
      }

      // 6. Freeze all route stops in the committed plan
      await client.query('UPDATE assignment_stops SET is_frozen = TRUE WHERE assignment_id = $1;', [
        assignmentId,
      ]);

      // 7. Update all served requests to ASSIGNED status
      if (pickupTargetIds.length > 0) {
        await client.query(
          "UPDATE requests SET status = 'ASSIGNED', updated_at = NOW() WHERE id = ANY($1::text[]);",
          [pickupTargetIds],
        );
      }

      // 8. Insert ASSIGNMENT_COMMITTED audit event
      await client.query(
        `INSERT INTO audit_events (
           entity_type, entity_id, event_type, actor, payload, created_at
         ) VALUES (
           'ASSIGNMENT', $1, 'ASSIGNMENT_COMMITTED', $2, $3, NOW()
         );`,
        [
          assignmentId,
          operatorId,
          JSON.stringify({ assignmentId, committedAt: new Date().toISOString() }),
        ],
      );

      // 9. Insert OPERATOR_NOTE_ADDED audit event if operator notes were provided
      if (notes) {
        await client.query(
          `INSERT INTO audit_events (
             entity_type, entity_id, event_type, actor, payload, created_at
           ) VALUES (
             'ASSIGNMENT', $1, 'OPERATOR_NOTE_ADDED', $2, $3, NOW()
           );`,
          [assignmentId, operatorId, JSON.stringify({ notes })],
        );
      }

      await client.query('COMMIT');
      return true;
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // ignore rollback error
      }
      throw err;
    } finally {
      if (poolClient) {
        poolClient.release();
      }
    }
  }

  async listAssignments(filter?: {
    status?: 'PROPOSED' | 'COMMITTED';
    scenarioId?: string;
    limit?: number;
    offset?: number;
  }): Promise<DbAssignment[]> {
    const conditions: string[] = [];
    const values: unknown[] = [];

    if (filter?.status) {
      values.push(filter.status);
      conditions.push(`status = $${values.length}`);
    }
    if (filter?.scenarioId) {
      values.push(filter.scenarioId);
      conditions.push(`scenario_id = $${values.length}`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    let limitClause = '';
    if (filter?.limit !== undefined) {
      const limit = Math.max(1, Math.min(Math.floor(filter.limit), MAX_QUERY_LIMIT));
      values.push(limit);
      limitClause = `LIMIT $${values.length}`;
    }

    let offsetClause = '';
    if (filter?.offset !== undefined) {
      if (
        !Number.isFinite(filter.offset) ||
        filter.offset < 0 ||
        filter.offset > MAX_QUERY_OFFSET
      ) {
        throw new Error(
          `Invalid query offset: must be a finite integer between 0 and ${MAX_QUERY_OFFSET} (received: ${filter.offset})`,
        );
      }
      values.push(Math.floor(filter.offset));
      offsetClause = `OFFSET $${values.length}`;
    }

    const sql = `
      SELECT
        id, scenario_id, status, metrics, unserved, committed_at, committed_by, created_at, updated_at
      FROM assignments
      ${whereClause}
      ORDER BY created_at DESC
      ${limitClause} ${offsetClause};
    `;

    const result = await this.client.query(sql, values);
    return result.rows.map((row) => ({
      id: row.id,
      scenario_id: row.scenario_id,
      status: row.status,
      metrics: typeof row.metrics === 'string' ? JSON.parse(row.metrics) : row.metrics,
      unserved: typeof row.unserved === 'string' ? JSON.parse(row.unserved) : row.unserved,
      committed_at: row.committed_at,
      committed_by: row.committed_by,
      created_at: row.created_at,
      updated_at: row.updated_at,
    }));
  }

  /**
   * Retrieves all frozen stops across all committed assignments with parsed nonzero coordinates.
   * Scoped SQL join guarantees complete safety snapshot without arbitrary pagination limits.
   */
  async listCommittedFrozenStops(): Promise<FrozenStopReference[]> {
    const sql = `
      SELECT
        s.assignment_id as "assignmentId",
        s.resource_id as "resourceId",
        s.stop_number as "stopNumber",
        s.type as "type",
        s.target_id as "targetId",
        ST_Y(s.location::geometry) as lat,
        ST_X(s.location::geometry) as lng
      FROM assignment_stops s
      JOIN assignments a ON s.assignment_id = a.id
      WHERE a.status = 'COMMITTED' AND s.is_frozen = TRUE
      ORDER BY s.assignment_id ASC, s.resource_id ASC, s.stop_number ASC;
    `;
    const result = await this.client.query(sql);
    return result.rows.map((row) => ({
      assignmentId: row.assignmentId,
      resourceId: row.resourceId,
      stopNumber: row.stopNumber,
      targetId: row.targetId,
      type: row.type,
      lat: Number(row.lat),
      lng: Number(row.lng),
    }));
  }

  async getLatestCommittedAssignment(
    scenarioId?: string,
  ): Promise<{ assignment: DbAssignment; stops: DbAssignmentStop[] } | null> {
    const conditions = ["status = 'COMMITTED'"];
    const values: unknown[] = [];
    if (scenarioId) {
      values.push(scenarioId);
      conditions.push(`scenario_id = $${values.length}`);
    }

    const sql = `
      SELECT id
      FROM assignments
      WHERE ${conditions.join(' AND ')}
      ORDER BY committed_at DESC NULLS LAST, created_at DESC
      LIMIT 1;
    `;
    const result = await this.client.query(sql, values);
    const row = result.rows[0];
    if (!row) return null;

    return this.getAssignmentWithStops(row.id);
  }

  async updateAssignmentStop(
    assignmentId: string,
    stopId: string,
    updates: {
      is_frozen?: boolean;
      stop_number?: number;
      resource_id?: string;
    },
  ): Promise<DbAssignmentStop | null> {
    const isPool = this.client instanceof pg.Pool;
    let poolClient: pg.PoolClient | undefined;
    const client: Queryable = isPool
      ? (poolClient = await (this.client as pg.Pool).connect())
      : this.client;

    try {
      await client.query('BEGIN');

      // 1. Lock the assignment row with SELECT ... FOR UPDATE to serialize with commitAssignment
      const assignResult = await client.query<{ id: string; status: string }>(
        'SELECT id, status FROM assignments WHERE id = $1 FOR UPDATE;',
        [assignmentId],
      );
      const assignRow = assignResult.rows[0];
      if (!assignRow) {
        const err = new Error(`Assignment with id "${assignmentId}" not found`);
        (err as unknown as { code: string; statusCode: number }).code = 'NOT_FOUND';
        (err as unknown as { code: string; statusCode: number }).statusCode = 404;
        throw err;
      }

      if (assignRow.status !== 'PROPOSED') {
        const err = new Error(
          `Cannot modify stops on assignment "${assignmentId}" because status is "${assignRow.status}". Only PROPOSED plans can be modified.`,
        );
        (err as unknown as { code: string; statusCode: number }).code = 'CANNOT_MODIFY_COMMITTED';
        (err as unknown as { code: string; statusCode: number }).statusCode = 409;
        throw err;
      }

      const sets: string[] = [];
      const values: unknown[] = [assignmentId, stopId];

      if (updates.is_frozen !== undefined) {
        values.push(updates.is_frozen);
        sets.push(`is_frozen = $${values.length}`);
      }
      if (updates.stop_number !== undefined) {
        values.push(updates.stop_number);
        sets.push(`stop_number = $${values.length}`);
      }
      if (updates.resource_id !== undefined) {
        values.push(updates.resource_id);
        sets.push(`resource_id = $${values.length}`);
      }

      if (sets.length === 0) {
        const fetchSql = `
          SELECT
            id, assignment_id, resource_id, stop_number, type, target_id,
            ST_AsText(location) as location,
            passengers_picked_up, passengers_dropped_off,
            estimated_arrival_minutes, is_frozen, created_at
          FROM assignment_stops
          WHERE assignment_id = $1 AND id = $2;
        `;
        const fetchResult = await client.query<DbAssignmentStop>(fetchSql, [assignmentId, stopId]);
        await client.query('COMMIT');
        return fetchResult.rows[0] ?? null;
      }

      const sql = `
        UPDATE assignment_stops
        SET ${sets.join(', ')}
        WHERE assignment_id = $1 AND id = $2
        RETURNING
          id, assignment_id, resource_id, stop_number, type, target_id,
          ST_AsText(location) as location,
          passengers_picked_up, passengers_dropped_off,
          estimated_arrival_minutes, is_frozen, created_at;
      `;

      const result = await client.query<DbAssignmentStop>(sql, values);
      const updated = result.rows[0] ?? null;

      if (!updated) {
        const err = new Error(`Stop "${stopId}" not found on assignment "${assignmentId}"`);
        (err as unknown as { code: string; statusCode: number }).code = 'NOT_FOUND';
        (err as unknown as { code: string; statusCode: number }).statusCode = 404;
        throw err;
      }

      await client.query('COMMIT');
      return updated;
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // ignore rollback error
      }
      throw err;
    } finally {
      if (poolClient) {
        poolClient.release();
      }
    }
  }

  // ==========================================
  // Audit Events
  // ==========================================

  async insertAuditEvent(event: {
    entityType: string;
    entityId: string;
    eventType: string;
    actor?: string;
    payload?: Record<string, unknown>;
  }): Promise<void> {
    const sql = `
      INSERT INTO audit_events (
        entity_type, entity_id, event_type, actor, payload, created_at
      ) VALUES (
        $1, $2, $3, $4, $5, NOW()
      );
    `;
    await this.client.query(sql, [
      event.entityType,
      event.entityId,
      event.eventType,
      event.actor ?? 'SYSTEM',
      JSON.stringify(event.payload ?? {}),
    ]);
  }

  async listAuditEvents(filter?: ListAuditEventsFilter): Promise<DbAuditEvent[]> {
    const conditions: string[] = [];
    const values: unknown[] = [];

    if (filter?.entityType) {
      values.push(filter.entityType);
      conditions.push(`entity_type = $${values.length}`);
    }
    if (filter?.entityId) {
      values.push(filter.entityId);
      conditions.push(`entity_id = $${values.length}`);
    }
    if (filter?.eventType) {
      values.push(filter.eventType);
      conditions.push(`event_type = $${values.length}`);
    }
    if (filter?.actor) {
      values.push(filter.actor);
      conditions.push(`actor = $${values.length}`);
    }
    if (filter?.since) {
      values.push(filter.since);
      conditions.push(`created_at >= $${values.length}`);
    }
    if (filter?.until) {
      values.push(filter.until);
      conditions.push(`created_at <= $${values.length}`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = Math.min(Math.max(filter?.limit ?? 50, 1), MAX_QUERY_LIMIT);
    const offset = Math.min(Math.max(filter?.offset ?? 0, 0), MAX_QUERY_OFFSET);

    values.push(limit);
    const limitPlaceholder = `$${values.length}`;
    values.push(offset);
    const offsetPlaceholder = `$${values.length}`;

    const sql = `
      SELECT id::text, entity_type, entity_id, event_type, actor, payload, created_at
      FROM audit_events
      ${whereClause}
      ORDER BY id DESC
      LIMIT ${limitPlaceholder} OFFSET ${offsetPlaceholder};
    `;

    const result = await this.client.query<DbAuditEvent>(sql, values);
    return result.rows;
  }

  // ==========================================
  // Operational Events Data Access
  // ==========================================

  async insertOperationalEvent(
    event: Omit<OperationalEvent, 'recordedAt'> & { recordedAt?: string },
  ): Promise<DbOperationalEvent> {
    const sql = `
      INSERT INTO operational_events (
        id, event_type, entity_type, entity_id, actor_id, actor_type,
        payload, correlation_id, idempotency_key, entity_version,
        processing_status, processing_attempts, last_error_code,
        occurred_at, created_at, processed_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6,
        $7, $8, $9, $10,
        $11, $12, $13,
        $14, NOW(), $15
      )
      RETURNING
        id, event_type, entity_type, entity_id, actor_id, actor_type,
        payload, correlation_id, idempotency_key, entity_version,
        processing_status, processing_attempts, last_error_code,
        occurred_at, created_at, processed_at;
    `;

    const occurredAt = event.occurredAt ? new Date(event.occurredAt) : new Date();
    const processedAt = event.processedAt ? new Date(event.processedAt) : null;

    const result = await this.client.query<DbOperationalEvent>(sql, [
      event.id,
      event.type,
      event.entityType,
      event.entityId,
      event.actorId ?? null,
      event.actorType,
      JSON.stringify(event.payload ?? {}),
      event.correlationId ?? null,
      event.idempotencyKey ?? null,
      event.entityVersion ?? 1,
      event.processingStatus ?? 'RECORDED',
      event.processingAttempts ?? 0,
      event.lastErrorCode ?? null,
      occurredAt,
      processedAt,
    ]);

    const row = result.rows[0];
    if (!row) {
      throw new Error(`Failed to insert operational event "${event.id}"`);
    }
    return row;
  }

  async getOperationalEvent(id: string): Promise<DbOperationalEvent | null> {
    const sql = `
      SELECT
        id, event_type, entity_type, entity_id, actor_id, actor_type,
        payload, correlation_id, idempotency_key, entity_version,
        processing_status, processing_attempts, last_error_code,
        occurred_at, created_at, processed_at
      FROM operational_events
      WHERE id = $1;
    `;
    const res = await this.client.query<DbOperationalEvent>(sql, [id]);
    return res.rows[0] ?? null;
  }

  async getOperationalEventByIdempotencyKey(key: string): Promise<DbOperationalEvent | null> {
    const sql = `
      SELECT
        id, event_type, entity_type, entity_id, actor_id, actor_type,
        payload, correlation_id, idempotency_key, entity_version,
        processing_status, processing_attempts, last_error_code,
        occurred_at, created_at, processed_at
      FROM operational_events
      WHERE idempotency_key = $1;
    `;
    const res = await this.client.query<DbOperationalEvent>(sql, [key]);
    return res.rows[0] ?? null;
  }

  async listOperationalEvents(filter?: ListOperationalEventsFilter): Promise<DbOperationalEvent[]> {
    const conditions: string[] = [];
    const values: unknown[] = [];

    if (filter?.eventType) {
      values.push(filter.eventType);
      conditions.push(`event_type = $${values.length}`);
    }
    if (filter?.entityType) {
      values.push(filter.entityType);
      conditions.push(`entity_type = $${values.length}`);
    }
    if (filter?.entityId) {
      values.push(filter.entityId);
      conditions.push(`entity_id = $${values.length}`);
    }
    if (filter?.actorType) {
      values.push(filter.actorType);
      conditions.push(`actor_type = $${values.length}`);
    }
    if (filter?.actorId) {
      values.push(filter.actorId);
      conditions.push(`actor_id = $${values.length}`);
    }
    if (filter?.processingStatus) {
      values.push(filter.processingStatus);
      conditions.push(`processing_status = $${values.length}`);
    }
    if (filter?.since) {
      values.push(filter.since);
      conditions.push(`occurred_at >= $${values.length}`);
    }
    if (filter?.until) {
      values.push(filter.until);
      conditions.push(`occurred_at <= $${values.length}`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = Math.min(Math.max(filter?.limit ?? 50, 1), MAX_QUERY_LIMIT);
    const offset = Math.min(Math.max(filter?.offset ?? 0, 0), MAX_QUERY_OFFSET);

    values.push(limit);
    const limitPlaceholder = `$${values.length}`;
    values.push(offset);
    const offsetPlaceholder = `$${values.length}`;

    const sql = `
      SELECT
        id, event_type, entity_type, entity_id, actor_id, actor_type,
        payload, correlation_id, idempotency_key, entity_version,
        processing_status, processing_attempts, last_error_code,
        occurred_at, created_at, processed_at
      FROM operational_events
      ${whereClause}
      ORDER BY occurred_at DESC, created_at DESC
      LIMIT ${limitPlaceholder} OFFSET ${offsetPlaceholder};
    `;

    const result = await this.client.query<DbOperationalEvent>(sql, values);
    return result.rows;
  }

  async updateOperationalEventStatus(
    id: string,
    status: EventProcessingStatus,
    details?: { attempts?: number; lastErrorCode?: string | null; processedAt?: Date | null },
  ): Promise<boolean> {
    const sets: string[] = ['processing_status = $2'];
    const values: unknown[] = [id, status];

    if (details?.attempts !== undefined) {
      values.push(details.attempts);
      sets.push(`processing_attempts = $${values.length}`);
    }
    if (details?.lastErrorCode !== undefined) {
      values.push(details.lastErrorCode);
      sets.push(`last_error_code = $${values.length}`);
    }
    if (details?.processedAt !== undefined) {
      values.push(details.processedAt);
      sets.push(`processed_at = $${values.length}`);
    } else if (status === 'SCOPE_IDENTIFIED' || status === 'AWAITING_REPAIR') {
      sets.push('processed_at = NOW()');
    }

    const sql = `
      UPDATE operational_events
      SET ${sets.join(', ')}
      WHERE id = $1;
    `;
    const result = await this.client.query(sql, values);
    return (result.rowCount ?? 0) > 0;
  }

  // ==========================================
  // Blocked Zones Data Access
  // ==========================================

  async insertBlockedZone(input: BlockedZoneCreateInput): Promise<DbBlockedZone> {
    const id = input.id ?? `bz-${crypto.randomUUID().slice(0, 8)}`;
    const polygonWkt = toPolygonWkt(input.polygon);
    const sql = `
      INSERT INTO blocked_zones (
        id, name, severity, geometry, is_active, created_by, created_at, updated_at
      ) VALUES (
        $1, $2, $3, ST_GeogFromText($4), TRUE, $5, NOW(), NOW()
      )
      RETURNING
        id, name, severity, ST_AsText(geometry) as geometry, is_active, created_by, created_at, updated_at;
    `;
    const res = await this.client.query<DbBlockedZone>(sql, [
      id,
      input.name ?? null,
      input.severity ?? 'BLOCKED',
      polygonWkt,
      input.createdBy,
    ]);
    const row = res.rows[0];
    if (!row) throw new Error(`Failed to insert blocked zone "${id}"`);
    return row;
  }

  async getBlockedZone(id: string): Promise<DbBlockedZone | null> {
    const sql = `
      SELECT
        id, name, severity, ST_AsText(geometry) as geometry, is_active, created_by, created_at, updated_at
      FROM blocked_zones
      WHERE id = $1;
    `;
    const res = await this.client.query<DbBlockedZone>(sql, [id]);
    return res.rows[0] ?? null;
  }

  async listBlockedZones(activeOnly = true): Promise<DbBlockedZone[]> {
    const whereClause = activeOnly ? 'WHERE is_active = TRUE' : '';
    const sql = `
      SELECT
        id, name, severity, ST_AsText(geometry) as geometry, is_active, created_by, created_at, updated_at
      FROM blocked_zones
      ${whereClause}
      ORDER BY created_at DESC;
    `;
    const res = await this.client.query<DbBlockedZone>(sql);
    return res.rows;
  }

  async updateBlockedZoneStatus(id: string, isActive: boolean): Promise<boolean> {
    const sql = `
      UPDATE blocked_zones
      SET is_active = $2, updated_at = NOW()
      WHERE id = $1;
    `;
    const res = await this.client.query(sql, [id, isActive]);
    return (res.rowCount ?? 0) > 0;
  }

  // ==========================================
  // Scenario Loading
  // ==========================================

  async loadScenario(scenario: Scenario): Promise<{
    scenarioId: string;
    requestsCount: number;
    resourcesCount: number;
    sheltersCount: number;
    isSimulated: boolean;
  }> {
    const validation = validateScenario(scenario);
    if (!validation.valid) {
      throw new Error(`Scenario validation failed: ${validation.errors.join('; ')}`);
    }

    // Determine simulation provenance
    const isSimulated = Boolean(
      scenario.simulated ||
      scenario.metadata?.simulated ||
      scenario.requests.some((r) => r.source === 'SIMULATED'),
    );

    const sourceLabel: RequestSource = isSimulated ? 'SIMULATED' : 'REPORTED';
    const resourceSource: 'SIMULATED' | 'REAL' = isSimulated ? 'SIMULATED' : 'REAL';

    let requestsCount = 0;
    for (const req of scenario.requests) {
      await this.insertRequest({
        ...req,
        source: sourceLabel, // Enforce SIMULATED label for all synthetic scenario requests
      });
      requestsCount++;
    }

    let resourcesCount = 0;
    for (const res of scenario.resources) {
      await this.insertResource(res, resourceSource);
      resourcesCount++;
    }

    let sheltersCount = 0;
    for (const sh of scenario.shelters) {
      await this.insertShelter(sh, resourceSource);
      sheltersCount++;
    }

    await this.insertAuditEvent({
      entityType: 'SCENARIO',
      entityId: scenario.id,
      eventType: 'SCENARIO_LOADED',
      actor: 'SYSTEM',
      payload: {
        scenarioId: scenario.id,
        name: scenario.metadata.name,
        requestsCount,
        resourcesCount,
        sheltersCount,
        isSimulated,
      },
    });

    return {
      scenarioId: scenario.id,
      requestsCount,
      resourcesCount,
      sheltersCount,
      isSimulated,
    };
  }

  // ==========================================
  // Operator Authentication & Sessions
  // ==========================================

  async getOperatorByUsername(username: string): Promise<DbOperator | null> {
    const res = await this.client.query<DbOperator>(
      'SELECT id, username, password_hash, salt, name, role, is_active, created_at, updated_at FROM operators WHERE username = $1',
      [username.trim().toLowerCase()],
    );
    return res.rows[0] ?? null;
  }

  async getOperatorById(id: string): Promise<DbOperator | null> {
    const res = await this.client.query<DbOperator>(
      'SELECT id, username, password_hash, salt, name, role, is_active, created_at, updated_at FROM operators WHERE id = $1',
      [id],
    );
    return res.rows[0] ?? null;
  }

  async insertOperator(
    operator: Omit<DbOperator, 'created_at' | 'updated_at'>,
  ): Promise<DbOperator> {
    const res = await this.client.query<DbOperator>(
      `INSERT INTO operators (
        id, username, password_hash, salt, name, role, is_active, created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, NOW(), NOW()
      ) RETURNING id, username, password_hash, salt, name, role, is_active, created_at, updated_at`,
      [
        operator.id,
        operator.username.trim().toLowerCase(),
        operator.password_hash,
        operator.salt,
        operator.name,
        operator.role || 'OPERATOR',
        operator.is_active ?? true,
      ],
    );
    return res.rows[0]!;
  }

  async updateOperatorPassword(id: string, passwordHash: string, salt: string): Promise<boolean> {
    const res = await this.client.query(
      'UPDATE operators SET password_hash = $1, salt = $2, updated_at = NOW() WHERE id = $3',
      [passwordHash, salt, id],
    );
    return (res.rowCount ?? 0) > 0;
  }

  async insertSession(
    token: string,
    operatorId: string,
    expiresAt: Date,
  ): Promise<DbOperatorSession> {
    const res = await this.client.query<DbOperatorSession>(
      `INSERT INTO operator_sessions (
        token, operator_id, expires_at, created_at
      ) VALUES (
        $1, $2, $3, NOW()
      ) RETURNING token, operator_id, expires_at, created_at`,
      [token, operatorId, expiresAt],
    );
    return res.rows[0]!;
  }

  async getSessionWithOperator(
    token: string,
  ): Promise<{ session: DbOperatorSession; operator: OperatorProfile } | null> {
    const res = await this.client.query<{
      token: string;
      operator_id: string;
      expires_at: Date;
      session_created_at: Date;
      op_id: string;
      username: string;
      name: string;
      role: OperatorRole;
      is_active: boolean;
    }>(
      `SELECT 
        s.token, s.operator_id, s.expires_at, s.created_at AS session_created_at,
        o.id AS op_id, o.username, o.name, o.role, o.is_active
       FROM operator_sessions s
       JOIN operators o ON s.operator_id = o.id
       WHERE s.token = $1 AND s.expires_at > NOW() AND o.is_active = TRUE`,
      [token],
    );

    if (res.rows.length === 0 || !res.rows[0]) {
      return null;
    }

    const r = res.rows[0];
    return {
      session: {
        token: r.token,
        operator_id: r.operator_id,
        expires_at: r.expires_at,
        created_at: r.session_created_at,
      },
      operator: {
        id: r.op_id,
        username: r.username,
        name: r.name,
        role: r.role,
      },
    };
  }

  async deleteSession(token: string): Promise<boolean> {
    const res = await this.client.query('DELETE FROM operator_sessions WHERE token = $1', [token]);
    return (res.rowCount ?? 0) > 0;
  }

  async cleanExpiredSessions(): Promise<number> {
    const res = await this.client.query('DELETE FROM operator_sessions WHERE expires_at <= NOW()');
    return res.rowCount ?? 0;
  }

  async countOperators(): Promise<number> {
    const res = await this.client.query<{ count: string }>(
      'SELECT COUNT(*)::text as count FROM operators',
    );
    return parseInt(res.rows[0]?.count ?? '0', 10);
  }

  /**
   * Evaluates whether a WGS84 point (lng, lat) is covered by any active service-area boundary
   * using PostGIS ST_Covers (boundary-inclusive containment) and validates geometry integrity.
   */
  async checkServiceAreaCoverage(lat: number, lng: number): Promise<ServiceAreaCoverageRow[]> {
    const sql = `
      SELECT
        region_id,
        region_name,
        boundary_version,
        dataset_sha256,
        ST_IsValid(geometry) AS is_valid,
        ST_SRID(geometry) AS srid,
        MD5(ST_AsBinary(geometry)) AS geometry_wkb_hash,
        ST_Covers(geometry, ST_SetSRID(ST_MakePoint($1, $2), 4326)) AS is_covered,
        ST_Distance(geometry::geography, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography) AS distance_meters
      FROM service_areas
      WHERE is_active = TRUE;
    `;
    const res = await this.client.query<ServiceAreaCoverageRow>(sql, [lng, lat]);
    return res.rows;
  }

  /**
   * Performs topological attestation of active database service area boundary geometry
   * against the canonical GeoJSON geometry (dissolved constituent polygons) using PostGIS ST_Equals.
   */
  async attestServiceAreaBoundary(
    canonicalGeometriesJson: string,
  ): Promise<ServiceAreaAttestationRow[]> {
    const sql = `
      WITH canonical AS (
        SELECT ST_Multi(
          ST_MakeValid(
            ST_UnaryUnion(
              ST_Collect(
                ST_SetSRID(ST_GeomFromGeoJSON(elem::text), 4326)
              )
            )
          )
        ) AS canonical_geom
        FROM jsonb_array_elements($1::jsonb) AS elem
      )
      SELECT
        sa.region_id,
        sa.region_name,
        sa.boundary_version,
        sa.dataset_sha256,
        ST_IsValid(sa.geometry) AS is_valid,
        ST_SRID(sa.geometry) AS srid,
        ST_NPoints(sa.geometry) AS point_count,
        (ST_Area(sa.geometry::geography) / 1000000.0) AS area_sq_km,
        MD5(ST_AsBinary(sa.geometry)) AS geometry_wkb_hash,
        ST_Equals(sa.geometry, c.canonical_geom) AS is_topologically_equal,
        (ST_Covers(sa.geometry, c.canonical_geom) AND ST_Covers(c.canonical_geom, sa.geometry)) AS is_mutually_covered
      FROM service_areas sa
      CROSS JOIN canonical c
      WHERE sa.is_active = TRUE;
    `;
    const res = await this.client.query<ServiceAreaAttestationRow>(sql, [canonicalGeometriesJson]);
    return res.rows;
  }
}
