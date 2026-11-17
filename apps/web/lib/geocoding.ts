/**
 * Geocoding & Landmark Fallback Services for FloodRelay Citizen Portal.
 *
 * Implements:
 * 1. OpenStreetMap Nominatim reverse and forward geocoding fallback (native fetch, descriptive User-Agent).
 * 2. Deterministic Regional Landmark fallback for defensible coverage area (Delhi NCR Floodplain).
 * 3. Sanitized user-facing messaging prohibiting raw technical tokens (GEOAPIFY_API_KEY, CONFIG_ERROR).
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

/**
 * Reverse geocodes coordinates via OpenStreetMap Nominatim with native fetch and safety timeouts.
 */
export async function fetchNominatimReverse(
  lat: number,
  lng: number,
  timeoutMs = 8000,
): Promise<{ address: string | null; confidence?: number } | null> {
  const url = new URL('https://nominatim.openstreetmap.org/reverse');
  url.searchParams.set('lat', lat.toString());
  url.searchParams.set('lon', lng.toString());
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('addressdetails', '1');

  try {
    const res = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'User-Agent': NOMINATIM_USER_AGENT,
      },
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!res.ok) {
      return null;
    }

    const data = (await res.json().catch(() => null)) as RawNominatimReverseResponse | null;
    if (!data || data.error) {
      return null;
    }

    const formatted = formatNominatimAddress(data);
    return formatted ? { address: formatted, confidence: 0.8 } : null;
  } catch {
    return null;
  }
}

/**
 * Forward geocodes an address or landmark query via OpenStreetMap Nominatim.
 */
export async function fetchNominatimSearch(
  query: string,
  timeoutMs = 8000,
): Promise<
  Array<{
    formatted: string;
    lat: number;
    lng: number;
    confidence?: number;
    resultType?: string;
    attribution?: string;
  }>
> {
  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.searchParams.set('q', query.trim());
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('addressdetails', '1');
  url.searchParams.set('limit', '5');

  try {
    const res = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'User-Agent': NOMINATIM_USER_AGENT,
      },
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!res.ok) {
      return [];
    }

    const data = (await res.json().catch(() => null)) as RawNominatimSearchItem[] | null;
    if (!Array.isArray(data)) {
      return [];
    }

    const results: Array<{
      formatted: string;
      lat: number;
      lng: number;
      confidence?: number;
      resultType?: string;
      attribution?: string;
    }> = [];

    for (const item of data) {
      if (!item || typeof item !== 'object') continue;
      const latNum = parseFloat(item.lat || '');
      const lngNum = parseFloat(item.lon || '');

      if (isNaN(latNum) || latNum < -90 || latNum > 90) continue;
      if (isNaN(lngNum) || lngNum < -180 || lngNum > 180) continue;

      const formatted =
        formatNominatimAddress(item as RawNominatimReverseResponse) || item.display_name?.trim();
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

    return results;
  } catch {
    return [];
  }
}
