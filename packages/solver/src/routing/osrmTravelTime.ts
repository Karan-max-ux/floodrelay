import type { GeoPoint, ResourceType } from '@floodrelay/shared';
import {
  StraightLineTravelTimeProvider,
  type TravelEstimate,
  type TravelTimeProvider,
  ASSUMED_FLOOD_IMPEDANCE_MULTIPLIER,
} from './travelTime.js';

export interface TableChunk {
  originIndices: number[];
  destinationIndices: number[];
}

export interface OsrmStats {
  requests: number;
  failedRequests: number;
  osrmCells: number;
  fallbackCells: number;
  lookupsOsrm: number;
  lookupsStraightLinePolicy: number;
  lookupsFallback: number;
}

export interface OsrmProviderOptions {
  baseUrl?: string;
  profile?: string;
  maxTableCoordinates?: number;
  timeoutMs?: number;
  fallbackProvider?: TravelTimeProvider;
  fetchImpl?: typeof fetch;
  useResourceSpeed?: boolean;
}

interface OsrmTableResponse {
  code: string;
  message?: string;
  durations?: Array<Array<number | null>>;
  distances?: Array<Array<number | null>>;
}

function getCoord(point: GeoPoint): { lat: number; lng: number } {
  const lat = point.lat ?? (point as unknown as { latitude?: number }).latitude ?? 0;
  const lng = point.lng ?? (point as unknown as { longitude?: number }).longitude ?? 0;
  return { lat, lng };
}

function coordKey(point: GeoPoint): string {
  const { lat, lng } = getCoord(point);
  return `${lat.toFixed(6)},${lng.toFixed(6)}`;
}

function pairKey(from: GeoPoint, to: GeoPoint): string {
  return `${coordKey(from)}->${coordKey(to)}`;
}

/**
 * OsrmTravelTimeProvider queries the OSRM Table API to retrieve real road network
 * distances and travel durations. Solvers remain synchronous by using a two-phase
 * prefetch-and-cache design with automatic fallback to straight-line calculations.
 */
export class OsrmTravelTimeProvider implements TravelTimeProvider {
  private readonly baseUrl: string;
  private readonly profile: string;
  private readonly maxTableCoordinates: number;
  private readonly timeoutMs: number;
  private readonly fallbackProvider: TravelTimeProvider;
  private readonly fetchFn: typeof fetch;
  private readonly useResourceSpeed: boolean;

  private readonly cache = new Map<string, TravelEstimate>();
  private readonly stats: OsrmStats = {
    requests: 0,
    failedRequests: 0,
    osrmCells: 0,
    fallbackCells: 0,
    lookupsOsrm: 0,
    lookupsStraightLinePolicy: 0,
    lookupsFallback: 0,
  };

  constructor(options: OsrmProviderOptions = {}) {
    this.baseUrl = (options.baseUrl ?? 'http://127.0.0.1:5000').replace(/\/+$/, '');
    this.profile = options.profile ?? 'driving';
    this.maxTableCoordinates = Math.max(2, options.maxTableCoordinates ?? 100);
    this.timeoutMs = options.timeoutMs ?? 5000;
    this.fallbackProvider = options.fallbackProvider ?? new StraightLineTravelTimeProvider();
    this.fetchFn = options.fetchImpl ?? globalThis.fetch;
    this.useResourceSpeed = options.useResourceSpeed ?? true;
  }

  /**
   * Plans matrix chunks such that originIndices.length + destinationIndices.length <= maxCoords
   * and every (origin, destination) pair is covered exactly once.
   */
  static planChunks(m: number, n: number, maxCoords = 100): TableChunk[] {
    if (m <= 0 || n <= 0) {
      return [];
    }

    const limit = Math.max(2, maxCoords);
    if (m + n <= limit) {
      return [
        {
          originIndices: Array.from({ length: m }, (_, i) => i),
          destinationIndices: Array.from({ length: n }, (_, j) => j),
        },
      ];
    }

    // Allocate balanced block sizes bounded by limit
    let blockSizeOrigins = Math.min(m, Math.max(1, Math.floor(limit / 2)));
    let blockSizeDestinations = Math.min(n, Math.max(1, limit - blockSizeOrigins));

    if (m < blockSizeOrigins) {
      blockSizeOrigins = m;
      blockSizeDestinations = Math.min(n, limit - blockSizeOrigins);
    } else if (n < blockSizeDestinations) {
      blockSizeDestinations = n;
      blockSizeOrigins = Math.min(m, limit - blockSizeDestinations);
    }

    const chunks: TableChunk[] = [];

    for (let oStart = 0; oStart < m; oStart += blockSizeOrigins) {
      const oEnd = Math.min(m, oStart + blockSizeOrigins);
      const originIndices = Array.from({ length: oEnd - oStart }, (_, idx) => oStart + idx);

      for (let dStart = 0; dStart < n; dStart += blockSizeDestinations) {
        const dEnd = Math.min(n, dStart + blockSizeDestinations);
        const destinationIndices = Array.from({ length: dEnd - dStart }, (_, idx) => dStart + idx);

        chunks.push({
          originIndices,
          destinationIndices,
        });
      }
    }

    return chunks;
  }

  getStats(): OsrmStats {
    return { ...this.stats };
  }

  resetStats(): void {
    this.stats.requests = 0;
    this.stats.failedRequests = 0;
    this.stats.osrmCells = 0;
    this.stats.fallbackCells = 0;
    this.stats.lookupsOsrm = 0;
    this.stats.lookupsStraightLinePolicy = 0;
    this.stats.lookupsFallback = 0;
  }

  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Asynchronously prefetches OSRM table estimates for all origin-destination pairs,
   * chunking requests to respect table coordinate limits and populating the sync cache.
   */
  async prefetch(origins: GeoPoint[], destinations: GeoPoint[]): Promise<void> {
    if (origins.length === 0 || destinations.length === 0) {
      return;
    }

    const chunks = OsrmTravelTimeProvider.planChunks(
      origins.length,
      destinations.length,
      this.maxTableCoordinates,
    );

    for (const chunk of chunks) {
      await this.fetchChunk(origins, destinations, chunk);
    }
  }

  /**
   * Asynchronously retrieves the full travel estimate matrix, prefetching if necessary.
   */
  async getMatrixAsync(
    origins: GeoPoint[],
    destinations: GeoPoint[],
    speedKmH?: number,
    resourceType?: ResourceType,
  ): Promise<TravelEstimate[][]> {
    await this.prefetch(origins, destinations);
    return this.getMatrix(origins, destinations, speedKmH, resourceType);
  }

  /**
   * Synchronously retrieves a travel estimate from the prefetch cache.
   * If the pair is not in cache, seamlessly falls back to the fallbackProvider.
   */
  getTravelEstimate(
    from: GeoPoint,
    to: GeoPoint,
    speedKmH?: number,
    isFlooded?: boolean,
    resourceType?: ResourceType,
  ): TravelEstimate {
    // Per-resource routing policy: BOAT and HELICOPTER always use straight-line travel time
    if (resourceType === 'BOAT' || resourceType === 'HELICOPTER') {
      this.stats.lookupsStraightLinePolicy++;
      return this.fallbackProvider.getTravelEstimate(from, to, speedKmH, isFlooded, resourceType);
    }

    const key = pairKey(from, to);
    const cached = this.cache.get(key);

    if (cached) {
      if (cached.source === 'OSRM') {
        this.stats.lookupsOsrm++;
        let durationMinutes = cached.durationMinutes;
        if (this.useResourceSpeed && speedKmH !== undefined && speedKmH > 0) {
          durationMinutes = Number(((cached.distanceKm / speedKmH) * 60).toFixed(2));
        }

        let distanceKm = cached.distanceKm;
        if (isFlooded) {
          durationMinutes = Number(
            (durationMinutes * ASSUMED_FLOOD_IMPEDANCE_MULTIPLIER).toFixed(2),
          );
          distanceKm = Number((distanceKm * ASSUMED_FLOOD_IMPEDANCE_MULTIPLIER).toFixed(3));
        }

        return {
          distanceKm,
          durationMinutes,
          source: 'OSRM',
        };
      }

      // Cached fallback cell: recompute with caller speed and isFlooded
      this.stats.lookupsFallback++;
      return this.fallbackProvider.getTravelEstimate(from, to, speedKmH, isFlooded, resourceType);
    }

    // Cache miss: fall back to straight line
    this.stats.fallbackCells++;
    this.stats.lookupsFallback++;
    return this.fallbackProvider.getTravelEstimate(from, to, speedKmH, isFlooded, resourceType);
  }

  /**
   * Synchronously retrieves an M x N travel estimate matrix from the prefetch cache.
   */
  getMatrix(
    origins: GeoPoint[],
    destinations: GeoPoint[],
    speedKmH?: number,
    resourceType?: ResourceType,
  ): TravelEstimate[][] {
    return origins.map((origin) =>
      destinations.map((dest) =>
        this.getTravelEstimate(origin, dest, speedKmH, undefined, resourceType),
      ),
    );
  }

  private async fetchChunk(
    allOrigins: GeoPoint[],
    allDestinations: GeoPoint[],
    chunk: TableChunk,
  ): Promise<void> {
    this.stats.requests++;

    const chunkOrigins = chunk.originIndices.map((idx) => allOrigins[idx]!);
    const chunkDestinations = chunk.destinationIndices.map((idx) => allDestinations[idx]!);

    const allCoords = [...chunkOrigins, ...chunkDestinations];
    const coordString = allCoords
      .map((c) => {
        const { lat, lng } = getCoord(c);
        return `${lng},${lat}`;
      })
      .join(';');

    const sourcesParam = chunk.originIndices.map((_, i) => i).join(';');
    const destinationsParam = chunk.destinationIndices
      .map((_, j) => chunkOrigins.length + j)
      .join(';');

    const url = `${this.baseUrl}/table/v1/${this.profile}/${coordString}?sources=${sourcesParam}&destinations=${destinationsParam}&annotations=duration,distance`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    let responseData: OsrmTableResponse;

    try {
      const res = await this.fetchFn(url, { signal: controller.signal });

      if (!res.ok) {
        this.stats.failedRequests++;
        this.fallbackEntireChunk(chunkOrigins, chunkDestinations);
        return;
      }

      responseData = (await res.json()) as OsrmTableResponse;
    } catch {
      this.stats.failedRequests++;
      this.fallbackEntireChunk(chunkOrigins, chunkDestinations);
      return;
    } finally {
      clearTimeout(timeoutId);
    }

    if (!responseData || responseData.code !== 'Ok' || !responseData.durations) {
      this.stats.failedRequests++;
      this.fallbackEntireChunk(chunkOrigins, chunkDestinations);
      return;
    }

    const { durations, distances } = responseData;

    for (let i = 0; i < chunkOrigins.length; i++) {
      const origin = chunkOrigins[i]!;
      for (let j = 0; j < chunkDestinations.length; j++) {
        const dest = chunkDestinations[j]!;
        const key = pairKey(origin, dest);

        const durSec = durations[i]?.[j];
        const distMeters = distances ? distances[i]?.[j] : null;

        if (
          durSec === null ||
          durSec === undefined ||
          distMeters === null ||
          distMeters === undefined
        ) {
          // Point not routable in road network, fall back
          this.stats.fallbackCells++;
          const fb = this.fallbackProvider.getTravelEstimate(origin, dest);
          this.cache.set(key, { ...fb, source: 'STRAIGHT_LINE' });
        } else {
          this.stats.osrmCells++;
          const distanceKm = Number((distMeters / 1000).toFixed(3));
          const durationMinutes = Number((durSec / 60).toFixed(2));
          this.cache.set(key, {
            distanceKm,
            durationMinutes,
            source: 'OSRM',
          });
        }
      }
    }
  }

  private fallbackEntireChunk(chunkOrigins: GeoPoint[], chunkDestinations: GeoPoint[]): void {
    for (const origin of chunkOrigins) {
      for (const dest of chunkDestinations) {
        const key = pairKey(origin, dest);
        this.stats.fallbackCells++;
        const fb = this.fallbackProvider.getTravelEstimate(origin, dest);
        this.cache.set(key, { ...fb, source: 'STRAIGHT_LINE' });
      }
    }
  }
}
