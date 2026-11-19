import type { PostgisRepository } from '../db/repository.js';

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
  constructor(private readonly repo: PostgisRepository) {}

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

    for (const row of rows) {
      if (row.is_valid !== true || Number(row.srid) !== 4326) {
        console.error(
          `[ServiceAreaService] Invalid boundary geometry detected for region "${row.region_id}" (is_valid=${String(row.is_valid)}, srid=${String(row.srid)}).`,
        );
        throw createServiceAreaError(
          SERVICE_AREA_UNAVAILABLE_MESSAGE,
          'SERVICE_AREA_UNAVAILABLE',
          503,
        );
      }
    }

    const coveredRow = rows.find((r) => r.is_covered === true);
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

    const primaryRow = rows[0];
    const distanceMeters = Number(primaryRow?.distance_meters ?? 0);
    const isNearBoundary = distanceMeters <= BOUNDARY_PROXIMITY_THRESHOLD_METERS;

    return {
      eligible: false,
      status: isNearBoundary ? 'NEAR_BOUNDARY_OUTSIDE' : 'OUTSIDE',
      distanceToBoundaryMeters: distanceMeters,
      regionId: null,
      regionName: null,
      boundaryVersion: primaryRow?.boundary_version ?? null,
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
      throw createServiceAreaError(OUTSIDE_SERVICE_AREA_MESSAGE, 'OUTSIDE_SERVICE_AREA', 422, {
        status: result.status,
        distanceToBoundaryMeters: result.distanceToBoundaryMeters,
        isNearBoundary: result.uncertaintyAssessment.isNearBoundary,
      });
    }
    return result;
  }
}
