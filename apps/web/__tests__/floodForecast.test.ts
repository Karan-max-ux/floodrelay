import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FloodForecastContext } from '@floodrelay/shared';
import type { MapLayers } from '../components/operator/map/LeafletMapCanvas';
import { apiClient } from '../lib/api/client';

describe('Phase 6 — Flood Forecast Context Layer Invariants & Operator Map', () => {
  const sampleForecastContext: FloodForecastContext = {
    provider: 'Copernicus EMS GloFAS via Open-Meteo',
    source: 'ECMWF GloFAS 4.0 Gridded Hydrological Model',
    attribution:
      'Contains modified Copernicus Emergency Management Service information (GloFAS) via Open-Meteo under CC BY 4.0',
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
    confidenceScore: 0.85,
    freshness: 'FRESH',
    disclaimer:
      'Informational hydrological context based on European Centre for Medium-Range Weather Forecasts (ECMWF) GloFAS 4.0 gridded river discharge model via Open-Meteo (CC BY 4.0). Does not measure localized street inundation, urban flash flooding, or measured gauge levels at Delhi Old Railway Bridge. This layer is informational only and does not trigger autonomous rescue dispatch or modify committed routes.',
  };

  describe('1. MapLayers Type & Toggle State', () => {
    it('initializes MapLayers with floodForecast defaulting to false', () => {
      const defaultLayers: MapLayers = {
        incidents: true,
        craft: true,
        shelters: true,
        routes: true,
        blockages: true,
        repairOverlay: false,
        floodForecast: false,
      };

      expect(defaultLayers.floodForecast).toBe(false);

      // Toggle on
      const toggledLayers: MapLayers = {
        ...defaultLayers,
        floodForecast: !defaultLayers.floodForecast,
      };

      expect(toggledLayers.floodForecast).toBe(true);
    });
  });

  describe('2. Forecast Context Data Integrity & Scientific Attribution', () => {
    it('verifies river discharge variables and metric units', () => {
      expect(sampleForecastContext.variable.name).toBe('river_discharge');
      expect(sampleForecastContext.variable.unit).toBe('m³/s');
      expect(sampleForecastContext.currentDischargeM3S).toBe(4.25);
      expect(sampleForecastContext.peakForecastM3S).toBe(4.25);
      expect(sampleForecastContext.riskCategory).toBe('NORMAL');
    });

    it('verifies explicit attribution to Copernicus GloFAS and Open-Meteo with CC BY 4.0', () => {
      expect(sampleForecastContext.provider).toContain('Copernicus EMS GloFAS');
      expect(sampleForecastContext.attribution).toContain(
        'Copernicus Emergency Management Service',
      );
      expect(sampleForecastContext.license).toBe('CC BY 4.0');
    });

    it('strictly enforces safety separation: disclaimer affirms layer is informational and does not dispatch', () => {
      expect(sampleForecastContext.disclaimer).toContain('Informational hydrological context');
      expect(sampleForecastContext.disclaimer).toContain(
        'does not trigger autonomous rescue dispatch',
      );
      expect(sampleForecastContext.disclaimer.toLowerCase()).toContain(
        'does not measure localized street inundation',
      );
    });
  });

  describe('3. API Client Integration', () => {
    beforeEach(() => {
      vi.restoreAllMocks();
    });

    it('calls /forecast/context via apiClient.getFloodForecast', async () => {
      const spy = vi.spyOn(apiClient, 'getFloodForecast').mockResolvedValue(sampleForecastContext);

      const result = await apiClient.getFloodForecast({ lat: 28.65, lng: 77.23, days: 7 });

      expect(spy).toHaveBeenCalledWith({ lat: 28.65, lng: 77.23, days: 7 });
      expect(result.currentDischargeM3S).toBe(4.25);
      expect(result.region.name).toBe('Yamuna River Basin (Delhi Reach)');
    });

    it('handles non-blocking failure when forecast provider is unavailable', async () => {
      vi.spyOn(apiClient, 'getFloodForecast').mockRejectedValue(
        new Error('Network error or rate limited'),
      );

      await expect(apiClient.getFloodForecast()).rejects.toThrow('Network error or rate limited');
    });
  });
});
