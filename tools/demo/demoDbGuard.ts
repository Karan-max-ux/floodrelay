import type pg from 'pg';

export interface VerifiedDemoDbInfo {
  databaseName: string;
  serverAddr: string;
  dbUser: string;
}

export const DEMO_OPERATOR_OWNERSHIP_TABLE = 'demo_operator_ownership';

export interface DemoRunManifest {
  runId: string;
  createdAt?: string;
  status?: 'INITIALIZING' | 'ACTIVE' | 'FAILED' | 'CLEANED';
  scenarioId?: string;
  requestIds: string[];
  assignmentIds: string[];
  assignmentStopIds: string[];
  resourceIds: string[];
  shelterIds: string[];
  blockedZoneIds: string[];
  operationalEventIds: string[];
  auditEventIds: string[];
  operatorUsernames: string[];
  createdOperatorUsernames?: string[];
  reusedOperatorUsernames?: string[];
}

export interface DemoCleanupCounts {
  deletedStops: number;
  deletedAssignments: number;
  deletedOperationalEvents: number;
  deletedAuditEvents: number;
  deletedBlockedZones: number;
  deletedRequests: number;
  deletedResources: number;
  deletedShelters: number;
  deletedOperators: number;
  cleanedRuns: number;
}

export const STRICT_ALLOWED_DEMO_HOSTS = new Set(['localhost', '127.0.0.1', '::1', 'postgres']);
export const STRICT_ALLOWED_DEMO_DB_NAMES = new Set(['floodrelay_demo', 'floodrelay_test']);

export const DEMO_METADATA_TABLE = 'demo_environment_metadata';
export const DEMO_METADATA_MARKER_KEY = 'DISPOSABLE_DEMO_ENVIRONMENT';
export const DEMO_METADATA_MARKER_VALUE = 'FLOODRELAY_VERIFIED_DEMO_DB';

export const DEMO_MANIFEST_TABLE = 'demo_run_manifest';

/**
 * Asserts that the connected PostgreSQL database is a verified disposable demo database.
 * Fails closed before any table operations or fixture mutations if:
 * 1. Explicit authorization flag ALLOW_DISPOSABLE_DEMO_DB is missing.
 * 2. Host does not match strict local/container allowlist.
 * 3. Database name is not in STRICT_ALLOWED_DEMO_DB_NAMES (e.g. floodrelay_demo or floodrelay_test).
 * 4. The database lacks the required demo environment identity marker.
 */
export async function assertDisposableDemoDatabase(pool: pg.Pool): Promise<VerifiedDemoDbInfo> {
  const nodeMajor = parseInt(process.versions.node.split('.')[0] || '0', 10);
  if (nodeMajor < 24) {
    throw new Error(`Node.js version 24 or higher is required. Found v${process.versions.node}`);
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'DEMO_SAFETY_VIOLATION: Cannot run demo scripts in production environment (NODE_ENV=production). Aborting.',
    );
  }

  // 1. Require explicit authorization flag
  const authFlag = process.env.ALLOW_DISPOSABLE_DEMO_DB;
  const isAuthorized = authFlag === '1' || authFlag === 'true';

  if (!isAuthorized) {
    throw new Error(
      'UNAUTHORIZED_DEMO_EXECUTION: Demo setup and cleanup require explicit authorization. ' +
        'Set ALLOW_DISPOSABLE_DEMO_DB=1 in a dedicated disposable demo environment.',
    );
  }

  // 2. Validate host in DATABASE_URL if present
  if (process.env.DATABASE_URL) {
    try {
      const parsedUrl = new URL(process.env.DATABASE_URL);
      const urlHost = parsedUrl.hostname.trim().toLowerCase();
      if (!STRICT_ALLOWED_DEMO_HOSTS.has(urlHost)) {
        throw new Error(
          `UNAPPROVED_DEMO_HOST: Host "${urlHost}" in DATABASE_URL is not in the demo host allowlist. ` +
            `Approved hosts: [${Array.from(STRICT_ALLOWED_DEMO_HOSTS).join(', ')}].`,
        );
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.message.startsWith('UNAPPROVED_DEMO_HOST')) {
        throw err;
      }
    }
  }

  // 3. Validate host in connection pool options
  const poolHost = (pool.options.host || '').trim().toLowerCase();
  if (poolHost && !STRICT_ALLOWED_DEMO_HOSTS.has(poolHost)) {
    throw new Error(
      `UNAPPROVED_DEMO_HOST: Host "${poolHost}" in connection pool options is not in the demo host allowlist. ` +
        `Approved hosts: [${Array.from(STRICT_ALLOWED_DEMO_HOSTS).join(', ')}].`,
    );
  }

  // 4. Connect to database to query runtime server identity
  let client: pg.PoolClient;
  try {
    client = await pool.connect();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`DATABASE_CONNECTION_FAILED: Failed to connect to demo database: ${msg}`, {
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

    // 5. Permit ONLY dedicated disposable demo database names
    if (!STRICT_ALLOWED_DEMO_DB_NAMES.has(dbName)) {
      throw new Error(
        `UNAUTHORIZED_DEMO_DATABASE_NAME: Connected to database "${dbName}", but only dedicated disposable demo databases [${Array.from(
          STRICT_ALLOWED_DEMO_DB_NAMES,
        ).join(', ')}] are permitted. ` +
          'Generic development (e.g. "floodrelay"), staging, or production databases are strictly prohibited.',
      );
    }

    // 6. Verify dedicated demo identity marker table
    try {
      const markerRes = await client.query<{
        marker_key: string;
        marker_value: string;
        is_disposable: boolean;
        database_name?: string;
      }>(
        `
        SELECT marker_key, marker_value, is_disposable, database_name 
        FROM ${DEMO_METADATA_TABLE} 
        WHERE marker_key = $1;
      `,
        [DEMO_METADATA_MARKER_KEY],
      );

      const markerRow = markerRes.rows[0];
      if (!markerRow) {
        throw new Error(
          `MISSING_DEMO_IDENTITY_MARKER: Table "${DEMO_METADATA_TABLE}" is missing the required marker "${DEMO_METADATA_MARKER_KEY}". ` +
            'This database has not been initialized as a disposable demo environment.',
        );
      }

      if (
        markerRow.marker_value !== DEMO_METADATA_MARKER_VALUE ||
        markerRow.is_disposable !== true
      ) {
        throw new Error(
          `INVALID_DEMO_IDENTITY_MARKER: Marker in "${DEMO_METADATA_TABLE}" does not certify a disposable demo database. ` +
            `Expected value "${DEMO_METADATA_MARKER_VALUE}" with is_disposable=true.`,
        );
      }
    } catch (err: unknown) {
      if (
        err instanceof Error &&
        (err.message.startsWith('MISSING_DEMO_IDENTITY_MARKER') ||
          err.message.startsWith('INVALID_DEMO_IDENTITY_MARKER'))
      ) {
        throw err;
      }
      throw new Error(
        `DEMO_ENVIRONMENT_METADATA_TABLE_NOT_FOUND: Failed to query "${DEMO_METADATA_TABLE}". ` +
          'Ensure the demo database has been provisioned with the disposable environment marker.',
        { cause: err },
      );
    }

    return {
      databaseName: dbName,
      serverAddr,
      dbUser,
    };
  } finally {
    client.release();
  }
}

/**
 * Provisions the demo environment metadata table and identity marker.
 * Requires ALLOW_DISPOSABLE_DEMO_DB=1 and checks that host and dbName are in the allowlist.
 */
export async function provisionDisposableDemoMarker(pool: pg.Pool): Promise<void> {
  const authFlag = process.env.ALLOW_DISPOSABLE_DEMO_DB;
  const isAuthorized = authFlag === '1' || authFlag === 'true';

  if (!isAuthorized) {
    throw new Error(
      'UNAUTHORIZED_DEMO_PROVISIONING: Cannot provision demo marker without ALLOW_DISPOSABLE_DEMO_DB=1.',
    );
  }

  const client = await pool.connect();
  try {
    const res = await client.query<{ db_name: string }>(`SELECT current_database() AS db_name`);
    const dbName = String(res.rows[0]?.db_name || '')
      .trim()
      .toLowerCase();

    if (!STRICT_ALLOWED_DEMO_DB_NAMES.has(dbName)) {
      throw new Error(
        `UNAUTHORIZED_DEMO_DATABASE_NAME: Cannot provision demo marker on database "${dbName}". Permitted: [${Array.from(
          STRICT_ALLOWED_DEMO_DB_NAMES,
        ).join(', ')}].`,
      );
    }

    await client.query(`
      CREATE TABLE IF NOT EXISTS ${DEMO_METADATA_TABLE} (
        marker_key text PRIMARY KEY,
        marker_value text NOT NULL,
        is_disposable boolean NOT NULL DEFAULT true,
        database_name text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT NOW()
      );
    `);

    await client.query(
      `
      INSERT INTO ${DEMO_METADATA_TABLE} (marker_key, marker_value, is_disposable, database_name)
      VALUES ($1, $2, true, $3)
      ON CONFLICT (marker_key) DO UPDATE
      SET marker_value = EXCLUDED.marker_value,
          is_disposable = EXCLUDED.is_disposable,
          database_name = EXCLUDED.database_name,
          created_at = NOW();
    `,
      [DEMO_METADATA_MARKER_KEY, DEMO_METADATA_MARKER_VALUE, dbName],
    );
  } finally {
    client.release();
  }
}

/**
 * Creates the demo run manifest and operator ownership tables if they do not exist.
 */
export async function ensureDemoManifestTable(pool: pg.Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS ${DEMO_MANIFEST_TABLE} (
        run_id text PRIMARY KEY,
        created_at timestamptz NOT NULL DEFAULT NOW(),
        status text NOT NULL DEFAULT 'ACTIVE',
        scenario_id text,
        request_ids text[] NOT NULL DEFAULT '{}',
        assignment_ids text[] NOT NULL DEFAULT '{}',
        assignment_stop_ids text[] NOT NULL DEFAULT '{}',
        resource_ids text[] NOT NULL DEFAULT '{}',
        shelter_ids text[] NOT NULL DEFAULT '{}',
        blocked_zone_ids text[] NOT NULL DEFAULT '{}',
        operational_event_ids text[] NOT NULL DEFAULT '{}',
        audit_event_ids text[] NOT NULL DEFAULT '{}',
        operator_usernames text[] NOT NULL DEFAULT '{}',
        created_operator_usernames text[] NOT NULL DEFAULT '{}',
        reused_operator_usernames text[] NOT NULL DEFAULT '{}'
      );

      ALTER TABLE ${DEMO_MANIFEST_TABLE} ADD COLUMN IF NOT EXISTS created_operator_usernames text[] NOT NULL DEFAULT '{}';
      ALTER TABLE ${DEMO_MANIFEST_TABLE} ADD COLUMN IF NOT EXISTS reused_operator_usernames text[] NOT NULL DEFAULT '{}';

      CREATE TABLE IF NOT EXISTS ${DEMO_OPERATOR_OWNERSHIP_TABLE} (
        username text PRIMARY KEY,
        created_by_run_id text NOT NULL,
        is_demo boolean NOT NULL DEFAULT true,
        created_at timestamptz NOT NULL DEFAULT NOW()
      );
    `);
  } finally {
    client.release();
  }
}

/**
 * Records or updates a demo run manifest in the database.
 */
export async function recordDemoRunManifest(
  pool: pg.Pool,
  manifest: DemoRunManifest,
): Promise<void> {
  await ensureDemoManifestTable(pool);
  const client = await pool.connect();
  try {
    await client.query(
      `
      INSERT INTO ${DEMO_MANIFEST_TABLE} (
        run_id, status, scenario_id,
        request_ids, assignment_ids, assignment_stop_ids,
        resource_ids, shelter_ids, blocked_zone_ids,
        operational_event_ids, audit_event_ids, operator_usernames,
        created_operator_usernames, reused_operator_usernames
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      ON CONFLICT (run_id) DO UPDATE SET
        status = EXCLUDED.status,
        scenario_id = EXCLUDED.scenario_id,
        request_ids = EXCLUDED.request_ids,
        assignment_ids = EXCLUDED.assignment_ids,
        assignment_stop_ids = EXCLUDED.assignment_stop_ids,
        resource_ids = EXCLUDED.resource_ids,
        shelter_ids = EXCLUDED.shelter_ids,
        blocked_zone_ids = EXCLUDED.blocked_zone_ids,
        operational_event_ids = EXCLUDED.operational_event_ids,
        audit_event_ids = EXCLUDED.audit_event_ids,
        operator_usernames = EXCLUDED.operator_usernames,
        created_operator_usernames = EXCLUDED.created_operator_usernames,
        reused_operator_usernames = EXCLUDED.reused_operator_usernames;
    `,
      [
        manifest.runId,
        manifest.status || 'ACTIVE',
        manifest.scenarioId || null,
        manifest.requestIds,
        manifest.assignmentIds,
        manifest.assignmentStopIds,
        manifest.resourceIds,
        manifest.shelterIds,
        manifest.blockedZoneIds,
        manifest.operationalEventIds,
        manifest.auditEventIds,
        manifest.operatorUsernames,
        manifest.createdOperatorUsernames || [],
        manifest.reusedOperatorUsernames || [],
      ],
    );
  } finally {
    client.release();
  }
}

/**
 * Retrieves active or recoverable demo run manifests.
 */
export async function getActiveDemoRunManifests(
  pool: pg.Pool,
  runId?: string,
): Promise<DemoRunManifest[]> {
  await ensureDemoManifestTable(pool);
  const client = await pool.connect();
  try {
    let query = `SELECT * FROM ${DEMO_MANIFEST_TABLE} WHERE status IN ('ACTIVE', 'INITIALIZING', 'FAILED')`;
    const params: unknown[] = [];
    if (runId) {
      query += ` AND run_id = $1`;
      params.push(runId);
    }
    const res = await client.query<{
      run_id: string;
      created_at: Date;
      status: 'INITIALIZING' | 'ACTIVE' | 'FAILED' | 'CLEANED';
      scenario_id: string | null;
      request_ids: string[];
      assignment_ids: string[];
      assignment_stop_ids: string[];
      resource_ids: string[];
      shelter_ids: string[];
      blocked_zone_ids: string[];
      operational_event_ids: string[];
      audit_event_ids: string[];
      operator_usernames: string[];
      created_operator_usernames: string[];
      reused_operator_usernames: string[];
    }>(query, params);

    return res.rows.map((row) => ({
      runId: row.run_id,
      createdAt: row.created_at.toISOString(),
      status: row.status,
      scenarioId: row.scenario_id || undefined,
      requestIds: row.request_ids || [],
      assignmentIds: row.assignment_ids || [],
      assignmentStopIds: row.assignment_stop_ids || [],
      resourceIds: row.resource_ids || [],
      shelterIds: row.shelter_ids || [],
      blockedZoneIds: row.blocked_zone_ids || [],
      operationalEventIds: row.operational_event_ids || [],
      auditEventIds: row.audit_event_ids || [],
      operatorUsernames: row.operator_usernames || [],
      createdOperatorUsernames: row.created_operator_usernames || [],
      reusedOperatorUsernames: row.reused_operator_usernames || [],
    }));
  } finally {
    client.release();
  }
}

/**
 * Deletes ONLY the fixtures tracked in the demo run manifest table using parameterized arrays.
 * Zero wildcard string queries (no LIKE 'demo-%').
 */
export async function cleanupTrackedDemoFixtures(
  pool: pg.Pool,
  runId?: string,
  options?: { preserveOperators?: boolean },
): Promise<DemoCleanupCounts> {
  const manifests = await getActiveDemoRunManifests(pool, runId);
  if (manifests.length === 0) {
    return {
      deletedStops: 0,
      deletedAssignments: 0,
      deletedOperationalEvents: 0,
      deletedAuditEvents: 0,
      deletedBlockedZones: 0,
      deletedRequests: 0,
      deletedResources: 0,
      deletedShelters: 0,
      deletedOperators: 0,
      cleanedRuns: 0,
    };
  }

  // Aggregate all unique IDs across the target manifests
  const allStops = Array.from(new Set(manifests.flatMap((m) => m.assignmentStopIds)));
  const allAssignments = Array.from(new Set(manifests.flatMap((m) => m.assignmentIds)));
  const allOpEvents = Array.from(new Set(manifests.flatMap((m) => m.operationalEventIds)));
  const allAuditEvents = Array.from(new Set(manifests.flatMap((m) => m.auditEventIds)));
  const allZones = Array.from(new Set(manifests.flatMap((m) => m.blockedZoneIds)));
  const allRequests = Array.from(new Set(manifests.flatMap((m) => m.requestIds)));
  const allResources = Array.from(new Set(manifests.flatMap((m) => m.resourceIds)));
  const allShelters = Array.from(new Set(manifests.flatMap((m) => m.shelterIds)));
  const runIds = manifests.map((m) => m.runId);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    let deletedStops = 0;
    if (allStops.length > 0) {
      const res = await client.query(`DELETE FROM assignment_stops WHERE id = ANY($1::text[])`, [
        allStops,
      ]);
      deletedStops = res.rowCount ?? 0;
    }
    // Also remove stops for assignments tracked if not covered individually
    if (allAssignments.length > 0) {
      const res = await client.query(
        `DELETE FROM assignment_stops WHERE assignment_id = ANY($1::text[])`,
        [allAssignments],
      );
      deletedStops += res.rowCount ?? 0;
    }

    let deletedAssignments = 0;
    if (allAssignments.length > 0) {
      const res = await client.query(`DELETE FROM assignments WHERE id = ANY($1::text[])`, [
        allAssignments,
      ]);
      deletedAssignments = res.rowCount ?? 0;
    }

    let deletedOpEvents = 0;
    if (allOpEvents.length > 0) {
      const res = await client.query(`DELETE FROM operational_events WHERE id = ANY($1::text[])`, [
        allOpEvents,
      ]);
      deletedOpEvents = res.rowCount ?? 0;
    }

    let deletedAuditEvents = 0;
    if (allAuditEvents.length > 0) {
      const res = await client.query(`DELETE FROM audit_events WHERE id = ANY($1::text[])`, [
        allAuditEvents,
      ]);
      deletedAuditEvents = res.rowCount ?? 0;
    }

    let deletedZones = 0;
    if (allZones.length > 0) {
      const res = await client.query(`DELETE FROM blocked_zones WHERE id = ANY($1::text[])`, [
        allZones,
      ]);
      deletedZones = res.rowCount ?? 0;
    }

    let deletedRequests = 0;
    if (allRequests.length > 0) {
      const res = await client.query(`DELETE FROM requests WHERE id = ANY($1::text[])`, [
        allRequests,
      ]);
      deletedRequests = res.rowCount ?? 0;
    }

    let deletedResources = 0;
    if (allResources.length > 0) {
      const res = await client.query(`DELETE FROM resources WHERE id = ANY($1::text[])`, [
        allResources,
      ]);
      deletedResources = res.rowCount ?? 0;
    }

    let deletedShelters = 0;
    if (allShelters.length > 0) {
      const res = await client.query(`DELETE FROM shelters WHERE id = ANY($1::text[])`, [
        allShelters,
      ]);
      deletedShelters = res.rowCount ?? 0;
    }

    // Strictly delete ONLY operators that were newly created by the target runs
    // and have verified demo ownership matching the run IDs being cleaned up.
    // Reused demo operators and pre-existing unrelated operators are NEVER deleted.
    const createdOperators = options?.preserveOperators
      ? []
      : Array.from(new Set(manifests.flatMap((m) => m.createdOperatorUsernames || [])));

    let deletedOperators = 0;
    if (createdOperators.length > 0) {
      const res = await client.query(
        `DELETE FROM operators 
         WHERE username = ANY($1::text[]) 
           AND username IN (
             SELECT username FROM ${DEMO_OPERATOR_OWNERSHIP_TABLE} 
             WHERE created_by_run_id = ANY($2::text[]) AND is_demo = true
           )`,
        [createdOperators, runIds],
      );
      deletedOperators = res.rowCount ?? 0;

      // Clean up demo ownership tracking rows
      await client.query(
        `DELETE FROM ${DEMO_OPERATOR_OWNERSHIP_TABLE} WHERE created_by_run_id = ANY($1::text[])`,
        [runIds],
      );
    }

    // Mark manifests as CLEANED
    await client.query(
      `UPDATE ${DEMO_MANIFEST_TABLE} SET status = 'CLEANED' WHERE run_id = ANY($1::text[])`,
      [runIds],
    );

    await client.query('COMMIT');

    return {
      deletedStops,
      deletedAssignments,
      deletedOperationalEvents: deletedOpEvents,
      deletedAuditEvents,
      deletedBlockedZones: deletedZones,
      deletedRequests,
      deletedResources,
      deletedShelters,
      deletedOperators,
      cleanedRuns: runIds.length,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
