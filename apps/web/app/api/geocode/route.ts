import { NextResponse } from 'next/server';
import { checkRateLimit, getClientIp } from '@/lib/rateLimiter';

export interface GeocodeRequestBody {
  text: string;
}

export interface GeocodeCandidate {
  formatted: string;
  lat: number;
  lng: number;
  confidence?: number;
  matchType?: string;
  resultType?: string;
  attribution?: string;
}

export interface GeocodeSuccessResponse {
  success: true;
  results: GeocodeCandidate[];
  message?: string;
}

export interface GeocodeErrorResponse {
  success: false;
  error: string;
  message: string;
}

export type GeocodeResponse = GeocodeSuccessResponse | GeocodeErrorResponse;

export async function POST(request: Request): Promise<NextResponse<GeocodeResponse>> {
  try {
    // 1. Rate limiting check
    const clientIp = getClientIp(request);
    const rateLimit = checkRateLimit(clientIp);
    if (!rateLimit.allowed) {
      return NextResponse.json(
        {
          success: false,
          error: 'RATE_LIMIT_EXCEEDED',
          message: 'Rate limit exceeded. Please wait a moment before searching again.',
        },
        {
          status: 429,
          headers: {
            'Retry-After': String(rateLimit.retryAfterSec ?? 60),
          },
        },
      );
    }

    // 2. Validate request body
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        {
          success: false,
          error: 'INVALID_REQUEST',
          message: 'Request body must be valid JSON with a "text" string parameter.',
        },
        { status: 400 },
      );
    }

    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json(
        {
          success: false,
          error: 'INVALID_REQUEST',
          message: 'Request body must be an object containing "text".',
        },
        { status: 400 },
      );
    }

    const { text } = body as Record<string, unknown>;

    if (typeof text !== 'string' || !text.trim()) {
      return NextResponse.json(
        {
          success: false,
          error: 'VALIDATION_ERROR',
          message: 'Street address or landmark query is required.',
        },
        { status: 400 },
      );
    }

    const trimmedQuery = text.trim();
    if (trimmedQuery.length < 3) {
      return NextResponse.json(
        {
          success: false,
          error: 'VALIDATION_ERROR',
          message: 'Address query must be at least 3 characters.',
        },
        { status: 400 },
      );
    }

    if (trimmedQuery.length > 300) {
      return NextResponse.json(
        {
          success: false,
          error: 'VALIDATION_ERROR',
          message: 'Address query exceeds maximum length of 300 characters.',
        },
        { status: 400 },
      );
    }

    // 3. API key check (never expose to client)
    const apiKey = process.env.GEOAPIFY_API_KEY;
    if (!apiKey || !apiKey.trim()) {
      return NextResponse.json(
        {
          success: false,
          error: 'CONFIG_ERROR',
          message: 'Geocoding service is not configured (missing GEOAPIFY_API_KEY).',
        },
        { status: 503 },
      );
    }

    // 4. Construct Geoapify request
    const geoapifyUrl = new URL('https://api.geoapify.com/v1/geocode/search');
    geoapifyUrl.searchParams.set('text', trimmedQuery);
    geoapifyUrl.searchParams.set('format', 'json');
    geoapifyUrl.searchParams.set('limit', '5');
    geoapifyUrl.searchParams.set('apiKey', apiKey.trim());

    let providerRes: Response;
    try {
      providerRes = await fetch(geoapifyUrl.toString(), {
        method: 'GET',
        headers: {
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(8000),
      });
    } catch (fetchErr: unknown) {
      const msg = fetchErr instanceof Error ? fetchErr.message : 'Network error';
      return NextResponse.json(
        {
          success: false,
          error: 'PROVIDER_NETWORK_ERROR',
          message: `Failed to reach geocoding provider: ${msg}`,
        },
        { status: 502 },
      );
    }

    // 5. Handle provider rate limits and errors
    if (providerRes.status === 429) {
      return NextResponse.json(
        {
          success: false,
          error: 'PROVIDER_RATE_LIMIT',
          message:
            'Geocoding provider rate limit reached. Please wait a moment or enter coordinates manually.',
        },
        { status: 429 },
      );
    }

    if (!providerRes.ok) {
      const errText = await providerRes.text().catch(() => '');
      return NextResponse.json(
        {
          success: false,
          error: 'PROVIDER_ERROR',
          message: `Geocoding provider responded with status ${providerRes.status}: ${errText.slice(0, 200)}`,
        },
        { status: 502 },
      );
    }

    const data = await providerRes.json().catch(() => null);
    if (!data || typeof data !== 'object') {
      return NextResponse.json(
        {
          success: false,
          error: 'PROVIDER_ERROR',
          message: 'Invalid response from geocoding provider.',
        },
        { status: 502 },
      );
    }

    // 6. Normalize candidates from results or features
    interface RawGeoapifyItem {
      formatted?: string;
      address_line1?: string;
      address_line2?: string;
      lat?: number;
      lon?: number;
      lng?: number;
      confidence?: number;
      rank?: { confidence?: number; match_type?: string };
      result_type?: string;
      datasource?: { attribution?: string };
      geometry?: { coordinates?: [number, number] };
      properties?: RawGeoapifyItem;
    }

    const rawList: RawGeoapifyItem[] = [];
    if (Array.isArray(data.results)) {
      rawList.push(...data.results);
    } else if (Array.isArray(data.features)) {
      for (const feat of data.features) {
        if (feat && typeof feat === 'object') {
          const props = (feat.properties || {}) as RawGeoapifyItem;
          const coords = feat.geometry?.coordinates;
          rawList.push({
            ...props,
            lat: props.lat ?? (coords && typeof coords[1] === 'number' ? coords[1] : undefined),
            lon: props.lon ?? (coords && typeof coords[0] === 'number' ? coords[0] : undefined),
          });
        }
      }
    }

    const candidates: GeocodeCandidate[] = [];

    for (const item of rawList) {
      if (!item || typeof item !== 'object') continue;

      const latNum =
        typeof item.lat === 'number'
          ? item.lat
          : typeof item.lat === 'string'
            ? parseFloat(item.lat)
            : NaN;

      const rawLng = item.lon ?? item.lng;
      const lngNum =
        typeof rawLng === 'number' ? rawLng : typeof rawLng === 'string' ? parseFloat(rawLng) : NaN;

      if (isNaN(latNum) || latNum < -90 || latNum > 90) continue;
      if (isNaN(lngNum) || lngNum < -180 || lngNum > 180) continue;

      const formatted =
        item.formatted?.trim() ||
        [item.address_line1, item.address_line2].filter(Boolean).join(', ').trim();

      if (!formatted) continue;

      const confidence = item.confidence ?? item.rank?.confidence;
      const matchType = item.rank?.match_type;
      const resultType = item.result_type;
      const attribution = item.datasource?.attribution;

      candidates.push({
        formatted,
        lat: latNum,
        lng: lngNum,
        confidence: typeof confidence === 'number' ? confidence : undefined,
        matchType: typeof matchType === 'string' ? matchType : undefined,
        resultType: typeof resultType === 'string' ? resultType : undefined,
        attribution: typeof attribution === 'string' ? attribution : undefined,
      });

      if (candidates.length >= 5) break;
    }

    // 7. Return candidates or no-match notice
    if (candidates.length === 0) {
      return NextResponse.json(
        {
          success: true,
          results: [],
          message:
            "We couldn't find a matching location for this address. Please provide a more precise address, add a nearby landmark or city, or use GPS.",
        },
        { status: 200 },
      );
    }

    return NextResponse.json(
      {
        success: true,
        results: candidates,
      },
      { status: 200 },
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    return NextResponse.json(
      {
        success: false,
        error: 'INTERNAL_ERROR',
        message,
      },
      { status: 500 },
    );
  }
}
