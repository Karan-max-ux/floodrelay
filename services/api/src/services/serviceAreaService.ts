import type { PostgisRepository, ServiceAreaAttestationRow } from '../db/repository.js';
import {
  DELHI_NCR_BOUNDARY_VERSION,
  DELHI_NCR_EXPECTED_DATASET_SHA256,
  DELHI_NCR_REGION_ID,
  DELHI_NCR_REGION_NAME,
  loadDelhiNcrBoundaryDataset,
} from '../geo/delhiNcrBoundary.js';

export const OUTSIDE_SERVICE_AREA_MESSAGE =
  'FloodRelay currently accepts rescue requests only within its supported Delhi NCR service area.';

export const SERVICE_AREA_UNAVAILABLE_MESSAGE =
  'Unable to verify whether this location is within the supported Delhi NCR service area right now. No rescue request was submitted. Please try again shortly, or call 112 in immediate danger.';

/**
 * Proximity threshold for boundary uncertainty guidance (in meters).
 * Justification:
 * 1. The underlying simplified administrative district polygons (geoBoundaries IND-ADM2-76128533)
 *    exhibit approximately 100-300m positional uncertainty relative to cadastral parcel boundaries.
 * 2. Consumer mobile GPS receivers in flood/storm conditions or urban canyons exhibit 50-200m+ jitter.
 * 3. A 1,000-meter conservative proximity band detects points immediately adjacent to the
 *    administrative outer boundary where eligibility cannot be conclusively distinguished from GPS error
 *    without expanding the operational coverage area.
 */
export const BOUNDARY_PROXIMITY_THRESHOLD_METERS = 1000;

export interface ServiceAreaUncertaintyAssessment {
  isNearBoundary: boolean;
  boundaryDistanceMeters: number;
  thresholdMeters: number;
  justification: string;
  hasPoorAccuracy?: boolean;
}

export interface ServiceAreaCheckResult {
  eligible: boolean;
  status: 'INSIDE' | 'NEAR_BOUNDARY_OUTSIDE' | 'OUTSIDE';
  distanceToBoundaryMeters: number;
  regionId: string | null;
  regionName: string | null;
  boundaryVersion: string | null;
  inclusiveBoundaryPolicy: 'ST_COVERS';
  uncertaintyAssessment: ServiceAreaUncertaintyAssessment;
}

export interface ServiceAreaAttestationResult {
  regionId: string;
  regionName: string;
  boundaryVersion: string;
  datasetSha256: string;
  isValid: boolean;
  srid: number;
  pointCount: number;
  areaSqKm: number;
  geometryWkbHash: string;
  isTopologicallyEqual: boolean;
  isMutuallyCovered: boolean;
  attestedAt: Date;
}

export interface ServiceAreaDomainError extends Error {
  code: string;
  statusCode: number;
  details?: unknown;
}

function createServiceAreaError(
  message: string,
  code: string,
  statusCode: number,
  details?: unknown,
): ServiceAreaDomainError {
  const err = new Error(message) as ServiceAreaDomainError;
  err.code = code;
  err.statusCode = statusCode;
  if (details !== undefined) {
    err.details = details;
  }
  return err;
}

export function isValidFiniteCoordinate(lat: unknown, lng: unknown): boolean {
  return (
    typeof lat === 'number' &&
    typeof lng === 'number' &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );
}

/**
 * Central service-area boundary enforcement backed by PostgreSQL/PostGIS `service_areas`.
 *
 * Fail-closed guarantees:
 * - Non-finite or out-of-range coordinates -> HTTP 400 VALIDATION_ERROR.
 * - Missing active boundary, invalid PostGIS geometry/SRID, or DB failure -> HTTP 503 SERVICE_AREA_UNAVAILABLE.
 * - Coordinates conclusively outside active boundary -> eligible: false (or HTTP 422 OUTSIDE_SERVICE_AREA via assert).
 * - Never falls back to approving unverified coordinates or leaking SQL/PostGIS internals.
 */
export class ServiceAreaService {
  // Static state shared across all repository instances (including transaction-backed instances)
  private static attestedGeometryWkbHash: string | null = null;
  private static attestationResult: ServiceAreaAttestationResult | null = null;
  private static attestationError: string | null = null;

  constructor(private readonly repo: PostgisRepository) {}

  public static getAttestedGeometryWkbHash(): string | null {
    return ServiceAreaService.attestedGeometryWkbHash;
  }

  public static getAttestationResult(): ServiceAreaAttestationResult | null {
    return ServiceAreaService.attestationResult;
  }

  public static setAttestedGeometryWkbHashForTest(hash: string | null): void {
    ServiceAreaService.attestedGeometryWkbHash = hash;
  }

  public static resetAttestationForTest(): void {
    ServiceAreaService.attestedGeometryWkbHash = null;
    ServiceAreaService.attestationResult = null;
    ServiceAreaService.attestationError = null;
  }

  /**
   * Performs rigorous topological attestation of the active PostgreSQL/PostGIS service_areas boundary
   * against the approved canonical Delhi NCR GeoJSON dataset.
   *
   * Verifies:
   * 1. Approved repository GeoJSON SHA-256 matches pinned constant.
   * 2. Exactly one active boundary row in `service_areas`.
   * 3. region_id, boundary_version, dataset_sha256, is_valid, and srid match trusted constants.
   * 4. PostGIS ST_Equals evaluates true between database geometry and canonical geometry.
   * 5. Captures the PostGIS WKB hash MD5(ST_AsBinary(geometry)) to detect any subsequent database tampering.
   */
  async attestActiveBoundaryIntegrity(): Promise<ServiceAreaAttestationResult> {
    const { dataset, sha256 } = loadDelhiNcrBoundaryDataset();
    if (sha256 !== DELHI_NCR_EXPECTED_DATASET_SHA256) {
      const msg = `Approved Delhi NCR GeoJSON SHA-256 mismatch: expected ${DELHI_NCR_EXPECTED_DATASET_SHA256}, got ${sha256}`;
      ServiceAreaService.attestationError = msg;
      throw new Error(msg);
    }

    const canonicalGeometriesJson = JSON.stringify(dataset.features.map((f) => f.geometry));

    let rows: ServiceAreaAttestationRow[];
    try {
      rows = await this.repo.attestServiceAreaBoundary(canonicalGeometriesJson);
    } catch (err) {
      const msg = `Database query failed during service-area boundary attestation: ${err instanceof Error ? err.message : String(err)}`;
      ServiceAreaService.attestationError = msg;
      throw new Error(msg, { cause: err });
    }

    if (!Array.isArray(rows) || rows.length === 0) {
      const msg = 'No active service-area boundary found in database.';
      ServiceAreaService.attestationError = msg;
      throw new Error(msg);
    }

    if (rows.length > 1) {
      const msg = `Multiple active service-area boundaries found in database (${rows.length} rows). Exactly 1 active boundary is required.`;
      ServiceAreaService.attestationError = msg;
      throw new Error(msg);
    }

    const row = rows[0]!;

    if (row.region_id !== DELHI_NCR_REGION_ID) {
      const msg = `Active boundary region_id mismatch: expected "${DELHI_NCR_REGION_ID}", actual "${row.region_id}"`;
      ServiceAreaService.attestationError = msg;
      throw new Error(msg);
    }

    if (row.boundary_version !== DELHI_NCR_BOUNDARY_VERSION) {
      const msg = `Active boundary version mismatch: expected "${DELHI_NCR_BOUNDARY_VERSION}", actual "${row.boundary_version}"`;
      ServiceAreaService.attestationError = msg;
      throw new Error(msg);
    }

    if (row.dataset_sha256 !== DELHI_NCR_EXPECTED_DATASET_SHA256) {
      const msg = `Active boundary dataset_sha256 mismatch: expected "${DELHI_NCR_EXPECTED_DATASET_SHA256}", actual "${row.dataset_sha256}"`;
      ServiceAreaService.attestationError = msg;
      throw new Error(msg);
    }

    if (row.is_valid !== true) {
      const msg = `Active boundary geometry topology is invalid according to PostGIS ST_IsValid.`;
      ServiceAreaService.attestationError = msg;
      throw new Error(msg);
    }

    if (Number(row.srid) !== 4326) {
      const msg = `Active boundary SRID mismatch: expected 4326, actual ${row.srid}`;
      ServiceAreaService.attestationError = msg;
      throw new Error(msg);
    }

    if (row.is_topologically_equal !== true && row.is_mutually_covered !== true) {
      const msg = `Active PostGIS boundary geometry does not topologically match canonical Delhi NCR GeoJSON polygon (ST_Equals returned false).`;
      ServiceAreaService.attestationError = msg;
      throw new Error(msg);
    }

    const result: ServiceAreaAttestationResult = {
      regionId: row.region_id,
      regionName: row.region_name,
      boundaryVersion: row.boundary_version,
      datasetSha256: row.dataset_sha256,
      isValid: row.is_valid,
      srid: Number(row.srid),
      pointCount: Number(row.point_count),
      areaSqKm: Number(row.area_sq_km),
      geometryWkbHash: row.geometry_wkb_hash,
      isTopologicallyEqual: Boolean(row.is_topologically_equal),
      isMutuallyCovered: Boolean(row.is_mutually_covered),
      attestedAt: new Date(),
    };

    ServiceAreaService.attestedGeometryWkbHash = row.geometry_wkb_hash;
    ServiceAreaService.attestationResult = result;
    ServiceAreaService.attestationError = null;

    return result;
  }

  async checkCoordinates(
    lat: number,
    lng: number,
    accuracyMeters?: number,
  ): Promise<ServiceAreaCheckResult> {
    if (!isValidFiniteCoordinate(lat, lng)) {
      throw createServiceAreaError(
        'Valid finite latitude (-90 to 90) and longitude (-180 to 180) are required',
        'VALIDATION_ERROR',
        400,
      );
    }

    let rows;
    try {
      rows = await this.repo.checkServiceAreaCoverage(lat, lng);
    } catch (err) {
      // Log internal diagnostic server-side only; never expose SQL or PostGIS details to clients
      console.error('[ServiceAreaService] Spatial service-area query failed:', err);
      throw createServiceAreaError(
        SERVICE_AREA_UNAVAILABLE_MESSAGE,
        'SERVICE_AREA_UNAVAILABLE',
        503,
      );
    }

    if (!Array.isArray(rows) || rows.length === 0) {
      console.error('[ServiceAreaService] No active service_areas boundary found in database.');
      throw createServiceAreaError(
        SERVICE_AREA_UNAVAILABLE_MESSAGE,
        'SERVICE_AREA_UNAVAILABLE',
        503,
      );
    }

    if (rows.length > 1) {
      console.error(
        `[ServiceAreaService] Multiple active service_areas boundaries found in database (${rows.length}).`,
      );
      throw createServiceAreaError(
        SERVICE_AREA_UNAVAILABLE_MESSAGE,
        'SERVICE_AREA_UNAVAILABLE',
        503,
      );
    }

    const row = rows[0]!;

    if (
      row.region_id !== DELHI_NCR_REGION_ID ||
      row.boundary_version !== DELHI_NCR_BOUNDARY_VERSION ||
      row.dataset_sha256 !== DELHI_NCR_EXPECTED_DATASET_SHA256 ||
      row.is_valid !== true ||
      Number(row.srid) !== 4326
    ) {
      console.error(
        `[ServiceAreaService] Boundary integrity check failed for region "${row.region_id}" (is_valid=${String(row.is_valid)}, srid=${String(row.srid)}, version=${String(row.boundary_version)}, checksum=${String(row.dataset_sha256)}).`,
      );
      throw createServiceAreaError(
        SERVICE_AREA_UNAVAILABLE_MESSAGE,
        'SERVICE_AREA_UNAVAILABLE',
        503,
      );
    }

    // Subsequent geometry alteration check: If the boundary was attested at startup/readiness,
    // verify that the active geometry's WKB hash is unchanged.
    if (
      ServiceAreaService.attestedGeometryWkbHash &&
      row.geometry_wkb_hash !== ServiceAreaService.attestedGeometryWkbHash
    ) {
      console.error(
        `[ServiceAreaService] Database boundary geometry changed after attestation! Attested WKB hash "${ServiceAreaService.attestedGeometryWkbHash}" does not match active WKB hash "${row.geometry_wkb_hash}".`,
      );
      throw createServiceAreaError(
        SERVICE_AREA_UNAVAILABLE_MESSAGE,
        'SERVICE_AREA_UNAVAILABLE',
        503,
      );
    }

    if (ServiceAreaService.attestationError) {
      console.error(
        `[ServiceAreaService] Service area attestation is in failed state: ${ServiceAreaService.attestationError}`,
      );
      throw createServiceAreaError(
        SERVICE_AREA_UNAVAILABLE_MESSAGE,
        'SERVICE_AREA_UNAVAILABLE',
        503,
      );
    }

    const coveredRow = row.is_covered ? row : null;
    const hasPoorAccuracy =
      typeof accuracyMeters === 'number' &&
      Number.isFinite(accuracyMeters) &&
      accuracyMeters > 1000;

    if (coveredRow) {
      return {
        eligible: true,
        status: 'INSIDE',
        distanceToBoundaryMeters: 0,
        regionId: coveredRow.region_id,
        regionName: coveredRow.region_name,
        boundaryVersion: coveredRow.boundary_version,
        inclusiveBoundaryPolicy: 'ST_COVERS',
        uncertaintyAssessment: {
          isNearBoundary: false,
          boundaryDistanceMeters: 0,
          thresholdMeters: BOUNDARY_PROXIMITY_THRESHOLD_METERS,
          justification:
            'Point is covered by authoritative Delhi NCR boundary geometry via PostGIS ST_Covers.',
          hasPoorAccuracy,
        },
      };
    }

    const distanceMeters = Number(row?.distance_meters ?? 0);
    const isNearBoundary = distanceMeters <= BOUNDARY_PROXIMITY_THRESHOLD_METERS;

    return {
      eligible: false,
      status: isNearBoundary ? 'NEAR_BOUNDARY_OUTSIDE' : 'OUTSIDE',
      distanceToBoundaryMeters: distanceMeters,
      regionId: null,
      regionName: null,
      boundaryVersion: row?.boundary_version ?? null,
      inclusiveBoundaryPolicy: 'ST_COVERS',
      uncertaintyAssessment: {
        isNearBoundary,
        boundaryDistanceMeters: distanceMeters,
        thresholdMeters: BOUNDARY_PROXIMITY_THRESHOLD_METERS,
        justification: isNearBoundary
          ? 'Point is outside reference polygon but within 1,000m proximity threshold (dataset 100-300m uncertainty and GPS margin).'
          : 'Point is conclusively outside the supported Delhi NCR service area.',
        hasPoorAccuracy,
      },
    };
  }

  async assertWithinServiceArea(lat: number, lng: number): Promise<ServiceAreaCheckResult> {
    const result = await this.checkCoordinates(lat, lng);
    if (!result.eligible) {
      console.warn(
        `[ServiceAreaService] Coordinates [${lat}, ${lng}] rejected: outside supported region "${DELHI_NCR_REGION_ID}".`,
      );
      throw createServiceAreaError(OUTSIDE_SERVICE_AREA_MESSAGE, 'OUTSIDE_SERVICE_AREA', 422, {
        regionId: DELHI_NCR_REGION_ID,
        regionName: DELHI_NCR_REGION_NAME,
        status: result.status,
        distanceToBoundaryMeters: result.distanceToBoundaryMeters,
        isNearBoundary: result.uncertaintyAssessment.isNearBoundary,
      });
    }
    return result;
  }
}
