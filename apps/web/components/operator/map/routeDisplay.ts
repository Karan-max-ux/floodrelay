import type { ResourceRoute, RouteGeometrySource, RouteStop } from '@floodrelay/shared';
import type { TileTheme } from './tileConfig';

export type RouteMode = 'ROAD' | 'DIRECT';

export interface RouteDisplayMetrics {
  distanceKm: number;
  durationMinutes: number;
  source: RouteGeometrySource;
  isRoadRouted: boolean;
  pickupsCount: number;
  dropoffsCount: number;
  stopsCount: number;
  vertexCount: number;
  mode?: RouteMode;
  hasUnavailableRoadSegments?: boolean;
  unavailableSegmentCount?: number;
  unavailableReasons?: string[];
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
  isUnavailable?: boolean;
  unavailableReason?: string;
  fromStopNumber?: number;
  toStopNumber?: number;
  isNonRoadResource?: boolean;
}

export interface AssignmentRouteSummary {
  routeCount: number;
  totalDistanceKm: number;
  totalDurationMinutes: number;
  osrmRouteCount: number;
  mixedRouteCount: number;
  straightLineRouteCount: number;
  overallSource: RouteGeometrySource;
  mode: RouteMode;
  hasUnavailableRoadSegments: boolean;
  unavailableSegmentCount: number;
}

export function isValidLatLngTuple(pt: unknown): pt is [number, number] {
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
 * Determines whether a resource is a non-road resource (BOAT or HELICOPTER).
 * Non-road resources maintain domain-level straight-line/transit vector routing.
 */
export function isNonRoadResource(
  resourceId: string,
  resourceType?: string,
  resourceTypeMap?: Map<string, string>,
): boolean {
  const type = (resourceType || resourceTypeMap?.get(resourceId) || '').toUpperCase();
  if (type === 'BOAT' || type === 'HELICOPTER') return true;
  if (type === 'HIGH_WATER_VEHICLE' || type === 'AMBULANCE' || type === 'TRUCK') return false;
  const idLower = resourceId.toLowerCase();
  return (
    idLower.includes('boat') ||
    idLower.includes('heli') ||
    idLower.includes('watercraft') ||
    idLower === 'air' ||
    idLower.startsWith('air_') ||
    idLower.startsWith('air-') ||
    idLower.endsWith('_air') ||
    idLower.endsWith('-air') ||
    idLower.includes('_air_') ||
    idLower.includes('-air-')
  );
}

/**
 * Calculates great-circle (haversine) direct geographic distance in kilometers between two coordinates.
 */
export function computeDirectDistanceKm(p1: [number, number], p2: [number, number]): number {
  const [lat1, lon1] = p1;
  const [lat2, lon2] = p2;
  const R = 6371; // Earth's mean radius in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Number((R * c).toFixed(3));
}

/**
 * Calculates total direct straight-line distance along a route's stops.
 */
export function computeRouteDirectDistanceKm(route: ResourceRoute): number {
  const stops = (route.stops ?? []).filter(
    (s: RouteStop) =>
      typeof s.lat === 'number' &&
      Number.isFinite(s.lat) &&
      typeof s.lng === 'number' &&
      Number.isFinite(s.lng),
  );
  if (stops.length < 2) return 0;
  let total = 0;
  for (let i = 0; i < stops.length - 1; i++) {
    total += computeDirectDistanceKm(
      [stops[i]!.lat, stops[i]!.lng],
      [stops[i + 1]!.lat, stops[i + 1]!.lng],
    );
  }
  return Number(total.toFixed(2));
}

/**
 * Extracts ordered [lat, lng] coordinates for rendering a route on Leaflet.
 * Prefers full road-following geometry when present; falls back to stop coordinates.
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
 * Google-like styling for road-following vs straight-line routes:
 * - OSRM: solid Google-blue road polyline
 * - MIXED: crisp dashed sky-blue indicator
 * - STRAIGHT_LINE: dashed teal vector (BOAT / HELICOPTER / Direct Air)
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
 * Splits a route into renderable polyline segments according to selected RouteMode.
 *
 * Confirmed Road Routing Failure Policy:
 * - When Road Route mode is selected:
 *   1. Use OSRM road geometry if available.
 *   2. If OSRM returns NoRoute, times out, returns an error, or provides invalid/missing geometry:
 *      - Do NOT draw a straight-line replacement.
 *      - Do NOT draw a dashed fallback line.
 *      - positions is empty [] so no line is rendered.
 *      - Segment is flagged with isUnavailable: true and an explanatory message.
 * - When Direct / Air mode is selected:
 *   - Renders straight-line connections between route stops.
 * - Non-road resources (BOAT / HELICOPTER) maintain their domain-level waterway/air transit vector.
 */
export function getRouteSegmentsForRendering(
  route: ResourceRoute,
  theme: TileTheme = 'standard',
  mode: RouteMode = 'ROAD',
  resourceType?: string,
  resourceTypeMap?: Map<string, string>,
): RouteRenderSegment[] {
  const isNonRoad = isNonRoadResource(route.resourceId, resourceType, resourceTypeMap);
  const stops = (route.stops ?? []).filter(
    (s: RouteStop) =>
      typeof s.lat === 'number' &&
      Number.isFinite(s.lat) &&
      typeof s.lng === 'number' &&
      Number.isFinite(s.lng),
  );

  // 1. DIRECT / AIR MODE:
  // Renders straight-line connection between relevant stops.
  if (mode === 'DIRECT') {
    if (stops.length < 2) {
      if (Array.isArray(route.geometry?.legs) && route.geometry.legs.length > 0) {
        const directSegments: RouteRenderSegment[] = [];
        for (let i = 0; i < route.geometry.legs.length; i++) {
          const leg = route.geometry.legs[i]!;
          const valid = (leg.coordinates ?? []).filter(isValidLatLngTuple);
          if (valid.length >= 2) {
            const from = valid[0]!;
            const to = valid[valid.length - 1]!;
            directSegments.push({
              key: `${route.resourceId}-direct-leg-${i}`,
              positions: [
                [from[0], from[1]],
                [to[0], to[1]],
              ],
              source: 'STRAIGHT_LINE',
              style: getRoutePolylineStyle('STRAIGHT_LINE', theme),
              isUnavailable: false,
              fromStopNumber: leg.fromStopNumber,
              toStopNumber: leg.toStopNumber,
              isNonRoadResource: isNonRoad,
            });
          }
        }
        if (directSegments.length > 0) return directSegments;
      }
      return [];
    }
    const directSegments: RouteRenderSegment[] = [];
    for (let i = 0; i < stops.length - 1; i++) {
      const from = stops[i]!;
      const to = stops[i + 1]!;
      directSegments.push({
        key: `${route.resourceId}-direct-leg-${i}`,
        positions: [
          [from.lat, from.lng],
          [to.lat, to.lng],
        ],
        source: 'STRAIGHT_LINE',
        style: getRoutePolylineStyle('STRAIGHT_LINE', theme),
        isUnavailable: false,
        fromStopNumber: from.stopNumber,
        toStopNumber: to.stopNumber,
        isNonRoadResource: isNonRoad,
      });
    }
    return directSegments;
  }

  // 2. ROAD MODE:
  // A. Non-road resources (BOAT / HELICOPTER):
  // Preserve existing non-road resource routing behavior required by domain model.
  if (isNonRoad) {
    const geom = route.geometry;
    let positions: [number, number][] = [];
    if (Array.isArray(geom?.coordinates) && geom.coordinates.length >= 2) {
      positions = geom.coordinates.filter(isValidLatLngTuple).map(([lat, lng]) => [lat, lng]);
    }
    if (positions.length < 2 && stops.length >= 2) {
      positions = stops.map((s) => [s.lat, s.lng]);
    }
    if (positions.length < 2) return [];
    return [
      {
        key: `${route.resourceId}-nonroad-transit`,
        positions,
        source: 'STRAIGHT_LINE',
        style: getRoutePolylineStyle('STRAIGHT_LINE', theme),
        isUnavailable: false,
        isNonRoadResource: true,
      },
    ];
  }

  // B. Road vehicles (HIGH_WATER_VEHICLE, Trucks, Ambulances):
  const geom = route.geometry;

  // Case B1: Multi-leg geometry present
  if (Array.isArray(geom?.legs) && geom.legs.length > 0) {
    const legSegments: RouteRenderSegment[] = [];
    for (let i = 0; i < geom.legs.length; i++) {
      const leg = geom.legs[i]!;
      const valid = (leg.coordinates ?? []).filter(isValidLatLngTuple);
      if (leg.source === 'OSRM' && valid.length >= 2) {
        legSegments.push({
          key: `${route.resourceId}-leg-${i}-osrm`,
          positions: valid.map(([lat, lng]) => [lat, lng]),
          source: 'OSRM',
          style: getRoutePolylineStyle('OSRM', theme),
          isUnavailable: false,
          fromStopNumber: leg.fromStopNumber,
          toStopNumber: leg.toStopNumber,
          isNonRoadResource: false,
        });
      } else {
        // Strict failure policy: NO line drawn on map; flagged unavailable
        legSegments.push({
          key: `${route.resourceId}-leg-${i}-unavailable`,
          positions: [],
          source: leg.source,
          style: getRoutePolylineStyle(leg.source, theme),
          isUnavailable: true,
          unavailableReason: `Road route unavailable. OSRM could not calculate a valid road route for this segment (Stop ${leg.fromStopNumber} -> Stop ${leg.toStopNumber}). Switch to Direct / Air mode to view a straight-line estimate.`,
          fromStopNumber: leg.fromStopNumber,
          toStopNumber: leg.toStopNumber,
          isNonRoadResource: false,
        });
      }
    }
    return legSegments;
  }

  // Case B2: Single OSRM route geometry without legs
  if (geom?.source === 'OSRM' && Array.isArray(geom.coordinates)) {
    const valid = geom.coordinates.filter(isValidLatLngTuple);
    if (valid.length >= 2) {
      return [
        {
          key: `${route.resourceId}-full-osrm`,
          positions: valid.map(([lat, lng]) => [lat, lng]),
          source: 'OSRM',
          style: getRoutePolylineStyle('OSRM', theme),
          isUnavailable: false,
          isNonRoadResource: false,
        },
      ];
    }
  }

  // Case B3: Road vehicle with missing or STRAIGHT_LINE fallback geometry (OSRM failed / NoRoute)
  // Strict failure policy: Do NOT draw a replacement or dashed line in Road Route mode.
  return [
    {
      key: `${route.resourceId}-road-unavailable`,
      positions: [],
      source: 'OSRM',
      style: getRoutePolylineStyle('OSRM', theme),
      isUnavailable: true,
      unavailableReason:
        'Road route unavailable. OSRM could not calculate a valid road route for this segment. Switch to Direct / Air mode to view a straight-line estimate.',
      isNonRoadResource: false,
    },
  ];
}

/**
 * Resolves distance, duration, and routing source metrics for a route under the selected mode.
 */
export function getRouteDisplayMetrics(
  route: ResourceRoute,
  mode: RouteMode = 'ROAD',
  resourceType?: string,
  resourceTypeMap?: Map<string, string>,
): RouteDisplayMetrics {
  const isNonRoad = isNonRoadResource(route.resourceId, resourceType, resourceTypeMap);
  const stops = route.stops ?? [];
  const geom = route.geometry;
  const segments = getRouteSegmentsForRendering(
    route,
    'standard',
    mode,
    resourceType,
    resourceTypeMap,
  );

  const unavailableSegments = segments.filter((s) => s.isUnavailable);
  const hasUnavailableRoadSegments = unavailableSegments.length > 0;
  const unavailableReasons = unavailableSegments.map(
    (s) => s.unavailableReason || 'Road route unavailable',
  );

  if (mode === 'DIRECT') {
    const directDist = computeRouteDirectDistanceKm(route);
    const directDuration = directDist > 0 ? Number(((directDist / 25) * 60).toFixed(1)) : 0;
    return {
      distanceKm: directDist,
      durationMinutes: directDuration,
      source: 'STRAIGHT_LINE',
      isRoadRouted: false,
      pickupsCount: stops.filter((s) => s.type === 'PICKUP').length,
      dropoffsCount: stops.filter((s) => s.type === 'DROPOFF').length,
      stopsCount: stops.length,
      vertexCount: stops.length,
      mode: 'DIRECT',
      hasUnavailableRoadSegments: false,
      unavailableSegmentCount: 0,
    };
  }

  // ROAD MODE:
  if (isNonRoad) {
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
    return {
      distanceKm,
      durationMinutes,
      source: 'STRAIGHT_LINE',
      isRoadRouted: false,
      pickupsCount: stops.filter((s) => s.type === 'PICKUP').length,
      dropoffsCount: stops.filter((s) => s.type === 'DROPOFF').length,
      stopsCount: stops.length,
      vertexCount: extractRouteLatLngs(route).length,
      mode: 'ROAD',
      hasUnavailableRoadSegments: false,
      unavailableSegmentCount: 0,
    };
  }

  // Road resource in Road mode:
  if (hasUnavailableRoadSegments) {
    let osrmDist = 0;
    let osrmDur = 0;
    if (geom?.legs) {
      for (const leg of geom.legs) {
        if (leg.source === 'OSRM') {
          osrmDist += leg.distanceKm;
          osrmDur += leg.durationMinutes;
        }
      }
    }
    const hasSuccessfulRoadLegs = osrmDist > 0;
    return {
      distanceKm: Number(osrmDist.toFixed(2)),
      durationMinutes: Number(osrmDur.toFixed(1)),
      source: hasSuccessfulRoadLegs ? 'MIXED' : 'OSRM',
      isRoadRouted: hasSuccessfulRoadLegs,
      pickupsCount: stops.filter((s) => s.type === 'PICKUP').length,
      dropoffsCount: stops.filter((s) => s.type === 'DROPOFF').length,
      stopsCount: stops.length,
      vertexCount: segments.reduce((sum, s) => sum + s.positions.length, 0),
      mode: 'ROAD',
      hasUnavailableRoadSegments: true,
      unavailableSegmentCount: unavailableSegments.length,
      unavailableReasons,
    };
  }

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
  const source: RouteGeometrySource = geom?.source ?? 'OSRM';

  return {
    distanceKm,
    durationMinutes,
    source,
    isRoadRouted: source === 'OSRM' || source === 'MIXED',
    pickupsCount: stops.filter((s) => s.type === 'PICKUP').length,
    dropoffsCount: stops.filter((s) => s.type === 'DROPOFF').length,
    stopsCount: stops.length,
    vertexCount: segments.reduce((sum, s) => sum + s.positions.length, 0),
    mode: 'ROAD',
    hasUnavailableRoadSegments: false,
    unavailableSegmentCount: 0,
  };
}

/**
 * Computes plan-wide route totals, unavailable segment counts, and overall routing classification.
 */
export function summarizeAssignmentRoutes(
  routes: ResourceRoute[] = [],
  mode: RouteMode = 'ROAD',
  resourceTypeMap?: Map<string, string>,
): AssignmentRouteSummary {
  let totalDistanceKm = 0;
  let totalDurationMinutes = 0;
  let osrmRouteCount = 0;
  let mixedRouteCount = 0;
  let straightLineRouteCount = 0;
  let unavailableSegmentCount = 0;

  for (const route of routes) {
    const m = getRouteDisplayMetrics(route, mode, undefined, resourceTypeMap);
    totalDistanceKm += m.distanceKm;
    totalDurationMinutes += m.durationMinutes;
    if (m.source === 'OSRM') {
      osrmRouteCount++;
    } else if (m.source === 'MIXED') {
      mixedRouteCount++;
    } else {
      straightLineRouteCount++;
    }
    if (m.unavailableSegmentCount) {
      unavailableSegmentCount += m.unavailableSegmentCount;
    }
  }

  let overallSource: RouteGeometrySource = 'STRAIGHT_LINE';
  if (routes.length > 0) {
    if (mode === 'DIRECT') {
      overallSource = 'STRAIGHT_LINE';
    } else if (osrmRouteCount === routes.length) {
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
    mode,
    hasUnavailableRoadSegments: unavailableSegmentCount > 0,
    unavailableSegmentCount,
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

export function getRouteSourceLabel(source: RouteGeometrySource, mode: RouteMode = 'ROAD'): string {
  if (mode === 'DIRECT') return 'Direct (Straight-Line)';
  if (source === 'OSRM') return 'OSRM Road';
  if (source === 'MIXED') return 'Mixed (Road + SL)';
  return 'Straight-Line';
}

/**
 * Determines whether an assignment represents an incremental plan repair proposal or execution.
 */
export function isRepairAssignment(
  assignment:
    | {
        id?: string;
        scenarioId?: string | null;
        scenario_id?: string | null;
        title?: string | null;
        description?: string | null;
      }
    | null
    | undefined,
): boolean {
  if (!assignment) return false;
  const id = (assignment.id || '').toLowerCase();
  const scenario = (assignment.scenarioId || assignment.scenario_id || '').toLowerCase();
  const title = (assignment.title || '').toLowerCase();
  const desc = (assignment.description || '').toLowerCase();
  return (
    id.startsWith('prop-repair-') ||
    id.includes('repair') ||
    scenario.includes('repair') ||
    title.includes('repair') ||
    desc.includes('repair')
  );
}

export interface RepairRouteStyle {
  casing: {
    color: string;
    weight: number;
    opacity: number;
    dashArray?: string;
    lineCap: 'round';
    lineJoin: 'round';
  };
  main: {
    color: string;
    weight: number;
    opacity: number;
    dashArray?: string;
    lineCap: 'round';
    lineJoin: 'round';
  };
}

/**
 * Google Maps-style styling for repair routes:
 * - Solid Google-Blue (#4285F4) main line
 * - Slightly wider translucent white casing beneath for contrast and depth
 * - Rounded line caps and joins
 * - Strong visual emphasis for active route (opacity 1.0, weight 5, casing 9)
 * - Reduced opacity for inactive routes (opacity 0.5, weight 3.5, casing 6)
 * - Distinct dashed style in Direct / Air mode
 */
export function getRepairRouteStyle(
  isActive: boolean,
  mode: RouteMode = 'ROAD',
  theme: TileTheme = 'standard',
): RepairRouteStyle {
  const isLight = theme === 'standard';

  if (mode === 'DIRECT') {
    return {
      casing: {
        color: isLight ? '#ffffff' : '#0f172a',
        weight: isActive ? 8 : 6,
        opacity: isActive ? 0.85 : 0.45,
        dashArray: '8, 8',
        lineCap: 'round',
        lineJoin: 'round',
      },
      main: {
        color: isActive ? '#4285F4' : '#93c5fd',
        weight: isActive ? 5 : 3.5,
        opacity: isActive ? 1.0 : 0.5,
        dashArray: '8, 8',
        lineCap: 'round',
        lineJoin: 'round',
      },
    };
  }

  // ROAD Route Mode: Solid road-following Google Blue with halo casing
  return {
    casing: {
      color: isLight ? '#ffffff' : '#0f172a',
      weight: isActive ? 9 : 6,
      opacity: isActive ? 0.9 : 0.5,
      lineCap: 'round',
      lineJoin: 'round',
    },
    main: {
      color: isActive ? '#4285F4' : '#60a5fa',
      weight: isActive ? 5 : 3.5,
      opacity: isActive ? 1.0 : 0.5,
      lineCap: 'round',
      lineJoin: 'round',
    },
  };
}

export interface RepairStopDisplay {
  stopNumber: number;
  type: 'DEPOT' | 'PICKUP' | 'DROPOFF';
  targetId: string;
  lat: number;
  lng: number;
  estimatedArrivalMinutes?: number;
  isStart: boolean;
  isEnd: boolean;
  isIntermediate: boolean;
  label: string;
}

/**
 * Extracts ordered stops for a repair route with clear classification for Start, Intermediate, and End markers.
 */
export function extractRepairStops(route: ResourceRoute): RepairStopDisplay[] {
  const stops = (route.stops ?? []).filter(
    (s: RouteStop) =>
      typeof s.lat === 'number' &&
      Number.isFinite(s.lat) &&
      typeof s.lng === 'number' &&
      Number.isFinite(s.lng),
  );

  return stops.map((s, idx) => {
    const isStart = idx === 0;
    const isEnd = idx === stops.length - 1 && stops.length > 1;
    const isIntermediate = !isStart && !isEnd;
    let label = `Stop #${s.stopNumber ?? idx + 1}`;
    if (isStart) label = 'Start (Depot/Facility)';
    else if (isEnd) label = 'Destination (Shelter)';
    else if (s.type === 'PICKUP') label = `Pickup (${s.targetId})`;
    else if (s.type === 'DROPOFF') label = `Dropoff (${s.targetId})`;

    return {
      stopNumber: s.stopNumber ?? idx + 1,
      type: s.type,
      targetId: s.targetId,
      lat: s.lat,
      lng: s.lng,
      estimatedArrivalMinutes: s.estimatedArrivalMinutes,
      isStart,
      isEnd,
      isIntermediate,
      label,
    };
  });
}
