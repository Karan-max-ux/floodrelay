import { describe, it, expect } from 'vitest';
import type { GeoPoint } from '@floodrelay/shared';
import { OsrmTravelTimeProvider } from './osrmTravelTime.js';

describe.skipIf(!process.env.OSRM_BASE_URL)('Live OSRM integration', () => {
  it('checks real estimates are finite, multi-request chunking for 60 points, and 0 failed requests', async () => {
    const liveUrl = process.env.OSRM_BASE_URL!;
    const provider = new OsrmTravelTimeProvider({
      baseUrl: liveUrl,
      maxTableCoordinates: 100,
    });

    // 60 points = 120 coordinates (origins + destinations)
    const origins: GeoPoint[] = [];
    const destinations: GeoPoint[] = [];
    for (let i = 0; i < 60; i++) {
      origins.push({ lat: 28.6 + i * 0.001, lng: 77.2 + i * 0.001 });
      destinations.push({ lat: 28.61 + i * 0.001, lng: 77.21 + i * 0.001 });
    }

    await provider.prefetch(origins, destinations);

    const stats = provider.getStats();
    expect(stats.failedRequests).toBe(0);
    expect(stats.requests).toBeGreaterThan(1);

    const est = provider.getTravelEstimate(origins[0]!, destinations[0]!);
    expect(Number.isFinite(est.distanceKm)).toBe(true);
    expect(Number.isFinite(est.durationMinutes)).toBe(true);
    expect(est.durationMinutes).toBeGreaterThan(0);
  });
});
