import type { BoundingBox, GeoPoint, ResourceType } from '@floodrelay/shared';
import {
  StraightLineTravelTimeProvider,
  type TravelEstimate,
  type TravelTimeProvider,
} from './travelTime.js';

export interface RegionProviderEntry {
  id: string;
  bbox?: BoundingBox;
  provider: TravelTimeProvider;
}

export interface RegionalStats {
  lookupsOutsideCoverage: number;
  lookupsStraightLinePolicy: number;
}

function getCoord(point: GeoPoint): { lat: number; lng: number } {
  const lat = point.lat ?? (point as unknown as { latitude?: number }).latitude ?? 0;
  const lng = point.lng ?? (point as unknown as { longitude?: number }).longitude ?? 0;
  return { lat, lng };
}

/**
 * Returns true when point lies inside or on the inclusive boundary of bbox.
 */
export function isPointInBbox(point: GeoPoint, bbox: BoundingBox): boolean {
  const { lat, lng } = getCoord(point);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return false;
  }
  return lat >= bbox.minLat && lat <= bbox.maxLat && lng >= bbox.minLng && lng <= bbox.maxLng;
}

/**
 * RegionalTravelTimeProvider routes road-vehicle legs across zero or more regional
 * OSRM providers based on inclusive bounding boxes:
 *
 * - Non-road resources (BOAT, HELICOPTER) always use straight-line policy.
 * - For road vehicles, the first region whose bbox contains BOTH `from` and `to`
 *   (or has an unbounded default region with no bbox) serves the leg via its OSRM provider.
 * - Any leg outside every configured region, or spanning two different regions,
 *   uses straight-line estimation tagged `source: 'STRAIGHT_LINE'` and increments `lookupsOutsideCoverage`.
 */
export class RegionalTravelTimeProvider implements TravelTimeProvider {
  private readonly straightLineProvider: TravelTimeProvider;
  private lookupsOutsideCoverage = 0;
  private lookupsStraightLinePolicy = 0;

  constructor(
    private readonly regions: RegionProviderEntry[],
    straightLineProvider?: TravelTimeProvider,
  ) {
    this.straightLineProvider = straightLineProvider ?? new StraightLineTravelTimeProvider();
  }

  getTravelEstimate(
    from: GeoPoint,
    to: GeoPoint,
    speedKmH?: number,
    isFlooded?: boolean,
    resourceType?: ResourceType,
  ): TravelEstimate {
    if (resourceType === 'BOAT' || resourceType === 'HELICOPTER') {
      this.lookupsStraightLinePolicy++;
      const est = this.straightLineProvider.getTravelEstimate(
        from,
        to,
        speedKmH,
        isFlooded,
        resourceType,
      );
      return { ...est, source: 'STRAIGHT_LINE' };
    }

    const matched = this.regions.find(
      (region) =>
        !region.bbox || (isPointInBbox(from, region.bbox) && isPointInBbox(to, region.bbox)),
    );

    if (matched) {
      return matched.provider.getTravelEstimate(from, to, speedKmH, isFlooded, resourceType);
    }

    this.lookupsOutsideCoverage++;
    const est = this.straightLineProvider.getTravelEstimate(
      from,
      to,
      speedKmH,
      isFlooded,
      resourceType,
    );
    return {
      ...est,
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

  getStats(): RegionalStats {
    return {
      lookupsOutsideCoverage: this.lookupsOutsideCoverage,
      lookupsStraightLinePolicy: this.lookupsStraightLinePolicy,
    };
  }

  resetStats(): void {
    this.lookupsOutsideCoverage = 0;
    this.lookupsStraightLinePolicy = 0;
  }
}
