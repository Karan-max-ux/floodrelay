import type { GeoPoint, Scenario } from '@floodrelay/shared';
import { StraightLineTravelTimeProvider, type TravelTimeProvider } from './travelTime.js';
import { OsrmTravelTimeProvider, type OsrmProviderOptions } from './osrmTravelTime.js';
import { HazardAwareTravelTimeProvider } from './hazardAwareTravelTime.js';

export interface TravelTimeReport {
  effectiveSource: 'OSRM' | 'STRAIGHT_LINE' | 'MIXED';
  osrmConfigured: boolean;
  osrmRequests: number;
  osrmFailedRequests: number;
  lookupsOsrm: number;
  lookupsStraightLinePolicy: number;
  lookupsFallback: number;
  roadCoveragePercent: number | null;
  hazardZoneCount: number;
  warnings: string[];
}

export interface TravelTimeFactoryOptions {
  osrm?: OsrmProviderOptions | null;
  pointLimit?: number; // default 500
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
 * Parses OSRM environment variables safely without throwing.
 * Returns null if OSRM_BASE_URL is blank or missing.
 */
export function osrmConfigFromEnv(
  env: Record<string, string | undefined> = process.env,
): OsrmProviderOptions | null {
  const rawUrl = env.OSRM_BASE_URL?.trim();
  if (!rawUrl) {
    return null;
  }

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

  return {
    baseUrl: rawUrl,
    profile,
    timeoutMs,
    maxTableCoordinates,
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

/**
 * Prepares a synchronous TravelTimeProvider for a scenario, optionally prefetching
 * road network durations from OSRM and decorating with hazard zones if present.
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
  let osrmProvider: OsrmTravelTimeProvider | null = null;

  if (osrmOptions) {
    osrmProvider = new OsrmTravelTimeProvider(osrmOptions);
    baseProvider = osrmProvider;

    // Per-resource routing policy: If the scenario has no road vehicles, prefetch must make zero OSRM requests.
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

      const uniqueOrigins = dedupePoints(rawOrigins);
      const uniqueDestinations = dedupePoints(rawDestinations);
      const allUniqueRoadPoints = dedupePoints([...uniqueOrigins, ...uniqueDestinations]);
      const totalPointCount = allUniqueRoadPoints.length;

      if (totalPointCount > pointLimit) {
        const msg = `Total unique points (${totalPointCount}) exceed OSRM limit (${pointLimit}); falling back to straight-line provider.`;
        console.warn(`[travelTimeFactory] ${msg}`);
        warnings.push(msg);
      } else {
        try {
          await osrmProvider.prefetch(uniqueOrigins, uniqueDestinations);
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          const msg = `OSRM prefetch failed with error: ${errorMsg}; falling back to straight-line provider.`;
          console.warn(`[travelTimeFactory] ${msg}`);
          warnings.push(msg);
        }
      }
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

    if (!osrmOptions) {
      return {
        effectiveSource: 'STRAIGHT_LINE',
        osrmConfigured: false,
        osrmRequests: 0,
        osrmFailedRequests: 0,
        lookupsOsrm: 0,
        lookupsStraightLinePolicy: 0,
        lookupsFallback: 0,
        roadCoveragePercent: null,
        hazardZoneCount,
        warnings: [...warnings],
      };
    }

    const stats = osrmProvider!.getStats();
    const totalRoadLookups = stats.lookupsOsrm + stats.lookupsFallback;

    const roadCoveragePercent =
      totalRoadLookups > 0
        ? Number(((stats.lookupsOsrm / totalRoadLookups) * 100).toFixed(1))
        : null;

    let effectiveSource: 'OSRM' | 'STRAIGHT_LINE' | 'MIXED';
    if (
      stats.lookupsOsrm > 0 &&
      stats.lookupsStraightLinePolicy === 0 &&
      stats.lookupsFallback === 0
    ) {
      effectiveSource = 'OSRM';
    } else if (
      stats.lookupsOsrm > 0 &&
      (stats.lookupsStraightLinePolicy > 0 || stats.lookupsFallback > 0)
    ) {
      effectiveSource = 'MIXED';
    } else {
      effectiveSource = 'STRAIGHT_LINE';
    }

    const reportWarnings = [...warnings];
    if (stats.failedRequests > 0) {
      reportWarnings.push(
        `OSRM had ${stats.failedRequests} failed HTTP request(s) during prefetch; straight-line fallback was used.`,
      );
    }
    if (stats.fallbackCells > 0 && stats.osrmCells > 0) {
      reportWarnings.push(
        `OSRM had ${stats.fallbackCells} fallback cell(s) due to unroutable coordinates or partial chunk failure.`,
      );
    }

    return {
      effectiveSource,
      osrmConfigured: true,
      osrmRequests: stats.requests,
      osrmFailedRequests: stats.failedRequests,
      lookupsOsrm: stats.lookupsOsrm,
      lookupsStraightLinePolicy: stats.lookupsStraightLinePolicy,
      lookupsFallback: stats.lookupsFallback,
      roadCoveragePercent,
      hazardZoneCount,
      warnings: reportWarnings,
    };
  };

  return {
    provider: effectiveProvider,
    report,
  };
}
