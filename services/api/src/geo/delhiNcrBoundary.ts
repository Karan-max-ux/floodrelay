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
  const sha256 = crypto.createHash('sha256').update(raw).digest('hex');
  const dataset = JSON.parse(raw) as NcrBoundaryDataset;

  if (dataset.type !== 'FeatureCollection' || !Array.isArray(dataset.features)) {
    throw new Error('Invalid Delhi NCR boundary GeoJSON: expected FeatureCollection');
  }

  const indexed = dataset.features.map((feature) => ({
    feature,
    ...computeFeatureBbox(feature),
  }));

  cachedDataset = { dataset, sha256, indexed };
  return cachedDataset;
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
    return { covered: false, matchedDistrict: null, matchedSubRegion: null };
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
        matchedDistrict: properties.officialName,
        matchedSubRegion: properties.subRegion,
      };
    }
  }

  return { covered: false, matchedDistrict: null, matchedSubRegion: null };
}
