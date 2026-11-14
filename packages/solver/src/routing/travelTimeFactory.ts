import type { BoundingBox, GeoPoint, Scenario } from '@floodrelay/shared';
import { StraightLineTravelTimeProvider, type TravelTimeProvider } from './travelTime.js';
import {
  OsrmTravelTimeProvider,
  resolveOsrmRegionConfigs,
  type OsrmProviderOptions,
  type OsrmRegionConfig,
} from './osrmTravelTime.js';
import { RegionalTravelTimeProvider, isPointInBbox } from './regionalTravelTime.js';
import { HazardAwareTravelTimeProvider } from './hazardAwareTravelTime.js';

const DECIMAL_NUMBER_REGEX = /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/;

export interface TravelTimeRegionReport {
  id: string;
  requests: number;
  failedRequests: number;
  lookupsOsrm: number;
}

export interface TravelTimeReport {
  effectiveSource: 'OSRM' | 'STRAIGHT_LINE' | 'MIXED';
  osrmConfigured: boolean;
  osrmRequests: number;
  osrmFailedRequests: number;
  lookupsOsrm: number;
  lookupsStraightLinePolicy: number;
  lookupsFallback: number;
  lookupsOutsideCoverage: number;
  roadCoveragePercent: number | null;
  hazardZoneCount: number;
  regions: TravelTimeRegionReport[];
  warnings: string[];
}

export interface TravelTimeFactoryOptions {
  osrm?: OsrmProviderOptions | null;
  pointLimit?: number; // default 500
  coverageBbox?: BoundingBox;
  regions?: OsrmRegionConfig[];
}

export interface PreparedTravelTime {
  provider: TravelTimeProvider;
  report: () => TravelTimeReport;
}

function getPoint(p: GeoPoint): { lat: number; lng: number } {
  const lat = p.lat ?? (p as unknown as { latitude?: number }).latitude ?? 0;
  const lng = p.lng ?? (p as unknown as { longitude?: number }).longitude ?? 0;
  return { lat, lng };
}

function coordKey(p: GeoPoint): string {
  const { lat, lng } = getPoint(p);
  return `${lat.toFixed(6)},${lng.toFixed(6)}`;
}

/**
 * Parses "minLat,minLng,maxLat,maxLng" in decimal degrees into a BoundingBox.
 * Invalid values (wrong count, non-numeric, out of range, min >= max) are ignored with a warning.
 */
export function parseCoverageBbox(raw: string | undefined): BoundingBox | undefined {
  const trimmed = raw?.trim();
  if (!trimmed) {
    return undefined;
  }

  const parts = trimmed.split(',').map((p) => p.trim());
  if (parts.length !== 4) {
    console.warn(
      `[travelTimeFactory] Invalid OSRM_COVERAGE_BBOX "${trimmed}" (expected 4 comma-separated decimal values); ignoring.`,
    );
    return undefined;
  }

  if (parts.some((p) => !DECIMAL_NUMBER_REGEX.test(p))) {
    console.warn(
      `[travelTimeFactory] Invalid OSRM_COVERAGE_BBOX "${trimmed}" (non-numeric value); ignoring.`,
    );
    return undefined;
  }

  const [minLat, minLng, maxLat, maxLng] = parts.map(Number) as [number, number, number, number];
  if (
    !Number.isFinite(minLat) ||
    !Number.isFinite(minLng) ||
    !Number.isFinite(maxLat) ||
    !Number.isFinite(maxLng)
  ) {
    console.warn(
      `[travelTimeFactory] Invalid OSRM_COVERAGE_BBOX "${trimmed}" (non-finite value); ignoring.`,
    );
    return undefined;
  }

  if (
    minLat < -90 ||
    minLat > 90 ||
    maxLat < -90 ||
    maxLat > 90 ||
    minLng < -180 ||
    minLng > 180 ||
    maxLng < -180 ||
    maxLng > 180
  ) {
    console.warn(
      `[travelTimeFactory] Invalid OSRM_COVERAGE_BBOX "${trimmed}" (coordinate out of range); ignoring.`,
    );
    return undefined;
  }

  if (minLat >= maxLat || minLng >= maxLng) {
    console.warn(
      `[travelTimeFactory] Invalid OSRM_COVERAGE_BBOX "${trimmed}" (min must be strictly less than max); ignoring.`,
    );
    return undefined;
  }

  return { minLat, minLng, maxLat, maxLng };
}

function isValidHttpUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Parses OSRM_REGIONS JSON array into validated OsrmRegionConfig entries.
 * Invalid entries and duplicate region IDs are logged and skipped cleanly without throwing.
 */
export function parseOsrmRegions(
  raw: string | undefined,
  defaultProfile = 'driving',
): OsrmRegionConfig[] {
  const trimmed = raw?.trim();
  if (!trimmed) {
    return [];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    console.warn('[travelTimeFactory] Invalid OSRM_REGIONS JSON; ignoring.');
    return [];
  }

  if (!Array.isArray(parsed)) {
    console.warn('[travelTimeFactory] OSRM_REGIONS must be a JSON array; ignoring.');
    return [];
  }

  const seenIds = new Set<string>();
  const validRegions: OsrmRegionConfig[] = [];

  for (let i = 0; i < parsed.length; i++) {
    const entry = parsed[i];
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      console.warn(`[travelTimeFactory] Invalid OSRM_REGIONS entry at index ${i}; skipping.`);
      continue;
    }

    const record = entry as Record<string, unknown>;
    const rawId = typeof record.id === 'string' ? record.id.trim() : '';
    if (!rawId) {
      console.warn(
        `[travelTimeFactory] OSRM_REGIONS entry at index ${i} is missing a non-empty "id"; skipping.`,
      );
      continue;
    }

    if (seenIds.has(rawId)) {
      console.warn(
        `[travelTimeFactory] Duplicate OSRM_REGIONS id "${rawId}" at index ${i}; skipping.`,
      );
      continue;
    }

    const rawBaseUrl = typeof record.baseUrl === 'string' ? record.baseUrl.trim() : '';
    if (!rawBaseUrl || !isValidHttpUrl(rawBaseUrl)) {
      console.warn(
        `[travelTimeFactory] OSRM_REGIONS entry "${rawId}" has invalid "baseUrl"; skipping.`,
      );
      continue;
    }

    const rawBbox = typeof record.bbox === 'string' ? record.bbox : undefined;
    const bbox = parseCoverageBbox(rawBbox);
    if (!bbox) {
      console.warn(
        `[travelTimeFactory] OSRM_REGIONS entry "${rawId}" has missing or invalid "bbox"; skipping.`,
      );
      continue;
    }

    let profile = defaultProfile;
    if (record.profile !== undefined) {
      if (typeof record.profile !== 'string' || !record.profile.trim()) {
        console.warn(
          `[travelTimeFactory] OSRM_REGIONS entry "${rawId}" has invalid "profile"; skipping.`,
        );
        continue;
      }
      profile = record.profile.trim();
    }

    seenIds.add(rawId);
    validRegions.push({
      id: rawId,
      baseUrl: rawBaseUrl.replace(/\/+$/, ''),
      bbox,
      profile,
    });
  }

  return validRegions;
}

/**
 * Parses OSRM environment variables safely without throwing.
 * Supports multi-region OSRM_REGIONS JSON or single-region OSRM_BASE_URL (+ optional OSRM_COVERAGE_BBOX).
 * Returns null if neither OSRM_REGIONS nor OSRM_BASE_URL produces a valid configuration.
 */
export function osrmConfigFromEnv(
  env: Record<string, string | undefined> = process.env,
): OsrmProviderOptions | null {
  const profile = env.OSRM_PROFILE?.trim() || 'driving';

  let timeoutMs: number | undefined;
  const rawTimeout = env.OSRM_TIMEOUT_MS?.trim();
  if (rawTimeout) {
    const parsed = Number(rawTimeout);
    if (Number.isFinite(parsed) && parsed > 0) {
      timeoutMs = parsed;
    } else {
      console.warn(`[travelTimeFactory] Invalid OSRM_TIMEOUT_MS "${rawTimeout}"; ignoring.`);
    }
  }

  let maxTableCoordinates: number | undefined;
  const rawMaxCoords = env.OSRM_MAX_TABLE_COORDINATES?.trim();
  if (rawMaxCoords) {
    const parsed = Number(rawMaxCoords);
    if (Number.isFinite(parsed) && parsed >= 2) {
      maxTableCoordinates = parsed;
    } else {
      console.warn(
        `[travelTimeFactory] Invalid OSRM_MAX_TABLE_COORDINATES "${rawMaxCoords}"; ignoring.`,
      );
    }
  }

  const rawRegions = env.OSRM_REGIONS?.trim();
  if (rawRegions) {
    const regions = parseOsrmRegions(rawRegions, profile);
    if (regions.length === 0) {
      console.warn(
        '[travelTimeFactory] OSRM_REGIONS produced no valid region entries; disabling OSRM routing.',
      );
      return null;
    }
    return {
      profile,
      timeoutMs,
      maxTableCoordinates,
      regions,
    };
  }

  const rawUrl = env.OSRM_BASE_URL?.trim();
  if (!rawUrl) {
    return null;
  }

  const coverageBbox = parseCoverageBbox(env.OSRM_COVERAGE_BBOX);

  return {
    baseUrl: rawUrl,
    profile,
    timeoutMs,
    maxTableCoordinates,
    ...(coverageBbox ? { coverageBbox } : {}),
  };
}

/**
 * Deduplicates an array of GeoPoints based on coordinate precision.
 */
function dedupePoints(points: GeoPoint[]): GeoPoint[] {
  const seen = new Set<string>();
  const unique: GeoPoint[] = [];

  for (const p of points) {
    const key = coordKey(p);
    if (!seen.has(key)) {
      seen.add(key);
      unique.push({ lat: p.lat, lng: p.lng });
    }
  }

  return unique;
}

interface ActiveRegionEntry {
  id: string;
  bbox?: BoundingBox;
  provider: OsrmTravelTimeProvider;
}

/**
 * Prepares a synchronous TravelTimeProvider for a scenario, optionally prefetching
 * road network durations from one or more regional OSRM endpoints and decorating with hazard zones.
 */
export async function prepareTravelTimeProvider(
  scenario: Scenario,
  options: TravelTimeFactoryOptions = {},
): Promise<PreparedTravelTime> {
  const warnings: string[] = [];
  const pointLimit = options.pointLimit ?? 500;
  const osrmOptions = options.osrm;

  // 1. Gather all origins and destinations
  const resources = scenario.resources ?? [];
  const roadResources = resources.filter(
    (r) => r.type === 'HIGH_WATER_VEHICLE' || r.type === 'AMBULANCE',
  );
  const hasRoadVehicles = roadResources.length > 0;
  const requests = scenario.requests ?? [];
  const shelters = scenario.shelters ?? [];

  let baseProvider: TravelTimeProvider;
  const activeRegions: ActiveRegionEntry[] = [];
  let regionalProvider: RegionalTravelTimeProvider | null = null;

  if (osrmOptions || (options.regions && options.regions.length > 0)) {
    const regionConfigs = resolveOsrmRegionConfigs(osrmOptions, options.regions);
    if (
      regionConfigs.length === 1 &&
      regionConfigs[0]?.id === 'default' &&
      regionConfigs[0].bbox === undefined
    ) {
      regionConfigs[0] = {
        ...regionConfigs[0],
        bbox: options.coverageBbox,
      };
    }

    for (const rc of regionConfigs) {
      activeRegions.push({
        id: rc.id,
        bbox: rc.bbox,
        provider: new OsrmTravelTimeProvider({
          baseUrl: rc.baseUrl,
          profile: rc.profile ?? osrmOptions?.profile,
          timeoutMs: osrmOptions?.timeoutMs,
          maxTableCoordinates: osrmOptions?.maxTableCoordinates,
          fallbackProvider: osrmOptions?.fallbackProvider,
          fetchImpl: osrmOptions?.fetchImpl,
          useResourceSpeed: osrmOptions?.useResourceSpeed,
        }),
      });
    }

    if (activeRegions.length > 0) {
      const hasAnyUnboundedRegion = activeRegions.some((r) => r.bbox === undefined);
      if (!hasAnyUnboundedRegion) {
        const allScenarioPoints = dedupePoints([
          ...resources.map((r) => ({ lat: r.lat, lng: r.lng })),
          ...requests.map((r) => ({ lat: r.lat, lng: r.lng })),
          ...shelters.map((s) => ({ lat: s.lat, lng: s.lng })),
        ]);
        const outsideScenarioPoints = allScenarioPoints.filter(
          (p) => !activeRegions.some((r) => isPointInBbox(p, r.bbox!)),
        );
        if (outsideScenarioPoints.length > 0) {
          const msg = `${outsideScenarioPoints.length} of ${allScenarioPoints.length} scenario points are outside every configured OSRM region; straight-line estimates used`;
          console.warn(`[travelTimeFactory] ${msg}`);
          warnings.push(msg);
        }
      }

      // Check per-scenario point limit (not per region) before dispatching any OSRM requests.
      if (hasRoadVehicles) {
        const rawOrigins: GeoPoint[] = [
          ...roadResources.map((r) => ({ lat: r.lat, lng: r.lng })),
          ...requests.map((r) => ({ lat: r.lat, lng: r.lng })),
          ...shelters.map((s) => ({ lat: s.lat, lng: s.lng })),
        ];

        const rawDestinations: GeoPoint[] = [
          ...requests.map((r) => ({ lat: r.lat, lng: r.lng })),
          ...shelters.map((s) => ({ lat: s.lat, lng: s.lng })),
        ];

        const uniqueScenarioOrigins = dedupePoints(rawOrigins);
        const uniqueScenarioDestinations = dedupePoints(rawDestinations);
        const allUniqueRoadPoints = dedupePoints([
          ...uniqueScenarioOrigins,
          ...uniqueScenarioDestinations,
        ]);
        const totalPointCount = allUniqueRoadPoints.length;

        if (totalPointCount > pointLimit) {
          const msg = `Total unique points (${totalPointCount}) exceed OSRM limit (${pointLimit}); falling back to straight-line provider.`;
          console.warn(`[travelTimeFactory] ${msg}`);
          warnings.push(msg);
        } else {
          for (const region of activeRegions) {
            const regionOrigins = region.bbox
              ? uniqueScenarioOrigins.filter((p) => isPointInBbox(p, region.bbox!))
              : uniqueScenarioOrigins;
            const regionDestinations = region.bbox
              ? uniqueScenarioDestinations.filter((p) => isPointInBbox(p, region.bbox!))
              : uniqueScenarioDestinations;

            if (regionOrigins.length === 0 || regionDestinations.length === 0) {
              continue;
            }

            try {
              await region.provider.prefetch(regionOrigins, regionDestinations);
            } catch (err) {
              const errorMsg = err instanceof Error ? err.message : String(err);
              const msg = `OSRM prefetch failed for region "${region.id}": ${errorMsg}; falling back to straight-line provider.`;
              console.warn(`[travelTimeFactory] ${msg}`);
              warnings.push(msg);
            }
          }
        }
      }

      regionalProvider = new RegionalTravelTimeProvider(activeRegions);
      baseProvider = regionalProvider;
    } else {
      baseProvider = new StraightLineTravelTimeProvider();
    }
  } else {
    baseProvider = new StraightLineTravelTimeProvider();
  }

  // 2. Wrap with HazardAwareTravelTimeProvider if blockedZones are present
  const blockedZones = scenario.blockedZones ?? [];
  let effectiveProvider = baseProvider;
  if (blockedZones.length > 0) {
    effectiveProvider = new HazardAwareTravelTimeProvider(baseProvider, blockedZones);
  }

  // 3. Create the report generator function (evaluated after solving)
  const report = (): TravelTimeReport => {
    const hazardZoneCount = blockedZones.length;

    if (!osrmOptions || activeRegions.length === 0) {
      return {
        effectiveSource: 'STRAIGHT_LINE',
        osrmConfigured: false,
        osrmRequests: 0,
        osrmFailedRequests: 0,
        lookupsOsrm: 0,
        lookupsStraightLinePolicy: 0,
        lookupsFallback: 0,
        lookupsOutsideCoverage: 0,
        roadCoveragePercent: null,
        hazardZoneCount,
        regions: [],
        warnings: [...warnings],
      };
    }

    const regionalStats = regionalProvider!.getStats();
    const lookupsOutsideCoverage = regionalStats.lookupsOutsideCoverage;
    let requestsTotal = 0;
    let failedRequestsTotal = 0;
    let lookupsOsrmTotal = 0;
    let lookupsFallbackTotal = 0;
    let lookupsPolicyTotal = regionalStats.lookupsStraightLinePolicy;
    let osrmCellsTotal = 0;
    let fallbackCellsTotal = 0;
    const regionsReport: TravelTimeRegionReport[] = [];

    for (const region of activeRegions) {
      const s = region.provider.getStats();
      requestsTotal += s.requests;
      failedRequestsTotal += s.failedRequests;
      lookupsOsrmTotal += s.lookupsOsrm;
      lookupsFallbackTotal += s.lookupsFallback;
      lookupsPolicyTotal += s.lookupsStraightLinePolicy;
      osrmCellsTotal += s.osrmCells;
      fallbackCellsTotal += s.fallbackCells;
      regionsReport.push({
        id: region.id,
        requests: s.requests,
        failedRequests: s.failedRequests,
        lookupsOsrm: s.lookupsOsrm,
      });
    }

    const totalRoadLookups = lookupsOsrmTotal + lookupsFallbackTotal + lookupsOutsideCoverage;

    const roadCoveragePercent =
      totalRoadLookups > 0
        ? Number(((lookupsOsrmTotal / totalRoadLookups) * 100).toFixed(1))
        : null;

    let effectiveSource: 'OSRM' | 'STRAIGHT_LINE' | 'MIXED';
    if (
      lookupsOsrmTotal > 0 &&
      lookupsPolicyTotal === 0 &&
      lookupsFallbackTotal === 0 &&
      lookupsOutsideCoverage === 0
    ) {
      effectiveSource = 'OSRM';
    } else if (
      lookupsOsrmTotal > 0 &&
      (lookupsPolicyTotal > 0 || lookupsFallbackTotal > 0 || lookupsOutsideCoverage > 0)
    ) {
      effectiveSource = 'MIXED';
    } else {
      effectiveSource = 'STRAIGHT_LINE';
    }

    const reportWarnings = [...warnings];
    if (failedRequestsTotal > 0) {
      reportWarnings.push(
        `OSRM had ${failedRequestsTotal} failed HTTP request(s) during prefetch; straight-line fallback was used.`,
      );
    }
    if (fallbackCellsTotal > 0 && osrmCellsTotal > 0) {
      reportWarnings.push(
        `OSRM had ${fallbackCellsTotal} fallback cell(s) due to unroutable coordinates or partial chunk failure.`,
      );
    }

    return {
      effectiveSource,
      osrmConfigured: true,
      osrmRequests: requestsTotal,
      osrmFailedRequests: failedRequestsTotal,
      lookupsOsrm: lookupsOsrmTotal,
      lookupsStraightLinePolicy: lookupsPolicyTotal,
      lookupsFallback: lookupsFallbackTotal,
      lookupsOutsideCoverage,
      roadCoveragePercent,
      hazardZoneCount,
      regions: regionsReport,
      warnings: reportWarnings,
    };
  };

  return {
    provider: effectiveProvider,
    report,
  };
}
