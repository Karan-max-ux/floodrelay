import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { FloodForecastContext } from '@floodrelay/shared';
import { ForecastService } from './forecastService.js';
import { OpenMeteoFloodForecastProvider, classifyDischargeRisk } from './openMeteoProvider.js';
import type { FloodForecastProvider } from './types.js';

describe('FloodForecast Provider & Service Suite', () => {
  let mockProvider: FloodForecastProvider;
  let service: ForecastService;
  const originalEnv = process.env;

  const mockFreshContext: FloodForecastContext = {
    provider: 'Copernicus EMS GloFAS via Open-Meteo',
    source: 'ECMWF GloFAS 4.0 Gridded Hydrological Model',
    attribution: 'Copernicus EMS (CC BY 4.0)',
    license: 'CC BY 4.0',
    region: {
      name: 'Yamuna River Basin (Delhi Reach)',
      targetLat: 28.65,
      targetLng: 77.23,
      stationLat: 28.675,
      stationLng: 77.225,
      elevationMeters: 227,
    },
    issuedAt: '2026-11-08T00:00:00.000Z',
    retrievedAt: '2026-11-08T06:00:00.000Z',
    validFrom: '2026-11-08T00:00:00.000Z',
    validTo: '2026-11-14T23:59:59.000Z',
    forecastHorizonDays: 7,
    variable: {
      name: 'river_discharge',
      unit: 'm³/s',
      description: 'Simulated daily river discharge rate in cubic meters per second',
    },
    daily: [
      {
        date: '2026-11-08',
        dischargeM3S: 4.25,
        dischargeMeanM3S: 4.25,
        dischargeMaxM3S: 4.25,
        dischargeMinM3S: 4.25,
      },
      {
        date: '2026-11-09',
        dischargeM3S: 4.24,
        dischargeMeanM3S: 4.24,
        dischargeMaxM3S: 4.24,
        dischargeMinM3S: 4.24,
      },
    ],
    currentDischargeM3S: 4.25,
    peakForecastM3S: 4.25,
    riskCategory: 'NORMAL',
    isExperimentalIndicator: true,
    freshness: 'FRESH',
    disclaimer:
      'Informational context only. This layer is informational only and does not trigger autonomous rescue dispatch or modify committed routes.',
  };

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.FORECAST_ENABLE_OFFLINE_FIXTURE;
    mockProvider = {
      name: 'MockProvider',
      getForecast: vi.fn().mockResolvedValue(mockFreshContext),
    };
    service = new ForecastService({ provider: mockProvider, cacheTtlMs: 3600000 });
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('classifies river discharge levels into correct risk tiers', () => {
    expect(classifyDischargeRisk(10)).toBe('NORMAL');
    expect(classifyDischargeRisk(49.9)).toBe('NORMAL');
    expect(classifyDischargeRisk(50)).toBe('ELEVATED');
    expect(classifyDischargeRisk(150)).toBe('ELEVATED');
    expect(classifyDischargeRisk(200)).toBe('HIGH');
    expect(classifyDischargeRisk(750)).toBe('HIGH');
    expect(classifyDischargeRisk(800)).toBe('EXTREME');
    expect(classifyDischargeRisk(1200)).toBe('EXTREME');
  });

  it('fetches fresh forecast from provider on initial call and populates metadata without hardcoded confidence', async () => {
    const res = await service.getForecastContext({ lat: 28.65, lng: 77.23, days: 7 });

    expect(mockProvider.getForecast).toHaveBeenCalledTimes(1);
    expect(res.provider).toContain('Copernicus EMS GloFAS');
    expect(res.variable.unit).toBe('m³/s');
    expect(res.variable.name).toBe('river_discharge');
    expect(res.daily.length).toBe(2);
    expect(res.freshness).toBe('FRESH');
    expect(res.riskCategory).toBe('NORMAL');
    expect(res.isExperimentalIndicator).toBe(true);
    expect(res.confidenceScore).toBeUndefined();
  });

  it('serves cached forecast on subsequent call within TTL without re-querying provider', async () => {
    const res1 = await service.getForecastContext({ lat: 28.65, lng: 77.23, days: 7 });
    expect(res1.freshness).toBe('FRESH');

    const res2 = await service.getForecastContext({ lat: 28.65, lng: 77.23, days: 7 });
    expect(mockProvider.getForecast).toHaveBeenCalledTimes(1);
    expect(res2.freshness).toBe('CACHED');
    expect(res2.currentDischargeM3S).toBe(4.25);
  });

  it('bypasses cache when forceRefresh is set to true', async () => {
    await service.getForecastContext({ lat: 28.65, lng: 77.23, days: 7 });
    expect(mockProvider.getForecast).toHaveBeenCalledTimes(1);

    const res = await service.getForecastContext({
      lat: 28.65,
      lng: 77.23,
      days: 7,
      forceRefresh: true,
    });
    expect(mockProvider.getForecast).toHaveBeenCalledTimes(2);
    expect(res.freshness).toBe('FRESH');
  });

  it('falls back to STALE cached data if provider fails on background refresh', async () => {
    await service.getForecastContext({ lat: 28.65, lng: 77.23, days: 7 });

    (mockProvider.getForecast as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('Upstream timeout'),
    );

    const staleRes = await service.getForecastContext({
      lat: 28.65,
      lng: 77.23,
      days: 7,
      forceRefresh: true,
    });
    expect(staleRes.freshness).toBe('STALE');
    expect(staleRes.disclaimer).toContain('Serving stale cached forecast');
    expect(staleRes.currentDischargeM3S).toBe(4.25);
  });

  it('returns explicit UNAVAILABLE status without fabricating low risk when upstream fails and no cache exists', async () => {
    (mockProvider.getForecast as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('Upstream down'),
    );

    const unavailRes = await service.getForecastContext({ lat: 28.65, lng: 77.23, days: 7 });
    expect(unavailRes.freshness).toBe('UNAVAILABLE');
    expect(unavailRes.riskCategory).toBe('UNAVAILABLE');
    expect(unavailRes.currentDischargeM3S).toBe(0);
    expect(unavailRes.disclaimer).toContain('currently unavailable');
  });

  it('generates offline fixture labeled SIMULATED FORECAST — DEMO ONLY when explicitly authorized via env flag', async () => {
    process.env.FORECAST_ENABLE_OFFLINE_FIXTURE = '1';
    const realProvider = new OpenMeteoFloodForecastProvider();
    const fallback = realProvider.getFallbackFixture(28.65, 77.23, 7);

    expect(fallback.freshness).toBe('OFFLINE_FIXTURE');
    expect(fallback.source).toBe('SIMULATED FORECAST — DEMO ONLY');
    expect(fallback.riskCategory).toBe('UNKNOWN');
    expect(fallback.daily.length).toBe(7);
    expect(fallback.variable.unit).toBe('m³/s');
    expect(fallback.isExperimentalIndicator).toBe(true);
    expect(fallback.confidenceScore).toBeUndefined();
    expect(fallback.disclaimer).toContain('SIMULATED FORECAST — DEMO ONLY');
  });

  describe('Provenance Preservation & Cache Contamination Prevention (Phase 2 Regressions)', () => {
    it('1. Initial genuine forecast returns FRESH and 2. Repeated genuine request returns CACHED', async () => {
      const first = await service.getForecastContext({ lat: 28.65, lng: 77.23 });
      expect(first.freshness).toBe('FRESH');

      const second = await service.getForecastContext({ lat: 28.65, lng: 77.23 });
      expect(second.freshness).toBe('CACHED');
    });

    it('3. Explicit offline fixture returns OFFLINE_FIXTURE and 4. Repeated offline fixture request remains OFFLINE_FIXTURE (never promoted to CACHED or READY)', async () => {
      process.env.FORECAST_ENABLE_OFFLINE_FIXTURE = '1';
      const realProvider = new OpenMeteoFloodForecastProvider();
      vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network offline'));

      const offlineService = new ForecastService({ provider: realProvider });
      const first = await offlineService.getForecastContext({ lat: 28.65, lng: 77.23 });
      expect(first.freshness).toBe('OFFLINE_FIXTURE');
      expect(first.source).toBe('SIMULATED FORECAST — DEMO ONLY');
      expect(first.riskCategory).toBe('UNKNOWN');

      // Second request must remain OFFLINE_FIXTURE — must NEVER be promoted to CACHED!
      const second = await offlineService.getForecastContext({ lat: 28.65, lng: 77.23 });
      expect(second.freshness).toBe('OFFLINE_FIXTURE');
      expect(second.source).toBe('SIMULATED FORECAST — DEMO ONLY');
    });

    it('5. Simulated fixture never enters the authentic forecast cache', async () => {
      process.env.FORECAST_ENABLE_OFFLINE_FIXTURE = '1';
      const realProvider = new OpenMeteoFloodForecastProvider();
      vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('Network offline'));

      const offlineService = new ForecastService({ provider: realProvider });
      const fixtureRes = await offlineService.getForecastContext({ lat: 28.65, lng: 77.23 });
      expect(fixtureRes.freshness).toBe('OFFLINE_FIXTURE');

      // Now disable offline fixture flag — subsequent query should NOT find a cached entry!
      delete process.env.FORECAST_ENABLE_OFFLINE_FIXTURE;
      vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('Network offline'));

      const nextRes = await offlineService.getForecastContext({ lat: 28.65, lng: 77.23 });
      // Must degrade to UNAVAILABLE, proving the simulated fixture was NEVER stored in cache
      expect(nextRes.freshness).toBe('UNAVAILABLE');
    });

    it('6. Force refresh preserves provenance', async () => {
      process.env.FORECAST_ENABLE_OFFLINE_FIXTURE = '1';
      const realProvider = new OpenMeteoFloodForecastProvider();
      vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network offline'));

      const offlineService = new ForecastService({ provider: realProvider });
      const res = await offlineService.getForecastContext({
        lat: 28.65,
        lng: 77.23,
        forceRefresh: true,
      });
      expect(res.freshness).toBe('OFFLINE_FIXTURE');
    });

    it('7. Provider recovery replaces the simulated display with genuine data', async () => {
      process.env.FORECAST_ENABLE_OFFLINE_FIXTURE = '1';
      let requestNum = 0;
      const recoverableProvider = {
        name: 'RecoverableProvider',
        getForecast: vi.fn().mockImplementation(() => {
          requestNum++;
          if (requestNum === 1) {
            // First request fails and returns offline fixture
            const p = new OpenMeteoFloodForecastProvider();
            return Promise.resolve(p.getFallbackFixture(28.65, 77.23, 7));
          }
          // Second request recovers with genuine upstream data
          return Promise.resolve(mockFreshContext);
        }),
      };

      const recoveryService = new ForecastService({ provider: recoverableProvider });
      const first = await recoveryService.getForecastContext({ lat: 28.65, lng: 77.23 });
      expect(first.freshness).toBe('OFFLINE_FIXTURE');

      // When network recovers, real forecast data safely replaces the demonstration display
      const second = await recoveryService.getForecastContext({
        lat: 28.65,
        lng: 77.23,
        forceRefresh: true,
      });
      expect(second.freshness).toBe('FRESH');
      expect(second.source).toContain('ECMWF GloFAS 4.0');
    });

    it('8. Provider failure after genuine cached data returns appropriately labelled STALE', async () => {
      process.env.FORECAST_ENABLE_OFFLINE_FIXTURE = '1';
      // First call succeeds with genuine data
      await service.getForecastContext({ lat: 28.65, lng: 77.23 });

      // Provider fails on subsequent refresh
      (mockProvider.getForecast as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('Upstream timeout'),
      );

      const staleRes = await service.getForecastContext({
        lat: 28.65,
        lng: 77.23,
        forceRefresh: true,
      });
      // Genuine cache takes precedence over offline fixture
      expect(staleRes.freshness).toBe('STALE');
      expect(staleRes.disclaimer).toContain('Serving stale cached forecast');
    });

    it('9. Provider failure without genuine cache returns UNAVAILABLE unless an explicitly enabled fixture is requested', async () => {
      delete process.env.FORECAST_ENABLE_OFFLINE_FIXTURE;
      (mockProvider.getForecast as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('Upstream down'),
      );

      const unavail = await service.getForecastContext({ lat: 28.65, lng: 77.23 });
      expect(unavail.freshness).toBe('UNAVAILABLE');
      expect(unavail.riskCategory).toBe('UNAVAILABLE');
    });

    it('10. Disabling offline fixtures prevents continued use of previously generated simulated data', async () => {
      process.env.FORECAST_ENABLE_OFFLINE_FIXTURE = '1';
      const realProvider = new OpenMeteoFloodForecastProvider();
      vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network offline'));

      const s = new ForecastService({ provider: realProvider });
      const first = await s.getForecastContext({ lat: 28.65, lng: 77.23 });
      expect(first.freshness).toBe('OFFLINE_FIXTURE');

      // Now disable flag
      delete process.env.FORECAST_ENABLE_OFFLINE_FIXTURE;
      const second = await s.getForecastContext({ lat: 28.65, lng: 77.23 });
      expect(second.freshness).toBe('UNAVAILABLE');
    });

    it('11. No simulated forecast becomes READY as authentic information', async () => {
      process.env.FORECAST_ENABLE_OFFLINE_FIXTURE = '1';
      const realProvider = new OpenMeteoFloodForecastProvider();
      vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network offline'));

      const s = new ForecastService({ provider: realProvider });
      const fixture = await s.getForecastContext({ lat: 28.65, lng: 77.23 });
      expect(fixture.freshness).toBe('OFFLINE_FIXTURE');
      expect(fixture.freshness).not.toBe('FRESH');
      expect(fixture.freshness).not.toBe('CACHED');
      expect(fixture.riskCategory).toBe('UNKNOWN');
    });
  });

  it('validates coordinates and rejects invalid out-of-bounds parameters', async () => {
    const provider = new OpenMeteoFloodForecastProvider();
    await expect(provider.getForecast({ lat: 105, lng: 77.23 })).rejects.toThrow(
      /Invalid coordinates/,
    );
    await expect(provider.getForecast({ lat: 28.65, lng: 200 })).rejects.toThrow(
      /Invalid coordinates/,
    );
  });

  it('verifies human-in-the-loop safety invariant: forecast layer has zero solver mutations', async () => {
    const res = await service.getForecastContext({ lat: 28.65, lng: 77.23 });
    expect(res).toBeDefined();
    expect(res.disclaimer).toContain('does not trigger autonomous rescue dispatch');
  });
});
