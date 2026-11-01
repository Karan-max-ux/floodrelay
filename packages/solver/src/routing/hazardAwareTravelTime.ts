import type { BlockedZone, GeoPoint, ResourceType } from '@floodrelay/shared';
import { type TravelEstimate, type TravelTimeProvider } from './travelTime.js';
import {
  zonesCrossedBySegment,
  type HazardPolicyOptions,
  ASSUMED_WATER_SURGE_IMPEDANCE_MULTIPLIER,
  ASSUMED_CAUTION_IMPEDANCE_MULTIPLIER,
  ASSUMED_BLOCKED_PENALTY_MULTIPLIER,
} from './blockedZones.js';

/**
 * HazardAwareTravelTimeProvider decorates an inner TravelTimeProvider by applying
 * hazard impedance multipliers and blocked-area exclusions based on operator-marked
 * hazard polygons.
 *
 * NOTE: Spatial hazard checks evaluate straight-line leg geometry between endpoints,
 * not the precise road network polyline.
 */
export class HazardAwareTravelTimeProvider implements TravelTimeProvider {
  constructor(
    private readonly inner: TravelTimeProvider,
    private readonly zones: BlockedZone[],
    private readonly options: HazardPolicyOptions = {},
  ) {}

  getTravelEstimate(
    from: GeoPoint,
    to: GeoPoint,
    speedKmH?: number,
    isFlooded?: boolean,
    resourceType?: ResourceType,
  ): TravelEstimate {
    const base = this.inner.getTravelEstimate(from, to, speedKmH, isFlooded, resourceType);

    if (this.zones.length === 0) {
      return base;
    }

    const crossed = zonesCrossedBySegment(from, to, this.zones);
    if (crossed.length === 0) {
      return base;
    }

    const isBlocked = crossed.some((z) => z.severity === 'BLOCKED');
    if (isBlocked) {
      if (this.options.blockedPolicy === 'PENALTY') {
        const mult = this.options.penaltyMultiplier ?? ASSUMED_BLOCKED_PENALTY_MULTIPLIER;
        return {
          distanceKm: Number((base.distanceKm * mult).toFixed(3)),
          durationMinutes: Number((base.durationMinutes * mult).toFixed(2)),
          blocked: true,
          hazard: 'BLOCKED',
          source: base.source,
        };
      }

      // Default INFINITE policy
      return {
        distanceKm: Infinity,
        durationMinutes: Infinity,
        blocked: true,
        hazard: 'BLOCKED',
        source: base.source,
      };
    }

    const isWaterSurge = crossed.some((z) => z.severity === 'WATER_SURGE');
    if (isWaterSurge) {
      const mult = ASSUMED_WATER_SURGE_IMPEDANCE_MULTIPLIER;
      return {
        distanceKm: Number((base.distanceKm * mult).toFixed(3)),
        durationMinutes: Number((base.durationMinutes * mult).toFixed(2)),
        hazard: 'WATER_SURGE',
        source: base.source,
      };
    }

    const isCaution = crossed.some((z) => z.severity === 'CAUTION');
    if (isCaution) {
      const mult = ASSUMED_CAUTION_IMPEDANCE_MULTIPLIER;
      return {
        distanceKm: Number((base.distanceKm * mult).toFixed(3)),
        durationMinutes: Number((base.durationMinutes * mult).toFixed(2)),
        hazard: 'CAUTION',
        source: base.source,
      };
    }

    return base;
  }

  getMatrix(
    origins: GeoPoint[],
    destinations: GeoPoint[],
    speedKmH?: number,
    resourceType?: ResourceType,
  ): TravelEstimate[][] {
    return origins.map((origin) =>
      destinations.map((dest) => this.getTravelEstimate(origin, dest, speedKmH, undefined, resourceType)),
    );
  }
}
