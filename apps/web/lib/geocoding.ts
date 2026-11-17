/**
 * Geocoding & Landmark Fallback Services for FloodRelay Citizen Portal.
 *
 * Implements:
 * 1. OpenStreetMap Nominatim reverse and forward geocoding fallback (native fetch, descriptive User-Agent).
 * 2. In-memory LRU/TTL Response Cache for Nominatim queries (1-hour TTL, bounded capacity, single-flight deduping).
 * 3. In-memory 1 req/sec Request Serializer spacing outgoing calls to Nominatim to comply with OSM usage policy.
 * 4. Deterministic Regional Landmark fallback for defensible coverage area (Delhi NCR Floodplain).
 * 5. Sanitized user-facing messaging prohibiting raw technical tokens (GEOAPIFY_API_KEY, CONFIG_ERROR).
 *
 * ARCHITECTURAL CONCURRENCY NOTE:
 * apps/web operates as a Next.js frontend application without direct database or Redis dependencies.
 * The in-memory cache and request serializer enforce the 1 req/sec rate limit, single-flight deduping,
 * and TTL caching per Node.js process / container instance. In a horizontally scaled multi-instance or
 * serverless deployment, inter-process coordination would require a centralized proxy or dedicated worker.
 * This in-memory implementation does not claim to provide a distributed global rate limit across isolated processes.
 */

export const NOMINATIM_USER_AGENT =
  'FloodRelay-EmergencyResponse/1.0 (https://github.com/Parssharma/floodrelay; disaster-relief-platform)';

export const REVERSE_GEOCODE_UNAVAILABLE_MESSAGE =
  'Automatic address lookup is temporarily unavailable. Your GPS coordinates are saved — please specify your street name or a nearby landmark.';

/**
 * Defensible regional coverage area for Delhi NCR / Yamuna Basin
 * Bounding Box: minLat 28.44, minLng 76.98, maxLat 28.74, maxLng 77.50
 * Aligns with OSRM_COVERAGE_BBOX in .env.example
 */
export const REGIONAL_COVERAGE_BBOX = {
  minLat: 28.44,
  minLng: 76.98,
  maxLat: 28.74,
  maxLng: 77.5,
} as const;

export interface RegionalLandmark {
  id: string;
  name: string;
  label: string;
  lat: number;
  lng: number;
  zone: string;
}

/**
 * Pre-configured reference flood basin landmarks for Delhi NCR.
 * Labels explicitly indicate "(Approximate Landmark)" to never fabricate an exact street address.
 */
export const REGIONAL_LANDMARKS: RegionalLandmark[] = [
  {
    id: 'lm-kashmere-gate',
    name: 'Kashmere Gate Relief Sector',
    label: 'Near Yamuna Riverbank, Kashmere Gate (Approximate Landmark)',
    lat: 28.668,
    lng: 77.232,
    zone: 'Central-North Floodplain',
  },
  {
    id: 'lm-wazirabad',
    name: 'Wazirabad Community Relief Sector',
    label: 'Near Wazirabad Floodplain Area (Approximate Landmark)',
    lat: 28.705,
    lng: 77.228,
    zone: 'North Floodplain',
  },
  {
    id: 'lm-civil-lines',
    name: 'Civil Lines Relief Sector',
    label: 'Near Civil Lines Flood Relief Zone (Approximate Landmark)',
    lat: 28.675,
    lng: 77.225,
    zone: 'North-Central Basin',
  },
  {
    id: 'lm-ito-bridge',
    name: 'ITO Yamuna Bridge Sector',
    label: 'Near ITO Yamuna Bridge Basin (Approximate Landmark)',
    lat: 28.628,
    lng: 77.248,
    zone: 'Central Floodplain',
  },
  {
    id: 'lm-mayur-vihar',
    name: 'Mayur Vihar Relief Sector',
    label: 'Near Mayur Vihar Floodplain (Approximate Landmark)',
    lat: 28.612,
    lng: 77.298,
    zone: 'East Floodplain',
  },
  {
    id: 'lm-okhla',
    name: 'Okhla Barrage Sector',
    label: 'Near Okhla Barrage Basin (Approximate Landmark)',
    lat: 28.545,
    lng: 77.31,
    zone: 'South Floodplain',
  },
];

/**
 * Checks if coordinates lie within the explicitly configured regional coverage area.
 */
export function isWithinRegionalCoverage(
  lat: number,
  lng: number,
  bbox = REGIONAL_COVERAGE_BBOX,
): boolean {
  return lat >= bbox.minLat && lat <= bbox.maxLat && lng >= bbox.minLng && lng <= bbox.maxLng;
}

/**
 * Computes Haversine distance in kilometers between two lat/lng coordinates.
 */
export function haversineDistanceKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const R = 6371; // Earth radius in km

  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Identifies the nearest regional landmark fallback if coordinates fall within coverage area.
 * Returns null if coordinates are outside coverage. Never fabricates an exact street address.
 */
export function findNearestRegionalLandmark(
  lat: number,
  lng: number,
): { landmark: RegionalLandmark; distanceKm: number } | null {
  if (!isWithinRegionalCoverage(lat, lng)) {
    return null;
  }

  let nearest: RegionalLandmark | null = null;
  let minDistance = Infinity;

  for (const lm of REGIONAL_LANDMARKS) {
    const dist = haversineDistanceKm(lat, lng, lm.lat, lm.lng);
    if (dist < minDistance) {
      minDistance = dist;
      nearest = lm;
    }
  }

  return nearest ? { landmark: nearest, distanceKm: minDistance } : null;
}

export interface NominatimAddressDetails {
  road?: string;
  suburb?: string;
  neighbourhood?: string;
  quarter?: string;
  city_district?: string;
  city?: string;
  town?: string;
  village?: string;
  county?: string;
  state?: string;
  postcode?: string;
  country?: string;
}

export interface RawNominatimReverseResponse {
  place_id?: number;
  licence?: string;
  osm_type?: string;
  osm_id?: number;
  lat?: string;
  lon?: string;
  display_name?: string;
  address?: NominatimAddressDetails;
  error?: string;
}

export interface RawNominatimSearchItem {
  place_id?: number;
  licence?: string;
  osm_type?: string;
  osm_id?: number;
  lat?: string;
  lon?: string;
  display_name?: string;
  type?: string;
  importance?: number;
  address?: NominatimAddressDetails;
}

/**
 * Formats a clean human-readable address from Nominatim response components.
 */
export function formatNominatimAddress(raw: RawNominatimReverseResponse): string | null {
  if (!raw || typeof raw !== 'object') return null;

  const addr = raw.address;
  if (addr) {
    const road = addr.road || addr.neighbourhood;
    const locality = addr.suburb || addr.quarter || addr.city_district;
    const city = addr.city || addr.town || addr.village || addr.county;
    const state = addr.state;
    const postcode = addr.postcode;

    const parts = [road, locality, city, state, postcode].filter(Boolean);
    if (parts.length > 0) {
      return parts.join(', ');
    }
  }

  if (typeof raw.display_name === 'string' && raw.display_name.trim()) {
    return raw.display_name.trim();
  }

  return null;
}

// ============================================================================
// NOMINATIM POLICY COMPLIANCE: CACHING & REQUEST SERIALIZATION
// ============================================================================

export const NOMINATIM_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour TTL
export const NOMINATIM_MAX_CACHE_SIZE = 500; // Bounded capacity
export const NOMINATIM_MIN_INTERVAL_MS = 1000; // Minimum 1 request per second spacing

export interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

export interface NominatimReverseResult {
  address: string | null;
  confidence?: number;
}

export interface NominatimSearchResultItem {
  formatted: string;
  lat: number;
  lng: number;
  confidence?: number;
  resultType?: string;
  attribution?: string;
}

// Bounded in-memory caches
const reverseCache = new Map<string, CacheEntry<NominatimReverseResult>>();
const searchCache = new Map<string, CacheEntry<NominatimSearchResultItem[]>>();

// In-flight single-flight promises for concurrent duplicate deduplication
const inFlightReverse = new Map<string, Promise<NominatimReverseResult | null>>();
const inFlightSearch = new Map<string, Promise<NominatimSearchResultItem[]>>();

// Request serializer state
let lastScheduledRequestTime = 0;
let queuePromise: Promise<void> = Promise.resolve();

function getFromCache<T>(cache: Map<string, CacheEntry<T>>, key: string): T | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }
  return entry.data;
}

function setInCache<T>(cache: Map<string, CacheEntry<T>>, key: string, data: T): void {
  // If key exists, delete first so re-insertion places it at latest in iterator order
  if (cache.has(key)) {
    cache.delete(key);
  } else if (cache.size >= NOMINATIM_MAX_CACHE_SIZE) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey !== undefined) {
      cache.delete(oldestKey);
    }
  }
  cache.set(key, {
    data,
    expiresAt: Date.now() + NOMINATIM_CACHE_TTL_MS,
  });
}

/**
 * Resets the in-memory Nominatim cache, in-flight single-flight map, and request queue.
 * Exported for clean unit test isolation.
 */
export function clearNominatimCache(): void {
  reverseCache.clear();
  searchCache.clear();
  inFlightReverse.clear();
  inFlightSearch.clear();
  lastScheduledRequestTime = 0;
  queuePromise = Promise.resolve();
}

/**
 * Returns current metrics for in-memory Nominatim caches.
 */
export function getNominatimCacheStats(): {
  reverseCacheSize: number;
  searchCacheSize: number;
  inFlightReverseSize: number;
  inFlightSearchSize: number;
} {
  return {
    reverseCacheSize: reverseCache.size,
    searchCacheSize: searchCache.size,
    inFlightReverseSize: inFlightReverse.size,
    inFlightSearchSize: inFlightSearch.size,
  };
}

/**
 * Shared serializer scheduling Nominatim outgoing requests spaced at least 1,000ms apart.
 * Respects AbortSignal cancellation and timeout without automatic retries.
 */
async function scheduleNominatimRequest<T>(
  action: (signal: AbortSignal) => Promise<T>,
  options?: { signal?: AbortSignal; timeoutMs?: number },
): Promise<T> {
  const timeoutMs = options?.timeoutMs ?? 8000;
  const callerSignal = options?.signal;

  if (callerSignal?.aborted) {
    throw callerSignal.reason || new DOMException('Aborted', 'AbortError');
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort(new DOMException('Request timed out', 'TimeoutError'));
  }, timeoutMs);

  const onCallerAbort = () => {
    controller.abort(callerSignal?.reason || new DOMException('Aborted', 'AbortError'));
  };

  if (callerSignal) {
    callerSignal.addEventListener('abort', onCallerAbort, { once: true });
  }

  const execute = async (): Promise<T> => {
    try {
      if (controller.signal.aborted) {
        throw controller.signal.reason || new DOMException('Aborted', 'AbortError');
      }

      const now = Date.now();
      const waitTime = Math.max(0, lastScheduledRequestTime + NOMINATIM_MIN_INTERVAL_MS - now);
      if (waitTime > 0) {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(resolve, waitTime);
          const onAbort = () => {
            clearTimeout(timer);
            reject(controller.signal.reason || new DOMException('Aborted', 'AbortError'));
          };
          controller.signal.addEventListener('abort', onAbort, { once: true });
        });
      }

      if (controller.signal.aborted) {
        throw controller.signal.reason || new DOMException('Aborted', 'AbortError');
      }

      lastScheduledRequestTime = Date.now();
      return await action(controller.signal);
    } finally {
      clearTimeout(timeoutId);
      if (callerSignal) {
        callerSignal.removeEventListener('abort', onCallerAbort);
      }
    }
  };

  const currentTask = queuePromise.then(
    () => execute(),
    () => execute(),
  );

  queuePromise = currentTask.then(
    () => {},
    () => {},
  );

  return currentTask;
}

/**
 * Reverse geocodes coordinates via OpenStreetMap Nominatim with caching, single-flight
 * deduplication, 1 req/sec rate limiting, and native fetch.
 */
export async function fetchNominatimReverse(
  lat: number,
  lng: number,
  timeoutMs = 8000,
  signal?: AbortSignal,
): Promise<NominatimReverseResult | null> {
  // Key rounded to 5 decimal places (~1.1 meter resolution)
  const key = `${lat.toFixed(5)},${lng.toFixed(5)}`;

  // 1. Cache hit returns immediately without consuming rate limit slot
  const cached = getFromCache(reverseCache, key);
  if (cached) {
    return cached;
  }

  // 2. Single-flight in-flight deduplication
  const existingInFlight = inFlightReverse.get(key);
  if (existingInFlight) {
    return existingInFlight;
  }

  const requestPromise = (async (): Promise<NominatimReverseResult | null> => {
    try {
      return await scheduleNominatimRequest(
        async (reqSignal) => {
          const url = new URL('https://nominatim.openstreetmap.org/reverse');
          url.searchParams.set('lat', lat.toString());
          url.searchParams.set('lon', lng.toString());
          url.searchParams.set('format', 'jsonv2');
          url.searchParams.set('addressdetails', '1');

          const res = await fetch(url.toString(), {
            method: 'GET',
            headers: {
              Accept: 'application/json',
              'User-Agent': NOMINATIM_USER_AGENT,
            },
            signal: reqSignal,
          });

          if (!res.ok) {
            return null;
          }

          const data = (await res.json().catch(() => null)) as RawNominatimReverseResponse | null;
          if (!data || data.error) {
            return null;
          }

          const formatted = formatNominatimAddress(data);
          if (!formatted) {
            return null;
          }

          const result: NominatimReverseResult = { address: formatted, confidence: 0.8 };
          // Only cache successful, non-null responses
          setInCache(reverseCache, key, result);
          return result;
        },
        { signal, timeoutMs },
      );
    } catch {
      return null;
    } finally {
      inFlightReverse.delete(key);
    }
  })();

  inFlightReverse.set(key, requestPromise);
  return requestPromise;
}

/**
 * Forward geocodes an address or landmark query via OpenStreetMap Nominatim with
 * caching, single-flight deduplication, 1 req/sec rate limiting, and native fetch.
 */
export async function fetchNominatimSearch(
  query: string,
  timeoutMs = 8000,
  signal?: AbortSignal,
): Promise<NominatimSearchResultItem[]> {
  const trimmed = query.trim();
  if (trimmed.length < 3) {
    return [];
  }

  // Normalized lowercase search key
  const key = trimmed.toLowerCase().replace(/\s+/g, ' ');

  // 1. Cache hit returns immediately without consuming rate limit slot
  const cached = getFromCache(searchCache, key);
  if (cached) {
    return cached;
  }

  // 2. Single-flight in-flight deduplication
  const existingInFlight = inFlightSearch.get(key);
  if (existingInFlight) {
    return existingInFlight;
  }

  const requestPromise = (async (): Promise<NominatimSearchResultItem[]> => {
    try {
      return await scheduleNominatimRequest(
        async (reqSignal) => {
          const url = new URL('https://nominatim.openstreetmap.org/search');
          url.searchParams.set('q', trimmed);
          url.searchParams.set('format', 'jsonv2');
          url.searchParams.set('addressdetails', '1');
          url.searchParams.set('limit', '5');

          const res = await fetch(url.toString(), {
            method: 'GET',
            headers: {
              Accept: 'application/json',
              'User-Agent': NOMINATIM_USER_AGENT,
            },
            signal: reqSignal,
          });

          if (!res.ok) {
            return [];
          }

          const data = (await res.json().catch(() => null)) as RawNominatimSearchItem[] | null;
          if (!Array.isArray(data)) {
            return [];
          }

          const results: NominatimSearchResultItem[] = [];

          for (const item of data) {
            if (!item || typeof item !== 'object') continue;
            const latNum = parseFloat(item.lat || '');
            const lngNum = parseFloat(item.lon || '');

            if (isNaN(latNum) || latNum < -90 || latNum > 90) continue;
            if (isNaN(lngNum) || lngNum < -180 || lngNum > 180) continue;

            const formatted =
              formatNominatimAddress(item as RawNominatimReverseResponse) ||
              item.display_name?.trim();
            if (!formatted) continue;

            const confidence =
              typeof item.importance === 'number' ? Math.min(Math.max(item.importance, 0), 1) : 0.6;

            results.push({
              formatted,
              lat: latNum,
              lng: lngNum,
              confidence,
              resultType: item.type,
              attribution: 'OpenStreetMap contributors',
            });

            if (results.length >= 5) break;
          }

          // Only cache successful non-empty results
          if (results.length > 0) {
            setInCache(searchCache, key, results);
          }
          return results;
        },
        { signal, timeoutMs },
      );
    } catch {
      return [];
    } finally {
      inFlightSearch.delete(key);
    }
  })();

  inFlightSearch.set(key, requestPromise);
  return requestPromise;
}
