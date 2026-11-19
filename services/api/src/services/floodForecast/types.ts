import type { FloodForecastContext } from '@floodrelay/shared';

export interface ForecastQueryOptions {
  lat?: number;
  lng?: number;
  days?: number;
  forceRefresh?: boolean;
}

export interface FloodForecastProvider {
  readonly name: string;
  getForecast(options?: ForecastQueryOptions): Promise<FloodForecastContext>;
}
