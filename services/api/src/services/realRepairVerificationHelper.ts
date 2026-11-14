import crypto from 'node:crypto';
import pg from 'pg';

export interface VerifiedTestDbInfo {
  databaseName: string;
  serverAddr: string;
  dbUser: string;
}

export const STRICT_ALLOWED_TEST_HOSTS = new Set(['localhost', '127.0.0.1', '::1', 'postgres']);

export const STRICT_ALLOWED_TEST_DB_NAME = 'floodrelay_test';

/**
 * Verifies that the connected PostgreSQL database is a verified disposable test database.
 * Fails closed before any table operations or fixture mutations if the database cannot be
 * verified, lacks the required test identity marker, or does not match strict allowlists.
 */
export async function assertDisposableTestDatabase(pool: pg.Pool): Promise<VerifiedTestDbInfo> {
  // 1. Require explicit authorization flag (CI=true alone does NOT authorize destructive tests)
  const authFlag = process.env.ALLOW_DISPOSABLE_REPAIR_TEST_DB;
  const isAuthorized = authFlag === '1' || authFlag === 'true';

  if (!isAuthorized) {
    throw new Error(
      'UNAUTHORIZED_TEST_EXECUTION: Destructive repair integration suite requires explicit authorization. ' +
        'Set ALLOW_DISPOSABLE_REPAIR_TEST_DB=1 in a dedicated disposable test environment. ' +
        '(CI=true alone does not authorize destructive tests).',
    );
  }

  // 2. Validate host in DATABASE_URL if present against strict allowlist
  if (process.env.DATABASE_URL) {
    try {
      const parsedUrl = new URL(process.env.DATABASE_URL);
      const urlHost = parsedUrl.hostname.trim().toLowerCase();
      if (!STRICT_ALLOWED_TEST_HOSTS.has(urlHost)) {
        throw new Error(
          `UNAPPROVED_TEST_HOST: Host "${urlHost}" in DATABASE_URL is not in the test-only host allowlist. ` +
            `Approved hosts: [${Array.from(STRICT_ALLOWED_TEST_HOSTS).join(', ')}].`,
        );
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.message.startsWith('UNAPPROVED_TEST_HOST')) {
        throw err;
      }
    }
  }

  // 3. Validate host in connection pool options against strict allowlist
  const poolHost = (pool.options.host || '').trim().toLowerCase();
  if (poolHost && !STRICT_ALLOWED_TEST_HOSTS.has(poolHost)) {
    throw new Error(
      `UNAPPROVED_TEST_HOST: Host "${poolHost}" in connection pool options is not in the test-only host allowlist. ` +
        `Approved hosts: [${Array.from(STRICT_ALLOWED_TEST_HOSTS).join(', ')}].`,
    );
  }

  // 4. Connect to database to query runtime server identity
  let client: pg.PoolClient;
  try {
    client = await pool.connect();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`DATABASE_CONNECTION_FAILED: Failed to connect to test database: ${msg}`, {
      cause: err,
    });
  }

  try {
    const res = await client.query<{
      db_name: string;
      db_user: string;
      server_addr: string | null;
    }>(`
      SELECT 
        current_database() AS db_name,
        current_user AS db_user,
        inet_server_addr()::text AS server_addr
    `);

    const firstRow = res.rows[0];
    if (!firstRow) {
      throw new Error(
        'DATABASE_IDENTITY_VERIFICATION_FAILED: Database identity query returned no rows.',
      );
    }

    const dbName = String(firstRow.db_name || '')
      .trim()
      .toLowerCase();
    const dbUser = String(firstRow.db_user || '')
      .trim()
      .toLowerCase();
    const serverAddr = String(firstRow.server_addr || '')
      .trim()
      .toLowerCase();

    // 5. Permit ONLY dedicated disposable test database name (floodrelay_test)
    const allowedDbName = STRICT_ALLOWED_TEST_DB_NAME;

    if (dbName !== allowedDbName) {
      throw new Error(
        `UNAUTHORIZED_DATABASE_NAME: Connected to database "${dbName}", but only dedicated disposable test database "${allowedDbName}" is permitted. ` +
          'Generic development (e.g. "floodrelay"), arbitrary test names, staging, or production databases are strictly prohibited.',
      );
    }

    // 6. Verify dedicated test-database identity marker provisioned during test-environment setup
    try {
      const markerRes = await client.query<{
        marker_key: string;
        marker_value: string;
        is_disposable: boolean;
        database_name?: string;
      }>(`
        SELECT marker_key, marker_value, is_disposable, database_name 
        FROM test_environment_metadata 
        WHERE marker_key = 'DISPOSABLE_TEST_ENVIRONMENT';
      `);

      const markerRow = markerRes.rows[0];
      if (
        !markerRow ||
        markerRow.marker_value !== 'FLOODRELAY_VERIFIED_TEST_DB' ||
        markerRow.is_disposable !== true
      ) {
        throw new Error(
          `INVALID_TEST_DB_MARKER: Database "${dbName}" has an invalid test identity marker in "test_environment_metadata". Expected marker_value "FLOODRELAY_VERIFIED_TEST_DB" and is_disposable=true.`,
        );
      }

      if (markerRow.database_name && markerRow.database_name.toLowerCase() !== dbName) {
        throw new Error(
          `TEST_DB_MARKER_MISMATCH: Marker database_name "${markerRow.database_name}" does not match connected database "${dbName}".`,
        );
      }
    } catch (err: unknown) {
      if (
        err instanceof Error &&
        (err.message.startsWith('INVALID_TEST_DB_MARKER') ||
          err.message.startsWith('TEST_DB_MARKER_MISMATCH'))
      ) {
        throw err;
      }
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(
        `MISSING_TEST_DB_MARKER: Database "${dbName}" is missing the dedicated test-database identity marker table "test_environment_metadata" (${msg}). ` +
          'Run "npm run provision:test-db" during test-environment setup.',
        { cause: err },
      );
    }

    return {
      databaseName: dbName,
      serverAddr: serverAddr || 'local/socket',
      dbUser,
    };
  } finally {
    client.release();
  }
}

/**
 * In-memory tracking registry for fixtures created during a specific test execution.
 * Ensures cleanup deletes ONLY the exact records created by the test run, avoiding broad wildcards.
 */
export class FixtureRegistry {
  public readonly runId: string;
  public readonly operatorUsernames = new Set<string>();
  public readonly operatorSessionTokens = new Set<string>();
  public readonly auditEventIds = new Set<string>();
  public readonly operationalEventIds = new Set<string>();
  public readonly assignmentStopIds = new Set<string>();
  public readonly assignmentIds = new Set<string>();
  public readonly requestIds = new Set<string>();
  public readonly resourceIds = new Set<string>();
  public readonly shelterIds = new Set<string>();
  public readonly blockedZoneIds = new Set<string>();

  private counter = 0;

  constructor(runId?: string) {
    // Generate a compact 8-hex-character runId by default to ensure all compound identifiers fit in VARCHAR(64)
    this.runId = runId || crypto.randomBytes(4).toString('hex');
  }

  /**
   * Generates a collision-resistant identifier prefixed for this test run.
   * Format: <prefix>_<runId>_<counter> (typically < 25 chars).
   */
  public generateId(prefix: string): string {
    this.counter += 1;
    return `${prefix}_${this.runId}_${this.counter.toString(36)}`;
  }

  /**
   * Tracks an assignment (or generated repair proposal) and its associated stops.
   */
  public trackAssignment(assignmentId: string): void {
    if (assignmentId) {
      this.assignmentIds.add(assignmentId);
    }
  }

  /**
   * Deletes all explicitly tracked fixtures in a single transaction in foreign-key safe order.
   * Parameterized queries ensure no unintended rows are ever deleted.
   * Only clears in-memory tracking collections after COMMIT succeeds.
   */
  public async cleanup(pool: pg.Pool): Promise<void> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // 1. Audit events: delete by entity_id matching our tracked entities
      const allEntityIds = [
        ...this.assignmentIds,
        ...this.requestIds,
        ...this.resourceIds,
        ...this.shelterIds,
        ...this.blockedZoneIds,
        ...this.operatorUsernames,
      ];

      if (allEntityIds.length > 0) {
        await client.query(
          `DELETE FROM audit_events 
           WHERE entity_id = ANY($1::text[]);`,
          [allEntityIds],
        );
      }

      // 2. Operational events: delete by tracked event ID or entity_id matching our tracked entities
      if (this.operationalEventIds.size > 0 || allEntityIds.length > 0) {
        await client.query(
          `DELETE FROM operational_events 
           WHERE id = ANY($1::text[]) 
              OR entity_id = ANY($2::text[]);`,
          [Array.from(this.operationalEventIds), allEntityIds],
        );
      }

      // 3. Assignment stops: delete by tracked stop ID, tracked assignment IDs, or tracked resource IDs
      if (
        this.assignmentStopIds.size > 0 ||
        this.assignmentIds.size > 0 ||
        this.resourceIds.size > 0
      ) {
        await client.query(
          `DELETE FROM assignment_stops 
           WHERE id = ANY($1::text[]) 
              OR assignment_id = ANY($2::text[])
              OR resource_id = ANY($3::text[]);`,
          [
            Array.from(this.assignmentStopIds),
            Array.from(this.assignmentIds),
            Array.from(this.resourceIds),
          ],
        );
      }

      // 4. Assignments (both baseline and proposal assignments)
      if (this.assignmentIds.size > 0) {
        await client.query(
          `DELETE FROM assignments 
           WHERE id = ANY($1::text[]);`,
          [Array.from(this.assignmentIds)],
        );
      }

      // 5. Requests
      if (this.requestIds.size > 0) {
        await client.query(
          `DELETE FROM requests 
           WHERE id = ANY($1::text[]);`,
          [Array.from(this.requestIds)],
        );
      }

      // 6. Blocked zones
      if (this.blockedZoneIds.size > 0) {
        await client.query(
          `DELETE FROM blocked_zones 
           WHERE id = ANY($1::text[]);`,
          [Array.from(this.blockedZoneIds)],
        );
      }

      // 7. Resources
      if (this.resourceIds.size > 0) {
        await client.query(
          `DELETE FROM resources 
           WHERE id = ANY($1::text[]);`,
          [Array.from(this.resourceIds)],
        );
      }

      // 8. Shelters
      if (this.shelterIds.size > 0) {
        await client.query(
          `DELETE FROM shelters 
           WHERE id = ANY($1::text[]);`,
          [Array.from(this.shelterIds)],
        );
      }

      // 9. Operator sessions
      if (this.operatorSessionTokens.size > 0) {
        await client.query(
          `DELETE FROM operator_sessions 
           WHERE token = ANY($1::text[]);`,
          [Array.from(this.operatorSessionTokens)],
        );
      }

      // 10. Operators
      if (this.operatorUsernames.size > 0) {
        await client.query(
          `DELETE FROM operators 
           WHERE username = ANY($1::text[]);`,
          [Array.from(this.operatorUsernames)],
        );
      }

      await client.query('COMMIT');

      // CRITICAL: Clear in-memory sets ONLY after COMMIT succeeds
      this.auditEventIds.clear();
      this.operationalEventIds.clear();
      this.assignmentStopIds.clear();
      this.assignmentIds.clear();
      this.requestIds.clear();
      this.blockedZoneIds.clear();
      this.resourceIds.clear();
      this.shelterIds.clear();
      this.operatorSessionTokens.clear();
      this.operatorUsernames.clear();
    } catch (err: unknown) {
      await client.query('ROLLBACK').catch(() => {});
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(
        `FIXTURE_CLEANUP_FAILED: Database cleanup transaction failed and was rolled back. Tracked fixtures preserved for retry: ${msg}`,
        { cause: err },
      );
    } finally {
      client.release();
    }
  }
}

export interface AuthoritativeFrozenStopBaseline {
  resourceId: string;
  stopNumber: number;
  type: 'PICKUP' | 'DROPOFF';
  targetId: string;
  lat: number;
  lng: number;
  passengersPickedUp: number;
  passengersDroppedOff: number;
  isFrozen: boolean;
}

export interface PersistedProposalStop {
  id: string;
  assignmentId: string;
  resourceId: string;
  stopNumber: number;
  type: 'PICKUP' | 'DROPOFF';
  targetId: string;
  lat: number;
  lng: number;
  passengersPickedUp: number;
  passengersDroppedOff: number;
  isFrozen: boolean;
}

/**
 * Fetches stops from assignment_stops directly using PostGIS functions to get numeric lat/lng.
 */
export async function fetchAssignmentStopsWithCoordinates(
  pool: pg.Pool,
  assignmentId: string,
): Promise<PersistedProposalStop[]> {
  const res = await pool.query<{
    id: string;
    assignment_id: string;
    resource_id: string;
    stop_number: number;
    type: 'PICKUP' | 'DROPOFF';
    target_id: string;
    lat: number;
    lng: number;
    passengers_picked_up: number;
    passengers_dropped_off: number;
    is_frozen: boolean;
  }>(
    `SELECT 
       id,
       assignment_id,
       resource_id,
       stop_number,
       type,
       target_id,
       ST_Y(location::geometry) AS lat,
       ST_X(location::geometry) AS lng,
       passengers_picked_up,
       passengers_dropped_off,
       is_frozen
     FROM assignment_stops
     WHERE assignment_id = $1
     ORDER BY resource_id ASC, stop_number ASC;`,
    [assignmentId],
  );

  return res.rows.map((r) => ({
    id: r.id,
    assignmentId: r.assignment_id,
    resourceId: r.resource_id,
    stopNumber: Number(r.stop_number),
    type: r.type,
    targetId: r.target_id,
    lat: Number(r.lat),
    lng: Number(r.lng),
    passengersPickedUp: Number(r.passengers_picked_up),
    passengersDroppedOff: Number(r.passengers_dropped_off),
    isFrozen: Boolean(r.is_frozen),
  }));
}

/**
 * Pure invariant comparator verifying that all baseline frozen stops are exactly preserved
 * in the proposed assignment. Throws descriptive errors if any invariant is violated.
 */
export function assertFrozenStopsPreserved(
  baselineStops: AuthoritativeFrozenStopBaseline[],
  proposalStops: PersistedProposalStop[],
  proposalStatus: string,
  tolerance = 1e-4,
): void {
  // 1. Repaired proposal status must be PROPOSED, never COMMITTED
  if (proposalStatus === 'COMMITTED') {
    throw new Error(
      'FROZEN_STOP_PRESERVATION_VIOLATION: Repaired proposal has status COMMITTED! Prohibited automatic commitment.',
    );
  }
  if (proposalStatus !== 'PROPOSED') {
    throw new Error(
      `FROZEN_STOP_PRESERVATION_VIOLATION: Repaired proposal has status "${proposalStatus}", expected "PROPOSED".`,
    );
  }

  const baselineFrozen = baselineStops.filter((s) => s.isFrozen);

  for (const base of baselineFrozen) {
    // 2. Locate matching stops by targetId and type
    const matchingOnResource = proposalStops.filter(
      (p) =>
        p.resourceId === base.resourceId && p.targetId === base.targetId && p.type === base.type,
    );

    const matchingOnAnyResource = proposalStops.filter(
      (p) => p.targetId === base.targetId && p.type === base.type,
    );

    if (matchingOnAnyResource.length === 0) {
      throw new Error(
        `FROZEN_STOP_PRESERVATION_VIOLATION: Frozen stop for target "${base.targetId}" (${base.type}) was removed from proposed plan.`,
      );
    }

    if (matchingOnResource.length === 0) {
      const movedResource = matchingOnAnyResource[0]?.resourceId ?? 'unknown';
      throw new Error(
        `FROZEN_STOP_PRESERVATION_VIOLATION: Frozen stop for target "${base.targetId}" changed resource from "${base.resourceId}" to "${movedResource}".`,
      );
    }

    // 3. Ensure no frozen stop is duplicated
    // For PICKUP, the target request must never be picked up multiple times on the route.
    // For DROPOFF / DEPOT, a vehicle may drop off at the same shelter for future un-frozen requests,
    // but there must not be multiple frozen stops for the same target across different positions.
    if (base.type === 'PICKUP') {
      if (matchingOnResource.length > 1) {
        throw new Error(
          `FROZEN_STOP_PRESERVATION_VIOLATION: Frozen stop for target "${base.targetId}" is duplicated ${matchingOnResource.length} times on resource "${base.resourceId}".`,
        );
      }
    } else {
      const duplicateFrozen = proposalStops.filter(
        (p) =>
          p.resourceId === base.resourceId &&
          p.isFrozen &&
          p.targetId === base.targetId &&
          p.type === base.type,
      );
      if (duplicateFrozen.length > 1) {
        throw new Error(
          `FROZEN_STOP_PRESERVATION_VIOLATION: Frozen stop for target "${base.targetId}" is duplicated ${duplicateFrozen.length} times on resource "${base.resourceId}".`,
        );
      }
    }

    // 4. Find the matching proposed stop corresponding to this frozen stop
    let prop = proposalStops.find(
      (p) =>
        p.resourceId === base.resourceId &&
        p.stopNumber === base.stopNumber &&
        p.targetId === base.targetId &&
        p.type === base.type,
    );

    if (!prop) {
      const reordered = matchingOnResource.find((p) => p.isFrozen) || matchingOnResource[0];
      if (reordered && reordered.stopNumber !== base.stopNumber) {
        throw new Error(
          `FROZEN_STOP_PRESERVATION_VIOLATION: Frozen stop for target "${base.targetId}" sequence reordered: was #${base.stopNumber}, now #${reordered.stopNumber}.`,
        );
      }
      prop = reordered;
    }

    if (!prop) {
      throw new Error(
        `FROZEN_STOP_PRESERVATION_VIOLATION: Frozen stop for target "${base.targetId}" (${base.type}) was removed from proposed plan.`,
      );
    }

    // 4. Compare stop sequence / order (stopNumber must match original frozen sequence)
    if (prop.stopNumber !== base.stopNumber) {
      throw new Error(
        `FROZEN_STOP_PRESERVATION_VIOLATION: Frozen stop for target "${base.targetId}" sequence reordered: was #${base.stopNumber}, now #${prop.stopNumber}.`,
      );
    }

    // 5. Compare coordinates within permitted tolerance
    const latDiff = Math.abs(prop.lat - base.lat);
    const lngDiff = Math.abs(prop.lng - base.lng);
    if (latDiff > tolerance || lngDiff > tolerance) {
      throw new Error(
        `FROZEN_STOP_PRESERVATION_VIOLATION: Coordinates for frozen stop #${base.stopNumber} (${prop.lat}, ${prop.lng}) exceed tolerance (${tolerance}) compared to committed baseline (${base.lat}, ${base.lng}).`,
      );
    }

    // 6. Compare pickup and drop-off passenger counts
    if (prop.passengersPickedUp !== base.passengersPickedUp) {
      throw new Error(
        `FROZEN_STOP_PRESERVATION_VIOLATION: Frozen stop #${base.stopNumber} passengers picked up changed: was ${base.passengersPickedUp}, now ${prop.passengersPickedUp}.`,
      );
    }

    if (prop.passengersDroppedOff !== base.passengersDroppedOff) {
      throw new Error(
        `FROZEN_STOP_PRESERVATION_VIOLATION: Frozen stop #${base.stopNumber} passengers dropped off changed: was ${base.passengersDroppedOff}, now ${prop.passengersDroppedOff}.`,
      );
    }

    // 7. Confirm target ID matches
    if (prop.targetId !== base.targetId) {
      throw new Error(
        `FROZEN_STOP_PRESERVATION_VIOLATION: Frozen stop target changed from "${base.targetId}" to "${prop.targetId}".`,
      );
    }

    // 8. Confirm type matches
    if (prop.type !== base.type) {
      throw new Error(
        `FROZEN_STOP_PRESERVATION_VIOLATION: Frozen stop type changed from "${base.type}" to "${prop.type}".`,
      );
    }
  }
}
