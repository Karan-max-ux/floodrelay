import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { BoundingBox, GeoPoint, Scenario } from '@floodrelay/shared';
import { haversineKm } from '../index.js';
import { OsrmTravelTimeProvider } from './osrmTravelTime.js';
import { isPointInBbox } from './regionalTravelTime.js';
import { enrichRoutesWithGeometry } from './routeGeometry.js';
import { prepareTravelTimeProvider } from './travelTimeFactory.js';
import { solveNearestFirst } from '../baselines/nearestFirst.js';
import { solveClarkeWrightBaseline } from '../baselines/clarkeWrightBaseline.js';
import { solveClusterAllocation } from '../heuristics/clusterAllocation.js';

describe('OSRM HTTP Server Integration Tests', () => {
  let server: http.Server;
  let serverPort: number;
  let baseUrl: string;
  let maxCoordsSeen = 0;
  let requestCount = 0;
  let serverMode: 'normal' | '429' | 'non-json' | 'stall' = 'normal';

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      requestCount++;

      if (serverMode === '429') {
        res.writeHead(429, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ message: 'Too Many Requests' }));
        return;
      }

      if (serverMode === 'non-json') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<html><body>Bad Gateway</body></html>');
        return;
      }

      if (serverMode === 'stall') {
        // Start response but never finish body
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.write('{"code": "Ok",');
        // Do not call res.end() to force client timeout
        return;
      }

      // Normal mode: parse OSRM Table request
      // Path: /table/v1/{profile}/{coords}?...
      const url = new URL(req.url ?? '/', `http://127.0.0.1:${serverPort}`);
      const pathParts = url.pathname.split('/');
      // /table/v1/driving/lng1,lat1;lng2,lat2
      const coordsSegment = pathParts[4] ?? '';
      const rawCoords = coordsSegment ? coordsSegment.split(';') : [];
      const coordCount = rawCoords.length;

      if (coordCount > maxCoordsSeen) {
        maxCoordsSeen = coordCount;
      }

      // Reject requests with more than 100 coordinates with HTTP 400 "TooBig"
      if (coordCount > 100) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ code: 'TooBig', message: 'TooBig' }));
        return;
      }

      // Parse coordinates (order is lng,lat)
      const parsedPoints: GeoPoint[] = rawCoords.map((c) => {
        const [lngStr = '0', latStr = '0'] = c.split(',');
        return { lat: parseFloat(latStr), lng: parseFloat(lngStr) };
      });

      const sourcesParam = url.searchParams.get('sources');
      const destinationsParam = url.searchParams.get('destinations');

      const sourceIndices =
        sourcesParam && sourcesParam !== 'all'
          ? sourcesParam.split(';').map(Number)
          : parsedPoints.map((_, i) => i);

      const destIndices =
        destinationsParam && destinationsParam !== 'all'
          ? destinationsParam.split(';').map(Number)
          : parsedPoints.map((_, i) => i);

      // Distinct road factor of 1.5 (differs from straight-line's 1.3 detour)
      const ROAD_DETOUR_FACTOR = 1.5;
      const CAR_SPEED_KMH = 50.0;

      const durations: number[][] = [];
      const distances: number[][] = [];

      for (const sIdx of sourceIndices) {
        const rowDur: number[] = [];
        const rowDist: number[] = [];
        const from = parsedPoints[sIdx]!;

        for (const dIdx of destIndices) {
          const to = parsedPoints[dIdx]!;
          const distKm = haversineKm(from, to) * ROAD_DETOUR_FACTOR;
          const distMeters = Math.round(distKm * 1000);
          const durSeconds = Math.round((distKm / CAR_SPEED_KMH) * 3600);

          rowDist.push(distMeters);
          rowDur.push(durSeconds);
        }

        durations.push(rowDur);
        distances.push(rowDist);
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          code: 'Ok',
          durations,
          distances,
        }),
      );
    });

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        serverPort = (server.address() as AddressInfo).port;
        baseUrl = `http://127.0.0.1:${serverPort}`;
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  beforeEach(() => {
    maxCoordsSeen = 0;
    requestCount = 0;
    serverMode = 'normal';
  });

  it('chunks matrix larger than 100 coordinates so server never sees >100 coordinates', async () => {
    // 60 origins and 60 destinations = 120 coordinates in a single table call if unchunked
    const origins: GeoPoint[] = [];
    const destinations: GeoPoint[] = [];

    for (let i = 0; i < 60; i++) {
      origins.push({ lat: 28.5 + i * 0.001, lng: 77.2 + i * 0.001 });
      destinations.push({ lat: 28.6 + i * 0.001, lng: 77.3 + i * 0.001 });
    }

    const provider = new OsrmTravelTimeProvider({
      baseUrl,
      maxTableCoordinates: 100,
    });

    await provider.prefetch(origins, destinations);

    expect(maxCoordsSeen).toBeLessThanOrEqual(100);
    expect(requestCount).toBeGreaterThan(1);

    const stats = provider.getStats();
    expect(stats.failedRequests).toBe(0);
    expect(stats.osrmCells).toBe(3600); // 60 * 60
  });

  it('honors vehicle speed when computing durations (useResourceSpeed)', async () => {
    const origins = [{ lat: 28.6, lng: 77.2 }];
    const destinations = [{ lat: 28.7, lng: 77.3 }];

    const provider = new OsrmTravelTimeProvider({ baseUrl, useResourceSpeed: true });
    await provider.prefetch(origins, destinations);

    // Haversine ~ 14.7 km * 1.5 detour = ~22.05 km
    const estimateSlow = provider.getTravelEstimate(origins[0]!, destinations[0]!, 10); // 10 km/h slow vehicle
    const estimateFast = provider.getTravelEstimate(origins[0]!, destinations[0]!, 60); // 60 km/h truck

    expect(estimateSlow.source).toBe('OSRM');
    expect(estimateFast.source).toBe('OSRM');
    expect(estimateSlow.distanceKm).toBeCloseTo(estimateFast.distanceKm, 2);
    // Slow speed duration should be roughly 6x of fast speed duration
    expect(estimateSlow.durationMinutes).toBeGreaterThan(estimateFast.durationMinutes * 5);
  });

  it('falls back to straight-line on HTTP 429 Too Many Requests', async () => {
    serverMode = '429';

    const origins = [{ lat: 28.6, lng: 77.2 }];
    const destinations = [{ lat: 28.7, lng: 77.3 }];

    const provider = new OsrmTravelTimeProvider({ baseUrl });
    await provider.prefetch(origins, destinations);

    const est = provider.getTravelEstimate(origins[0]!, destinations[0]!);
    const stats = provider.getStats();
    expect(stats.failedRequests).toBe(1);
    expect(stats.fallbackCells).toBe(1);

    expect(est.source).toBe('STRAIGHT_LINE');
    expect(stats.lookupsFallback).toBe(1);
    expect(stats.lookupsOsrm).toBe(0);
  });

  it('falls back to straight-line on non-JSON response body', async () => {
    serverMode = 'non-json';

    const origins = [{ lat: 28.6, lng: 77.2 }];
    const destinations = [{ lat: 28.7, lng: 77.3 }];

    const provider = new OsrmTravelTimeProvider({ baseUrl });
    await provider.prefetch(origins, destinations);

    const stats = provider.getStats();
    expect(stats.failedRequests).toBe(1);

    const est = provider.getTravelEstimate(origins[0]!, destinations[0]!);
    expect(est.source).toBe('STRAIGHT_LINE');
  });

  it('aborts and falls back when response body stalls (timeout)', async () => {
    serverMode = 'stall';

    const origins = [{ lat: 28.6, lng: 77.2 }];
    const destinations = [{ lat: 28.7, lng: 77.3 }];

    // Short timeout 100ms
    const provider = new OsrmTravelTimeProvider({ baseUrl, timeoutMs: 100 });
    await provider.prefetch(origins, destinations);

    const stats = provider.getStats();
    expect(stats.failedRequests).toBe(1);

    const est = provider.getTravelEstimate(origins[0]!, destinations[0]!);
    expect(est.source).toBe('STRAIGHT_LINE');
  });

  it('falls back cleanly when nothing is listening on the port', async () => {
    // Non-existent port
    const provider = new OsrmTravelTimeProvider({
      baseUrl: 'http://127.0.0.1:59999',
      timeoutMs: 500,
    });

    const origins = [{ lat: 28.6, lng: 77.2 }];
    const destinations = [{ lat: 28.7, lng: 77.3 }];

    await provider.prefetch(origins, destinations);

    const stats = provider.getStats();
    expect(stats.failedRequests).toBe(1);

    const est = provider.getTravelEstimate(origins[0]!, destinations[0]!);
    expect(est.source).toBe('STRAIGHT_LINE');
  });

  it('performs end-to-end solve with prepareTravelTimeProvider and all solvers', async () => {
    const scenario: Scenario = {
      id: 'test-scenario',
      metadata: {
        id: 'test-scenario',
        name: 'Test Scenario',
        region: 'Delhi NCR',
        createdAt: new Date().toISOString(),
        bounds: { minLat: 28.5, maxLat: 28.7, minLng: 77.1, maxLng: 77.3 },
      },
      requests: [
        {
          id: 'req-1',
          lat: 28.61,
          lng: 77.21,
          peopleCount: 2,
          urgency: 'HIGH',
          status: 'PENDING',
          source: 'REPORTED',
          createdAt: new Date().toISOString(),
        },
        {
          id: 'req-2',
          lat: 28.63,
          lng: 77.23,
          peopleCount: 3,
          urgency: 'CRITICAL',
          status: 'PENDING',
          source: 'REPORTED',
          createdAt: new Date().toISOString(),
        },
      ],
      resources: [
        {
          id: 'res-1',
          name: 'Rescue Truck 1',
          lat: 28.6,
          lng: 77.2,
          type: 'HIGH_WATER_VEHICLE',
          capacity: 5,
          status: 'AVAILABLE',
          speedKmH: 40,
          source: 'REAL',
        },
      ],
      shelters: [
        {
          id: 'sh-1',
          name: 'Primary Shelter',
          lat: 28.65,
          lng: 77.25,
          capacity: 100,
          currentOccupancy: 0,
          source: 'REAL',
        },
      ],
    };

    const { provider, report } = await prepareTravelTimeProvider(scenario, {
      osrm: { baseUrl },
    });

    const nfPlan = solveNearestFirst(scenario, { travelTimeProvider: provider });
    const cwPlan = solveClarkeWrightBaseline(scenario, { travelTimeProvider: provider });
    const caPlan = solveClusterAllocation(scenario, { travelTimeProvider: provider });

    expect(nfPlan.routes.length).toBeGreaterThan(0);
    expect(cwPlan.routes.length).toBeGreaterThan(0);
    expect(caPlan.routes.length).toBeGreaterThan(0);

    const rep = report();
    expect(rep.osrmConfigured).toBe(true);
    expect(rep.effectiveSource).toBe('OSRM');
    expect(rep.lookupsOsrm).toBeGreaterThan(0);
    expect(rep.lookupsStraightLinePolicy).toBe(0);
    expect(rep.lookupsFallback).toBe(0);
    expect(rep.lookupsOutsideCoverage).toBe(0);
    expect(rep.regions).toEqual([
      {
        id: 'default',
        requests: rep.osrmRequests,
        failedRequests: 0,
        lookupsOsrm: rep.lookupsOsrm,
      },
    ]);
    expect(rep.roadCoveragePercent).toBe(100);
    expect(rep.warnings).toHaveLength(0);
  });

  it('routes two-region scenario across two local fake OSRM servers, isolates coords by bbox, and handles cross-region & outside legs', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const northBbox: BoundingBox = { minLat: 28.44, minLng: 76.98, maxLat: 28.74, maxLng: 77.5 };
    const southBbox: BoundingBox = { minLat: 12.8, minLng: 77.4, maxLat: 13.2, maxLng: 77.8 };

    const receivedNorth: GeoPoint[] = [];
    const receivedSouth: GeoPoint[] = [];

    function createRegionFakeServer(
      seenCoords: GeoPoint[],
      detourFactor: number,
    ): { server: http.Server; start: () => Promise<string> } {
      const srv = http.createServer((req, res) => {
        const url = new URL(req.url ?? '/', 'http://127.0.0.1');
        const coordsSegment = url.pathname.split('/')[4] ?? '';
        const parsed = (coordsSegment ? coordsSegment.split(';') : []).map((c) => {
          const [lngStr = '0', latStr = '0'] = c.split(',');
          return { lat: parseFloat(latStr), lng: parseFloat(lngStr) };
        });
        seenCoords.push(...parsed);

        const sourcesParam = url.searchParams.get('sources');
        const destsParam = url.searchParams.get('destinations');
        const sIdxList = sourcesParam
          ? sourcesParam.split(';').map(Number)
          : parsed.map((_, i) => i);
        const dIdxList = destsParam ? destsParam.split(';').map(Number) : parsed.map((_, i) => i);

        const durations = sIdxList.map((si) =>
          dIdxList.map((di) => {
            const distKm = haversineKm(parsed[si]!, parsed[di]!) * detourFactor;
            return Math.round((distKm / 50) * 3600);
          }),
        );
        const distances = sIdxList.map((si) =>
          dIdxList.map((di) =>
            Math.round(haversineKm(parsed[si]!, parsed[di]!) * detourFactor * 1000),
          ),
        );
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ code: 'Ok', durations, distances }));
      });
      return {
        server: srv,
        start: () =>
          new Promise<string>((resolve) => {
            srv.listen(0, '127.0.0.1', () => {
              const addr = srv.address() as AddressInfo;
              resolve(`http://127.0.0.1:${addr.port}`);
            });
          }),
      };
    }

    const fakeA = createRegionFakeServer(receivedNorth, 1.5);
    const fakeB = createRegionFakeServer(receivedSouth, 1.8);
    const [urlNorth, urlSouth] = await Promise.all([fakeA.start(), fakeB.start()]);

    try {
      const twoRegionScenario: Scenario = {
        id: 'two-region-india',
        metadata: {
          id: 'two-region-india',
          name: 'Two Region + Outside Scenario',
          region: 'India',
          createdAt: new Date().toISOString(),
          bounds: { minLat: 12.8, maxLat: 28.74, minLng: 72.8, maxLng: 77.8 },
        },
        requests: [
          {
            id: 'req-north',
            lat: 28.62,
            lng: 77.22,
            peopleCount: 2,
            urgency: 'HIGH',
            status: 'PENDING',
            source: 'REPORTED',
            createdAt: new Date().toISOString(),
          },
          {
            id: 'req-south',
            lat: 12.97,
            lng: 77.59,
            peopleCount: 3,
            urgency: 'CRITICAL',
            status: 'PENDING',
            source: 'REPORTED',
            createdAt: new Date().toISOString(),
          },
          {
            id: 'req-outside-mumbai',
            lat: 19.07,
            lng: 72.87,
            peopleCount: 1,
            urgency: 'MEDIUM',
            status: 'PENDING',
            source: 'REPORTED',
            createdAt: new Date().toISOString(),
          },
        ],
        resources: [
          {
            id: 'truck-north',
            name: 'Delhi Truck',
            lat: 28.6,
            lng: 77.2,
            type: 'HIGH_WATER_VEHICLE',
            capacity: 6,
            status: 'AVAILABLE',
            speedKmH: 50,
            source: 'REAL',
          },
          {
            id: 'truck-south',
            name: 'Bengaluru Truck',
            lat: 12.95,
            lng: 77.55,
            type: 'HIGH_WATER_VEHICLE',
            capacity: 6,
            status: 'AVAILABLE',
            speedKmH: 50,
            source: 'REAL',
          },
        ],
        shelters: [
          {
            id: 'sh-north',
            name: 'Delhi Shelter',
            lat: 28.65,
            lng: 77.25,
            capacity: 50,
            currentOccupancy: 0,
            source: 'REAL',
          },
          {
            id: 'sh-south',
            name: 'Bengaluru Shelter',
            lat: 13.02,
            lng: 77.64,
            capacity: 50,
            currentOccupancy: 0,
            source: 'REAL',
          },
        ],
      };

      const { provider, report } = await prepareTravelTimeProvider(twoRegionScenario, {
        osrm: {
          regions: [
            { id: 'north', baseUrl: urlNorth, bbox: northBbox },
            { id: 'south', baseUrl: urlSouth, bbox: southBbox },
          ],
        },
      });

      // Each fake server received ONLY coordinates inside its own bbox
      expect(receivedNorth.length).toBeGreaterThan(0);
      expect(receivedSouth.length).toBeGreaterThan(0);
      expect(receivedNorth.every((c) => isPointInBbox(c, northBbox))).toBe(true);
      expect(receivedSouth.every((c) => isPointInBbox(c, southBbox))).toBe(true);

      // Explicit cross-region leg returns straight-line
      const crossRegionEst = provider.getTravelEstimate(
        twoRegionScenario.resources[0]!, // Delhi
        twoRegionScenario.requests[1]!, // Bengaluru
        50,
        false,
        'HIGH_WATER_VEHICLE',
      );
      expect(crossRegionEst.source).toBe('STRAIGHT_LINE');

      // Plan is still produced by all three solvers
      const nfPlan = solveNearestFirst(twoRegionScenario, { travelTimeProvider: provider });
      const cwPlan = solveClarkeWrightBaseline(twoRegionScenario, { travelTimeProvider: provider });
      const caPlan = solveClusterAllocation(twoRegionScenario, { travelTimeProvider: provider });
      expect(nfPlan.routes.length).toBeGreaterThan(0);
      expect(cwPlan.routes.length).toBeGreaterThan(0);
      expect(caPlan.routes.length).toBeGreaterThan(0);

      const rep = report();
      expect(rep.osrmConfigured).toBe(true);
      expect(rep.effectiveSource).toBe('MIXED');
      expect(rep.lookupsOsrm).toBeGreaterThan(0);
      expect(rep.lookupsOutsideCoverage).toBeGreaterThan(0);
      expect(rep.regions).toHaveLength(2);
      const northRep = rep.regions.find((r) => r.id === 'north')!;
      const southRep = rep.regions.find((r) => r.id === 'south')!;
      expect(northRep.requests).toBe(1);
      expect(southRep.requests).toBe(1);
      expect(northRep.lookupsOsrm).toBeGreaterThan(0);
      expect(southRep.lookupsOsrm).toBeGreaterThan(0);
      expect(northRep.lookupsOsrm + southRep.lookupsOsrm).toBe(rep.lookupsOsrm);
      expect(rep.roadCoveragePercent).toBe(
        Number(
          ((rep.lookupsOsrm / (rep.lookupsOsrm + rep.lookupsOutsideCoverage)) * 100).toFixed(1),
        ),
      );
      expect(rep.warnings).toContain(
        '1 of 7 scenario points are outside every configured OSRM region; straight-line estimates used',
      );
    } finally {
      await new Promise<void>((r) => fakeA.server.close(() => r()));
      await new Promise<void>((r) => fakeB.server.close(() => r()));
      warnSpy.mockRestore();
    }
  });

  it('enriches solved road routes via local HTTP /route/v1/ GeoJSON endpoint while keeping BOAT straight-line', async () => {
    const routeRequests: string[] = [];
    const routeServer = http.createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      if (url.pathname.startsWith('/route/v1/')) {
        routeRequests.push(url.pathname + url.search);
        const coordsSeg = url.pathname.split('/')[4] ?? '';
        const [fromRaw = '77.21,28.66', toRaw = '77.23,28.68'] = coordsSeg.split(';');
        const [fLng = 77.21, fLat = 28.66] = fromRaw.split(',').map(Number);
        const [tLng = 77.23, tLat = 28.68] = toRaw.split(',').map(Number);
        const midLng = Number(((fLng + tLng) / 2 + 0.004).toFixed(6));
        const midLat = Number(((fLat + tLat) / 2 + 0.002).toFixed(6));

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            code: 'Ok',
            routes: [
              {
                distance: 3600,
                duration: 240,
                geometry: {
                  type: 'LineString',
                  coordinates: [
                    [fLng, fLat],
                    [midLng, midLat],
                    [tLng, tLat],
                  ],
                },
              },
            ],
          }),
        );
        return;
      }

      res.writeHead(404);
      res.end();
    });

    const routeUrl = await new Promise<string>((resolve) => {
      routeServer.listen(0, '127.0.0.1', () => {
        const addr = routeServer.address() as AddressInfo;
        resolve(`http://127.0.0.1:${addr.port}`);
      });
    });

    try {
      const resources = [
        {
          id: 'road-1',
          name: 'Road Truck',
          type: 'HIGH_WATER_VEHICLE' as const,
          capacity: 6,
          speedKmH: 36,
          lat: 28.66,
          lng: 77.21,
          status: 'AVAILABLE' as const,
          source: 'SIMULATED' as const,
        },
        {
          id: 'boat-policy-1',
          name: 'Policy Boat',
          type: 'BOAT' as const,
          capacity: 4,
          speedKmH: 20,
          lat: 28.66,
          lng: 77.21,
          status: 'AVAILABLE' as const,
          source: 'SIMULATED' as const,
        },
      ];

      const routes = [
        {
          resourceId: 'road-1',
          stops: [
            {
              stopNumber: 1,
              type: 'PICKUP' as const,
              targetId: 'req-1',
              lat: 28.68,
              lng: 77.23,
              passengersPickedUp: 2,
              passengersDroppedOff: 0,
              estimatedArrivalMinutes: 5,
            },
            {
              stopNumber: 2,
              type: 'DROPOFF' as const,
              targetId: 'sh-1',
              lat: 28.7,
              lng: 77.25,
              passengersPickedUp: 0,
              passengersDroppedOff: 2,
              estimatedArrivalMinutes: 11,
            },
          ],
          totalTravelDistanceKm: 7.2,
          totalDurationMinutes: 11,
          servedRequestIds: ['req-1'],
        },
        {
          resourceId: 'boat-policy-1',
          stops: [
            {
              stopNumber: 1,
              type: 'PICKUP' as const,
              targetId: 'req-1',
              lat: 28.68,
              lng: 77.23,
              passengersPickedUp: 2,
              passengersDroppedOff: 0,
              estimatedArrivalMinutes: 9,
            },
          ],
          totalTravelDistanceKm: 2.9,
          totalDurationMinutes: 9,
          servedRequestIds: ['req-1'],
        },
      ];

      const { routes: enriched, stats } = await enrichRoutesWithGeometry(routes, {
        resources,
        osrm: { baseUrl: routeUrl },
      });

      expect(routeRequests).toHaveLength(2);
      expect(routeRequests[0]).toContain('overview=full&geometries=geojson');
      expect(stats.legsOsrm).toBe(2);
      expect(stats.legsStraightLinePolicy).toBe(1);

      const roadGeom = enriched[0]!.geometry!;
      expect(roadGeom.source).toBe('OSRM');
      // 3 coordinates per leg -> 5 deduplicated vertices
      expect(roadGeom.coordinates.length).toBe(5);
      expect(roadGeom.distanceKm).toBe(7.2);

      const boatGeom = enriched[1]!.geometry!;
      expect(boatGeom.source).toBe('STRAIGHT_LINE');
      expect(boatGeom.coordinates).toEqual([
        [28.66, 77.21],
        [28.68, 77.23],
      ]);
    } finally {
      await new Promise<void>((r) => routeServer.close(() => r()));
    }
  });
});
