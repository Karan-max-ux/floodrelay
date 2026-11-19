import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const DELHI_NCR_REGION_ID = 'IN-NCR';
export const DELHI_NCR_REGION_NAME = 'Delhi National Capital Region (NCR)';
export const DELHI_NCR_BOUNDARY_VERSION = 'ncrpb-2026-gb-ind-adm2-v1';
export const DELHI_NCR_EXPECTED_DATASET_SHA256 =
  'a48e65c666c374c07364e03c79d090a8c0888971f463f804d40baf052104e8ae';

export interface NcrFeatureProperties {
  shapeID: string;
  shapeName: string;
  officialName: string;
  subRegion: 'NCT of Delhi' | 'Haryana' | 'Uttar Pradesh' | 'Rajasthan';
}

export interface NcrGeoJsonFeature {
  type: 'Feature';
  properties: NcrFeatureProperties;
  geometry:
    | { type: 'Polygon'; coordinates: number[][][] }
    | { type: 'MultiPolygon'; coordinates: number[][][][] };
}

export interface NcrBoundaryDataset {
  type: 'FeatureCollection';
  name: string;
  metadata: {
    regionId: string;
    regionName: string;
    boundaryVersion: string;
    crs: string;
    constituentListAuthority: string;
    constituentListUrl: string;
    ncrpbMeetingReference: string;
    ncrpbNotifiedAreaSqKm: number;
    computedAreaSqKm: number;
    gisGeometrySource: string;
    gisGeometryReleaseCommit: string;
    gisGeometryDownloadUrl: string;
    gisGeometryBuildDate: string;
    gisGeometryLicense: string;
    gisSourceFileSha256: string;
    subRegions: Record<
      string,
      { notifiedAreaSqKm: number; adm2Polygons: number; districts: string[] }
    >;
    conversionMethodology: string;
    knownLimitations: string[];
  };
  features: NcrGeoJsonFeature[];
}

interface IndexedFeature {
  feature: NcrGeoJsonFeature;
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

let cachedDataset: {
  dataset: NcrBoundaryDataset;
  sha256: string;
  indexed: IndexedFeature[];
} | null = null;

function resolveBoundaryPath(): string {
  const candidates = [
    path.join(__dirname, 'delhi-ncr-boundary.geojson'),
    path.resolve(__dirname, '../../src/geo/delhi-ncr-boundary.geojson'),
    path.resolve(process.cwd(), 'services/api/src/geo/delhi-ncr-boundary.geojson'),
    path.resolve(process.cwd(), 'src/geo/delhi-ncr-boundary.geojson'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  throw new Error('Delhi NCR boundary dataset file delhi-ncr-boundary.geojson not found');
}

function computeFeatureBbox(feature: NcrGeoJsonFeature): {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
} {
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLng = Infinity;
  let maxLng = -Infinity;

  const polygons =
    feature.geometry.type === 'Polygon'
      ? [feature.geometry.coordinates]
      : feature.geometry.coordinates;

  for (const poly of polygons) {
    for (const ring of poly) {
      for (const pt of ring) {
        const lng = pt[0]!;
        const lat = pt[1]!;
        if (lat < minLat) minLat = lat;
        if (lat > maxLat) maxLat = lat;
        if (lng < minLng) minLng = lng;
        if (lng > maxLng) maxLng = lng;
      }
    }
  }

  return { minLat, maxLat, minLng, maxLng };
}

export function resetCachedBoundaryDatasetForTest(): void {
  cachedDataset = null;
}

export function validateAndIndexNcrDataset(
  raw: string,
  expectedSha256 = DELHI_NCR_EXPECTED_DATASET_SHA256,
): { dataset: NcrBoundaryDataset; sha256: string; indexed: IndexedFeature[] } {
  const sha256 = crypto.createHash('sha256').update(raw).digest('hex');
  if (sha256 !== expectedSha256) {
    throw new Error('DELHI_NCR_BOUNDARY_INTEGRITY_FAILURE');
  }

  let dataset: NcrBoundaryDataset;
  try {
    dataset = JSON.parse(raw) as NcrBoundaryDataset;
  } catch {
    throw new Error('Invalid Delhi NCR boundary GeoJSON: malformed JSON syntax');
  }

  if (dataset.type !== 'FeatureCollection' || !Array.isArray(dataset.features)) {
    throw new Error('Invalid Delhi NCR boundary GeoJSON: expected FeatureCollection');
  }

  if (dataset.features.length === 0) {
    throw new Error('Invalid Delhi NCR boundary GeoJSON: empty feature collection');
  }

  const indexed = dataset.features.map((feature, idx) => {
    if (!feature || feature.type !== 'Feature' || !feature.geometry) {
      throw new Error(`Invalid feature at index ${idx}: must be GeoJSON Feature`);
    }

    const geomType = feature.geometry.type;
    if (geomType !== 'Polygon' && geomType !== 'MultiPolygon') {
      throw new Error(
        `Unexpected geometry type "${geomType}" at index ${idx}: expected Polygon or MultiPolygon`,
      );
    }

    const coords = feature.geometry.coordinates;
    if (!Array.isArray(coords) || coords.length === 0) {
      throw new Error(`Invalid coordinates at index ${idx}: coordinates array is empty`);
    }

    // Validate coordinate numbers and ranges (lng in [-180, 180], lat in [-90, 90])
    const polygons = geomType === 'Polygon' ? [coords as number[][][]] : (coords as number[][][][]);
    for (const poly of polygons) {
      if (!Array.isArray(poly) || poly.length === 0) {
        throw new Error(`Invalid polygon ring structure at feature index ${idx}`);
      }
      for (const ring of poly) {
        if (!Array.isArray(ring) || ring.length < 4) {
          throw new Error(
            `Invalid linear ring at feature index ${idx}: must have at least 4 positions`,
          );
        }
        for (const pt of ring) {
          if (!Array.isArray(pt) || pt.length < 2) {
            throw new Error(`Invalid coordinate position at feature index ${idx}`);
          }
          const lng = pt[0];
          const lat = pt[1];
          if (
            typeof lng !== 'number' ||
            typeof lat !== 'number' ||
            !Number.isFinite(lng) ||
            !Number.isFinite(lat) ||
            lng < -180 ||
            lng > 180 ||
            lat < -90 ||
            lat > 90
          ) {
            throw new Error(
              `Invalid coordinate values [${lng}, ${lat}] at feature index ${idx}: must be finite WGS84 coordinates`,
            );
          }
        }
      }
    }

    return {
      feature,
      ...computeFeatureBbox(feature),
    };
  });

  return { dataset, sha256, indexed };
}

export function loadDelhiNcrBoundaryDataset(): {
  dataset: NcrBoundaryDataset;
  sha256: string;
  indexed: IndexedFeature[];
} {
  if (cachedDataset) {
    return cachedDataset;
  }

  const filePath = resolveBoundaryPath();
  const raw = fs.readFileSync(filePath, 'utf-8');
  cachedDataset = validateAndIndexNcrDataset(raw);
  return cachedDataset;
}

export function getCanonicalNcrFeatureGeometriesJson(): string {
  const { dataset } = loadDelhiNcrBoundaryDataset();
  return JSON.stringify(dataset.features.map((f) => f.geometry));
}

function pointOnSegment(
  px: number,
  py: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  eps = 1e-11,
): boolean {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const sqLen = dx * dx + dy * dy;
  if (sqLen === 0) {
    return Math.hypot(px - x1, py - y1) <= eps;
  }
  const cross = Math.abs((py - y1) * dx - (px - x1) * dy);
  if (cross > eps * Math.sqrt(sqLen)) return false;
  const dot = (px - x1) * dx + (py - y1) * dy;
  return dot >= -eps && dot <= sqLen + eps;
}

function pointOnRingBoundary(lng: number, lat: number, ring: number[][]): boolean {
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const pi = ring[i]!;
    const pj = ring[j]!;
    if (pointOnSegment(lng, lat, pi[0]!, pi[1]!, pj[0]!, pj[1]!)) {
      return true;
    }
  }
  return false;
}

function pointInRingInclusive(lng: number, lat: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i]![0]!;
    const yi = ring[i]![1]!;
    const xj = ring[j]![0]!;
    const yj = ring[j]![1]!;
    if (pointOnSegment(lng, lat, xi, yi, xj, yj)) {
      return true;
    }
    const intersect = yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function polygonCoversPoint(lng: number, lat: number, coords: number[][][]): boolean {
  const outer = coords[0];
  if (!outer || !pointInRingInclusive(lng, lat, outer)) {
    return false;
  }
  for (let i = 1; i < coords.length; i++) {
    const hole = coords[i]!;
    if (pointInRingInclusive(lng, lat, hole) && !pointOnRingBoundary(lng, lat, hole)) {
      return false;
    }
  }
  return true;
}

function distanceToSegmentMeters(
  lat: number,
  lng: number,
  p1Lng: number,
  p1Lat: number,
  p2Lng: number,
  p2Lat: number,
): number {
  const latRad = (lat * Math.PI) / 180;
  const kx = Math.cos(latRad) * 111319.5;
  const ky = 111132.9;

  const px = lng * kx;
  const py = lat * ky;
  const x1 = p1Lng * kx;
  const y1 = p1Lat * ky;
  const x2 = p2Lng * kx;
  const y2 = p2Lat * ky;

  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;

  if (lenSq === 0) {
    return Math.hypot(px - x1, py - y1);
  }

  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lenSq));
  const projX = x1 + t * dx;
  const projY = y1 + t * dy;

  return Math.hypot(px - projX, py - projY);
}

export function computeMinDistanceToBoundaryMeters(lat: number, lng: number): number {
  const { indexed } = loadDelhiNcrBoundaryDataset();
  let minDistance = Infinity;

  const latRad = (lat * Math.PI) / 180;
  const kx = Math.cos(latRad) * 111319.5;
  const ky = 111132.9;

  for (const entry of indexed) {
    const dLatBbox = Math.max(0, entry.minLat - lat, lat - entry.maxLat) * ky;
    const dLngBbox = Math.max(0, entry.minLng - lng, lng - entry.maxLng) * kx;
    const bboxDist = Math.hypot(dLatBbox, dLngBbox);
    if (bboxDist >= minDistance) {
      continue;
    }

    const { geometry } = entry.feature;
    const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;

    for (const poly of polygons) {
      const outerRing = poly[0];
      if (!outerRing) continue;
      for (let i = 0, j = outerRing.length - 1; i < outerRing.length; j = i++) {
        const p1 = outerRing[j]!;
        const p2 = outerRing[i]!;
        const d = distanceToSegmentMeters(lat, lng, p1[0]!, p1[1]!, p2[0]!, p2[1]!);
        if (d < minDistance) {
          minDistance = d;
        }
      }
    }
  }

  return Math.round(minDistance * 10) / 10;
}

/**
 * Pure reference evaluator matching PostGIS ST_Covers(geometry, ST_SetSRID(ST_MakePoint(lng, lat), 4326))
 * over the verified 34-district Delhi NCR GeoJSON dataset.
 *
 * Used for deterministic dataset validation and in-memory unit-test DB mocks.
 * Production runtime queries PostgreSQL/PostGIS `service_areas` directly.
 */
export function evaluateDelhiNcrCoverage(
  lat: number,
  lng: number,
): {
  covered: boolean;
  distanceToBoundaryMeters: number;
  matchedDistrict: string | null;
  matchedSubRegion: string | null;
} {
  if (
    typeof lat !== 'number' ||
    typeof lng !== 'number' ||
    !Number.isFinite(lat) ||
    !Number.isFinite(lng) ||
    lat < -90 ||
    lat > 90 ||
    lng < -180 ||
    lng > 180
  ) {
    return {
      covered: false,
      distanceToBoundaryMeters: Infinity,
      matchedDistrict: null,
      matchedSubRegion: null,
    };
  }

  const { indexed } = loadDelhiNcrBoundaryDataset();

  for (const entry of indexed) {
    if (
      lat < entry.minLat - 1e-9 ||
      lat > entry.maxLat + 1e-9 ||
      lng < entry.minLng - 1e-9 ||
      lng > entry.maxLng + 1e-9
    ) {
      continue;
    }
    const { geometry, properties } = entry.feature;
    const hit =
      geometry.type === 'Polygon'
        ? polygonCoversPoint(lng, lat, geometry.coordinates)
        : geometry.coordinates.some((poly) => polygonCoversPoint(lng, lat, poly));
    if (hit) {
      return {
        covered: true,
        distanceToBoundaryMeters: 0,
        matchedDistrict: properties.officialName,
        matchedSubRegion: properties.subRegion,
      };
    }
  }

  const distanceToBoundaryMeters = computeMinDistanceToBoundaryMeters(lat, lng);

  return {
    covered: false,
    distanceToBoundaryMeters,
    matchedDistrict: null,
    matchedSubRegion: null,
  };
}
