import { describe, it, expect, vi } from 'vitest';
import type { RescueResource, ResourceRoute } from '@floodrelay/shared';
import { ASSUMED_CAUTION_IMPEDANCE_MULTIPLIER } from './blockedZones.js';
import { enrichRoutesWithGeometry, mergeRouteCoordinates } from './routeGeometry.js';
import { OsrmTravelTimeProvider } from './osrmTravelTime.js';

function makeResource(overrides: Partial<RescueResource> = {}): RescueResource {
  return {
    id: 'res-amb-1',
    name: 'Ambulance Alpha',
    type: 'AMBULANCE',
    capacity: 4,
    speedKmH: 40,
    lat: 28.66,
    lng: 77.21,
    status: 'AVAILABLE',
    source: 'SIMULATED',
    ...overrides,
  };
}

function makeRoute(overrides: Partial<ResourceRoute> = {}): ResourceRoute {
  return {
    resourceId: 'res-amb-1',
    stops: [
      {
        stopNumber: 1,
        type: 'PICKUP',
        targetId: 'req-1',
        lat: 28.68,
        lng: 77.23,
        passengersPickedUp: 2,
        passengersDroppedOff: 0,
        estimatedArrivalMinutes: 5,
      },
      {
        stopNumber: 2,
        type: 'DROPOFF',
        targetId: 'sh-1',
        lat: 28.7,
        lng: 77.25,
        passengersPickedUp: 0,
        passengersDroppedOff: 2,
        estimatedArrivalMinutes: 12,
      },
    ],
    totalTravelDistanceKm: 6.2,
    totalDurationMinutes: 12,
    servedRequestIds: ['req-1'],
    ...overrides,
  };
}

describe('mergeRouteCoordinates', () => {
  it('concatenates leg coordinates while deduplicating shared boundary vertices', () => {
    const merged = mergeRouteCoordinates([
      [
        [28.66, 77.21],
        [28.67, 77.22],
        [28.68, 77.23],
      ],
      [
        [28.68, 77.23],
        [28.69, 77.24],
        [28.7, 77.25],
      ],
    ]);

    expect(merged).toEqual([
      [28.66, 77.21],
      [28.67, 77.22],
      [28.68, 77.23],
      [28.69, 77.24],
      [28.7, 77.25],
    ]);
  });
});

describe('OsrmTravelTimeProvider.fetchRouteLegGeometry', () => {
  it('converts OSRM GeoJSON [lng, lat] pairs to [lat, lng] and caches repeat lookups', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        code: 'Ok',
        routes: [
          {
            distance: 4200,
            duration: 300,
            geometry: {
              type: 'LineString',
              coordinates: [
                [77.21, 28.66],
                [77.215, 28.67],
                [77.23, 28.68],
              ],
            },
          },
        ],
      }),
    });

    const provider = new OsrmTravelTimeProvider({
      baseUrl: 'http://127.0.0.1:5000',
      fetchImpl: mockFetch as unknown as typeof fetch,
      useResourceSpeed: true,
    });

    const first = await provider.fetchRouteLegGeometry(
      { lat: 28.66, lng: 77.21 },
      { lat: 28.68, lng: 77.23 },
      42,
    );
    const second = await provider.fetchRouteLegGeometry(
      { lat: 28.66, lng: 77.21 },
      { lat: 28.68, lng: 77.23 },
      21,
    );

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0]![0]).toContain(
      '/route/v1/driving/77.21,28.66;77.23,28.68?overview=full&geometries=geojson&steps=false',
    );
    expect(first).toEqual({
      distanceKm: 4.2,
      durationMinutes: 6,
      coordinates: [
        [28.66, 77.21],
        [28.67, 77.215],
        [28.68, 77.23],
      ],
    });
    expect(second?.durationMinutes).toBe(12);
  });
});

describe('enrichRoutesWithGeometry', () => {
  it('enforces straight-line policy with zero OSRM calls for BOAT and HELICOPTER even when inside OSRM region', async () => {
    const mockFetch = vi.fn();
    const boat = makeResource({ id: 'res-boat', type: 'BOAT', speedKmH: 20 });
    const heli = makeResource({ id: 'res-heli', type: 'HELICOPTER', speedKmH: 120 });

    const { routes, stats } = await enrichRoutesWithGeometry(
      [makeRoute({ resourceId: 'res-boat' }), makeRoute({ resourceId: 'res-heli' })],
      {
        resources: [boat, heli],
        osrm: {
          regions: [
            {
              id: 'delhi',
              baseUrl: 'http://127.0.0.1:5001',
              bbox: { minLat: 28.4, minLng: 76.9, maxLat: 28.9, maxLng: 77.5 },
            },
          ],
          fetchImpl: mockFetch as unknown as typeof fetch,
        },
      },
    );

    expect(mockFetch).not.toHaveBeenCalled();
    expect(stats.osrmRouteRequests).toBe(0);
    expect(stats.legsStraightLinePolicy).toBe(4);
    for (const r of routes) {
      expect(r.geometry?.source).toBe('STRAIGHT_LINE');
      expect(r.geometry?.coordinates).toEqual([
        [28.66, 77.21],
        [28.68, 77.23],
        [28.7, 77.25],
      ]);
      expect(r.geometry?.legs).toHaveLength(2);
    }
  });

  it('isolates covered vs outside/cross-region legs without sending out-of-region coordinates to OSRM', async () => {
    const calledUrls: string[] = [];
    const mockFetch = vi.fn().mockImplementation(async (url: string) => {
      calledUrls.push(url);
      return {
        ok: true,
        json: async () => ({
          code: 'Ok',
          routes: [
            {
              distance: 3500,
              duration: 210,
              geometry: {
                type: 'LineString',
                coordinates: [
                  [77.21, 28.66],
                  [77.22, 28.675],
                  [77.23, 28.68],
                ],
              },
            },
          ],
        }),
      };
    });

    const amb = makeResource({ id: 'res-amb-1', type: 'AMBULANCE', speedKmH: 35 });
    const mixedRoute = makeRoute({
      stops: [
        {
          stopNumber: 1,
          type: 'PICKUP',
          targetId: 'req-in-delhi',
          lat: 28.68,
          lng: 77.23,
          passengersPickedUp: 2,
          passengersDroppedOff: 0,
          estimatedArrivalMinutes: 6,
        },
        {
          stopNumber: 2,
          type: 'DROPOFF',
          targetId: 'sh-outside-mumbai',
          lat: 19.07,
          lng: 72.87,
          passengersPickedUp: 0,
          passengersDroppedOff: 2,
          estimatedArrivalMinutes: 1200,
        },
      ],
    });

    const { routes, stats } = await enrichRoutesWithGeometry([mixedRoute], {
      resources: [amb],
      osrm: {
        regions: [
          {
            id: 'delhi',
            baseUrl: 'http://127.0.0.1:5001',
            bbox: { minLat: 28.44, minLng: 76.98, maxLat: 28.74, maxLng: 77.5 },
          },
        ],
        fetchImpl: mockFetch as unknown as typeof fetch,
      },
    });

    expect(calledUrls).toHaveLength(1);
    expect(calledUrls[0]).not.toContain('72.87');
    expect(stats.legsOsrm).toBe(1);
    expect(stats.legsOutsideCoverage).toBe(1);

    const geom = routes[0]!.geometry!;
    expect(geom.source).toBe('MIXED');
    expect(geom.legs).toHaveLength(2);
    expect(geom.legs![0]!.source).toBe('OSRM');
    expect(geom.legs![1]!.source).toBe('STRAIGHT_LINE');
    expect(geom.coordinates).toEqual([
      [28.66, 77.21],
      [28.675, 77.22],
      [28.68, 77.23],
      [19.07, 72.87],
    ]);
  });

  it('falls back to straight-line leg geometry when OSRM fails or returns invalid coordinates', async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    const truck = makeResource({ id: 'res-truck', type: 'HIGH_WATER_VEHICLE', speedKmH: 30 });

    const { routes, stats } = await enrichRoutesWithGeometry(
      [makeRoute({ resourceId: 'res-truck' })],
      {
        resources: [truck],
        osrm: {
          baseUrl: 'http://127.0.0.1:5999',
          fetchImpl: mockFetch as unknown as typeof fetch,
        },
      },
    );

    expect(stats.osrmRouteRequests).toBe(2);
    expect(stats.osrmRouteFailedRequests).toBe(2);
    expect(stats.legsFallback).toBe(2);
    expect(routes[0]!.geometry?.source).toBe('STRAIGHT_LINE');
    expect(routes[0]!.geometry?.coordinates).toEqual([
      [28.66, 77.21],
      [28.68, 77.23],
      [28.7, 77.25],
    ]);
    expect(routes[0]!.geometry!.distanceKm).toBeGreaterThan(0);
  });

  it('applies hazard zone impedance multipliers onto OSRM leg distance and duration', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        code: 'Ok',
        routes: [
          {
            distance: 5000,
            duration: 300,
            geometry: {
              type: 'LineString',
              coordinates: [
                [77.21, 28.66],
                [77.23, 28.68],
              ],
            },
          },
        ],
      }),
    });

    const amb = makeResource({ id: 'res-amb-1', type: 'AMBULANCE', speedKmH: 60 });
    const singleStopRoute = makeRoute({
      stops: [makeRoute().stops[0]!],
    });

    const { routes } = await enrichRoutesWithGeometry([singleStopRoute], {
      resources: [amb],
      osrm: {
        baseUrl: 'http://127.0.0.1:5000',
        fetchImpl: mockFetch as unknown as typeof fetch,
      },
      blockedZones: [
        {
          id: 'zone-caution',
          name: 'Flooded Crossing',
          severity: 'CAUTION',
          polygon: [
            { lat: 28.665, lng: 77.215 },
            { lat: 28.665, lng: 77.225 },
            { lat: 28.675, lng: 77.225 },
            { lat: 28.675, lng: 77.215 },
          ],
        },
      ],
    });

    // Base OSRM: 5.0 km at 60 km/h = 5.0 min; CAUTION multiplier scales both distance and duration
    const geom = routes[0]!.geometry!;
    expect(geom.source).toBe('OSRM');
    expect(geom.distanceKm).toBeCloseTo(5 * ASSUMED_CAUTION_IMPEDANCE_MULTIPLIER, 2);
    expect(geom.durationMinutes).toBeCloseTo(5 * ASSUMED_CAUTION_IMPEDANCE_MULTIPLIER, 2);
  });

  it('handles empty stops safely without making HTTP calls', async () => {
    const mockFetch = vi.fn();
    const amb = makeResource({ id: 'res-amb-1', type: 'AMBULANCE' });

    const { routes, stats } = await enrichRoutesWithGeometry(
      [
        makeRoute({
          stops: [],
          servedRequestIds: [],
          totalTravelDistanceKm: 0,
          totalDurationMinutes: 0,
        }),
      ],
      {
        resources: [amb],
        osrm: {
          baseUrl: 'http://127.0.0.1:5000',
          fetchImpl: mockFetch as unknown as typeof fetch,
        },
      },
    );

    expect(mockFetch).not.toHaveBeenCalled();
    expect(stats.osrmRouteRequests).toBe(0);
    expect(routes[0]!.geometry).toEqual({
      coordinates: [[28.66, 77.21]],
      distanceKm: 0,
      durationMinutes: 0,
      source: 'STRAIGHT_LINE',
      legs: [],
    });
  });
});
