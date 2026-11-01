import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { GeoPoint, Scenario } from '@floodrelay/shared';
import { haversineKm } from '../index.js';
import { OsrmTravelTimeProvider } from './osrmTravelTime.js';
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
    expect(rep.roadCoveragePercent).toBe(100);
    expect(rep.warnings).toHaveLength(0);
  });
});
