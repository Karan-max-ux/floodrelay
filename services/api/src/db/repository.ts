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
} from '@floodrelay/shared';
import {
  type DbRequest,
  type DbResource,
  type DbShelter,
  type DbAssignment,
  type DbAssignmentStop,
  type VerificationStatus,
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

export class PostgisRepository {
  constructor(private readonly client: Queryable) {}

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
      }>(
        `SELECT id, resource_id, type, target_id, stop_number, is_frozen
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

      if (pickupTargetIds.length > 0) {
        const reqResult = await client.query<{ id: string; status: string }>(
          'SELECT id, status FROM requests WHERE id = ANY($1::text[]) ORDER BY id COLLATE "C" ASC FOR UPDATE;',
          [pickupTargetIds],
        );
        const lockedRequests = new Map(reqResult.rows.map((r) => [r.id, r.status]));

        for (const stop of planStops) {
          if (stop.type === 'PICKUP' && stop.target_id) {
            const reqId = stop.target_id;
            const reqStatus = lockedRequests.get(reqId);
            if (!reqStatus) {
              const err = new Error(`Request "${reqId}" referenced in pickup stop does not exist`);
              (err as unknown as { code: string; statusCode: number }).code = 'REQUEST_NOT_FOUND';
              (err as unknown as { code: string; statusCode: number }).statusCode = 409;
              throw err;
            }

            if (stop.is_frozen) {
              if (reqStatus !== 'ASSIGNED') {
                const err = new Error(
                  `Request "${reqId}" in frozen stop is in invalid status: ${reqStatus} (must be ASSIGNED)`,
                );
                (err as unknown as { code: string; statusCode: number }).code =
                  'REQUEST_ALREADY_ASSIGNED';
                (err as unknown as { code: string; statusCode: number }).statusCode = 409;
                throw err;
              }
            } else {
              if (reqStatus !== 'PENDING') {
                const err = new Error(
                  `Request "${reqId}" is no longer in PENDING status (current status: ${reqStatus})`,
                );
                (err as unknown as { code: string; statusCode: number }).code =
                  'REQUEST_ALREADY_ASSIGNED';
                (err as unknown as { code: string; statusCode: number }).statusCode = 409;
                throw err;
              }
            }
          }
        }
      }

      // 4. Lock all referenced resource rows using PostgreSQL SELECT ... FOR UPDATE in deterministic order
      const resourceIds = Array.from(new Set(planStops.map((s) => s.resource_id))).sort();
      if (resourceIds.length > 0) {
        const resResult = await client.query<{ id: string; status: string }>(
          'SELECT id, status FROM resources WHERE id = ANY($1::text[]) ORDER BY id COLLATE "C" ASC FOR UPDATE;',
          [resourceIds],
        );
        const lockedResources = new Map(resResult.rows.map((r) => [r.id, r.status]));

        for (const resId of resourceIds) {
          if (!lockedResources.has(resId)) {
            const err = new Error(`Resource "${resId}" referenced in assignment does not exist`);
            (err as unknown as { code: string; statusCode: number }).code = 'RESOURCE_NOT_FOUND';
            (err as unknown as { code: string; statusCode: number }).statusCode = 409;
            throw err;
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

        if (otherStopsResult.rows.length > 0) {
          const otherStopsByRes = new Map<string, typeof otherStopsResult.rows>();
          for (const stop of otherStopsResult.rows) {
            if (!otherStopsByRes.has(stop.resource_id)) {
              otherStopsByRes.set(stop.resource_id, []);
            }
            otherStopsByRes.get(stop.resource_id)!.push(stop);
          }

          for (const [resId, otherStops] of otherStopsByRes.entries()) {
            const thisResFrozenStops = planStops.filter(
              (s) => s.resource_id === resId && Boolean(s.is_frozen),
            );
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
          }
        }
      }

      // 5. Update assignment status to COMMITTED
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
    const limit = filter?.limit ?? 50;
    const offset = filter?.offset ?? 0;
    values.push(limit, offset);

    const sql = `
      SELECT
        id, scenario_id, status, metrics, unserved, committed_at, committed_by, created_at, updated_at
      FROM assignments
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT $${values.length - 1} OFFSET $${values.length};
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
      return null;
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

    const result = await this.client.query<DbAssignmentStop>(sql, values);
    return result.rows[0] ?? null;
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
}
