import type { GeoPoint, HazardLevel, ResourceType } from '@floodrelay/shared';
import { haversineKm } from '../index.js';

export const ASSUMED_ROAD_DETOUR_FACTOR = 1.3; // placeholder, not measured
export const ASSUMED_DEFAULT_SPEED_KMH = 30; // placeholder, not measured
export const ASSUMED_FLOOD_IMPEDANCE_MULTIPLIER = 1.5; // placeholder, not measured

export interface TravelEstimate {
  distanceKm: number;
  durationMinutes: number;
  blocked?: boolean;
  hazard?: HazardLevel;
  source?: 'OSRM' | 'STRAIGHT_LINE';
}

export interface TravelTimeProvider {
  getTravelEstimate(
    from: GeoPoint,
    to: GeoPoint,
    speedKmH?: number,
    isFlooded?: boolean,
    resourceType?: ResourceType,
  ): TravelEstimate;
  getMatrix(
    origins: GeoPoint[],
    destinations: GeoPoint[],
    speedKmH?: number,
    resourceType?: ResourceType,
  ): TravelEstimate[][];
}

/**
 * StraightLineTravelTimeProvider calculates geodesic distance via haversine,
 * scaled by a road network detour factor (default 1.3x) and flood impedance multiplier.
 */
export class StraightLineTravelTimeProvider implements TravelTimeProvider {
  constructor(
    private readonly detourFactor: number = ASSUMED_ROAD_DETOUR_FACTOR,
    private readonly defaultSpeedKmH: number = ASSUMED_DEFAULT_SPEED_KMH,
    private readonly floodImpedanceMultiplier: number = ASSUMED_FLOOD_IMPEDANCE_MULTIPLIER,
  ) {}

  getTravelEstimate(
    from: GeoPoint,
    to: GeoPoint,
    speedKmH?: number,
    isFlooded?: boolean,
    resourceType?: ResourceType,
  ): TravelEstimate {
    void resourceType;
    const rawDistance = haversineKm(from, to);
    const impedance = isFlooded ? this.floodImpedanceMultiplier : 1.0;
    const distanceKm = Number((rawDistance * this.detourFactor * impedance).toFixed(3));
    const speed = speedKmH && speedKmH > 0 ? speedKmH : this.defaultSpeedKmH;
    const durationMinutes = Number(((distanceKm / speed) * 60).toFixed(2));

    return {
      distanceKm,
      durationMinutes,
      source: 'STRAIGHT_LINE',
    };
  }

  getMatrix(
    origins: GeoPoint[],
    destinations: GeoPoint[],
    speedKmH?: number,
    resourceType?: ResourceType,
  ): TravelEstimate[][] {
    return origins.map((origin) =>
      destinations.map((dest) =>
        this.getTravelEstimate(origin, dest, speedKmH, undefined, resourceType),
      ),
    );
  }
}
