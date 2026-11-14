import { describe, it, expect, vi } from 'vitest';
import type { Scenario, BlockedZone } from '@floodrelay/shared';
import {
  osrmConfigFromEnv,
  parseCoverageBbox,
  parseOsrmRegions,
  prepareTravelTimeProvider,
} from './travelTimeFactory.js';
import { StraightLineTravelTimeProvider } from './travelTime.js';
import { HazardAwareTravelTimeProvider } from './hazardAwareTravelTime.js';

describe('travelTimeFactory', () => {
  describe('osrmConfigFromEnv', () => {
    it('returns null when OSRM_BASE_URL is blank, missing, or whitespace', () => {
      expect(osrmConfigFromEnv({})).toBeNull();
      expect(osrmConfigFromEnv({ OSRM_BASE_URL: '' })).toBeNull();
      expect(osrmConfigFromEnv({ OSRM_BASE_URL: '   ' })).toBeNull();
    });

    it('parses valid environment variables with default profile', () => {
      const config = osrmConfigFromEnv({
        OSRM_BASE_URL: 'http://127.0.0.1:5000',
      });
      expect(config).toEqual({
        baseUrl: 'http://127.0.0.1:5000',
        profile: 'driving',
        timeoutMs: undefined,
        maxTableCoordinates: undefined,
      });
    });

    it('parses custom profile, timeout, and maxTableCoordinates', () => {
      const config = osrmConfigFromEnv({
        OSRM_BASE_URL: 'http://osrm-service:5000/',
        OSRM_PROFILE: 'car',
        OSRM_TIMEOUT_MS: '3000',
        OSRM_MAX_TABLE_COORDINATES: '80',
      });
      expect(config).toEqual({
        baseUrl: 'http://osrm-service:5000/',
        profile: 'car',
        timeoutMs: 3000,
        maxTableCoordinates: 80,
      });
    });

    it('safely ignores invalid numeric values with a console warning', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const config = osrmConfigFromEnv({
        OSRM_BASE_URL: 'http://127.0.0.1:5000',
        OSRM_TIMEOUT_MS: 'not-a-number',
        OSRM_MAX_TABLE_COORDINATES: '1', // Must be >= 2
      });

      expect(config?.timeoutMs).toBeUndefined();
      expect(config?.maxTableCoordinates).toBeUndefined();
      expect(warnSpy).toHaveBeenCalledTimes(2);

      warnSpy.mockRestore();
    });

    it('parses optional OSRM_COVERAGE_BBOX with single-region OSRM_BASE_URL and ignores invalid bboxes', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const valid = osrmConfigFromEnv({
        OSRM_BASE_URL: 'http://127.0.0.1:5000',
        OSRM_COVERAGE_BBOX: ' 28.44 , 76.98 , 28.74 , 77.50 ',
      });
      expect(valid?.coverageBbox).toEqual({
        minLat: 28.44,
        minLng: 76.98,
        maxLat: 28.74,
        maxLng: 77.5,
      });

      const invalidBboxes = [
        '28.44,76.98,28.74', // wrong count
        '28.44,abc,28.74,77.50', // non-numeric
        '28.74,76.98,28.44,77.50', // minLat > maxLat
        '28.44,76.98,28.44,77.50', // minLat === maxLat
        '-91,76.98,28.74,77.50', // out of range
        '28.44,76.98,28.74,181', // out of range
      ];
      for (const bad of invalidBboxes) {
        const cfg = osrmConfigFromEnv({
          OSRM_BASE_URL: 'http://127.0.0.1:5000',
          OSRM_COVERAGE_BBOX: bad,
        });
        expect(cfg?.coverageBbox).toBeUndefined();
      }

      expect(parseCoverageBbox('   ')).toBeUndefined();
      expect(warnSpy).toHaveBeenCalledTimes(invalidBboxes.length);
      warnSpy.mockRestore();
    });

    it('parses valid OSRM_REGIONS JSON array without requiring OSRM_BASE_URL', () => {
      const config = osrmConfigFromEnv({
        OSRM_REGIONS: JSON.stringify([
          {
            id: 'north',
            baseUrl: 'http://127.0.0.1:5001/',
            bbox: '28.44,76.98,28.74,77.50',
          },
          {
            id: 'south',
            baseUrl: 'http://127.0.0.1:5002',
            bbox: '12.80,77.40,13.20,77.80',
            profile: 'car',
          },
        ]),
      });

      expect(config?.regions).toEqual([
        {
          id: 'north',
          baseUrl: 'http://127.0.0.1:5001',
          bbox: { minLat: 28.44, minLng: 76.98, maxLat: 28.74, maxLng: 77.5 },
          profile: 'driving',
        },
        {
          id: 'south',
          baseUrl: 'http://127.0.0.1:5002',
          bbox: { minLat: 12.8, minLng: 77.4, maxLat: 13.2, maxLng: 77.8 },
          profile: 'car',
        },
      ]);
    });

    it('rejects duplicate ids and skips invalid entries in OSRM_REGIONS safely with warnings', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      expect(osrmConfigFromEnv({ OSRM_REGIONS: 'not-valid-json' })).toBeNull();
      expect(osrmConfigFromEnv({ OSRM_REGIONS: '{"id":"not-array"}' })).toBeNull();

      const parsed = parseOsrmRegions(
        JSON.stringify([
          'not-an-object',
          { id: '', baseUrl: 'http://127.0.0.1:5001', bbox: '28.44,76.98,28.74,77.50' },
          { id: 'bad-url', baseUrl: 'ftp://invalid:5001', bbox: '28.44,76.98,28.74,77.50' },
          { id: 'bad-bbox', baseUrl: 'http://127.0.0.1:5001', bbox: '28.74,76.98,28.44,77.50' },
          {
            id: 'bad-profile',
            baseUrl: 'http://127.0.0.1:5001',
            bbox: '28.44,76.98,28.74,77.50',
            profile: '',
          },
          { id: 'north', baseUrl: 'http://127.0.0.1:5001', bbox: '28.44,76.98,28.74,77.50' },
          { id: 'north', baseUrl: 'http://127.0.0.1:5009', bbox: '12.80,77.40,13.20,77.80' }, // duplicate id
        ]),
      );

      expect(parsed).toEqual([
        {
          id: 'north',
          baseUrl: 'http://127.0.0.1:5001',
          bbox: { minLat: 28.44, minLng: 76.98, maxLat: 28.74, maxLng: 77.5 },
          profile: 'driving',
        },
      ]);
      expect(warnSpy).toHaveBeenCalled();
      warnSpy.mockRestore();
    });
  });

  describe('prepareTravelTimeProvider', () => {
    const baseScenario: Scenario = {
      id: 'factory-test',
      metadata: {
        id: 'factory-test',
        name: 'Factory Test Scenario',
        region: 'Delhi NCR',
        createdAt: new Date().toISOString(),
        bounds: { minLat: 28.5, maxLat: 28.7, minLng: 77.1, maxLng: 77.3 },
      },
      requests: [
        {
          id: 'r1',
          lat: 28.6,
          lng: 77.2,
          peopleCount: 1,
          urgency: 'HIGH',
          status: 'PENDING',
          source: 'REPORTED',
          createdAt: new Date().toISOString(),
        },
        {
          id: 'r2',
          lat: 28.6,
          lng: 77.2, // Same coordinate as r1 to test deduplication
          peopleCount: 2,
          urgency: 'MEDIUM',
          status: 'PENDING',
          source: 'REPORTED',
          createdAt: new Date().toISOString(),
        },
      ],
      resources: [
        {
          id: 'v1',
          name: 'Rescue Truck 1',
          lat: 28.55,
          lng: 77.15,
          type: 'HIGH_WATER_VEHICLE',
          capacity: 5,
          speedKmH: 40,
          status: 'AVAILABLE',
          source: 'REAL',
        },
      ],
      shelters: [
        {
          id: 's1',
          name: 'Shelter Central',
          lat: 28.65,
          lng: 77.25,
          capacity: 50,
          currentOccupancy: 0,
          source: 'REAL',
        },
      ],
    };

    it('returns straight-line provider and unconfigured report when osrm option is null/omitted', async () => {
      const { provider, report } = await prepareTravelTimeProvider(baseScenario, { osrm: null });
      const est = provider.getTravelEstimate(baseScenario.resources[0]!, baseScenario.requests[0]!);

      expect(est.source).toBe('STRAIGHT_LINE');

      const rep = report();
      expect(rep.osrmConfigured).toBe(false);
      expect(rep.effectiveSource).toBe('STRAIGHT_LINE');
      expect(rep.roadCoveragePercent).toBeNull();
      expect(rep.osrmRequests).toBe(0);
      expect(rep.lookupsOutsideCoverage).toBe(0);
      expect(rep.regions).toEqual([]);
      expect(rep.hazardZoneCount).toBe(0);
      expect(rep.warnings).toHaveLength(0);
    });

    it('falls back to straight-line if point count exceeds pointLimit', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      // Base scenario has 3 unique points (v1, r1/r2, s1)
      const { provider, report } = await prepareTravelTimeProvider(baseScenario, {
        osrm: { baseUrl: 'http://127.0.0.1:5000' },
        pointLimit: 2, // limit is 2, but we have 3 unique points
      });

      const est = provider.getTravelEstimate(baseScenario.resources[0]!, baseScenario.requests[0]!);
      expect(est.source).toBe('STRAIGHT_LINE');

      const rep = report();
      expect(rep.osrmConfigured).toBe(true);
      expect(rep.effectiveSource).toBe('STRAIGHT_LINE');
      expect(rep.lookupsOutsideCoverage).toBe(0);
      expect(rep.regions).toEqual([
        { id: 'default', requests: 0, failedRequests: 0, lookupsOsrm: 0 },
      ]);
      expect(rep.roadCoveragePercent).toBe(0);
      expect(rep.warnings.some((w) => w.includes('exceed OSRM limit'))).toBe(true);

      warnSpy.mockRestore();
    });

    it('wraps provider with HazardAwareTravelTimeProvider when blockedZones are present', async () => {
      const blockedZone: BlockedZone = {
        id: 'zone-1',
        name: 'Flooded River Bank',
        severity: 'BLOCKED',
        polygon: [
          { lat: 28.58, lng: 77.18 },
          { lat: 28.62, lng: 77.18 },
          { lat: 28.62, lng: 77.22 },
          { lat: 28.58, lng: 77.22 },
        ],
      };

      const scenarioWithZones: Scenario = {
        ...baseScenario,
        blockedZones: [blockedZone],
      };

      const { provider, report } = await prepareTravelTimeProvider(scenarioWithZones, {
        osrm: null,
      });
      expect(provider).toBeInstanceOf(HazardAwareTravelTimeProvider);

      const rep = report();
      expect(rep.hazardZoneCount).toBe(1);

      // Leg from v1 (28.55, 77.15) to s1 (28.65, 77.25) crosses the blocked zone
      const estimate = provider.getTravelEstimate(
        baseScenario.resources[0]!,
        baseScenario.shelters[0]!,
      );
      expect(estimate.blocked).toBe(true);
      expect(estimate.hazard).toBe('BLOCKED');
      expect(estimate.durationMinutes).toBe(Number.POSITIVE_INFINITY);
    });
    it('(a) boat and helicopter times equal StraightLineTravelTimeProvider values exactly', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          code: 'Ok',
          durations: [[120, 240]],
          distances: [[5000, 10000]],
        }),
      });

      const { provider } = await prepareTravelTimeProvider(baseScenario, {
        osrm: { baseUrl: 'http://127.0.0.1:5000', fetchImpl: mockFetch as unknown as typeof fetch },
      });

      const straightLine = new StraightLineTravelTimeProvider();
      const origin = baseScenario.resources[0]!;
      const dest = baseScenario.requests[0]!;

      const boatEst = provider.getTravelEstimate(origin, dest, 25, false, 'BOAT');
      const expectedBoat = straightLine.getTravelEstimate(origin, dest, 25, false, 'BOAT');
      expect(boatEst).toEqual(expectedBoat);
      expect(boatEst.source).toBe('STRAIGHT_LINE');

      const heliEst = provider.getTravelEstimate(origin, dest, 120, false, 'HELICOPTER');
      const expectedHeli = straightLine.getTravelEstimate(origin, dest, 120, false, 'HELICOPTER');
      expect(heliEst).toEqual(expectedHeli);
      expect(heliEst.source).toBe('STRAIGHT_LINE');
    });

    it('(b) a boats-only scenario makes zero OSRM requests', async () => {
      const mockFetch = vi.fn();
      const boatsOnlyScenario: Scenario = {
        ...baseScenario,
        resources: [
          {
            id: 'boat-1',
            name: 'Rescue Boat Alpha',
            type: 'BOAT',
            capacity: 6,
            lat: 28.52,
            lng: 77.12,
            speedKmH: 25,
            status: 'AVAILABLE',
            source: 'REAL',
          },
          {
            id: 'boat-2',
            name: 'Rescue Boat Bravo',
            type: 'BOAT',
            capacity: 8,
            lat: 28.53,
            lng: 77.13,
            speedKmH: 20,
            status: 'AVAILABLE',
            source: 'REAL',
          },
        ],
      };

      const { provider, report } = await prepareTravelTimeProvider(boatsOnlyScenario, {
        osrm: { baseUrl: 'http://127.0.0.1:5000', fetchImpl: mockFetch as unknown as typeof fetch },
      });

      expect(mockFetch).not.toHaveBeenCalled();

      // Query legs for boats
      provider.getTravelEstimate(
        boatsOnlyScenario.resources[0]!,
        boatsOnlyScenario.requests[0]!,
        25,
        false,
        'BOAT',
      );
      provider.getTravelEstimate(
        boatsOnlyScenario.requests[0]!,
        boatsOnlyScenario.shelters[0]!,
        25,
        false,
        'BOAT',
      );

      const rep = report();
      expect(rep.osrmRequests).toBe(0);
      expect(rep.osrmFailedRequests).toBe(0);
      expect(rep.lookupsOsrm).toBe(0);
      expect(rep.lookupsStraightLinePolicy).toBe(2);
      expect(rep.lookupsFallback).toBe(0);
      expect(rep.lookupsOutsideCoverage).toBe(0);
      expect(rep.regions).toEqual([
        { id: 'default', requests: 0, failedRequests: 0, lookupsOsrm: 0 },
      ]);
      expect(rep.roadCoveragePercent).toBeNull();
      expect(rep.effectiveSource).toBe('STRAIGHT_LINE');
    });

    it('(c) a mixed scenario sends OSRM requests only for road-vehicle legs', async () => {
      let requestedUrl = '';
      const mockFetch = vi.fn().mockImplementation(async (url: string) => {
        requestedUrl = url;
        return {
          ok: true,
          json: async () => ({
            code: 'Ok',
            durations: [
              [0, 100, 200],
              [100, 0, 150],
              [200, 150, 0],
            ],
            distances: [
              [0, 1500, 3000],
              [1500, 0, 2000],
              [3000, 2000, 0],
            ],
          }),
        };
      });

      const mixedScenario: Scenario = {
        ...baseScenario,
        resources: [
          {
            id: 'boat-1',
            name: 'Rescue Boat Alpha',
            type: 'BOAT',
            capacity: 6,
            lat: 28.45,
            lng: 77.05,
            speedKmH: 25,
            status: 'AVAILABLE',
            source: 'REAL',
          },
          {
            id: 'truck-1',
            name: 'Rescue Truck Alpha',
            type: 'HIGH_WATER_VEHICLE',
            capacity: 8,
            lat: 28.55,
            lng: 77.15,
            speedKmH: 40,
            status: 'AVAILABLE',
            source: 'REAL',
          },
        ],
      };

      const { provider } = await prepareTravelTimeProvider(mixedScenario, {
        osrm: { baseUrl: 'http://127.0.0.1:5000', fetchImpl: mockFetch as unknown as typeof fetch },
      });

      // The prefetch URL must contain the truck coordinate (77.150000,28.550000)
      // but must NOT contain the boat coordinate (77.050000,28.450000)
      expect(requestedUrl).toContain('77.15,28.55');
      expect(requestedUrl).not.toContain('77.05,28.45');

      // Road vehicle leg gets OSRM
      const truckEst = provider.getTravelEstimate(
        mixedScenario.resources[1]!,
        mixedScenario.requests[0]!,
        40,
        false,
        'HIGH_WATER_VEHICLE',
      );
      expect(truckEst.source).toBe('OSRM');

      // Boat leg gets STRAIGHT_LINE
      const boatEst = provider.getTravelEstimate(
        mixedScenario.resources[0]!,
        mixedScenario.requests[0]!,
        25,
        false,
        'BOAT',
      );
      expect(boatEst.source).toBe('STRAIGHT_LINE');
    });

    it('(d) report fields are correct in each case (boats-only, road-only, mixed)', async () => {
      const mockFetch = vi.fn().mockImplementation(async () => ({
        ok: true,
        json: async () => ({
          code: 'Ok',
          durations: [
            [0, 100, 200],
            [100, 0, 150],
            [200, 150, 0],
          ],
          distances: [
            [0, 1500, 3000],
            [1500, 0, 2000],
            [3000, 2000, 0],
          ],
        }),
      }));

      // 1. Road-only case
      const roadScenario: Scenario = {
        ...baseScenario,
        resources: [
          {
            id: 'truck-1',
            name: 'Rescue Truck Alpha',
            type: 'HIGH_WATER_VEHICLE',
            capacity: 8,
            lat: 28.55,
            lng: 77.15,
            speedKmH: 40,
            status: 'AVAILABLE',
            source: 'REAL',
          },
        ],
      };
      const { provider: roadProvider, report: roadReport } = await prepareTravelTimeProvider(
        roadScenario,
        {
          osrm: {
            baseUrl: 'http://127.0.0.1:5000',
            fetchImpl: mockFetch as unknown as typeof fetch,
          },
        },
      );
      roadProvider.getTravelEstimate(
        roadScenario.resources[0]!,
        roadScenario.requests[0]!,
        40,
        false,
        'HIGH_WATER_VEHICLE',
      );
      const repRoad = roadReport();
      expect(repRoad.effectiveSource).toBe('OSRM');
      expect(repRoad.osrmRequests).toBeGreaterThan(0);
      expect(repRoad.lookupsOsrm).toBe(1);
      expect(repRoad.lookupsStraightLinePolicy).toBe(0);
      expect(repRoad.lookupsFallback).toBe(0);
      expect(repRoad.lookupsOutsideCoverage).toBe(0);
      expect(repRoad.regions).toHaveLength(1);
      expect(repRoad.regions[0]!.lookupsOsrm).toBe(1);
      expect(repRoad.roadCoveragePercent).toBe(100);

      // 2. Mixed case
      const mixedScenario: Scenario = {
        ...baseScenario,
        resources: [
          {
            id: 'boat-1',
            name: 'Rescue Boat',
            type: 'BOAT',
            capacity: 6,
            lat: 28.45,
            lng: 77.05,
            speedKmH: 25,
            status: 'AVAILABLE',
            source: 'REAL',
          },
          {
            id: 'truck-1',
            name: 'Rescue Truck',
            type: 'HIGH_WATER_VEHICLE',
            capacity: 8,
            lat: 28.55,
            lng: 77.15,
            speedKmH: 40,
            status: 'AVAILABLE',
            source: 'REAL',
          },
        ],
      };
      const { provider: mixedProvider, report: mixedReport } = await prepareTravelTimeProvider(
        mixedScenario,
        {
          osrm: {
            baseUrl: 'http://127.0.0.1:5000',
            fetchImpl: mockFetch as unknown as typeof fetch,
          },
        },
      );
      // One truck lookup, one boat lookup
      mixedProvider.getTravelEstimate(
        mixedScenario.resources[1]!,
        mixedScenario.requests[0]!,
        40,
        false,
        'HIGH_WATER_VEHICLE',
      );
      mixedProvider.getTravelEstimate(
        mixedScenario.resources[0]!,
        mixedScenario.requests[0]!,
        25,
        false,
        'BOAT',
      );
      const repMixed = mixedReport();
      expect(repMixed.effectiveSource).toBe('MIXED');
      expect(repMixed.lookupsOsrm).toBe(1);
      expect(repMixed.lookupsStraightLinePolicy).toBe(1);
      expect(repMixed.lookupsFallback).toBe(0);
      expect(repMixed.lookupsOutsideCoverage).toBe(0);
      expect(repMixed.regions).toHaveLength(1);
      expect(repMixed.roadCoveragePercent).toBe(100);
    });

    it('(e) makes zero OSRM requests when all scenario points lie outside configured regions', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const mockFetch = vi.fn();

      const outsideScenario: Scenario = {
        ...baseScenario,
        requests: [{ ...baseScenario.requests[0]!, lat: 19.07, lng: 72.87 }],
        resources: [{ ...baseScenario.resources[0]!, lat: 19.05, lng: 72.85 }],
        shelters: [{ ...baseScenario.shelters[0]!, lat: 19.1, lng: 72.9 }],
      };

      const { provider, report } = await prepareTravelTimeProvider(outsideScenario, {
        osrm: {
          fetchImpl: mockFetch as unknown as typeof fetch,
          regions: [
            {
              id: 'north',
              baseUrl: 'http://127.0.0.1:5001',
              bbox: { minLat: 28.44, minLng: 76.98, maxLat: 28.74, maxLng: 77.5 },
            },
            {
              id: 'south',
              baseUrl: 'http://127.0.0.1:5002',
              bbox: { minLat: 12.8, minLng: 77.4, maxLat: 13.2, maxLng: 77.8 },
            },
          ],
        },
      });

      expect(mockFetch).not.toHaveBeenCalled();
      const est = provider.getTravelEstimate(
        outsideScenario.resources[0]!,
        outsideScenario.requests[0]!,
        40,
        false,
        'HIGH_WATER_VEHICLE',
      );
      expect(est.source).toBe('STRAIGHT_LINE');

      const rep = report();
      expect(rep.osrmConfigured).toBe(true);
      expect(rep.osrmRequests).toBe(0);
      expect(rep.lookupsOsrm).toBe(0);
      expect(rep.lookupsOutsideCoverage).toBe(1);
      expect(rep.roadCoveragePercent).toBe(0);
      expect(rep.effectiveSource).toBe('STRAIGHT_LINE');
      expect(rep.regions).toEqual([
        { id: 'north', requests: 0, failedRequests: 0, lookupsOsrm: 0 },
        { id: 'south', requests: 0, failedRequests: 0, lookupsOsrm: 0 },
      ]);
      expect(rep.warnings).toContain(
        '3 of 3 scenario points are outside every configured OSRM region; straight-line estimates used',
      );
      warnSpy.mockRestore();
    });

    it('(f) enforces per-scenario pointLimit across multiple regions combined', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const mockFetch = vi.fn();

      const multiRegionScenario: Scenario = {
        ...baseScenario,
        requests: [
          { ...baseScenario.requests[0]!, id: 'r-north', lat: 28.6, lng: 77.2 },
          { ...baseScenario.requests[1]!, id: 'r-south', lat: 12.95, lng: 77.55 },
        ],
        resources: [{ ...baseScenario.resources[0]!, id: 'v-north', lat: 28.55, lng: 77.15 }],
        shelters: [{ ...baseScenario.shelters[0]!, id: 's-south', lat: 13.0, lng: 77.6 }],
      };

      // 4 unique points across the two regions combined, limit = 3 -> skips all OSRM prefetch
      const { report } = await prepareTravelTimeProvider(multiRegionScenario, {
        pointLimit: 3,
        osrm: {
          fetchImpl: mockFetch as unknown as typeof fetch,
          regions: [
            {
              id: 'north',
              baseUrl: 'http://127.0.0.1:5001',
              bbox: { minLat: 28.44, minLng: 76.98, maxLat: 28.74, maxLng: 77.5 },
            },
            {
              id: 'south',
              baseUrl: 'http://127.0.0.1:5002',
              bbox: { minLat: 12.8, minLng: 77.4, maxLat: 13.2, maxLng: 77.8 },
            },
          ],
        },
      });

      expect(mockFetch).not.toHaveBeenCalled();
      const rep = report();
      expect(rep.warnings.some((w) => w.includes('exceed OSRM limit'))).toBe(true);
      warnSpy.mockRestore();
    });
  });
});
