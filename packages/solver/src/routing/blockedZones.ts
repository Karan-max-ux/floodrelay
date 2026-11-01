import type {
  BlockedZone,
  GeoPoint,
  HazardLevel,
  RescueRequest,
  RescueResource,
  ResourceRoute,
  ResourceType,
  Shelter,
  SolverPlan,
} from '@floodrelay/shared';

export const ASSUMED_WATER_SURGE_IMPEDANCE_MULTIPLIER = 2.0; // placeholder, not measured
export const ASSUMED_CAUTION_IMPEDANCE_MULTIPLIER = 1.25; // placeholder, not measured
export const ASSUMED_BLOCKED_PENALTY_MULTIPLIER = 10.0; // placeholder, not measured

export interface HazardPolicyOptions {
  blockedPolicy?: 'INFINITE' | 'PENALTY';
  penaltyMultiplier?: number;
}

export interface LegHazardInfo {
  from: GeoPoint;
  to: GeoPoint;
  hazard?: HazardLevel;
  isBlocked: boolean;
  crossedZoneIds: string[];
}

export interface PlanHazardReport {
  totalLegs: number;
  hazardLegs: number;
  blockedLegs: number;
  legDetails: Array<{
    vehicleId: string;
    legIndex: number;
    info: LegHazardInfo;
  }>;
}

export interface BoundingBox {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

export function computeBoundingBox(points: GeoPoint[]): BoundingBox {
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLng = Infinity;
  let maxLng = -Infinity;
  for (const pt of points) {
    const { lat, lng } = getPoint(pt);
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
  }
  return { minLat, maxLat, minLng, maxLng };
}

export function boundingBoxesOverlap(b1: BoundingBox, b2: BoundingBox): boolean {
  return !(
    b1.maxLat < b2.minLat ||
    b1.minLat > b2.maxLat ||
    b1.maxLng < b2.minLng ||
    b1.minLng > b2.maxLng
  );
}

function getPoint(p: GeoPoint): { lat: number; lng: number } {
  const lat = p.lat ?? (p as unknown as { latitude?: number }).latitude ?? 0;
  const lng = p.lng ?? (p as unknown as { longitude?: number }).longitude ?? 0;
  return { lat, lng };
}

/**
 * Checks if a point lies on a 2D line segment between a and b.
 */
function isPointOnSegment(p: GeoPoint, a: GeoPoint, b: GeoPoint, epsilon = 1e-9): boolean {
  const P = getPoint(p);
  const A = getPoint(a);
  const B = getPoint(b);

  const cross = (P.lat - A.lat) * (B.lng - A.lng) - (P.lng - A.lng) * (B.lat - A.lat);
  if (Math.abs(cross) > epsilon) {
    return false;
  }

  const minLng = Math.min(A.lng, B.lng) - epsilon;
  const maxLng = Math.max(A.lng, B.lng) + epsilon;
  const minLat = Math.min(A.lat, B.lat) - epsilon;
  const maxLat = Math.max(A.lat, B.lat) + epsilon;

  return P.lng >= minLng && P.lng <= maxLng && P.lat >= minLat && P.lat <= maxLat;
}

/**
 * Ray-casting algorithm to test if a point is inside or on the boundary of a polygon.
 * Boundary points count as inside. Correctly handles concave polygons.
 */
export function pointInPolygon(point: GeoPoint, polygon: GeoPoint[]): boolean {
  if (polygon.length < 3) {
    return false;
  }

  const P = getPoint(point);

  // Check if point lies directly on any boundary edge
  const n = polygon.length;
  for (let i = 0; i < n; i++) {
    const a = polygon[i]!;
    const b = polygon[(i + 1) % n]!;
    if (isPointOnSegment(point, a, b)) {
      return true;
    }
  }

  // Cast horizontal ray to the right (+lng)
  let inside = false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const pi = getPoint(polygon[i]!);
    const pj = getPoint(polygon[j]!);

    const intersect =
      pi.lat > P.lat !== pj.lat > P.lat &&
      P.lng < ((pj.lng - pi.lng) * (P.lat - pi.lat)) / (pj.lat - pi.lat) + pi.lng;

    if (intersect) {
      inside = !inside;
    }
  }

  return inside;
}

function orientation(a: GeoPoint, b: GeoPoint, c: GeoPoint): number {
  const A = getPoint(a);
  const B = getPoint(b);
  const C = getPoint(c);

  const val = (B.lat - A.lat) * (C.lng - B.lng) - (B.lng - A.lng) * (C.lat - B.lat);
  if (Math.abs(val) < 1e-9) {
    return 0; // collinear
  }
  return val > 0 ? 1 : 2; // 1 = clockwise, 2 = counterclockwise
}

/**
 * Tests whether two 2D line segments (p1-p2 and p3-p4) intersect.
 * Touching endpoints and collinear overlapping segments count as intersecting.
 */
export function segmentsIntersect(p1: GeoPoint, p2: GeoPoint, p3: GeoPoint, p4: GeoPoint): boolean {
  const o1 = orientation(p1, p2, p3);
  const o2 = orientation(p1, p2, p4);
  const o3 = orientation(p3, p4, p1);
  const o4 = orientation(p3, p4, p2);

  // General intersecting case
  if (o1 !== o2 && o3 !== o4) {
    return true;
  }

  // Collinear / touching cases
  if (o1 === 0 && isPointOnSegment(p3, p1, p2)) return true;
  if (o2 === 0 && isPointOnSegment(p4, p1, p2)) return true;
  if (o3 === 0 && isPointOnSegment(p1, p3, p4)) return true;
  if (o4 === 0 && isPointOnSegment(p2, p3, p4)) return true;

  return false;
}

/**
 * Tests whether a line segment (p1-p2) intersects or lies inside a polygon.
 * If either endpoint or the midpoint lies inside, or if any edge intersects, returns true.
 */
export function segmentIntersectsPolygon(p1: GeoPoint, p2: GeoPoint, polygon: GeoPoint[]): boolean {
  if (polygon.length < 3) {
    return false;
  }

  // Check if either endpoint or midpoint is inside/on the polygon
  if (pointInPolygon(p1, polygon) || pointInPolygon(p2, polygon)) {
    return true;
  }

  const P1 = getPoint(p1);
  const P2 = getPoint(p2);
  const mid: GeoPoint = {
    lat: (P1.lat + P2.lat) / 2,
    lng: (P1.lng + P2.lng) / 2,
  };
  if (pointInPolygon(mid, polygon)) {
    return true;
  }

  // Check if segment intersects any polygon boundary edge
  const n = polygon.length;
  for (let i = 0; i < n; i++) {
    const a = polygon[i]!;
    const b = polygon[(i + 1) % n]!;
    if (segmentsIntersect(p1, p2, a, b)) {
      return true;
    }
  }

  return false;
}

/**
 * Returns the highest severity hazard at a point, or null if outside all zones.
 */
export function hazardAtPoint(point: GeoPoint, zones: BlockedZone[]): HazardLevel | null {
  let highest: HazardLevel | null = null;

  for (const zone of zones) {
    if (pointInPolygon(point, zone.polygon)) {
      if (zone.severity === 'BLOCKED') {
        return 'BLOCKED';
      }
      if (zone.severity === 'WATER_SURGE') {
        highest = 'WATER_SURGE';
      } else if (zone.severity === 'CAUTION' && highest === null) {
        highest = 'CAUTION';
      }
    }
  }

  return highest;
}

/**
 * Finds all hazard zones intersected or crossed by a segment.
 */
export function zonesCrossedBySegment(
  p1: GeoPoint,
  p2: GeoPoint,
  zones: BlockedZone[],
): BlockedZone[] {
  if (zones.length === 0) return [];
  const segBox = computeBoundingBox([p1, p2]);
  return zones.filter((zone) => {
    const zoneBox = computeBoundingBox(zone.polygon);
    if (!boundingBoxesOverlap(segBox, zoneBox)) {
      return false;
    }
    return segmentIntersectsPolygon(p1, p2, zone.polygon);
  });
}

/**
 * Tests whether a segment crosses any zone with severity 'BLOCKED'.
 */
export function isSegmentBlocked(p1: GeoPoint, p2: GeoPoint, zones: BlockedZone[]): boolean {
  if (zones.length === 0) return false;
  const segBox = computeBoundingBox([p1, p2]);
  return zones.some((zone) => {
    if (zone.severity !== 'BLOCKED') return false;
    const zoneBox = computeBoundingBox(zone.polygon);
    if (!boundingBoxesOverlap(segBox, zoneBox)) {
      return false;
    }
    return segmentIntersectsPolygon(p1, p2, zone.polygon);
  });
}

/**
 * Computes the travel impedance multiplier across a segment given crossed zones.
 */
export function legImpedanceMultiplier(
  p1: GeoPoint,
  p2: GeoPoint,
  zones: BlockedZone[],
  options?: HazardPolicyOptions,
): number {
  const crossed = zonesCrossedBySegment(p1, p2, zones);
  if (crossed.length === 0) {
    return 1.0;
  }

  const hasBlocked = crossed.some((z) => z.severity === 'BLOCKED');
  if (hasBlocked) {
    if (options?.blockedPolicy === 'PENALTY') {
      return options.penaltyMultiplier ?? ASSUMED_BLOCKED_PENALTY_MULTIPLIER;
    }
    return Infinity;
  }

  const hasWaterSurge = crossed.some((z) => z.severity === 'WATER_SURGE');
  if (hasWaterSurge) {
    return ASSUMED_WATER_SURGE_IMPEDANCE_MULTIPLIER;
  }

  const hasCaution = crossed.some((z) => z.severity === 'CAUTION');
  if (hasCaution) {
    return ASSUMED_CAUTION_IMPEDANCE_MULTIPLIER;
  }

  return 1.0;
}

/**
 * Identifies rescue requests located inside blocked or hazardous zones.
 */
export function findRequestsInBlockedZones(
  requests: RescueRequest[],
  zones: BlockedZone[],
): Array<{ request: RescueRequest; zone: BlockedZone }> {
  const result: Array<{ request: RescueRequest; zone: BlockedZone }> = [];

  for (const request of requests) {
    for (const zone of zones) {
      if (zone.severity === 'BLOCKED' && pointInPolygon(request, zone.polygon)) {
        result.push({ request, zone });
      }
    }
  }

  return result;
}

/**
 * Evaluates a complete SolverPlan and flags legs crossing hazard or blocked zones.
 * NOTE: Evaluates straight-line leg geometry between stop endpoints.
 */
export function flagPlanHazards(
  plan: SolverPlan | { routes: ResourceRoute[] },
  zones: BlockedZone[],
): PlanHazardReport {
  let totalLegs = 0;
  let hazardLegs = 0;
  let blockedLegs = 0;
  const legDetails: PlanHazardReport['legDetails'] = [];

  for (const route of plan.routes) {
    const stops = route.stops;
    if (stops.length < 2) {
      continue;
    }

    for (let i = 0; i < stops.length - 1; i++) {
      totalLegs++;
      const sFrom = stops[i]!;
      const sTo = stops[i + 1]!;
      const from = { lat: sFrom.lat, lng: sFrom.lng };
      const to = { lat: sTo.lat, lng: sTo.lng };

      const crossed = zonesCrossedBySegment(from, to, zones);
      if (crossed.length > 0) {
        hazardLegs++;
        const isBlocked = crossed.some((z) => z.severity === 'BLOCKED');
        if (isBlocked) {
          blockedLegs++;
        }

        let hazard: HazardLevel = 'CAUTION';
        if (isBlocked) {
          hazard = 'BLOCKED';
        } else if (crossed.some((z) => z.severity === 'WATER_SURGE')) {
          hazard = 'WATER_SURGE';
        }

        legDetails.push({
          vehicleId: route.resourceId,
          legIndex: i,
          info: {
            from,
            to,
            hazard,
            isBlocked,
            crossedZoneIds: crossed.map((z) => z.id),
          },
        });
      }
    }
  }

  return {
    totalLegs,
    hazardLegs,
    blockedLegs,
    legDetails,
  };
}

/**
 * Evaluates whether at least one vehicle has a finite round-trip
 * shelter -> request -> shelter under active hazard policies.
 * If no vehicle can reach the request from any shelter and return to any shelter
 * with finite travel time and without crossing an impassable zone, returns false.
 */
export function hasFiniteRoundTrip(
  req: GeoPoint,
  resources: RescueResource[],
  shelters: Shelter[],
  provider: {
    getTravelEstimate(
      from: GeoPoint,
      to: GeoPoint,
      speedKmH?: number,
      isFlooded?: boolean,
      resourceType?: ResourceType,
    ): { durationMinutes: number; blocked?: boolean };
  },
): boolean {
  if (shelters.length === 0 || resources.length === 0) {
    return false;
  }
  for (const res of resources) {
    let canReach = false;
    for (const sh of shelters) {
      const est = provider.getTravelEstimate(sh, req, res.speedKmH, undefined, res.type);
      if (Number.isFinite(est.durationMinutes) && !est.blocked) {
        canReach = true;
        break;
      }
    }
    if (!canReach) continue;

    for (const sh of shelters) {
      const est = provider.getTravelEstimate(req, sh, res.speedKmH, undefined, res.type);
      if (Number.isFinite(est.durationMinutes) && !est.blocked) {
        return true;
      }
    }
  }
  return false;
}
