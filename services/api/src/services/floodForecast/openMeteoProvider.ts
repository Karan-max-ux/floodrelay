import type {
  FloodForecastContext,
  ForecastRiskLevel,
  DailyDischargeForecast,
} from '@floodrelay/shared';
import type { FloodForecastProvider, ForecastQueryOptions } from './types.js';

interface OpenMeteoFloodApiResponse {
  latitude: number;
  longitude: number;
  generationtime_ms: number;
  utc_offset_seconds: number;
  timezone: string;
  timezone_abbreviation: string;
  elevation?: number;
  daily_units: {
    time: string;
    river_discharge?: string;
    river_discharge_mean?: string;
    river_discharge_max?: string;
    river_discharge_min?: string;
  };
  daily: {
    time: string[];
    river_discharge?: number[];
    river_discharge_mean?: number[];
    river_discharge_max?: number[];
    river_discharge_min?: number[];
  };
}

export const DEFAULT_YAMUNA_LAT = 28.65;
export const DEFAULT_YAMUNA_LNG = 77.23;
export const DEFAULT_FORECAST_DAYS = 7;
export const FORECAST_DISCLAIMER =
  'Informational hydrological context based on European Centre for Medium-Range Weather Forecasts (ECMWF) GloFAS 4.0 gridded river discharge model via Open-Meteo (CC BY 4.0). GloFAS simulates river discharge in cubic meters per second (m³/s) and does not measure localized street inundation, urban flash flooding, or measured gauge levels at Delhi Old Railway Bridge (Central Water Commission Yamuna Warning Level: 204.5 m, Danger Level: 205.33 m above MSL). All discharge risk thresholds (50, 200, 800 m³/s) are experimental model indicators and do NOT constitute official public flood warnings. This layer is informational only and does not trigger autonomous rescue dispatch or modify committed routes.';

export function isValidCalendarDate(dateStr: string): boolean {
  if (typeof dateStr !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return false;
  }
  const [yearStr, monthStr, dayStr] = dateStr.split('-');
  const year = parseInt(yearStr!, 10);
  const month = parseInt(monthStr!, 10);
  const day = parseInt(dayStr!, 10);
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return false;
  }
  const d = new Date(Date.UTC(year, month - 1, day));
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day;
}

export function classifyDischargeRisk(maxDischargeM3S: number): ForecastRiskLevel {
  if (
    typeof maxDischargeM3S !== 'number' ||
    !Number.isFinite(maxDischargeM3S) ||
    maxDischargeM3S < 0
  ) {
    return 'UNAVAILABLE';
  }
  if (maxDischargeM3S >= 800) return 'EXTREME';
  if (maxDischargeM3S >= 200) return 'HIGH';
  if (maxDischargeM3S >= 50) return 'ELEVATED';
  return 'NORMAL';
}

export class OpenMeteoFloodForecastProvider implements FloodForecastProvider {
  public readonly name = 'OpenMeteo-GloFAS';
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(options?: { baseUrl?: string; timeoutMs?: number }) {
    this.baseUrl = options?.baseUrl || 'https://flood-api.open-meteo.com/v1/flood';
    this.timeoutMs = options?.timeoutMs || 5000;
  }

  async getForecast(options?: ForecastQueryOptions): Promise<FloodForecastContext> {
    const lat = options?.lat ?? DEFAULT_YAMUNA_LAT;
    const lng = options?.lng ?? DEFAULT_YAMUNA_LNG;
    const days = Math.min(Math.max(options?.days ?? DEFAULT_FORECAST_DAYS, 1), 14);

    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      throw new Error(
        `Invalid coordinates: lat=${lat}, lng=${lng}. Must be valid WGS84 coordinates.`,
      );
    }

    const url = new URL(this.baseUrl);
    url.searchParams.set('latitude', lat.toFixed(4));
    url.searchParams.set('longitude', lng.toFixed(4));
    url.searchParams.set(
      'daily',
      'river_discharge,river_discharge_mean,river_discharge_max,river_discharge_min',
    );
    url.searchParams.set('forecast_days', days.toString());

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const res = await fetch(url.toString(), {
        signal: controller.signal,
        headers: {
          Accept: 'application/json',
          'User-Agent': 'FloodRelay-HydrologicalContext/1.0',
        },
      });

      if (!res.ok) {
        throw new Error(`Upstream flood provider returned HTTP ${res.status}: ${res.statusText}`);
      }

      const json = (await res.json()) as OpenMeteoFloodApiResponse;
      return this.transformResponse(json, lat, lng, days, 'FRESH');
    } catch (err) {
      // Offline fixture is permitted ONLY when explicitly authorized via environment flag
      const allowOffline =
        process.env.FORECAST_ENABLE_OFFLINE_FIXTURE === '1' ||
        process.env.FORECAST_ENABLE_OFFLINE_FIXTURE === 'true';

      if (allowOffline) {
        return this.getFallbackFixture(lat, lng, days);
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  private transformResponse(
    json: OpenMeteoFloodApiResponse,
    targetLat: number,
    targetLng: number,
    days: number,
    freshness: 'FRESH' | 'CACHED' | 'STALE',
  ): FloodForecastContext {
    if (!json || typeof json !== 'object' || !json.daily || typeof json.daily !== 'object') {
      throw new Error('Malformed upstream flood forecast: missing daily data object');
    }

    const dates = json.daily.time;
    if (!Array.isArray(dates) || dates.length === 0) {
      throw new Error('Upstream flood provider returned empty or missing daily.time array');
    }

    for (let i = 0; i < dates.length; i++) {
      const d = dates[i];
      if (typeof d !== 'string' || !isValidCalendarDate(d)) {
        throw new Error(`Malformed or invalid calendar date in daily.time: "${d}"`);
      }
      if (i > 0 && d <= dates[i - 1]!) {
        throw new Error(
          `Out-of-order or duplicate forecast date in daily.time: "${d}" follows "${dates[i - 1]}"`,
        );
      }
    }

    if (json.daily_units?.river_discharge) {
      const unit = json.daily_units.river_discharge.trim();
      if (unit !== 'm³/s' && unit !== 'm3/s') {
        throw new Error(
          `Incompatible measurement unit for river_discharge: expected "m³/s", received "${unit}"`,
        );
      }
    }

    const discharge = json.daily.river_discharge;
    const mean = json.daily.river_discharge_mean;
    const max = json.daily.river_discharge_max;
    const min = json.daily.river_discharge_min;

    if (!discharge && !mean && !max) {
      throw new Error('Upstream flood provider returned no river discharge metrics');
    }

    // Verify array length consistency
    for (const [name, arr] of [
      ['river_discharge', discharge],
      ['river_discharge_mean', mean],
      ['river_discharge_max', max],
      ['river_discharge_min', min],
    ] as const) {
      if (arr !== undefined && (!Array.isArray(arr) || arr.length !== dates.length)) {
        throw new Error(
          `Array length mismatch for ${name}: expected ${dates.length}, got ${arr?.length}`,
        );
      }
    }

    const daily: DailyDischargeForecast[] = dates.map((date, idx) => {
      const rawDischarge = discharge ? discharge[idx] : undefined;
      const rawMean = mean ? mean[idx] : undefined;
      const rawMax = max ? max[idx] : undefined;
      const rawMin = min ? min[idx] : undefined;

      // Reject non-finite, null, or negative values immediately
      for (const [metricName, val] of [
        ['river_discharge', rawDischarge],
        ['river_discharge_mean', rawMean],
        ['river_discharge_max', rawMax],
        ['river_discharge_min', rawMin],
      ] as const) {
        if (
          val !== undefined &&
          (val === null || typeof val !== 'number' || !Number.isFinite(val) || val < 0)
        ) {
          throw new Error(
            `Invalid or non-finite measurement for ${metricName} on ${date}: received ${val}`,
          );
        }
      }

      // Check min/mean/max bounds consistency when provided
      if (rawMin !== undefined && rawMax !== undefined && rawMax < rawMin) {
        throw new Error(
          `Inconsistent discharge bounds on ${date}: max (${rawMax}) < min (${rawMin})`,
        );
      }
      if (rawMin !== undefined && rawMean !== undefined && rawMean < rawMin - 0.05) {
        throw new Error(
          `Inconsistent discharge bounds on ${date}: mean (${rawMean}) < min (${rawMin})`,
        );
      }
      if (rawMean !== undefined && rawMax !== undefined && rawMean > rawMax + 0.05) {
        throw new Error(
          `Inconsistent discharge bounds on ${date}: mean (${rawMean}) > max (${rawMax})`,
        );
      }

      const effectiveDischarge = rawDischarge ?? rawMean ?? rawMax;
      if (
        effectiveDischarge === undefined ||
        effectiveDischarge === null ||
        !Number.isFinite(effectiveDischarge) ||
        effectiveDischarge < 0
      ) {
        throw new Error(
          `Invalid or missing river discharge measurement on ${date}: received ${effectiveDischarge}`,
        );
      }

      const effectiveMean = rawMean ?? effectiveDischarge;
      const effectiveMax = rawMax ?? effectiveDischarge;
      const effectiveMin = rawMin ?? effectiveDischarge;

      if (!Number.isFinite(effectiveMean) || effectiveMean < 0) {
        throw new Error(`Invalid river_discharge_mean on ${date}: received ${effectiveMean}`);
      }
      if (!Number.isFinite(effectiveMax) || effectiveMax < 0) {
        throw new Error(`Invalid river_discharge_max on ${date}: received ${effectiveMax}`);
      }
      if (!Number.isFinite(effectiveMin) || effectiveMin < 0) {
        throw new Error(`Invalid river_discharge_min on ${date}: received ${effectiveMin}`);
      }

      return {
        date,
        dischargeM3S: Number(effectiveDischarge.toFixed(2)),
        dischargeMeanM3S: Number(effectiveMean.toFixed(2)),
        dischargeMaxM3S: Number(effectiveMax.toFixed(2)),
        dischargeMinM3S: Number(effectiveMin.toFixed(2)),
      };
    });

    const currentDischargeM3S = daily[0]?.dischargeM3S ?? 0;
    const peakForecastM3S = daily.reduce((acc, d) => Math.max(acc, d.dischargeMaxM3S), 0);
    const riskCategory = classifyDischargeRisk(peakForecastM3S);

    const retrievedAt = new Date().toISOString();

    return {
      provider: 'Copernicus EMS GloFAS via Open-Meteo',
      source: 'ECMWF GloFAS 4.0 Gridded Hydrological Model',
      attribution:
        'Contains modified Copernicus Emergency Management Service information (GloFAS) via Open-Meteo under CC BY 4.0',
      license: 'CC BY 4.0',
      region: {
        name: 'Yamuna River Basin (Delhi Reach)',
        targetLat,
        targetLng,
        stationLat: json.latitude,
        stationLng: json.longitude,
        elevationMeters: json.elevation,
      },
      issuedAt: dates[0] ? `${dates[0]}T00:00:00.000Z` : retrievedAt,
      retrievedAt,
      validFrom: dates[0] ? `${dates[0]}T00:00:00.000Z` : retrievedAt,
      validTo: dates[dates.length - 1] ? `${dates[dates.length - 1]}T23:59:59.000Z` : retrievedAt,
      forecastHorizonDays: days,
      variable: {
        name: 'river_discharge',
        unit: json.daily_units?.river_discharge || 'm³/s',
        description: 'Simulated daily river discharge rate in cubic meters per second',
      },
      daily,
      currentDischargeM3S,
      peakForecastM3S,
      riskCategory,
      isExperimentalIndicator: true,
      freshness,
      disclaimer: FORECAST_DISCLAIMER,
    };
  }

  public getFallbackFixture(
    targetLat = DEFAULT_YAMUNA_LAT,
    targetLng = DEFAULT_YAMUNA_LNG,
    days = DEFAULT_FORECAST_DAYS,
  ): FloodForecastContext {
    const today = new Date();
    const daily: DailyDischargeForecast[] = [];

    // Realistic baseline discharge for Yamuna at Delhi reach (simulated fixture)
    const baseDischarges = [4.28, 4.25, 4.24, 4.22, 4.22, 4.22, 4.21, 4.2, 4.19, 4.18];

    for (let i = 0; i < days; i++) {
      const d = new Date(today.getTime() + i * 24 * 3600 * 1000);
      const dateStr = d.toISOString().split('T')[0]!;
      const val = baseDischarges[i % baseDischarges.length]!;
      daily.push({
        date: dateStr,
        dischargeM3S: val,
        dischargeMeanM3S: val,
        dischargeMaxM3S: val,
        dischargeMinM3S: val,
      });
    }

    const currentDischargeM3S = daily[0]?.dischargeM3S ?? 4.28;
    const peakForecastM3S = daily.reduce((acc, d) => Math.max(acc, d.dischargeMaxM3S), 0);
    const retrievedAt = new Date().toISOString();

    return {
      provider: 'Simulated Hydrological Model (Offline Fixture)',
      source: 'SIMULATED FORECAST — DEMO ONLY',
      attribution:
        'Contains simulated hydrological context modeled on Copernicus Emergency Management Service under CC BY 4.0',
      license: 'CC BY 4.0',
      region: {
        name: 'Yamuna River Basin (Delhi Reach - Offline Model)',
        targetLat,
        targetLng,
        stationLat: 28.675,
        stationLng: 77.225,
        elevationMeters: 227,
      },
      issuedAt: `${daily[0]!.date}T00:00:00.000Z`,
      retrievedAt,
      validFrom: `${daily[0]!.date}T00:00:00.000Z`,
      validTo: `${daily[daily.length - 1]!.date}T23:59:59.000Z`,
      forecastHorizonDays: days,
      variable: {
        name: 'river_discharge',
        unit: 'm³/s',
        description:
          'Simulated daily river discharge rate in cubic meters per second (offline test fallback)',
      },
      daily,
      currentDischargeM3S,
      peakForecastM3S,
      riskCategory: 'UNKNOWN',
      isExperimentalIndicator: true,
      freshness: 'OFFLINE_FIXTURE',
      disclaimer: `${FORECAST_DISCLAIMER} (SIMULATED FORECAST — DEMO ONLY: Live network provider was unreachable and explicit offline fixture was enabled).`,
    };
  }
}
