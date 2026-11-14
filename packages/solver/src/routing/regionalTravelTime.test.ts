import { describe, it, expect, vi } from 'vitest';
import type { BoundingBox, GeoPoint } from '@floodrelay/shared';
import {
  RegionalTravelTimeProvider,
  isPointInBbox,
  type RegionProviderEntry,
} from './regionalTravelTime.js';
import { StraightLineTravelTimeProvider, type TravelTimeProvider } from './travelTime.js';

const NORTH_BBOX: BoundingBox = {
  minLat: 28.44,
  minLng: 76.98,
  maxLat: 28.74,
  maxLng: 77.5,
};

const SOUTH_BBOX: BoundingBox = {
  minLat: 12.8,
  minLng: 77.4,
  maxLat: 13.2,
  maxLng: 77.8,
};

describe('isPointInBbox', () => {
  it('returns true for interior and inclusive boundary edges/corners', () => {
    expect(isPointInBbox({ lat: 28.6139, lng: 77.209 }, NORTH_BBOX)).toBe(true);
    expect(isPointInBbox({ lat: NORTH_BBOX.minLat, lng: NORTH_BBOX.minLng }, NORTH_BBOX)).toBe(
      true,
    );
    expect(isPointInBbox({ lat: NORTH_BBOX.maxLat, lng: NORTH_BBOX.maxLng }, NORTH_BBOX)).toBe(
      true,
    );
    expect(isPointInBbox({ lat: NORTH_BBOX.minLat, lng: 77.2 }, NORTH_BBOX)).toBe(true);
    expect(isPointInBbox({ lat: 28.6, lng: NORTH_BBOX.maxLng }, NORTH_BBOX)).toBe(true);
  });

  it('returns false outside bbox or for non-finite coordinates', () => {
    expect(isPointInBbox({ lat: 28.4399, lng: 77.2 }, NORTH_BBOX)).toBe(false);
    expect(isPointInBbox({ lat: 28.7401, lng: 77.2 }, NORTH_BBOX)).toBe(false);
    expect(isPointInBbox({ lat: 28.6, lng: 76.9799 }, NORTH_BBOX)).toBe(false);
    expect(isPointInBbox({ lat: 28.6, lng: 77.5001 }, NORTH_BBOX)).toBe(false);
    expect(isPointInBbox({ lat: Number.NaN, lng: 77.2 }, NORTH_BBOX)).toBe(false);
    expect(isPointInBbox({ lat: 28.6, lng: Number.POSITIVE_INFINITY }, NORTH_BBOX)).toBe(false);
  });
});

describe('RegionalTravelTimeProvider', () => {
  const northA: GeoPoint = { lat: 28.6, lng: 77.2 };
  const northB: GeoPoint = { lat: 28.65, lng: 77.25 };
  const southA: GeoPoint = { lat: 12.95, lng: 77.55 };
  const southB: GeoPoint = { lat: 13.05, lng: 77.65 };
  const outsidePoint: GeoPoint = { lat: 19.07, lng: 72.87 };

  function makeMockRegionProvider(
    distanceKm: number,
  ): TravelTimeProvider & { getTravelEstimate: ReturnType<typeof vi.fn> } {
    const getTravelEstimate = vi.fn().mockReturnValue({
      distanceKm,
      durationMinutes: Number(((distanceKm / 40) * 60).toFixed(2)),
      source: 'OSRM' as const,
    });
    return {
      getTravelEstimate,
      getMatrix: vi.fn((origins: GeoPoint[], destinations: GeoPoint[], speedKmH, resourceType) =>
        origins.map((o) =>
          destinations.map((d) => getTravelEstimate(o, d, speedKmH, undefined, resourceType)),
        ),
      ),
    };
  }

  it('routes legs inside matching regions to the corresponding regional OSRM provider', () => {
    const northProvider = makeMockRegionProvider(10);
    const southProvider = makeMockRegionProvider(20);
    const entries: RegionProviderEntry[] = [
      { id: 'north', bbox: NORTH_BBOX, provider: northProvider },
      { id: 'south', bbox: SOUTH_BBOX, provider: southProvider },
    ];
    const provider = new RegionalTravelTimeProvider(entries);

    const estN = provider.getTravelEstimate(northA, northB, 40, false, 'HIGH_WATER_VEHICLE');
    const estNEdge = provider.getTravelEstimate(
      { lat: NORTH_BBOX.minLat, lng: NORTH_BBOX.minLng },
      { lat: NORTH_BBOX.maxLat, lng: NORTH_BBOX.maxLng },
      40,
      false,
      'AMBULANCE',
    );
    const estS = provider.getTravelEstimate(southA, southB, 40, false, 'HIGH_WATER_VEHICLE');

    expect(estN.source).toBe('OSRM');
    expect(estN.distanceKm).toBe(10);
    expect(estNEdge.source).toBe('OSRM');
    expect(estS.source).toBe('OSRM');
    expect(estS.distanceKm).toBe(20);
    expect(northProvider.getTravelEstimate).toHaveBeenCalledTimes(2);
    expect(southProvider.getTravelEstimate).toHaveBeenCalledTimes(1);
    expect(provider.getStats()).toEqual({
      lookupsOutsideCoverage: 0,
      lookupsStraightLinePolicy: 0,
    });
  });

  it('falls back to straight-line for cross-region and outside legs without calling any region OSRM', () => {
    const northProvider = makeMockRegionProvider(10);
    const southProvider = makeMockRegionProvider(20);
    const straightLine = new StraightLineTravelTimeProvider();
    const provider = new RegionalTravelTimeProvider(
      [
        { id: 'north', bbox: NORTH_BBOX, provider: northProvider },
        { id: 'south', bbox: SOUTH_BBOX, provider: southProvider },
      ],
      straightLine,
    );

    const legs: Array<[GeoPoint, GeoPoint]> = [
      [northA, southA], // cross-region (both points covered, but in different regions)
      [northA, outsidePoint], // inside -> outside
      [outsidePoint, southB], // outside -> inside
      [outsidePoint, { lat: 19.1, lng: 72.9 }], // outside -> outside
    ];

    for (const [from, to] of legs) {
      const est = provider.getTravelEstimate(from, to, 45, true, 'HIGH_WATER_VEHICLE');
      const expected = straightLine.getTravelEstimate(from, to, 45, true, 'HIGH_WATER_VEHICLE');
      expect(est).toEqual({ ...expected, source: 'STRAIGHT_LINE' });
    }

    expect(northProvider.getTravelEstimate).not.toHaveBeenCalled();
    expect(southProvider.getTravelEstimate).not.toHaveBeenCalled();
    expect(provider.getStats()).toEqual({
      lookupsOutsideCoverage: 4,
      lookupsStraightLinePolicy: 0,
    });
  });

  it('always uses straight-line policy for BOAT and HELICOPTER even when inside regions', () => {
    const northProvider = makeMockRegionProvider(10);
    const provider = new RegionalTravelTimeProvider([
      { id: 'north', bbox: NORTH_BBOX, provider: northProvider },
    ]);

    const boatEst = provider.getTravelEstimate(northA, northB, 25, false, 'BOAT');
    const heliEst = provider.getTravelEstimate(northA, outsidePoint, 150, false, 'HELICOPTER');

    expect(boatEst.source).toBe('STRAIGHT_LINE');
    expect(heliEst.source).toBe('STRAIGHT_LINE');
    expect(northProvider.getTravelEstimate).not.toHaveBeenCalled();
    expect(provider.getStats()).toEqual({
      lookupsOutsideCoverage: 0,
      lookupsStraightLinePolicy: 2,
    });
  });

  it('tracks stats across getMatrix and resets cleanly via resetStats()', () => {
    const northProvider = makeMockRegionProvider(10);
    const southProvider = makeMockRegionProvider(20);
    const provider = new RegionalTravelTimeProvider([
      { id: 'north', bbox: NORTH_BBOX, provider: northProvider },
      { id: 'south', bbox: SOUTH_BBOX, provider: southProvider },
    ]);

    const matrix = provider.getMatrix(
      [northA, outsidePoint],
      [northB, southA],
      40,
      'HIGH_WATER_VEHICLE',
    );
    expect(matrix[0]![0]!.source).toBe('OSRM'); // northA -> northB
    expect(matrix[0]![1]!.source).toBe('STRAIGHT_LINE'); // northA -> southA (cross-region)
    expect(matrix[1]![0]!.source).toBe('STRAIGHT_LINE'); // outside -> northB
    expect(matrix[1]![1]!.source).toBe('STRAIGHT_LINE'); // outside -> southA

    expect(provider.getStats().lookupsOutsideCoverage).toBe(3);

    provider.resetStats();
    expect(provider.getStats()).toEqual({
      lookupsOutsideCoverage: 0,
      lookupsStraightLinePolicy: 0,
    });
  });
});
