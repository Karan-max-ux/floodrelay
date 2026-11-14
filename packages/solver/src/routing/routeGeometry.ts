import type {
  BlockedZone,
  BoundingBox,
  GeoPoint,
  RescueResource,
  ResourceRoute,
  ResourceType,
  RouteGeometry,
  RouteGeometrySource,
  RouteLegGeometry,
} from '@floodrelay/shared';
import {
  StraightLineTravelTimeProvider,
  type TravelEstimate,
  type TravelTimeProvider,
} from './travelTime.js';
import {
  OsrmTravelTimeProvider,
  resolveOsrmRegionConfigs,
  type OsrmProviderOptions,
  type OsrmRegionConfig,
} from './osrmTravelTime.js';
import { isPointInBbox } from './regionalTravelTime.js';
import { HazardAwareTravelTimeProvider } from './hazardAwareTravelTime.js';
import type { HazardPolicyOptions } from './blockedZones.js';

export interface RouteGeometryEnrichOptions {
  resources?: RescueResource[];
  osrm?: OsrmProviderOptions | null;
  regions?: OsrmRegionConfig[];
  coverageBbox?: BoundingBox;
  blockedZones?: BlockedZone[];
  hazardPolicy?: HazardPolicyOptions;
  travelTimeProvider?: TravelTimeProvider;
  straightLineProvider?: TravelTimeProvider;
}

export interface RouteGeometryStats {
  routesProcessed: number;
  osrmRouteRequests: number;
  osrmRouteFailedRequests: number;
  legsOsrm: number;
  legsStraightLinePolicy: number;
  legsOutsideCoverage: number;
  legsFallback: number;
}

export interface EnrichedRoutesResult {
  routes: ResourceRoute[];
  stats: RouteGeometryStats;
}

interface ActiveRouteRegion {
  id: string;
  bbox?: BoundingBox;
  provider: OsrmTravelTimeProvider;
}

const VERTEX_EPSILON = 1e-6;

function coordsEqual(a: [number, number], b: [number, number]): boolean {
  return Math.abs(a[0] - b[0]) < VERTEX_EPSILON && Math.abs(a[1] - b[1]) < VERTEX_EPSILON;
}

/**
 * Concatenates per-leg coordinate arrays while deduplicating shared stop vertices.
 */
export function mergeRouteCoordinates(
  legs: ReadonlyArray<ReadonlyArray<[number, number]>>,
): [number, number][] {
  const merged: [number, number][] = [];
  for (const legCoords of legs) {
    for (const pt of legCoords) {
      const prev = merged[merged.length - 1];
      if (!prev || !coordsEqual(prev, pt)) {
        merged.push([pt[0], pt[1]]);
      }
    }
  }
  return merged;
}

function applyHazardZonesToBaseEstimate(
  base: TravelEstimate,
  from: GeoPoint,
  to: GeoPoint,
  speedKmH: number | undefined,
  resourceType: ResourceType | undefined,
  blockedZones: BlockedZone[] | undefined,
  hazardPolicy: HazardPolicyOptions | undefined,
): TravelEstimate {
  if (!blockedZones || blockedZones.length === 0) {
    return base;
  }

  const singleLegProvider: TravelTimeProvider = {
    getTravelEstimate: () => base,
    getMatrix: (origins, destinations) => origins.map(() => destinations.map(() => base)),
  };

  const hazardProvider = new HazardAwareTravelTimeProvider(
    singleLegProvider,
    blockedZones,
    hazardPolicy,
  );
  const adjusted = hazardProvider.getTravelEstimate(from, to, speedKmH, undefined, resourceType);

  // Never serialize Infinity into RouteGeometry JSON distances/durations.
  if (!Number.isFinite(adjusted.distanceKm) || !Number.isFinite(adjusted.durationMinutes)) {
    return base;
  }
  return adjusted;
}

function resolveRegionEntries(options: RouteGeometryEnrichOptions): ActiveRouteRegion[] {
  const configs = resolveOsrmRegionConfigs(options.osrm, options.regions);
  if (
    configs.length === 1 &&
    configs[0]?.id === 'default' &&
    configs[0].bbox === undefined &&
    options.coverageBbox
  ) {
    configs[0] = { ...configs[0], bbox: options.coverageBbox };
  }

  return configs.map((rc) => ({
    id: rc.id,
    bbox: rc.bbox,
    provider: new OsrmTravelTimeProvider({
      baseUrl: rc.baseUrl,
      profile: rc.profile ?? options.osrm?.profile,
      timeoutMs: options.osrm?.timeoutMs,
      fallbackProvider: options.straightLineProvider ?? options.osrm?.fallbackProvider,
      fetchImpl: options.osrm?.fetchImpl,
      useResourceSpeed: options.osrm?.useResourceSpeed,
    }),
  }));
}

function buildFallbackEstimate(
  from: GeoPoint,
  to: GeoPoint,
  speedKmH: number | undefined,
  resourceType: ResourceType | undefined,
  travelTimeProvider: TravelTimeProvider | undefined,
  straightLineProvider: TravelTimeProvider,
  blockedZones: BlockedZone[] | undefined,
  hazardPolicy: HazardPolicyOptions | undefined,
): TravelEstimate {
  if (travelTimeProvider) {
    const est = travelTimeProvider.getTravelEstimate(from, to, speedKmH, undefined, resourceType);
    if (Number.isFinite(est.distanceKm) && Number.isFinite(est.durationMinutes)) {
      return est;
    }
  }

  const base = straightLineProvider.getTravelEstimate(from, to, speedKmH, undefined, resourceType);
  return applyHazardZonesToBaseEstimate(
    base,
    from,
    to,
    speedKmH,
    resourceType,
    blockedZones,
    hazardPolicy,
  );
}

/**
 * Enriches solver routes with full road-following OSRM leg geometries (where covered
 * for road vehicles) and straight-line segments (BOAT/HELICOPTER, out-of-coverage, or fallback).
 */
export async function enrichRoutesWithGeometry(
  routes: ResourceRoute[],
  options: RouteGeometryEnrichOptions = {},
): Promise<EnrichedRoutesResult> {
  const straightLineProvider =
    options.straightLineProvider ??
    options.osrm?.fallbackProvider ??
    new StraightLineTravelTimeProvider();

  const resourceMap = new Map<string, RescueResource>();
  for (const res of options.resources ?? []) {
    resourceMap.set(res.id, res);
  }

  const regionEntries = resolveRegionEntries(options);
  const fetchedKeys = new Set<string>();
  const stats: RouteGeometryStats = {
    routesProcessed: routes.length,
    osrmRouteRequests: 0,
    osrmRouteFailedRequests: 0,
    legsOsrm: 0,
    legsStraightLinePolicy: 0,
    legsOutsideCoverage: 0,
    legsFallback: 0,
  };

  const enrichedRoutes: ResourceRoute[] = [];

  for (const route of routes) {
    const resource = resourceMap.get(route.resourceId);
    const speedKmH = resource?.speedKmH;
    const resourceType = resource?.type;
    const orderedStops = [...route.stops].sort((a, b) => a.stopNumber - b.stopNumber);

    if (orderedStops.length === 0) {
      const emptyCoords: [number, number][] = resource ? [[resource.lat, resource.lng]] : [];
      enrichedRoutes.push({
        ...route,
        geometry: {
          coordinates: emptyCoords,
          distanceKm: 0,
          durationMinutes: 0,
          source: 'STRAIGHT_LINE',
          legs: [],
        },
      });
      continue;
    }

    const nodes: Array<{ stopNumber: number; lat: number; lng: number }> = [];
    if (resource && orderedStops[0]!.type !== 'DEPOT') {
      nodes.push({ stopNumber: 0, lat: resource.lat, lng: resource.lng });
    }
    for (const stop of orderedStops) {
      nodes.push({ stopNumber: stop.stopNumber, lat: stop.lat, lng: stop.lng });
    }

    if (nodes.length < 2) {
      const onlyNode = nodes[0]!;
      enrichedRoutes.push({
        ...route,
        geometry: {
          coordinates: [[onlyNode.lat, onlyNode.lng]],
          distanceKm: 0,
          durationMinutes: 0,
          source: 'STRAIGHT_LINE',
          legs: [],
        },
      });
      continue;
    }

    const legs: RouteLegGeometry[] = [];
    const isStraightLineResource = resourceType === 'BOAT' || resourceType === 'HELICOPTER';

    for (let i = 0; i < nodes.length - 1; i++) {
      const from = nodes[i]!;
      const to = nodes[i + 1]!;
      const straightCoords: [number, number][] = [
        [from.lat, from.lng],
        [to.lat, to.lng],
      ];

      if (isStraightLineResource || regionEntries.length === 0) {
        stats.legsStraightLinePolicy++;
        const est = buildFallbackEstimate(
          from,
          to,
          speedKmH,
          resourceType,
          options.travelTimeProvider,
          straightLineProvider,
          options.blockedZones,
          options.hazardPolicy,
        );
        legs.push({
          fromStopNumber: from.stopNumber,
          toStopNumber: to.stopNumber,
          distanceKm: Number(est.distanceKm.toFixed(3)),
          durationMinutes: Number(est.durationMinutes.toFixed(2)),
          source: 'STRAIGHT_LINE',
          coordinates: straightCoords,
        });
        continue;
      }

      const matchedRegion = regionEntries.find(
        (region) =>
          !region.bbox || (isPointInBbox(from, region.bbox) && isPointInBbox(to, region.bbox)),
      );

      if (!matchedRegion) {
        stats.legsOutsideCoverage++;
        const est = buildFallbackEstimate(
          from,
          to,
          speedKmH,
          resourceType,
          options.travelTimeProvider,
          straightLineProvider,
          options.blockedZones,
          options.hazardPolicy,
        );
        legs.push({
          fromStopNumber: from.stopNumber,
          toStopNumber: to.stopNumber,
          distanceKm: Number(est.distanceKm.toFixed(3)),
          durationMinutes: Number(est.durationMinutes.toFixed(2)),
          source: 'STRAIGHT_LINE',
          coordinates: straightCoords,
        });
        continue;
      }

      const reqKey = `${matchedRegion.id}:${from.lat.toFixed(6)},${from.lng.toFixed(6)}->${to.lat.toFixed(6)},${to.lng.toFixed(6)}`;
      const isNewFetch = !fetchedKeys.has(reqKey);
      if (isNewFetch) {
        fetchedKeys.add(reqKey);
        stats.osrmRouteRequests++;
      }

      const osrmLeg = await matchedRegion.provider.fetchRouteLegGeometry(from, to, speedKmH);
      if (osrmLeg) {
        stats.legsOsrm++;
        const adjusted = applyHazardZonesToBaseEstimate(
          {
            distanceKm: osrmLeg.distanceKm,
            durationMinutes: osrmLeg.durationMinutes,
            source: 'OSRM',
          },
          from,
          to,
          speedKmH,
          resourceType,
          options.blockedZones,
          options.hazardPolicy,
        );
        legs.push({
          fromStopNumber: from.stopNumber,
          toStopNumber: to.stopNumber,
          distanceKm: Number(adjusted.distanceKm.toFixed(3)),
          durationMinutes: Number(adjusted.durationMinutes.toFixed(2)),
          source: 'OSRM',
          coordinates: osrmLeg.coordinates,
        });
      } else {
        if (isNewFetch) {
          stats.osrmRouteFailedRequests++;
        }
        stats.legsFallback++;
        const est = buildFallbackEstimate(
          from,
          to,
          speedKmH,
          resourceType,
          options.travelTimeProvider,
          straightLineProvider,
          options.blockedZones,
          options.hazardPolicy,
        );
        legs.push({
          fromStopNumber: from.stopNumber,
          toStopNumber: to.stopNumber,
          distanceKm: Number(est.distanceKm.toFixed(3)),
          durationMinutes: Number(est.durationMinutes.toFixed(2)),
          source: 'STRAIGHT_LINE',
          coordinates: straightCoords,
        });
      }
    }

    const coordinates = mergeRouteCoordinates(legs.map((l) => l.coordinates));
    const distanceKm = Number(legs.reduce((sum, l) => sum + l.distanceKm, 0).toFixed(3));
    const durationMinutes = Number(legs.reduce((sum, l) => sum + l.durationMinutes, 0).toFixed(2));
    const osrmCount = legs.filter((l) => l.source === 'OSRM').length;
    let source: RouteGeometrySource;
    if (legs.length > 0 && osrmCount === legs.length) {
      source = 'OSRM';
    } else if (osrmCount > 0) {
      source = 'MIXED';
    } else {
      source = 'STRAIGHT_LINE';
    }

    const geometry: RouteGeometry = {
      coordinates,
      distanceKm,
      durationMinutes,
      source,
      legs,
    };

    enrichedRoutes.push({
      ...route,
      geometry,
    });
  }

  return {
    routes: enrichedRoutes,
    stats,
  };
}
