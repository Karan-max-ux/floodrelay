import { describe, it, expect, vi } from 'vitest';
import type { GeoPoint } from '@floodrelay/shared';
import { OsrmTravelTimeProvider } from './osrmTravelTime.js';

describe('OsrmTravelTimeProvider', () => {
  const p1: GeoPoint = { lat: 28.6139, lng: 77.209 };
  const p2: GeoPoint = { lat: 28.7041, lng: 77.1025 };
  const p3: GeoPoint = { lat: 28.5355, lng: 77.391 };
  const p4: GeoPoint = { lat: 28.4595, lng: 77.0266 };

  describe('planChunks', () => {
    it('returns empty array when m or n is zero', () => {
      expect(OsrmTravelTimeProvider.planChunks(0, 10, 100)).toEqual([]);
      expect(OsrmTravelTimeProvider.planChunks(10, 0, 100)).toEqual([]);
      expect(OsrmTravelTimeProvider.planChunks(0, 0, 100)).toEqual([]);
    });

    it('returns a single chunk when m + n <= maxCoords', () => {
      const chunks = OsrmTravelTimeProvider.planChunks(20, 30, 100);
      expect(chunks).toHaveLength(1);
      expect(chunks[0]!.originIndices).toHaveLength(20);
      expect(chunks[0]!.destinationIndices).toHaveLength(30);
      expect(
        chunks[0]!.originIndices.length + chunks[0]!.destinationIndices.length,
      ).toBeLessThanOrEqual(100);
    });

    it('chunks large matrices with no duplicate or missing cells and coords <= maxCoords per chunk', () => {
      const m = 65;
      const n = 75;
      const maxCoords = 100;
      const chunks = OsrmTravelTimeProvider.planChunks(m, n, maxCoords);

      expect(chunks.length).toBeGreaterThan(1);

      // Verify every chunk satisfies coordinate budget
      for (const chunk of chunks) {
        const total = chunk.originIndices.length + chunk.destinationIndices.length;
        expect(total).toBeLessThanOrEqual(maxCoords);
        expect(chunk.originIndices.length).toBeGreaterThan(0);
        expect(chunk.destinationIndices.length).toBeGreaterThan(0);
      }

      // Verify exact cell coverage: every pair (i, j) must be visited exactly once
      const cellCoverage = Array.from({ length: m }, () => new Array(n).fill(0));

      for (const chunk of chunks) {
        for (const o of chunk.originIndices) {
          for (const d of chunk.destinationIndices) {
            cellCoverage[o]![d]!++;
          }
        }
      }

      for (let i = 0; i < m; i++) {
        for (let j = 0; j < n; j++) {
          expect(cellCoverage[i]![j]).toBe(1);
        }
      }
    });
  });

  describe('prefetch and getTravelEstimate', () => {
    it('queries OSRM in lng,lat order, converts units, and populates cache', async () => {
      const mockFetch = vi.fn().mockImplementation(async (url: string) => {
        expect(url).toContain('77.209,28.6139;77.1025,28.7041;77.391,28.5355');
        expect(url).toContain('sources=0;1&destinations=2');
        return {
          ok: true,
          json: async () => ({
            code: 'Ok',
            durations: [
              [1200], // 20 mins
              [1800], // 30 mins
            ],
            distances: [
              [15000], // 15 km
              [24000], // 24 km
            ],
          }),
        };
      });

      const provider = new OsrmTravelTimeProvider({
        fetchImpl: mockFetch as unknown as typeof fetch,
      });
      await provider.prefetch([p1, p2], [p3]);

      expect(mockFetch).toHaveBeenCalledTimes(1);

      const est1 = provider.getTravelEstimate(p1, p3);
      expect(est1.distanceKm).toBe(15);
      expect(est1.durationMinutes).toBe(20);
      expect(est1.source).toBe('OSRM');

      const est2 = provider.getTravelEstimate(p2, p3);
      expect(est2.distanceKm).toBe(24);
      expect(est2.durationMinutes).toBe(30);
      expect(est2.source).toBe('OSRM');

      const stats = provider.getStats();
      expect(stats.requests).toBe(1);
      expect(stats.failedRequests).toBe(0);
      expect(stats.osrmCells).toBe(2);
      expect(stats.fallbackCells).toBe(0);
    });

    it('falls back to straight line on cache miss and increments fallback stats', () => {
      const provider = new OsrmTravelTimeProvider();
      const est = provider.getTravelEstimate(p1, p4);

      expect(est.source).toBe('STRAIGHT_LINE');
      expect(est.distanceKm).toBeGreaterThan(0);
      expect(est.durationMinutes).toBeGreaterThan(0);
      expect(provider.getStats().fallbackCells).toBe(1);
    });

    it('handles HTTP 429 rate limit error gracefully with fallback', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        statusText: 'Too Many Requests',
      });

      const provider = new OsrmTravelTimeProvider({
        fetchImpl: mockFetch as unknown as typeof fetch,
      });
      await provider.prefetch([p1], [p2]);

      const stats = provider.getStats();
      expect(stats.requests).toBe(1);
      expect(stats.failedRequests).toBe(1);
      expect(stats.fallbackCells).toBe(1);

      const est = provider.getTravelEstimate(p1, p2);
      expect(est.source).toBe('STRAIGHT_LINE');
    });

    it('handles HTTP 500 / 503 server errors gracefully', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        statusText: 'Service Unavailable',
      });

      const provider = new OsrmTravelTimeProvider({
        fetchImpl: mockFetch as unknown as typeof fetch,
      });
      await provider.prefetch([p1], [p2]);

      expect(provider.getStats().failedRequests).toBe(1);
      const est = provider.getTravelEstimate(p1, p2);
      expect(est.source).toBe('STRAIGHT_LINE');
    });

    it('handles network offline / exceptions without throwing', async () => {
      const mockFetch = vi.fn().mockRejectedValue(new Error('Network error: ENOTFOUND'));

      const provider = new OsrmTravelTimeProvider({
        fetchImpl: mockFetch as unknown as typeof fetch,
      });
      await expect(provider.prefetch([p1], [p2])).resolves.not.toThrow();

      expect(provider.getStats().failedRequests).toBe(1);
      const est = provider.getTravelEstimate(p1, p2);
      expect(est.source).toBe('STRAIGHT_LINE');
    });

    it('handles request timeout without throwing', async () => {
      const mockFetch = vi.fn().mockImplementation(async () => {
        const error = new Error('The operation was aborted');
        error.name = 'AbortError';
        throw error;
      });

      const provider = new OsrmTravelTimeProvider({
        timeoutMs: 10,
        fetchImpl: mockFetch as unknown as typeof fetch,
      });

      await expect(provider.prefetch([p1], [p2])).resolves.not.toThrow();
      expect(provider.getStats().failedRequests).toBe(1);
    });

    it('handles null cells for unroutable points by falling back per-cell', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          code: 'Ok',
          durations: [
            [600, null], // cell (0, 0) routable, cell (0, 1) unroutable
          ],
          distances: [[5000, null]],
        }),
      });

      const provider = new OsrmTravelTimeProvider({
        fetchImpl: mockFetch as unknown as typeof fetch,
      });
      await provider.prefetch([p1], [p2, p3]);

      const estRoutable = provider.getTravelEstimate(p1, p2);
      expect(estRoutable.source).toBe('OSRM');
      expect(estRoutable.distanceKm).toBe(5);
      expect(estRoutable.durationMinutes).toBe(10);

      const estUnroutable = provider.getTravelEstimate(p1, p3);
      expect(estUnroutable.source).toBe('STRAIGHT_LINE');

      const stats = provider.getStats();
      expect(stats.osrmCells).toBe(1);
      expect(stats.fallbackCells).toBe(1);
    });

    it('handles partial failure across multiple chunks', async () => {
      let callCount = 0;
      const mockFetch = vi.fn().mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          return {
            ok: true,
            json: async () => ({
              code: 'Ok',
              durations: [[600]],
              distances: [[5000]],
            }),
          };
        }
        return {
          ok: false,
          status: 500,
        };
      });

      // maxTableCoordinates=2 forces each 1x1 pair into separate chunks
      const provider = new OsrmTravelTimeProvider({
        maxTableCoordinates: 2,
        fetchImpl: mockFetch as unknown as typeof fetch,
      });

      await provider.prefetch([p1, p2], [p3]);

      expect(callCount).toBe(2);
      expect(provider.getStats().requests).toBe(2);
      expect(provider.getStats().failedRequests).toBe(1);

      expect(provider.getTravelEstimate(p1, p3).source).toBe('OSRM');
      expect(provider.getTravelEstimate(p2, p3).source).toBe('STRAIGHT_LINE');
    });

    it('computes matrix synchronously after async prefetch with getMatrixAsync', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          code: 'Ok',
          durations: [
            [120, 240],
            [360, 480],
          ],
          distances: [
            [1000, 2000],
            [3000, 4000],
          ],
        }),
      });

      const provider = new OsrmTravelTimeProvider({
        fetchImpl: mockFetch as unknown as typeof fetch,
      });
      const matrix = await provider.getMatrixAsync([p1, p2], [p3, p4]);

      expect(matrix).toHaveLength(2);
      expect(matrix[0]).toHaveLength(2);
      expect(matrix[1]).toHaveLength(2);

      expect(matrix[0]![0]!.distanceKm).toBe(1);
      expect(matrix[0]![0]!.durationMinutes).toBe(2);
      expect(matrix[1]![1]!.distanceKm).toBe(4);
      expect(matrix[1]![1]!.durationMinutes).toBe(8);
    });

    it('resets statistics with resetStats()', () => {
      const provider = new OsrmTravelTimeProvider();
      provider.getTravelEstimate(p1, p2); // cache miss
      expect(provider.getStats().fallbackCells).toBe(1);
      expect(provider.getStats().lookupsFallback).toBe(1);

      provider.resetStats();
      expect(provider.getStats().fallbackCells).toBe(0);
      expect(provider.getStats().lookupsFallback).toBe(0);
      expect(provider.getStats().lookupsOsrm).toBe(0);
    });

    it('scales duration with vehicle speed when useResourceSpeed is true', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          code: 'Ok',
          durations: [[1200]], // 20 mins default OSRM driving
          distances: [[30000]], // 30 km
        }),
      });

      const provider = new OsrmTravelTimeProvider({
        fetchImpl: mockFetch as unknown as typeof fetch,
        useResourceSpeed: true,
      });
      await provider.prefetch([p1], [p2]);

      // No speed provided => default OSRM car duration (20 mins)
      const defaultEst = provider.getTravelEstimate(p1, p2);
      expect(defaultEst.durationMinutes).toBe(20);

      // Caller passes speedKmH = 60 => 30 km / 60 km/h * 60 = 30 mins
      const speed60Est = provider.getTravelEstimate(p1, p2, 60);
      expect(speed60Est.durationMinutes).toBe(30);

      // Caller passes speedKmH = 15 => 30 km / 15 km/h * 60 = 120 mins
      const speed15Est = provider.getTravelEstimate(p1, p2, 15);
      expect(speed15Est.durationMinutes).toBe(120);

      const stats = provider.getStats();
      expect(stats.lookupsOsrm).toBe(3);
      expect(stats.lookupsFallback).toBe(0);
    });

    it('ignores vehicle speed when useResourceSpeed is false', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          code: 'Ok',
          durations: [[1200]], // 20 mins
          distances: [[30000]], // 30 km
        }),
      });

      const provider = new OsrmTravelTimeProvider({
        fetchImpl: mockFetch as unknown as typeof fetch,
        useResourceSpeed: false,
      });
      await provider.prefetch([p1], [p2]);

      const est = provider.getTravelEstimate(p1, p2, 60);
      expect(est.durationMinutes).toBe(20); // stays 20 mins
    });

    it('recomputes cached fallback entries with caller speed at lookup time', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
      });

      const provider = new OsrmTravelTimeProvider({
        fetchImpl: mockFetch as unknown as typeof fetch,
      });
      await provider.prefetch([p1], [p2]);

      const est30 = provider.getTravelEstimate(p1, p2, 30);
      const est60 = provider.getTravelEstimate(p1, p2, 60);

      expect(est30.source).toBe('STRAIGHT_LINE');
      expect(est60.source).toBe('STRAIGHT_LINE');
      expect(est60.durationMinutes).toBeCloseTo(est30.durationMinutes / 2, 1);

      const stats = provider.getStats();
      expect(stats.fallbackCells).toBe(1);
      expect(stats.lookupsFallback).toBe(2);
    });
  });
});
