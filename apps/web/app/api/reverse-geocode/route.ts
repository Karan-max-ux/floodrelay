import { NextResponse } from 'next/server';
import {
  fetchNominatimReverse,
  findNearestRegionalLandmark,
  MAX_REGIONAL_LANDMARK_DISTANCE_KM,
  OSM_ATTRIBUTION,
  OSM_ATTRIBUTION_URL,
  REVERSE_GEOCODE_UNAVAILABLE_MESSAGE,
} from '../../../lib/geocoding';

export interface ReverseGeocodeRequestBody {
  lat: number;
  lng: number;
}

export interface ReverseGeocodeSuccessResponse {
  success: true;
  address: string | null;
  confidence?: number;
  message?: string;
  isApproximate?: boolean;
  provider?: 'geoapify' | 'nominatim' | 'regional_fallback';
  attribution?: string;
  attributionUrl?: string;
}

export interface ReverseGeocodeErrorResponse {
  success: false;
  error: string;
  message: string;
}

export type ReverseGeocodeResponse = ReverseGeocodeSuccessResponse | ReverseGeocodeErrorResponse;

export async function POST(request: Request): Promise<NextResponse<ReverseGeocodeResponse>> {
  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        {
          success: false,
          error: 'INVALID_REQUEST',
          message: 'Request body must be valid JSON with numeric lat and lng.',
        },
        { status: 400 },
      );
    }

    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json(
        {
          success: false,
          error: 'INVALID_REQUEST',
          message: 'Request body must be an object with lat and lng.',
        },
        { status: 400 },
      );
    }

    const { lat, lng } = body as Record<string, unknown>;

    const latNum = typeof lat === 'number' ? lat : parseFloat(String(lat));
    const lngNum = typeof lng === 'number' ? lng : parseFloat(String(lng));

    if (isNaN(latNum) || latNum < -90 || latNum > 90) {
      return NextResponse.json(
        {
          success: false,
          error: 'VALIDATION_ERROR',
          message: 'Latitude must be a valid number between -90 and 90.',
        },
        { status: 400 },
      );
    }

    if (isNaN(lngNum) || lngNum < -180 || lngNum > 180) {
      return NextResponse.json(
        {
          success: false,
          error: 'VALIDATION_ERROR',
          message: 'Longitude must be a valid number between -180 and 180.',
        },
        { status: 400 },
      );
    }

    // Step 1: Prefer Geoapify when GEOAPIFY_API_KEY is configured
    const apiKey = process.env.GEOAPIFY_API_KEY;
    let geoapifyError: { status: number; error: string; message: string } | null = null;
    let geoapifyEmpty = false;

    if (apiKey && apiKey.trim()) {
      const geoapifyUrl = new URL('https://api.geoapify.com/v1/geocode/reverse');
      geoapifyUrl.searchParams.set('lat', latNum.toString());
      geoapifyUrl.searchParams.set('lon', lngNum.toString());
      geoapifyUrl.searchParams.set('format', 'json');
      geoapifyUrl.searchParams.set('apiKey', apiKey.trim());

      let providerRes: Response | null = null;
      try {
        providerRes = await fetch(geoapifyUrl.toString(), {
          method: 'GET',
          headers: {
            Accept: 'application/json',
          },
          signal: AbortSignal.timeout(8000),
        });
      } catch {
        geoapifyError = {
          status: 502,
          error: 'PROVIDER_NETWORK_ERROR',
          message:
            'Failed to reach reverse geocoding provider. Please try again or specify location manually.',
        };
      }

      if (providerRes) {
        if (!providerRes.ok) {
          geoapifyError = {
            status: 502,
            error: 'PROVIDER_ERROR',
            message: `Reverse geocoding provider responded with error (status ${providerRes.status}). Please try again or specify location manually.`,
          };
        } else {
          const data = await providerRes.json().catch(() => null);
          if (data && typeof data === 'object') {
            let formattedAddress: string | null = null;
            let confidence: number | undefined;

            if (Array.isArray(data.results) && data.results.length > 0) {
              const first = data.results[0];
              formattedAddress =
                first.formatted ||
                [first.address_line1, first.address_line2].filter(Boolean).join(', ') ||
                null;
              confidence = first.confidence ?? first.rank?.confidence;
            } else if (Array.isArray(data.features) && data.features.length > 0) {
              const props = data.features[0].properties;
              formattedAddress =
                props?.formatted ||
                [props?.address_line1, props?.address_line2].filter(Boolean).join(', ') ||
                null;
              confidence = props?.confidence ?? props?.rank?.confidence;
            }

            if (formattedAddress && formattedAddress.trim()) {
              return NextResponse.json(
                {
                  success: true,
                  address: formattedAddress.trim(),
                  confidence,
                  provider: 'geoapify',
                },
                { status: 200 },
              );
            }

            // Geoapify returned 200 but had empty results or no address:
            // Do NOT short-circuit! Fall through to Step 2 (Nominatim) and Step 3 (Landmarks).
            geoapifyEmpty = true;
          }
        }
      }
    }

    // Step 2: Fall back to OpenStreetMap Nominatim when Geoapify is missing, returned empty, or failed
    const nominatimResult = await fetchNominatimReverse(latNum, lngNum, 8000, request.signal);
    if (nominatimResult && nominatimResult.address && nominatimResult.address.trim()) {
      return NextResponse.json(
        {
          success: true,
          address: nominatimResult.address.trim(),
          confidence: nominatimResult.confidence,
          provider: 'nominatim',
          attribution: nominatimResult.attribution || OSM_ATTRIBUTION,
          attributionUrl: nominatimResult.attributionUrl || OSM_ATTRIBUTION_URL,
        },
        { status: 200 },
      );
    }

    // Step 3: Deterministic Regional Landmark Fallback (Delhi NCR coverage area within 5.0 km)
    const regionalLandmark = findNearestRegionalLandmark(
      latNum,
      lngNum,
      MAX_REGIONAL_LANDMARK_DISTANCE_KM,
    );
    if (regionalLandmark) {
      return NextResponse.json(
        {
          success: true,
          address: regionalLandmark.landmark.label,
          confidence: 0.35,
          isApproximate: true,
          provider: 'regional_fallback',
          message:
            'Approximate regional landmark identified. Please specify your exact street address or landmark manually.',
        },
        { status: 200 },
      );
    }

    // If Geoapify failed with provider error and Nominatim also failed outside regional coverage:
    if (geoapifyError) {
      return NextResponse.json(
        {
          success: false,
          error: geoapifyError.error,
          message: geoapifyError.message,
        },
        { status: geoapifyError.status as 502 },
      );
    }

    // Step 4: Graceful Unavailable State (Outside Coverage Area or All Lookups Exhausted)
    return NextResponse.json(
      {
        success: true,
        address: null,
        message: geoapifyEmpty
          ? 'No street address found for these coordinates. Please enter your street address or landmark manually.'
          : REVERSE_GEOCODE_UNAVAILABLE_MESSAGE,
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
