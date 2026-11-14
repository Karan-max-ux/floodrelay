import type { ResourceRoute, RouteGeometrySource, RouteStop } from '@floodrelay/shared';
import type { TileTheme } from './tileConfig';

export interface RouteDisplayMetrics {
  distanceKm: number;
  durationMinutes: number;
  source: RouteGeometrySource;
  isRoadRouted: boolean;
  pickupsCount: number;
  dropoffsCount: number;
  stopsCount: number;
  vertexCount: number;
}

export interface RoutePolylineStyle {
  color: string;
  weight: number;
  opacity: number;
  dashArray?: string;
}

export interface RouteRenderSegment {
  key: string;
  positions: [number, number][];
  source: 'OSRM' | 'STRAIGHT_LINE';
  style: RoutePolylineStyle;
}

export interface AssignmentRouteSummary {
  routeCount: number;
  totalDistanceKm: number;
  totalDurationMinutes: number;
  osrmRouteCount: number;
  mixedRouteCount: number;
  straightLineRouteCount: number;
  overallSource: RouteGeometrySource;
}

function isValidLatLngTuple(pt: unknown): pt is [number, number] {
  return (
    Array.isArray(pt) &&
    pt.length >= 2 &&
    typeof pt[0] === 'number' &&
    Number.isFinite(pt[0]) &&
    typeof pt[1] === 'number' &&
    Number.isFinite(pt[1])
  );
}

/**
 * Extracts ordered [lat, lng] coordinates for rendering a route on Leaflet.
 * Prefers full road-following geometry from Task B when present; falls back to stop coordinates.
 */
export function extractRouteLatLngs(route: ResourceRoute): [number, number][] {
  const geomCoords = route.geometry?.coordinates;
  if (Array.isArray(geomCoords) && geomCoords.length >= 2) {
    const valid = geomCoords.filter(isValidLatLngTuple);
    if (valid.length >= 2) {
      return valid.map(([lat, lng]) => [lat, lng]);
    }
  }

  return (route.stops ?? [])
    .filter(
      (s: RouteStop) =>
        typeof s.lat === 'number' &&
        Number.isFinite(s.lat) &&
        typeof s.lng === 'number' &&
        Number.isFinite(s.lng),
    )
    .map((s: RouteStop) => [s.lat, s.lng]);
}

/**
 * Resolves consistent distance, duration, and routing source metrics for a route.
 */
export function getRouteDisplayMetrics(route: ResourceRoute): RouteDisplayMetrics {
  const geom = route.geometry;
  const stops = route.stops ?? [];
  const distanceKm =
    geom && typeof geom.distanceKm === 'number' && Number.isFinite(geom.distanceKm)
      ? geom.distanceKm
      : typeof route.totalTravelDistanceKm === 'number' &&
          Number.isFinite(route.totalTravelDistanceKm)
        ? route.totalTravelDistanceKm
        : 0;
  const durationMinutes =
    geom && typeof geom.durationMinutes === 'number' && Number.isFinite(geom.durationMinutes)
      ? geom.durationMinutes
      : typeof route.totalDurationMinutes === 'number' &&
          Number.isFinite(route.totalDurationMinutes)
        ? route.totalDurationMinutes
        : 0;

  const source: RouteGeometrySource = geom?.source ?? 'STRAIGHT_LINE';
  const vertexCount = extractRouteLatLngs(route).length;

  return {
    distanceKm,
    durationMinutes,
    source,
    isRoadRouted: source === 'OSRM' || source === 'MIXED',
    pickupsCount: stops.filter((s) => s.type === 'PICKUP').length,
    dropoffsCount: stops.filter((s) => s.type === 'DROPOFF').length,
    stopsCount: stops.length,
    vertexCount,
  };
}

/**
 * Google-like styling for road-following vs straight-line routes:
 * - OSRM: solid Google-blue road polyline
 * - MIXED: crisp dashed sky-blue indicator (per-leg rendering uses OSRM vs STRAIGHT_LINE per leg)
 * - STRAIGHT_LINE: dashed teal vector (BOAT / HELICOPTER / outside coverage / fallback)
 */
export function getRoutePolylineStyle(
  source: RouteGeometrySource,
  theme: TileTheme = 'standard',
): RoutePolylineStyle {
  if (source === 'OSRM') {
    return {
      color: theme === 'standard' ? '#1a73e8' : '#38bdf8',
      weight: 5,
      opacity: 0.92,
    };
  }

  if (source === 'MIXED') {
    return {
      color: theme === 'standard' ? '#0284c7' : '#22d3ee',
      weight: 4,
      opacity: 0.9,
      dashArray: '10, 5',
    };
  }

  return {
    color: theme === 'standard' ? '#0f766e' : '#14b8a6',
    weight: 3,
    opacity: 0.85,
    dashArray: '6, 8',
  };
}

/**
 * Splits a route into per-leg renderable polyline segments when mixed legs exist,
 * or returns a single polyline segment matching extractRouteLatLngs(route).
 */
export function getRouteSegmentsForRendering(
  route: ResourceRoute,
  theme: TileTheme = 'standard',
): RouteRenderSegment[] {
  const geom = route.geometry;
  if (geom?.source === 'MIXED' && Array.isArray(geom.legs) && geom.legs.length > 0) {
    const legSegments: RouteRenderSegment[] = [];
    for (let i = 0; i < geom.legs.length; i++) {
      const leg = geom.legs[i]!;
      const valid = (leg.coordinates ?? []).filter(isValidLatLngTuple);
      if (valid.length >= 2) {
        legSegments.push({
          key: `${route.resourceId}-leg-${i}`,
          positions: valid.map(([lat, lng]) => [lat, lng]),
          source: leg.source,
          style: getRoutePolylineStyle(leg.source, theme),
        });
      }
    }
    if (legSegments.length > 0) {
      return legSegments;
    }
  }

  const positions = extractRouteLatLngs(route);
  if (positions.length < 2) {
    return [];
  }
  const source = geom?.source ?? 'STRAIGHT_LINE';
  return [
    {
      key: `${route.resourceId}-full`,
      positions,
      source: source === 'OSRM' ? 'OSRM' : 'STRAIGHT_LINE',
      style: getRoutePolylineStyle(source, theme),
    },
  ];
}

/**
 * Computes plan-wide route totals and overall routing source classification.
 */
export function summarizeAssignmentRoutes(routes: ResourceRoute[] = []): AssignmentRouteSummary {
  let totalDistanceKm = 0;
  let totalDurationMinutes = 0;
  let osrmRouteCount = 0;
  let mixedRouteCount = 0;
  let straightLineRouteCount = 0;

  for (const route of routes) {
    const m = getRouteDisplayMetrics(route);
    totalDistanceKm += m.distanceKm;
    totalDurationMinutes += m.durationMinutes;
    if (m.source === 'OSRM') {
      osrmRouteCount++;
    } else if (m.source === 'MIXED') {
      mixedRouteCount++;
    } else {
      straightLineRouteCount++;
    }
  }

  let overallSource: RouteGeometrySource = 'STRAIGHT_LINE';
  if (routes.length > 0) {
    if (osrmRouteCount === routes.length) {
      overallSource = 'OSRM';
    } else if (osrmRouteCount > 0 || mixedRouteCount > 0) {
      overallSource = 'MIXED';
    }
  }

  return {
    routeCount: routes.length,
    totalDistanceKm: Number(totalDistanceKm.toFixed(2)),
    totalDurationMinutes: Number(totalDurationMinutes.toFixed(1)),
    osrmRouteCount,
    mixedRouteCount,
    straightLineRouteCount,
    overallSource,
  };
}

export function formatDistanceKm(km: number): string {
  if (!Number.isFinite(km) || km <= 0) return '0.0 km';
  return km >= 10 ? `${km.toFixed(1)} km` : `${km.toFixed(2)} km`;
}

export function formatDurationMinutes(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes <= 0) return '0 min';
  return `~${Math.round(minutes)} min`;
}

export function getRouteSourceLabel(source: RouteGeometrySource): string {
  if (source === 'OSRM') return 'OSRM Road';
  if (source === 'MIXED') return 'Mixed (Road + SL)';
  return 'Straight-Line';
}
