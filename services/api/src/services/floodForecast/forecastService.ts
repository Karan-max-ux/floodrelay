import type { FloodForecastContext } from '@floodrelay/shared';
import type { FloodForecastProvider, ForecastQueryOptions } from './types.js';
import { OpenMeteoFloodForecastProvider } from './openMeteoProvider.js';

interface CacheEntry {
  data: FloodForecastContext;
  cachedAt: number;
}

export class ForecastService {
  private readonly provider: FloodForecastProvider;
  private readonly cacheTtlMs: number;
  private cache: Map<string, CacheEntry> = new Map();

  constructor(options?: { provider?: FloodForecastProvider; cacheTtlMs?: number }) {
    this.provider = options?.provider ?? new OpenMeteoFloodForecastProvider();
    this.cacheTtlMs = options?.cacheTtlMs ?? 60 * 60 * 1000; // 1 hour default
  }

  private getCacheKey(options?: ForecastQueryOptions): string {
    const lat = (options?.lat ?? 28.65).toFixed(2);
    const lng = (options?.lng ?? 77.23).toFixed(2);
    const days = options?.days ?? 7;
    return `${lat}:${lng}:${days}`;
  }

  async getForecastContext(options?: ForecastQueryOptions): Promise<FloodForecastContext> {
    const cacheKey = this.getCacheKey(options);
    const cached = this.cache.get(cacheKey);
    const now = Date.now();

    // 1. Return fresh cached copy if within TTL and refresh not requested
    if (cached && !options?.forceRefresh && now - cached.cachedAt < this.cacheTtlMs) {
      return {
        ...cached.data,
        freshness: 'CACHED',
      };
    }

    try {
      // 2. Fetch from upstream provider
      const freshData = await this.provider.getForecast(options);

      // CRITICAL PROVENANCE PRESERVATION:
      // Offline simulated fixtures must NEVER enter the authentic forecast cache.
      // They must always retain OFFLINE_FIXTURE provenance and never be promoted to FRESH or CACHED.
      if (freshData.freshness === 'OFFLINE_FIXTURE') {
        // If authentic data was previously cached, authentic STALE data takes precedence over simulated fixture
        if (cached) {
          return {
            ...cached.data,
            freshness: 'STALE',
            disclaimer: `${cached.data.disclaimer} (NOTICE: Serving stale cached forecast as upstream update timed out).`,
          };
        }
        return freshData;
      }

      this.cache.set(cacheKey, {
        data: freshData,
        cachedAt: now,
      });
      return freshData;
    } catch {
      // 3. Fallback to stale cached data if available (only authentic upstream data exists in this.cache)
      if (cached) {
        return {
          ...cached.data,
          freshness: 'STALE',
          disclaimer: `${cached.data.disclaimer} (NOTICE: Serving stale cached forecast as upstream update timed out).`,
        };
      }

      // 4. Fallback to deterministic simulated fixture ONLY if offline fixture is explicitly authorized
      const allowOffline =
        process.env.FORECAST_ENABLE_OFFLINE_FIXTURE === '1' ||
        process.env.FORECAST_ENABLE_OFFLINE_FIXTURE === 'true';

      if (
        allowOffline &&
        'getFallbackFixture' in this.provider &&
        typeof (this.provider as { getFallbackFixture?: unknown }).getFallbackFixture === 'function'
      ) {
        return (
          this.provider as {
            getFallbackFixture: (lat?: number, lng?: number, days?: number) => FloodForecastContext;
          }
        ).getFallbackFixture(options?.lat, options?.lng, options?.days);
      }

      // 5. Otherwise return explicit UNAVAILABLE structure without fabricating normal discharge
      const lat = options?.lat ?? 28.65;
      const lng = options?.lng ?? 77.23;
      const days = options?.days ?? 7;
      const nowIso = new Date(now).toISOString();

      return {
        provider: 'Copernicus EMS GloFAS via Open-Meteo',
        source: 'ECMWF GloFAS 4.0 Gridded Hydrological Model',
        attribution: 'Copernicus Emergency Management Service / Open-Meteo',
        license: 'CC BY 4.0',
        region: {
          name: 'Yamuna River Basin (Delhi Reach)',
          targetLat: lat,
          targetLng: lng,
          stationLat: lat,
          stationLng: lng,
        },
        issuedAt: nowIso,
        retrievedAt: nowIso,
        validFrom: nowIso,
        validTo: nowIso,
        forecastHorizonDays: days,
        variable: {
          name: 'river_discharge',
          unit: 'm³/s',
          description: 'Simulated daily river discharge rate in cubic meters per second',
        },
        daily: [],
        currentDischargeM3S: 0,
        peakForecastM3S: 0,
        riskCategory: 'UNAVAILABLE',
        isExperimentalIndicator: true,
        freshness: 'UNAVAILABLE',
        disclaimer:
          'Hydrological flood forecast provider is currently unavailable. No recent forecast data could be retrieved. Operational rescue routing and human dispatch remain fully active.',
      };
    }
  }

  clearCache(): void {
    this.cache.clear();
  }
}
