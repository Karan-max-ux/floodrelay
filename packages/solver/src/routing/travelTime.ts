import type { GeoPoint } from '@floodrelay/shared';
import { haversineKm } from '../index.js';

export interface TravelEstimate {
  distanceKm: number;
  durationMinutes: number;
}

export interface TravelTimeProvider {
  getTravelEstimate(from: GeoPoint, to: GeoPoint, speedKmH?: number): TravelEstimate;
  getMatrix(origins: GeoPoint[], destinations: GeoPoint[], speedKmH?: number): TravelEstimate[][];
}

/**
 * StraightLineTravelTimeProvider calculates geodesic distance via haversine,
 * scaled by a road network detour factor (default 1.3x).
 */
export class StraightLineTravelTimeProvider implements TravelTimeProvider {
  constructor(
    private readonly detourFactor = 1.3,
    private readonly defaultSpeedKmH = 30
  ) {}

  getTravelEstimate(from: GeoPoint, to: GeoPoint, speedKmH?: number): TravelEstimate {
    const rawDistance = haversineKm(from, to);
    const distanceKm = Number((rawDistance * this.detourFactor).toFixed(3));
    const speed = speedKmH && speedKmH > 0 ? speedKmH : this.defaultSpeedKmH;
    const durationMinutes = Number(((distanceKm / speed) * 60).toFixed(2));

    return {
      distanceKm,
      durationMinutes,
    };
  }

  getMatrix(
    origins: GeoPoint[],
    destinations: GeoPoint[],
    speedKmH?: number
  ): TravelEstimate[][] {
    return origins.map((origin) =>
      destinations.map((dest) => this.getTravelEstimate(origin, dest, speedKmH))
    );
  }
}
