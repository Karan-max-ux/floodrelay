import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  OpenMeteoFloodForecastProvider,
  classifyDischargeRisk,
  DEFAULT_YAMUNA_LAT,
  DEFAULT_YAMUNA_LNG,
  FORECAST_DISCLAIMER,
} from './openMeteoProvider.js';
import { ForecastService } from './forecastService.js';

describe('OpenMeteoFloodForecastProvider Unit Tests', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.FORECAST_ENABLE_OFFLINE_FIXTURE;
    vi.restoreAllMocks();
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  describe('classifyDischargeRisk boundary thresholds & safety', () => {
    it('returns UNAVAILABLE for non-finite, NaN, null-cast, or negative discharge measurements', () => {
      expect(classifyDischargeRisk(NaN)).toBe('UNAVAILABLE');
      expect(classifyDischargeRisk(Infinity)).toBe('UNAVAILABLE');
      expect(classifyDischargeRisk(-Infinity)).toBe('UNAVAILABLE');
      expect(classifyDischargeRisk(-0.01)).toBe('UNAVAILABLE');
      expect(classifyDischargeRisk(-50)).toBe('UNAVAILABLE');
      // @ts-expect-error test invalid types
      expect(classifyDischargeRisk(undefined)).toBe('UNAVAILABLE');
      // @ts-expect-error test invalid types
      expect(classifyDischargeRisk('invalid')).toBe('UNAVAILABLE');
    });

    it('classifies exact boundary conditions: 49.99, 50, 199.99, 200, 799.99, 800', () => {
      // 0 to 49.99 -> NORMAL
      expect(classifyDischargeRisk(0)).toBe('NORMAL');
      expect(classifyDischargeRisk(25)).toBe('NORMAL');
      expect(classifyDischargeRisk(49.99)).toBe('NORMAL');

      // 50 to 199.99 -> ELEVATED
      expect(classifyDischargeRisk(50)).toBe('ELEVATED');
      expect(classifyDischargeRisk(100)).toBe('ELEVATED');
      expect(classifyDischargeRisk(199.99)).toBe('ELEVATED');

      // 200 to 799.99 -> HIGH
      expect(classifyDischargeRisk(200)).toBe('HIGH');
      expect(classifyDischargeRisk(500)).toBe('HIGH');
      expect(classifyDischargeRisk(799.99)).toBe('HIGH');

      // 800+ -> EXTREME
      expect(classifyDischargeRisk(800)).toBe('EXTREME');
      expect(classifyDischargeRisk(1500)).toBe('EXTREME');
    });
  });

  describe('transformResponse and validation edge-cases', () => {
    const provider = new OpenMeteoFloodForecastProvider();

    it('rejects empty daily.time array without defaulting to 0 / NORMAL', () => {
      const malformed = {
        latitude: 28.65,
        longitude: 77.23,
        generationtime_ms: 1.2,
        utc_offset_seconds: 0,
        timezone: 'UTC',
        timezone_abbreviation: 'UTC',
        daily_units: { time: 'iso8601', river_discharge: 'm³/s' },
        daily: {
          time: [],
          river_discharge: [],
        },
      };

      // @ts-expect-error private method test
      expect(() => provider.transformResponse(malformed, 28.65, 77.23, 7, 'FRESH')).toThrow(
        /empty or missing daily\.time array/,
      );
    });

    it('rejects malformed date strings in daily.time', () => {
      const malformed = {
        latitude: 28.65,
        longitude: 77.23,
        generationtime_ms: 1.2,
        utc_offset_seconds: 0,
        timezone: 'UTC',
        timezone_abbreviation: 'UTC',
        daily_units: { time: 'iso8601', river_discharge: 'm³/s' },
        daily: {
          time: ['2026/11/08', 'not-a-date'],
          river_discharge: [10, 20],
        },
      };

      // @ts-expect-error private method test
      expect(() => provider.transformResponse(malformed, 28.65, 77.23, 7, 'FRESH')).toThrow(
        /Malformed or invalid calendar date/,
      );
    });

    it('rejects semantically impossible calendar dates such as February 30 or April 31', () => {
      const feb30 = {
        latitude: 28.65,
        longitude: 77.23,
        generationtime_ms: 1.2,
        utc_offset_seconds: 0,
        timezone: 'UTC',
        timezone_abbreviation: 'UTC',
        daily_units: { time: 'iso8601', river_discharge: 'm³/s' },
        daily: {
          time: ['2026-02-30'],
          river_discharge: [10],
        },
      };
      // @ts-expect-error private method test
      expect(() => provider.transformResponse(feb30, 28.65, 77.23, 1, 'FRESH')).toThrow(
        /Malformed or invalid calendar date/,
      );

      const apr31 = {
        latitude: 28.65,
        longitude: 77.23,
        generationtime_ms: 1.2,
        utc_offset_seconds: 0,
        timezone: 'UTC',
        timezone_abbreviation: 'UTC',
        daily_units: { time: 'iso8601', river_discharge: 'm³/s' },
        daily: {
          time: ['2026-04-31'],
          river_discharge: [10],
        },
      };
      // @ts-expect-error private method test
      expect(() => provider.transformResponse(apr31, 28.65, 77.23, 1, 'FRESH')).toThrow(
        /Malformed or invalid calendar date/,
      );
    });

    it('rejects duplicate or out-of-order dates in daily.time', () => {
      const outOfOrder = {
        latitude: 28.65,
        longitude: 77.23,
        generationtime_ms: 1.2,
        utc_offset_seconds: 0,
        timezone: 'UTC',
        timezone_abbreviation: 'UTC',
        daily_units: { time: 'iso8601', river_discharge: 'm³/s' },
        daily: {
          time: ['2026-11-09', '2026-11-08'],
          river_discharge: [10, 20],
        },
      };
      // @ts-expect-error private method test
      expect(() => provider.transformResponse(outOfOrder, 28.65, 77.23, 2, 'FRESH')).toThrow(
        /Out-of-order or duplicate forecast date/,
      );

      const duplicateDate = {
        latitude: 28.65,
        longitude: 77.23,
        generationtime_ms: 1.2,
        utc_offset_seconds: 0,
        timezone: 'UTC',
        timezone_abbreviation: 'UTC',
        daily_units: { time: 'iso8601', river_discharge: 'm³/s' },
        daily: {
          time: ['2026-11-08', '2026-11-08'],
          river_discharge: [10, 20],
        },
      };
      // @ts-expect-error private method test
      expect(() => provider.transformResponse(duplicateDate, 28.65, 77.23, 2, 'FRESH')).toThrow(
        /Out-of-order or duplicate forecast date/,
      );
    });

    it('rejects incompatible measurement units for river_discharge', () => {
      const incompatibleUnit = {
        latitude: 28.65,
        longitude: 77.23,
        generationtime_ms: 1.2,
        utc_offset_seconds: 0,
        timezone: 'UTC',
        timezone_abbreviation: 'UTC',
        daily_units: { time: 'iso8601', river_discharge: 'cfs' },
        daily: {
          time: ['2026-11-08'],
          river_discharge: [10],
        },
      };
      // @ts-expect-error private method test
      expect(() => provider.transformResponse(incompatibleUnit, 28.65, 77.23, 1, 'FRESH')).toThrow(
        /Incompatible measurement unit for river_discharge/,
      );
    });

    it('rejects inconsistent discharge bounds where max < min or mean is outside [min, max]', () => {
      const maxLessThanMin = {
        latitude: 28.65,
        longitude: 77.23,
        generationtime_ms: 1.2,
        utc_offset_seconds: 0,
        timezone: 'UTC',
        timezone_abbreviation: 'UTC',
        daily_units: { time: 'iso8601', river_discharge: 'm³/s' },
        daily: {
          time: ['2026-11-08'],
          river_discharge: [10],
          river_discharge_min: [20],
          river_discharge_max: [15],
        },
      };
      // @ts-expect-error private method test
      expect(() => provider.transformResponse(maxLessThanMin, 28.65, 77.23, 1, 'FRESH')).toThrow(
        /Inconsistent discharge bounds on 2026-11-08: max \(15\) < min \(20\)/,
      );
    });

    it('rejects missing discharge metrics', () => {
      const malformed = {
        latitude: 28.65,
        longitude: 77.23,
        generationtime_ms: 1.2,
        utc_offset_seconds: 0,
        timezone: 'UTC',
        timezone_abbreviation: 'UTC',
        daily_units: { time: 'iso8601' },
        daily: {
          time: ['2026-11-08'],
        },
      };

      // @ts-expect-error private method test
      expect(() => provider.transformResponse(malformed, 28.65, 77.23, 7, 'FRESH')).toThrow(
        /no river discharge metrics/,
      );
    });

    it('rejects mismatched array lengths between time and discharge arrays', () => {
      const malformed = {
        latitude: 28.65,
        longitude: 77.23,
        generationtime_ms: 1.2,
        utc_offset_seconds: 0,
        timezone: 'UTC',
        timezone_abbreviation: 'UTC',
        daily_units: { time: 'iso8601', river_discharge: 'm³/s' },
        daily: {
          time: ['2026-11-08', '2026-11-09'],
          river_discharge: [10], // length 1 vs dates length 2
        },
      };

      // @ts-expect-error private method test
      expect(() => provider.transformResponse(malformed, 28.65, 77.23, 7, 'FRESH')).toThrow(
        /Array length mismatch for river_discharge/,
      );
    });

    it('rejects null, NaN, or negative discharge measurements rather than silently defaulting to 0 / NORMAL', () => {
      const malformed = {
        latitude: 28.65,
        longitude: 77.23,
        generationtime_ms: 1.2,
        utc_offset_seconds: 0,
        timezone: 'UTC',
        timezone_abbreviation: 'UTC',
        daily_units: { time: 'iso8601', river_discharge: 'm³/s' },
        daily: {
          time: ['2026-11-08'],
          river_discharge: [NaN],
        },
      };

      // @ts-expect-error private method test
      expect(() => provider.transformResponse(malformed, 28.65, 77.23, 7, 'FRESH')).toThrow(
        /Invalid (or non-finite measurement|or missing river discharge measurement)/,
      );
    });

    it('validates and maps complete scientific attribution and metadata', () => {
      const valid = {
        latitude: 28.65,
        longitude: 77.23,
        generationtime_ms: 1.2,
        utc_offset_seconds: 0,
        timezone: 'UTC',
        timezone_abbreviation: 'UTC',
        elevation: 215,
        daily_units: { time: 'iso8601', river_discharge: 'm³/s' },
        daily: {
          time: ['2026-11-08', '2026-11-09'],
          river_discharge: [120.5, 230.1],
          river_discharge_mean: [120.5, 230.1],
          river_discharge_max: [130.0, 245.0],
          river_discharge_min: [110.0, 220.0],
        },
      };

      // @ts-expect-error private method test
      const result = provider.transformResponse(valid, 28.65, 77.23, 2, 'FRESH');
      expect(result.provider).toContain('Copernicus EMS GloFAS via Open-Meteo');
      expect(result.source).toContain('ECMWF GloFAS 4.0');
      expect(result.attribution).toContain('Copernicus Emergency Management Service');
      expect(result.license).toBe('CC BY 4.0');
      expect(result.isExperimentalIndicator).toBe(true);
      expect(result.disclaimer).toBe(FORECAST_DISCLAIMER);
      expect(result.peakForecastM3S).toBe(245.0);
      expect(result.riskCategory).toBe('HIGH');
      expect(result.daily).toHaveLength(2);
      expect(result.daily[0]?.dischargeM3S).toBe(120.5);
    });
  });

  describe('HTTP error handling, timeouts and offline fallback', () => {
    it('handles upstream HTTP 429 rate limiting by failing or falling back appropriately', async () => {
      const provider = new OpenMeteoFloodForecastProvider();
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: false,
        status: 429,
        statusText: 'Too Many Requests',
      } as Response);

      await expect(provider.getForecast()).rejects.toThrow(/HTTP 429/);
    });

    it('handles upstream HTTP 500 server error', async () => {
      const provider = new OpenMeteoFloodForecastProvider();
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      } as Response);

      await expect(provider.getForecast()).rejects.toThrow(/HTTP 500/);
    });

    it('handles network abort / timeout cleanly', async () => {
      const provider = new OpenMeteoFloodForecastProvider({ timeoutMs: 50 });
      vi.spyOn(globalThis, 'fetch').mockImplementationOnce(
        () =>
          new Promise((_, reject) => {
            setTimeout(() => {
              const err = new Error('The operation was aborted');
              err.name = 'AbortError';
              reject(err);
            }, 100);
          }),
      );

      await expect(provider.getForecast()).rejects.toThrow(/aborted/);
    });

    it('returns deterministic offline fixture when FORECAST_ENABLE_OFFLINE_FIXTURE is enabled', async () => {
      process.env.FORECAST_ENABLE_OFFLINE_FIXTURE = '1';
      const provider = new OpenMeteoFloodForecastProvider();
      vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('Network offline'));

      const result = await provider.getForecast();
      expect(result.freshness).toBe('OFFLINE_FIXTURE');
      expect(result.riskCategory).toBe('UNKNOWN');
      expect(result.source).toContain('SIMULATED FORECAST');
      expect(result.daily.length).toBe(7);
    });
  });

  describe('ForecastService caching and UNAVAILABLE degradation', () => {
    it('returns UNAVAILABLE when provider fails and no cache or offline fixture exists', async () => {
      const failingProvider = {
        name: 'FailingProvider',
        getForecast: vi.fn().mockRejectedValue(new Error('Connection refused')),
      };
      const service = new ForecastService({ provider: failingProvider });

      const res = await service.getForecastContext({
        lat: DEFAULT_YAMUNA_LAT,
        lng: DEFAULT_YAMUNA_LNG,
      });
      expect(res.freshness).toBe('UNAVAILABLE');
      expect(res.riskCategory).toBe('UNAVAILABLE');
      expect(res.daily).toHaveLength(0);
      expect(res.disclaimer).toContain('currently unavailable');
    });

    it('serves STALE cache when provider fails after cache expiry', async () => {
      let callCount = 0;
      const validContext = {
        provider: 'GloFAS',
        source: 'GloFAS',
        attribution: 'CC BY 4.0',
        license: 'CC BY 4.0',
        region: {
          name: 'Yamuna',
          targetLat: 28.65,
          targetLng: 77.23,
          stationLat: 28.65,
          stationLng: 77.23,
        },
        issuedAt: new Date().toISOString(),
        retrievedAt: new Date().toISOString(),
        validFrom: new Date().toISOString(),
        validTo: new Date().toISOString(),
        forecastHorizonDays: 7,
        variable: { name: 'river_discharge', unit: 'm³/s', description: 'm3/s' },
        daily: [
          {
            date: '2026-11-08',
            dischargeM3S: 10,
            dischargeMeanM3S: 10,
            dischargeMaxM3S: 10,
            dischargeMinM3S: 10,
          },
        ],
        currentDischargeM3S: 10,
        peakForecastM3S: 10,
        riskCategory: 'NORMAL' as const,
        isExperimentalIndicator: true,
        freshness: 'FRESH' as const,
        disclaimer: 'Initial disclaimer',
      };

      const mockProvider = {
        name: 'Mock',
        getForecast: vi.fn().mockImplementation(() => {
          callCount++;
          if (callCount === 1) {
            return Promise.resolve(validContext);
          }
          return Promise.reject(new Error('Network error on refresh'));
        }),
      };

      const service = new ForecastService({ provider: mockProvider, cacheTtlMs: 10 });
      // 1. Initial call populates cache
      const first = await service.getForecastContext({ lat: 28.65, lng: 77.23 });
      expect(first.freshness).toBe('FRESH');

      // Wait for TTL to expire
      await new Promise((r) => setTimeout(r, 20));

      // 2. Second call triggers refresh, fails upstream, falls back to STALE cache
      const second = await service.getForecastContext({ lat: 28.65, lng: 77.23 });
      expect(second.freshness).toBe('STALE');
      expect(second.disclaimer).toContain('Serving stale cached forecast');
    });
  });
});
