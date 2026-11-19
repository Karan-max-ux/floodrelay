import {
  DELHI_NCR_BOUNDARY_VERSION,
  DELHI_NCR_REGION_ID,
  DELHI_NCR_REGION_NAME,
  evaluateDelhiNcrCoverage,
} from './delhiNcrBoundary.js';

/**
 * Shared in-memory test mock helper for `SELECT ... FROM service_areas` queries.
 * Evaluates exact WGS84 point-in-polygon containment using the verified 34-district
 * Delhi NCR GeoJSON dataset (matching PostGIS ST_Covers boundary-inclusive semantics).
 */
export function handleMockServiceAreaQuery<R extends Record<string, unknown>>(
  sql: string,
  vals: unknown[],
): { rows: R[]; command: string; rowCount: number; oid: number; fields: [] } | null {
  if (!sql.includes('FROM service_areas')) {
    return null;
  }

  const lng = vals[0] as number;
  const lat = vals[1] as number;
  const evaluation = evaluateDelhiNcrCoverage(lat, lng);

  return {
    rows: [
      {
        region_id: DELHI_NCR_REGION_ID,
        regionId: DELHI_NCR_REGION_ID,
        region_name: DELHI_NCR_REGION_NAME,
        regionName: DELHI_NCR_REGION_NAME,
        boundary_version: DELHI_NCR_BOUNDARY_VERSION,
        boundaryVersion: DELHI_NCR_BOUNDARY_VERSION,
        is_valid: true,
        isValid: true,
        srid: 4326,
        is_covered: evaluation.covered,
        isCovered: evaluation.covered,
        distance_meters: evaluation.distanceToBoundaryMeters,
        distanceMeters: evaluation.distanceToBoundaryMeters,
      } as unknown as R,
    ],
    command: 'SELECT',
    rowCount: 1,
    oid: 0,
    fields: [],
  };
}
