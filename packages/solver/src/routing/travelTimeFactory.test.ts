import { describe, it, expect, vi } from 'vitest';
import type { Scenario, BlockedZone } from '@floodrelay/shared';
import { osrmConfigFromEnv, prepareTravelTimeProvider } from './travelTimeFactory.js';
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
  });
});
