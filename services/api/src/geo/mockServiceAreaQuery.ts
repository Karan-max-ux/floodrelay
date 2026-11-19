import {
  DELHI_NCR_BOUNDARY_VERSION,
  DELHI_NCR_EXPECTED_DATASET_SHA256,
  DELHI_NCR_REGION_ID,
  DELHI_NCR_REGION_NAME,
  evaluateDelhiNcrCoverage,
} from './delhiNcrBoundary.js';

export const MOCK_DELHI_NCR_WKB_HASH = 'c8f7d9a1e2b3c4d5e6f708192a3b4c5d';

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

  if (sql.includes('WITH canonical AS') || sql.includes('ST_Equals')) {
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
          geometry_wkb_hash: MOCK_DELHI_NCR_WKB_HASH,
          is_topologically_equal: true,
          is_mutually_covered: true,
        } as unknown as R,
      ],
      command: 'SELECT',
      rowCount: 1,
      oid: 0,
      fields: [],
    };
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
        dataset_sha256: DELHI_NCR_EXPECTED_DATASET_SHA256,
        datasetSha256: DELHI_NCR_EXPECTED_DATASET_SHA256,
        is_valid: true,
        isValid: true,
        srid: 4326,
        geometry_wkb_hash: MOCK_DELHI_NCR_WKB_HASH,
        geometryWkbHash: MOCK_DELHI_NCR_WKB_HASH,
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
