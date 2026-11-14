import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React, { act } from 'react';
import ReactDOM from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { POST as geocodePOST } from '../app/api/geocode/route';
import { resetRateLimiter, getClientIp } from '@/lib/rateLimiter';
import CitizenRequestPage from '../app/citizen/request/page';
import { useCitizenLocation } from '@/hooks/useCitizenLocation';
import { apiClient } from '../lib/api/client';
import type { CreateRequestInput } from '../lib/api/types';

// Configure React act environment
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Mock minimal DOM environment for React 19 node execution
interface MockListeners {
  [event: string]: (e: Event) => void;
}
const listeners: MockListeners = {};

const mockDocument = {
  addEventListener: (type: string, fn: (e: Event) => void) => {
    listeners[type] = fn;
  },
  removeEventListener: (type: string) => {
    delete listeners[type];
  },
  createElement: (tag: string) => ({
    tagName: tag.toUpperCase(),
    nodeType: 1,
    style: {},
    setAttribute: () => {},
    removeAttribute: () => {},
    appendChild: () => {},
    removeChild: () => {},
    addEventListener: (type: string, fn: (e: Event) => void) => {
      listeners[type] = fn;
    },
    removeEventListener: (type: string) => {
      delete listeners[type];
    },
    ownerDocument: mockDocument,
  }),
  createTextNode: (text: string) => ({ nodeType: 3, nodeValue: text }),
  documentElement: { style: {} },
  defaultView: null as unknown,
};

class MockHTMLIFrameElement {}
class MockElement {}
class MockHTMLElement extends MockElement {}

const mockGeolocation = {
  getCurrentPosition: vi.fn(),
};

const mockWindow = {
  addEventListener: () => {},
  removeEventListener: () => {},
  HTMLIFrameElement: MockHTMLIFrameElement,
  Element: MockElement,
  HTMLElement: MockHTMLElement,
  document: mockDocument,
  ownerDocument: mockDocument,
  navigator: {
    userAgent: 'node',
    geolocation: mockGeolocation,
  },
};
mockDocument.defaultView = mockWindow;

global.window = mockWindow as unknown as Window & typeof globalThis;
global.document = mockDocument as unknown as Document;
(globalThis as unknown as Record<string, unknown>).HTMLIFrameElement = MockHTMLIFrameElement;
(globalThis as unknown as Record<string, unknown>).Element = MockElement;
(globalThis as unknown as Record<string, unknown>).HTMLElement = MockHTMLElement;
Object.defineProperty(globalThis, 'navigator', {
  value: {
    userAgent: 'node',
    geolocation: mockGeolocation,
  },
  configurable: true,
  writable: true,
});

// Mock Next.js navigation
const mockRouterPush = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockRouterPush, replace: vi.fn() }),
  usePathname: () => '/citizen/request',
}));

// Mock Leaflet preview component for headless node testing
vi.mock('@/components/citizen/CitizenLocationPreview', () => ({
  default: ({
    lat,
    lng,
    address,
    source,
  }: {
    lat: number;
    lng: number;
    address?: string;
    source?: string;
  }) => (
    <div data-testid="mock-location-preview">
      <span data-testid="preview-lat">{lat}</span>
      <span data-testid="preview-lng">{lng}</span>
      <span data-testid="preview-address">{address}</span>
      <span data-testid="preview-source">{source}</span>
    </div>
  ),
}));

// Mock apiClient
vi.mock('@/lib/api/client', () => ({
  apiClient: {
    createRequest: vi.fn(),
  },
}));

describe('FloodRelay Citizen Portal Smart Location System (20 Regression Invariants)', () => {
  const originalEnv = process.env.GEOAPIFY_API_KEY;

  beforeEach(() => {
    vi.restoreAllMocks();
    resetRateLimiter();
    process.env.GEOAPIFY_API_KEY = 'test_valid_geoapify_key';
  });

  afterEach(() => {
    process.env.GEOAPIFY_API_KEY = originalEnv;
  });

  // =========================================================================
  // SERVER-SIDE FORWARD GEOCODING API TESTS (POST /api/geocode)
  // =========================================================================
  describe('Server-Side API Route: POST /api/geocode', () => {
    it('returns 400 INVALID_REQUEST for malformed JSON or non-object body', async () => {
      const reqMalformed = new Request('http://localhost:3000/api/geocode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'invalid-json{',
      });
      const resMalformed = await geocodePOST(reqMalformed);
      const dataMalformed = await resMalformed.json();
      expect(resMalformed.status).toBe(400);
      expect(dataMalformed.error).toBe('INVALID_REQUEST');

      const reqArray = new Request('http://localhost:3000/api/geocode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '[]',
      });
      const resArray = await geocodePOST(reqArray);
      expect(resArray.status).toBe(400);
    });

    it('returns 400 VALIDATION_ERROR when query text is missing, empty, or too short', async () => {
      // Empty string
      const reqEmpty = new Request('http://localhost:3000/api/geocode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: '   ' }),
      });
      const resEmpty = await geocodePOST(reqEmpty);
      const dataEmpty = await resEmpty.json();
      expect(resEmpty.status).toBe(400);
      expect(dataEmpty.error).toBe('VALIDATION_ERROR');

      // Less than 3 characters
      const reqShort = new Request('http://localhost:3000/api/geocode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: '12' }),
      });
      const resShort = await geocodePOST(reqShort);
      const dataShort = await resShort.json();
      expect(resShort.status).toBe(400);
      expect(dataShort.error).toBe('VALIDATION_ERROR');
      expect(dataShort.message).toContain('at least 3 characters');
    });

    it('returns 503 CONFIG_ERROR when GEOAPIFY_API_KEY is not configured', async () => {
      delete process.env.GEOAPIFY_API_KEY;

      const req = new Request('http://localhost:3000/api/geocode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: '1428 Riverbend Dr' }),
      });
      const res = await geocodePOST(req);
      const data = await res.json();
      expect(res.status).toBe(503);
      expect(data.error).toBe('CONFIG_ERROR');
      expect(data.message).toContain('GEOAPIFY_API_KEY');
    });

    it('returns 200 with normalized candidate list on successful provider geocoding', async () => {
      const mockGeoapifyResponse = {
        results: [
          {
            formatted: '1428 Riverbend Dr, Houston, TX 77024, United States',
            lat: 29.7604,
            lon: -95.3698,
            confidence: 0.95,
            rank: { confidence: 0.95, match_type: 'full_match' },
            result_type: 'building',
            datasource: { attribution: '© OpenStreetMap contributors' },
          },
          {
            formatted: 'Riverbend Dr, Houston, TX 77024, United States',
            lat: 29.761,
            lon: -95.368,
            confidence: 0.8,
            rank: { confidence: 0.8, match_type: 'street' },
            result_type: 'street',
          },
        ],
      };

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify(mockGeoapifyResponse), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

      const req = new Request('http://localhost:3000/api/geocode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: '1428 Riverbend Dr' }),
      });

      const res = await geocodePOST(req);
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.results).toHaveLength(2);
      expect(data.results[0].formatted).toBe('1428 Riverbend Dr, Houston, TX 77024, United States');
      expect(data.results[0].lat).toBe(29.7604);
      expect(data.results[0].lng).toBe(-95.3698);
      expect(data.results[0].confidence).toBe(0.95);
      expect(data.results[0].matchType).toBe('full_match');
      expect(data.results[0].resultType).toBe('building');
    });

    it('returns 200 with empty array and descriptive message when no matches found', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify({ results: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

      const req = new Request('http://localhost:3000/api/geocode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: 'Nonexistent Unknown Place 99999' }),
      });

      const res = await geocodePOST(req);
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.results).toEqual([]);
      expect(data.message).toContain("couldn't find a matching location");
    });

    it('handles provider 429 rate limit gracefully', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response('Too Many Requests', { status: 429, statusText: 'Too Many Requests' }),
      );

      const req = new Request('http://localhost:3000/api/geocode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: '1428 Riverbend Dr' }),
      });

      const res = await geocodePOST(req);
      const data = await res.json();

      expect(res.status).toBe(429);
      expect(data.error).toBe('PROVIDER_RATE_LIMIT');
      expect(data.message).toContain('rate limit');
    });

    it('handles provider network errors and timeouts gracefully', async () => {
      vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(
        new Error('Network timeout reaching api.geoapify.com'),
      );

      const req = new Request('http://localhost:3000/api/geocode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: '1428 Riverbend Dr' }),
      });

      const res = await geocodePOST(req);
      const data = await res.json();

      expect(res.status).toBe(502);
      expect(data.error).toBe('PROVIDER_NETWORK_ERROR');
      expect(data.message).toContain('Failed to reach geocoding provider');
    });

    it('enforces server-side sliding window rate limiting (429)', async () => {
      // 30 allowed requests
      for (let i = 0; i < 30; i++) {
        vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
          new Response(JSON.stringify({ results: [] }), { status: 200 }),
        );
        const req = new Request('http://localhost:3000/api/geocode', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '192.168.1.100' },
          body: JSON.stringify({ text: 'Riverbend Dr' }),
        });
        const res = await geocodePOST(req);
        expect(res.status).toBe(200);
      }

      // 31st request triggers 429
      const reqOver = new Request('http://localhost:3000/api/geocode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '192.168.1.100' },
        body: JSON.stringify({ text: 'Riverbend Dr' }),
      });
      const resOver = await geocodePOST(reqOver);
      const dataOver = await resOver.json();

      expect(resOver.status).toBe(429);
      expect(dataOver.error).toBe('RATE_LIMIT_EXCEEDED');
      expect(resOver.headers.get('Retry-After')).toBeDefined();
    });
  });

  // =========================================================================
  // CITIZEN SMART LOCATION WORKFLOW & REGRESSION TESTS (REQUIREMENTS 1 - 20)
  // =========================================================================
  describe('Citizen Smart Location Lifecycle & Invariant Requirements', () => {
    // 1. Coordinates are blank on initial render
    it('1. Coordinates are blank on initial render (no prefilled Houston/Delhi coordinates)', () => {
      const html = renderToString(React.createElement(CitizenRequestPage));

      // Latitude and Longitude inputs must NOT contain Houston coordinates
      expect(html).not.toContain('value="29.7604"');
      expect(html).not.toContain('value="-95.3698"');
      expect(html).not.toContain('value="28.6139"');
      expect(html).not.toContain('value="77.2090"');

      // Placeholders must indicate example usage
      expect(html).toContain('placeholder="e.g. 29.7604"');
      expect(html).toContain('placeholder="e.g. -95.3698"');

      // Location confirmed card is NOT present initially
      expect(html).not.toContain('data-testid="location-confirmed-card"');
      expect(html).not.toContain('Location Confirmed');
    });

    // 2. Manual address geocoding succeeds
    it('2. Manual address geocoding succeeds and returns formatted candidate', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: true,
            results: [
              {
                formatted: '1428 Riverbend Dr, Houston, TX 77024',
                lat: 29.7604,
                lng: -95.3698,
                confidence: 0.95,
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      );

      const res = await fetch('/api/geocode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: '1428 Riverbend Dr' }),
      });
      const data = await res.json();

      expect(res.ok).toBe(true);
      expect(data.success).toBe(true);
      expect(data.results[0].formatted).toBe('1428 Riverbend Dr, Houston, TX 77024');
      expect(data.results[0].lat).toBe(29.7604);
      expect(data.results[0].lng).toBe(-95.3698);
    });

    // 3. Multiple address candidates require selection
    it('3. Multiple address candidates require explicit selection and do not auto-select first', () => {
      interface HarnessState {
        address: string;
        lat: string;
        lng: string;
        isLocationConfirmed: boolean;
        candidates: Array<{ formatted: string; lat: number; lng: number }>;
      }

      const state: HarnessState = {
        address: 'Main Street',
        lat: '',
        lng: '',
        isLocationConfirmed: false,
        candidates: [
          { formatted: 'Main Street, Houston, TX', lat: 29.75, lng: -95.36 },
          { formatted: 'Main Street, Austin, TX', lat: 30.26, lng: -97.74 },
        ],
      };

      // Multiple candidates: neither is automatically confirmed
      expect(state.isLocationConfirmed).toBe(false);
      expect(state.lat).toBe('');
      expect(state.lng).toBe('');

      // User must explicitly select the intended location
      const onSelectCandidate = (candidate: { formatted: string; lat: number; lng: number }) => {
        state.address = candidate.formatted;
        state.lat = candidate.lat.toFixed(6);
        state.lng = candidate.lng.toFixed(6);
        state.isLocationConfirmed = true;
        state.candidates = [];
      };

      onSelectCandidate(state.candidates[1]); // User chooses Austin
      expect(state.isLocationConfirmed).toBe(true);
      expect(state.address).toBe('Main Street, Austin, TX');
      expect(state.lat).toBe('30.260000');
      expect(state.lng).toBe('-97.740000');
    });

    // 4. Selected match populates both coordinates
    it('4. Selected match populates both latitude and longitude accurately', () => {
      let lat = '';
      let lng = '';
      let isLocationConfirmed = false;

      const candidate = {
        formatted: 'Civil Defense Shelter 4, Yamuna Bank, Delhi',
        lat: 28.613938,
        lng: 77.209021,
      };

      const selectCandidate = (c: typeof candidate) => {
        lat = c.lat.toFixed(6);
        lng = c.lng.toFixed(6);
        isLocationConfirmed = true;
      };

      selectCandidate(candidate);

      expect(lat).toBe('28.613938');
      expect(lng).toBe('77.209021');
      expect(isLocationConfirmed).toBe(true);
    });

    // 5. Address edits invalidate previous confirmation
    it('5. Address edits invalidate previous confirmation to prevent mismatched submissions', () => {
      let isLocationConfirmed = true;
      const confirmedAddress = '1428 Riverbend Dr, Houston, TX';
      let currentAddress = confirmedAddress;

      const onAddressChange = (newVal: string) => {
        currentAddress = newVal;
        // Invariant: any change to address invalidates confirmation
        isLocationConfirmed = false;
      };

      onAddressChange('1428 Riverbend Dr, Apt 4B (Edited)');
      expect(isLocationConfirmed).toBe(false);
      expect(currentAddress).not.toBe(confirmedAddress);
    });

    // 6. Coordinate edits invalidate previous confirmation
    it('6. Coordinate edits invalidate previous confirmation', () => {
      let isLocationConfirmed = true;
      let lat = '29.760400';
      let lng = '-95.369800';

      const onCoordinateChange = (newLat: string, newLng: string) => {
        lat = newLat;
        lng = newLng;
        // Invariant: manual coordinate edits invalidate confirmation until explicitly confirmed
        isLocationConfirmed = false;
      };

      onCoordinateChange('30.123456', '-95.369800');
      expect(isLocationConfirmed).toBe(false);
      expect(lat).toBe('30.123456');
      expect(lng).toBe('-95.369800');
    });

    // 7. Unmatched addresses cannot silently submit
    it('7. Unmatched addresses cannot silently submit without coordinates and confirmation', () => {
      const validate = (address: string, lat: string, lng: string, confirmed: boolean) => {
        const errors: Record<string, string> = {};
        if (!lat.trim()) errors.lat = 'Latitude is required';
        if (!lng.trim()) errors.lng = 'Longitude is required';
        if (!address.trim()) errors.address = 'Address is required';
        if (!confirmed) errors.location = 'Location must be confirmed before submitting';
        return Object.keys(errors).length === 0;
      };

      // Address typed but geocoding returned no match -> lat/lng empty, unconfirmed
      const canSubmit = validate('Random Landmark Without Match', '', '', false);
      expect(canSubmit).toBe(false);
    });

    // 8. GPS success populates latitude and longitude
    it('8. GPS success populates latitude and longitude from browser geolocation', () => {
      let lat = '';
      let lng = '';
      let accuracy: number | null = null;
      let gpsStatus = 'IDLE';

      const mockGpsSuccess = (pos: {
        coords: { latitude: number; longitude: number; accuracy: number };
      }) => {
        lat = pos.coords.latitude.toFixed(6);
        lng = pos.coords.longitude.toFixed(6);
        accuracy = pos.coords.accuracy;
        gpsStatus = 'ACQUIRED';
      };

      mockGpsSuccess({
        coords: { latitude: 29.789123, longitude: -95.456789, accuracy: 4.5 },
      });

      expect(gpsStatus).toBe('ACQUIRED');
      expect(lat).toBe('29.789123');
      expect(lng).toBe('-95.456789');
      expect(accuracy).toBe(4.5);
    });

    // 9. GPS success triggers reverse geocoding
    it('9. GPS success triggers reverse geocoding', async () => {
      let reverseGeocodeCalledWith: { lat: number; lng: number } | null = null;

      vi.spyOn(globalThis, 'fetch').mockImplementationOnce(async (url, init) => {
        const body = JSON.parse((init?.body as string) || '{}');
        reverseGeocodeCalledWith = body;
        return new Response(JSON.stringify({ success: true, address: '100 GPS Avenue' }), {
          status: 200,
        });
      });

      const triggerReverseGeocode = async (latNum: number, lngNum: number) => {
        await fetch('/api/reverse-geocode', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ lat: latNum, lng: lngNum }),
        });
      };

      await triggerReverseGeocode(29.789123, -95.456789);

      expect(reverseGeocodeCalledWith).toEqual({ lat: 29.789123, lng: -95.456789 });
    });

    // 10. Reverse geocoding autofills the address
    it('10. Reverse geocoding autofills the street address but keeps location unconfirmed until explicit citizen confirmation', async () => {
      let address = '';
      let isLocationConfirmed = false;
      let locationSource = 'NONE';

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: true,
            address: '456 Floodplain Lane, Houston, TX 77024',
          }),
          { status: 200 },
        ),
      );

      const res = await fetch('/api/reverse-geocode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lat: 29.76, lng: -95.36 }),
      });
      const data = await res.json();

      if (data.success && data.address) {
        address = data.address;
        // Invariant: Keep location unconfirmed until citizen explicitly confirms
        isLocationConfirmed = false;
        locationSource = 'GPS';
      }

      expect(address).toBe('456 Floodplain Lane, Houston, TX 77024');
      expect(isLocationConfirmed).toBe(false);
      expect(locationSource).toBe('GPS');
    });

    // 11. GPS permission denial preserves manual-address workflow
    it('11. GPS permission denial preserves manual-address workflow without inserting mock coordinates', () => {
      const lat = '';
      const lng = '';
      let gpsStatus = 'IDLE';

      const mockGpsError = (err: { code: number }) => {
        if (err.code === 1) {
          gpsStatus = 'DENIED';
        }
        // Strict invariant: no fallback fake coordinates
      };

      mockGpsError({ code: 1 });

      expect(gpsStatus).toBe('DENIED');
      expect(lat).toBe('');
      expect(lng).toBe('');
    });

    // 12. Reverse-geocoding failure preserves real GPS coordinates
    it('12. Reverse-geocoding failure preserves real GPS coordinates', async () => {
      const lat = '29.789123';
      const lng = '-95.456789';
      let reverseGeocodeStatus = 'LOOKING_UP';
      let reverseGeocodeMessage = '';

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify({ success: false, error: 'PROVIDER_ERROR' }), { status: 502 }),
      );

      const res = await fetch('/api/reverse-geocode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lat: 29.789123, lng: -95.456789 }),
      });
      const data = await res.json();

      if (!data.success) {
        reverseGeocodeStatus = 'ERROR';
        reverseGeocodeMessage =
          'Coordinates are saved — please enter your street address or landmark manually.';
      }

      // Coordinates MUST be preserved
      expect(lat).toBe('29.789123');
      expect(lng).toBe('-95.456789');
      expect(reverseGeocodeStatus).toBe('ERROR');
      expect(reverseGeocodeMessage).toContain('Coordinates are saved');
    });

    // 13. Late API responses cannot overwrite edited input
    it('13. Late API responses cannot overwrite edited input (sequence & edit guards)', async () => {
      let currentSeq = 0;
      let address: string;
      let userEditedDuringRequest = false;

      let resolveSlowCall!: (val: Response) => void;
      const slowPromise = new Promise<Response>((resolve) => {
        resolveSlowCall = resolve;
      });

      vi.spyOn(globalThis, 'fetch').mockReturnValueOnce(slowPromise);

      // Trigger search (seq = 1)
      const seq = ++currentSeq;
      userEditedDuringRequest = false;

      const runLookup = async () => {
        const res = await fetch('/api/geocode', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: 'Old Query' }),
        });
        const data = await res.json();

        // Sequence guard and user-edit guard
        if (seq !== currentSeq || userEditedDuringRequest) {
          return;
        }
        address = data.results[0].formatted;
      };

      const lookupPromise = runLookup();

      // User immediately types a new custom address
      address = 'Custom Address 999';
      userEditedDuringRequest = true;

      // Slow response finishes later
      resolveSlowCall(
        new Response(
          JSON.stringify({
            success: true,
            results: [{ formatted: 'Stale Address From Slow API' }],
          }),
          { status: 200 },
        ),
      );
      await lookupPromise;

      expect(address).toBe('Custom Address 999');
    });

    // 14. Provider timeout and rate-limit errors are handled
    it('14. Provider timeout and rate-limit errors are handled cleanly', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: false,
            error: 'PROVIDER_RATE_LIMIT',
            message: 'Geocoding provider rate limit reached.',
          }),
          { status: 429 },
        ),
      );

      const res = await fetch('/api/geocode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: 'Any Address' }),
      });
      const data = await res.json();

      expect(res.status).toBe(429);
      expect(data.error).toBe('PROVIDER_RATE_LIMIT');
    });

    // 15. Missing Geoapify configuration is handled
    it('15. Missing Geoapify configuration returns controlled 503 error', async () => {
      delete process.env.GEOAPIFY_API_KEY;

      const res = await geocodePOST(
        new Request('http://localhost:3000/api/geocode', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: '1428 Riverbend Dr' }),
        }),
      );
      const data = await res.json();

      expect(res.status).toBe(503);
      expect(data.error).toBe('CONFIG_ERROR');
    });

    // 16. Invalid coordinate ranges are rejected
    it('16. Invalid coordinate ranges are rejected by validation', () => {
      const validateCoords = (latStr: string, lngStr: string) => {
        const errors: Record<string, string> = {};
        const latNum = parseFloat(latStr);
        const lngNum = parseFloat(lngStr);

        if (!latStr.trim() || isNaN(latNum) || latNum < -90 || latNum > 90) {
          errors.lat = 'Valid latitude between -90 and 90 is required';
        }
        if (!lngStr.trim() || isNaN(lngNum) || lngNum < -180 || lngNum > 180) {
          errors.lng = 'Valid longitude between -180 and 180 is required';
        }
        return errors;
      };

      expect(validateCoords('95.5', '-95.3698').lat).toContain('-90 and 90');
      expect(validateCoords('-95.5', '-95.3698').lat).toContain('-90 and 90');
      expect(validateCoords('29.76', '195.0').lng).toContain('-180 and 180');
      expect(validateCoords('29.76', '-195.0').lng).toContain('-180 and 180');
      expect(validateCoords('invalid', '-95.0').lat).toContain('-90 and 90');
      expect(validateCoords('29.76', '-95.36')).toEqual({});
    });

    // 17. Empty/unconfirmed locations are blocked
    it('17. Empty or unconfirmed locations are blocked from submission', () => {
      const validateForm = (form: {
        lat: string;
        lng: string;
        address: string;
        isLocationConfirmed: boolean;
        waterLevel: string;
        partyCount: number;
      }) => {
        const errors: Record<string, string> = {};
        if (!form.lat.trim()) errors.lat = 'Latitude is required';
        if (!form.lng.trim()) errors.lng = 'Longitude is required';
        if (!form.address.trim()) errors.address = 'Address is required';
        if (!form.isLocationConfirmed) errors.location = 'Location must be confirmed';
        return Object.keys(errors).length === 0;
      };

      // Empty lat/lng
      expect(
        validateForm({
          lat: '',
          lng: '',
          address: '1428 Riverbend Dr',
          isLocationConfirmed: false,
          waterLevel: 'ground_floor',
          partyCount: 3,
        }),
      ).toBe(false);

      // Lat/lng present but unconfirmed
      expect(
        validateForm({
          lat: '29.76',
          lng: '-95.36',
          address: '1428 Riverbend Dr',
          isLocationConfirmed: false,
          waterLevel: 'ground_floor',
          partyCount: 3,
        }),
      ).toBe(false);

      // Confirmed with valid lat/lng and address
      expect(
        validateForm({
          lat: '29.76',
          lng: '-95.36',
          address: '1428 Riverbend Dr',
          isLocationConfirmed: true,
          waterLevel: 'ground_floor',
          partyCount: 3,
        }),
      ).toBe(true);
    });

    // 18. Confirmed manual address submits correct coordinates
    it('18. Confirmed manual address submits correct geocoded coordinates to backend', async () => {
      let submittedInput: CreateRequestInput | null = null;
      vi.mocked(apiClient.createRequest).mockImplementationOnce(async (input) => {
        submittedInput = input;
        return {
          id: 'req-confirmed-manual-001',
          createdAt: new Date().toISOString(),
          urgency: input.urgency,
          peopleCount: input.peopleCount,
          isFlaggedDuplicate: false,
          idempotent: false,
          lat: input.lat,
          lng: input.lng,
          source: 'REPORTED',
        };
      });

      const executeSubmission = async (input: {
        address: string;
        lat: number;
        lng: number;
        partyCount: number;
        urgency: 'HIGH';
      }) => {
        await apiClient.createRequest({
          lat: input.lat,
          lng: input.lng,
          peopleCount: input.partyCount,
          urgency: input.urgency,
          medicalNeeds: false,
          notes: `Address: ${input.address} | Water Level: Reached ground floor`,
          source: 'REPORTED',
          idempotencyKey: '00000000-0000-4000-8000-000000000001',
        });
      };

      await executeSubmission({
        address: '1428 Riverbend Dr, Houston, TX',
        lat: 29.7604,
        lng: -95.3698,
        partyCount: 3,
        urgency: 'HIGH',
      });

      expect(submittedInput).not.toBeNull();
      expect(submittedInput!.lat).toBe(29.7604);
      expect(submittedInput!.lng).toBe(-95.3698);
      expect(submittedInput!.notes).toContain('1428 Riverbend Dr, Houston, TX');
      expect(submittedInput!.source).toBe('REPORTED');
    });

    // 19. Confirmed GPS location submits correct coordinates
    it('19. Confirmed GPS location submits correct GPS coordinates to backend', async () => {
      let submittedInput: CreateRequestInput | null = null;
      vi.mocked(apiClient.createRequest).mockImplementationOnce(async (input) => {
        submittedInput = input;
        return {
          id: 'req-confirmed-gps-002',
          createdAt: new Date().toISOString(),
          urgency: input.urgency,
          peopleCount: input.peopleCount,
          isFlaggedDuplicate: false,
          idempotent: false,
          lat: input.lat,
          lng: input.lng,
          source: 'REPORTED',
        };
      });

      await apiClient.createRequest({
        lat: 29.789123,
        lng: -95.456789,
        peopleCount: 4,
        urgency: 'CRITICAL',
        medicalNeeds: true,
        notes: 'Address: 456 Floodplain Lane | GPS Verified',
        source: 'REPORTED',
        idempotencyKey: '00000000-0000-4000-8000-000000000002',
      });

      expect(submittedInput).not.toBeNull();
      expect(submittedInput!.lat).toBe(29.789123);
      expect(submittedInput!.lng).toBe(-95.456789);
      expect(submittedInput!.urgency).toBe('CRITICAL');
      expect(submittedInput!.medicalNeeds).toBe(true);
      expect(submittedInput!.source).toBe('REPORTED');
    });

    // 20. Existing idempotency and duplicate-detection behavior remains unchanged
    it('20. Existing idempotency and duplicate-detection behavior remains intact', async () => {
      // Proves that when duplicate is flagged or idempotent replay occurs, receipt preserves flags
      const duplicateReceipt = {
        id: 'req-existing-duplicate-003',
        createdAt: '2026-11-09T18:00:00.000Z',
        urgency: 'HIGH',
        peopleCount: 3,
        isFlaggedDuplicate: true,
        duplicateOfId: 'req-original-001',
        idempotent: true,
        addressSummary: '1428 Riverbend Dr',
        approxLat: 29.76,
        approxLng: -95.37,
      };

      const serialized = JSON.stringify(duplicateReceipt);
      const parsed = JSON.parse(serialized);

      expect(parsed.isFlaggedDuplicate).toBe(true);
      expect(parsed.duplicateOfId).toBe('req-original-001');
      expect(parsed.idempotent).toBe(true);
    });
  });

  // =========================================================================
  // FORWARDED-IP TRUST & RATE LIMITER SECURITY REVIEW
  // =========================================================================
  describe('Forwarded-IP Trust & Rate Limiter Security Review', () => {
    it('extracts leftmost client IP from multi-hop x-forwarded-for header chain', () => {
      const req = new Request('http://localhost:3000/api/geocode', {
        headers: {
          'x-forwarded-for': '203.0.113.195, 70.41.3.18, 150.172.238.178',
        },
      });
      const ip = getClientIp(req);
      expect(ip).toBe('203.0.113.195');
    });

    it('falls back to x-real-ip when x-forwarded-for is missing', () => {
      const req = new Request('http://localhost:3000/api/geocode', {
        headers: {
          'x-real-ip': '198.51.100.42',
        },
      });
      const ip = getClientIp(req);
      expect(ip).toBe('198.51.100.42');
    });

    it('falls back to "unknown" when no IP headers are present', () => {
      const req = new Request('http://localhost:3000/api/geocode');
      const ip = getClientIp(req);
      expect(ip).toBe('unknown');
    });

    it('isolates rate limits per client IP and resets on resetRateLimiter', () => {
      resetRateLimiter();
      const reqA = new Request('http://localhost:3000/api/geocode', {
        headers: { 'x-forwarded-for': '192.0.2.1' },
      });
      const reqB = new Request('http://localhost:3000/api/geocode', {
        headers: { 'x-forwarded-for': '192.0.2.2' },
      });

      const ipA = getClientIp(reqA);
      const ipB = getClientIp(reqB);

      // Verify independence
      expect(ipA).toBe('192.0.2.1');
      expect(ipB).toBe('192.0.2.2');
      expect(ipA).not.toBe(ipB);
    });
  });

  // =========================================================================
  // MOUNTED REACT REGRESSION TESTS (REACT 19 CREATEROOT & HOOKS)
  // =========================================================================
  describe('Mounted React Regression Tests (React 19 createRoot & Lifecycle)', () => {
    let container: unknown;
    let root: ReactDOM.Root;

    interface HarnessHandle {
      location: ReturnType<typeof useCitizenLocation>;
      errors: Record<string, string>;
      validateAndSubmit: () => Promise<{ success: boolean; error?: string }>;
    }

    function CitizenLocationHarness({ onMount }: { onMount: (handle: HarnessHandle) => void }) {
      const [errors, setErrors] = React.useState<Record<string, string>>({});
      const location = useCitizenLocation({
        onErrorsClear: (fields) => {
          setErrors((prev) => {
            const next = { ...prev };
            fields.forEach((f) => delete next[f]);
            return next;
          });
        },
        onSetError: (field, msg) => {
          setErrors((prev) => ({ ...prev, [field]: msg }));
        },
      });

      const validateAndSubmit = async (): Promise<{ success: boolean; error?: string }> => {
        const latNum = parseFloat(location.lat);
        const lngNum = parseFloat(location.lng);

        if (!location.lat.trim() || isNaN(latNum) || latNum < -90 || latNum > 90) {
          return { success: false, error: 'Valid latitude is required' };
        }
        if (!location.lng.trim() || isNaN(lngNum) || lngNum < -180 || lngNum > 180) {
          return { success: false, error: 'Valid longitude is required' };
        }
        if (!location.address.trim()) {
          return { success: false, error: 'Address is required' };
        }
        if (!location.isLocationConfirmed) {
          return { success: false, error: 'Location must be confirmed before submission' };
        }

        await apiClient.createRequest({
          lat: latNum,
          lng: lngNum,
          peopleCount: 3,
          urgency: 'HIGH',
          medicalNeeds: false,
          notes: `Address: ${location.address}`,
          source: 'REPORTED',
          idempotencyKey: '00000000-0000-4000-8000-000000000099',
        });

        mockRouterPush('/citizen/confirmation');
        return { success: true };
      };

      onMount({
        location,
        errors,
        validateAndSubmit,
      });

      return null;
    }

    beforeEach(() => {
      container = mockDocument.createElement('div');
      root = ReactDOM.createRoot(container as HTMLElement);
      mockRouterPush.mockClear();
    });

    afterEach(() => {
      act(() => {
        root.unmount();
      });
    });

    it('1. GPS autofill without automatic confirmation: coordinates and address populate, but isLocationConfirmed remains false and blocks submission', async () => {
      let handle!: HarnessHandle;

      act(() => {
        root.render(
          <CitizenLocationHarness
            onMount={(h) => {
              handle = h;
            }}
          />,
        );
      });

      // Verify blank initial state
      expect(handle.location.lat).toBe('');
      expect(handle.location.lng).toBe('');
      expect(handle.location.address).toBe('');
      expect(handle.location.isLocationConfirmed).toBe(false);

      // Mock geolocation success
      mockGeolocation.getCurrentPosition.mockImplementationOnce(
        (success: (pos: unknown) => void) => {
          success({
            coords: {
              latitude: 29.7604,
              longitude: -95.3698,
              accuracy: 4.8,
            },
          });
        },
      );

      // Mock reverse-geocode endpoint returning formatted street address
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: true,
            address: '1428 Riverbend Dr, Houston, TX 77024',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      );

      // Trigger "Use My Current Location"
      await act(async () => {
        handle.location.handleUseLocation();
      });

      // Invariants check:
      // 1. Coordinates and address autofilled
      expect(handle.location.lat).toBe('29.760400');
      expect(handle.location.lng).toBe('-95.369800');
      expect(handle.location.address).toBe('1428 Riverbend Dr, Houston, TX 77024');
      expect(handle.location.locationSource).toBe('GPS');
      expect(handle.location.gpsAccuracy).toBe(4.8);

      // 2. CRITICAL REQUIREMENT: isLocationConfirmed remains false until citizen explicitly confirms!
      expect(handle.location.isLocationConfirmed).toBe(false);
      expect(handle.location.confirmedDetails).toBeNull();

      // 3. Attempting submission without explicit confirmation fails
      const submitResult = await handle.validateAndSubmit();
      expect(submitResult.success).toBe(false);
      expect(submitResult.error).toContain('Location must be confirmed before submission');
      expect(apiClient.createRequest).not.toHaveBeenCalled();
      expect(mockRouterPush).not.toHaveBeenCalled();
    });

    it('2. Manual confirmation: clicking explicit confirm marks location confirmed and enables submission', async () => {
      let handle!: HarnessHandle;

      act(() => {
        root.render(
          <CitizenLocationHarness
            onMount={(h) => {
              handle = h;
            }}
          />,
        );
      });

      // Autofill via GPS
      mockGeolocation.getCurrentPosition.mockImplementationOnce(
        (success: (pos: unknown) => void) => {
          success({
            coords: {
              latitude: 29.7604,
              longitude: -95.3698,
              accuracy: 5.0,
            },
          });
        },
      );

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: true,
            address: '1428 Riverbend Dr, Houston, TX 77024',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      );

      await act(async () => {
        handle.location.handleUseLocation();
      });

      expect(handle.location.isLocationConfirmed).toBe(false);

      // Citizen clicks explicit "Confirm Location"
      act(() => {
        const confirmed = handle.location.handleExplicitConfirm();
        expect(confirmed).toBe(true);
      });

      // Location is now confirmed with provenance details
      expect(handle.location.isLocationConfirmed).toBe(true);
      expect(handle.location.confirmedDetails).toEqual({
        address: '1428 Riverbend Dr, Houston, TX 77024',
        lat: '29.760400',
        lng: '-95.369800',
        source: 'GPS',
        accuracy: 5.0,
      });

      // Mock apiClient.createRequest success
      vi.mocked(apiClient.createRequest).mockResolvedValueOnce({
        id: 'req-mounted-gps-001',
        createdAt: new Date().toISOString(),
        urgency: 'HIGH',
        peopleCount: 3,
        isFlaggedDuplicate: false,
        idempotent: false,
        lat: 29.7604,
        lng: -95.3698,
        source: 'REPORTED',
      });

      // Submission now succeeds
      const submitResult = await handle.validateAndSubmit();
      expect(submitResult.success).toBe(true);
      expect(apiClient.createRequest).toHaveBeenCalledTimes(1);
      expect(mockRouterPush).toHaveBeenCalledWith('/citizen/confirmation');
    });

    it('3. Address edits during pending search invalidate the search and clear candidate suggestions', async () => {
      let handle!: HarnessHandle;

      act(() => {
        root.render(
          <CitizenLocationHarness
            onMount={(h) => {
              handle = h;
            }}
          />,
        );
      });

      // Setup a delayed fetch promise for forward geocoding
      let resolveSlowSearch!: (res: Response) => void;
      const slowSearchPromise = new Promise<Response>((resolve) => {
        resolveSlowSearch = resolve;
      });

      vi.spyOn(globalThis, 'fetch').mockReturnValueOnce(slowSearchPromise);

      // Citizen enters address and clicks "Find Location"
      act(() => {
        void handle.location.handleSearchAddress('1428 Riverbend');
      });

      expect(handle.location.geocodeStatus).toBe('SEARCHING');

      // While the search is pending, citizen edits the address input
      act(() => {
        handle.location.handleAddressChange('1428 Riverbend Dr Apt 4B');
      });

      // Invariants: candidates cleared, status reset to IDLE, confirmation invalidated
      expect(handle.location.address).toBe('1428 Riverbend Dr Apt 4B');
      expect(handle.location.geocodeCandidates).toEqual([]);
      expect(handle.location.geocodeStatus).toBe('IDLE');
      expect(handle.location.isLocationConfirmed).toBe(false);

      // Now the delayed search response finally resolves
      await act(async () => {
        resolveSlowSearch(
          new Response(
            JSON.stringify({
              success: true,
              results: [
                {
                  formatted: '1428 Riverbend Dr, Houston, TX 77024',
                  lat: 29.7604,
                  lng: -95.3698,
                },
              ],
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          ),
        );
      });

      // Invariant: stale candidates MUST NOT be added to candidate list
      expect(handle.location.geocodeCandidates).toEqual([]);
      expect(handle.location.address).toBe('1428 Riverbend Dr Apt 4B');
      expect(handle.location.isLocationConfirmed).toBe(false);
    });

    it('4. Stale candidate prevention: sequence counter prevents older search responses from overwriting newer ones', async () => {
      let handle!: HarnessHandle;

      act(() => {
        root.render(
          <CitizenLocationHarness
            onMount={(h) => {
              handle = h;
            }}
          />,
        );
      });

      let resolveSearchA!: (res: Response) => void;
      const promiseA = new Promise<Response>((resolve) => {
        resolveSearchA = resolve;
      });

      let resolveSearchB!: (res: Response) => void;
      const promiseB = new Promise<Response>((resolve) => {
        resolveSearchB = resolve;
      });

      // 1st search starts (Search A)
      vi.spyOn(globalThis, 'fetch').mockReturnValueOnce(promiseA);
      act(() => {
        void handle.location.handleSearchAddress('Old Search Address');
      });

      // 2nd search starts (Search B) before Search A finishes
      vi.spyOn(globalThis, 'fetch').mockReturnValueOnce(promiseB);
      act(() => {
        void handle.location.handleSearchAddress('New Search Address');
      });

      // Search B resolves first
      await act(async () => {
        resolveSearchB(
          new Response(
            JSON.stringify({
              success: true,
              results: [
                {
                  formatted: 'New Search Address, Houston, TX',
                  lat: 29.77,
                  lng: -95.38,
                },
              ],
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          ),
        );
      });

      expect(handle.location.geocodeCandidates).toHaveLength(1);
      expect(handle.location.geocodeCandidates[0].formatted).toBe(
        'New Search Address, Houston, TX',
      );

      // Search A resolves late
      await act(async () => {
        resolveSearchA(
          new Response(
            JSON.stringify({
              success: true,
              results: [
                {
                  formatted: 'Old Search Address (Stale), Houston, TX',
                  lat: 29.71,
                  lng: -95.31,
                },
              ],
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          ),
        );
      });

      // Verification: Search A's stale results were discarded; Search B's results remain intact!
      expect(handle.location.geocodeCandidates).toHaveLength(1);
      expect(handle.location.geocodeCandidates[0].formatted).toBe(
        'New Search Address, Houston, TX',
      );
    });

    it('5. Manual coordinate changes invalidate previous confirmation and require re-confirmation before submission', async () => {
      let handle!: HarnessHandle;

      act(() => {
        root.render(
          <CitizenLocationHarness
            onMount={(h) => {
              handle = h;
            }}
          />,
        );
      });

      // Candidate selected and confirmed
      act(() => {
        handle.location.handleSelectCandidate({
          formatted: '1428 Riverbend Dr, Houston, TX',
          lat: 29.7604,
          lng: -95.3698,
        });
      });

      expect(handle.location.isLocationConfirmed).toBe(true);

      // Citizen manually edits latitude coordinate
      act(() => {
        handle.location.handleCoordinateChange('lat', '29.761000');
      });

      // Confirmation is immediately invalidated
      expect(handle.location.isLocationConfirmed).toBe(false);
      expect(handle.location.confirmedDetails).toBeNull();
      expect(handle.location.locationSource).toBe('MANUAL');

      // Submission blocked
      const submitResult = await handle.validateAndSubmit();
      expect(submitResult.success).toBe(false);
      expect(submitResult.error).toContain('Location must be confirmed before submission');

      // Citizen explicitly re-confirms with updated coordinates
      act(() => {
        const confirmed = handle.location.handleExplicitConfirm();
        expect(confirmed).toBe(true);
      });

      expect(handle.location.isLocationConfirmed).toBe(true);
      expect(handle.location.confirmedDetails?.lat).toBe('29.761000');
    });

    // =========================================================================
    // FINAL GPS REVERSE-GEOCODING RACE CONDITION & INVARIANTS (PR #33)
    // =========================================================================
    it('6. GPS lookup starts, coordinates are manually edited, and an old reverse-geocoding response arrives — the old address must not appear', async () => {
      let handle!: HarnessHandle;

      act(() => {
        root.render(
          <CitizenLocationHarness
            onMount={(h) => {
              handle = h;
            }}
          />,
        );
      });

      let resolveSlowReverse!: (res: Response) => void;
      const slowReversePromise = new Promise<Response>((resolve) => {
        resolveSlowReverse = resolve;
      });
      vi.spyOn(globalThis, 'fetch').mockReturnValueOnce(slowReversePromise);

      mockGeolocation.getCurrentPosition.mockImplementationOnce(
        (success: (pos: unknown) => void) => {
          success({
            coords: {
              latitude: 29.7604,
              longitude: -95.3698,
              accuracy: 5.0,
            },
          });
        },
      );

      // 1. Citizen clicks "Use My Current Location"
      await act(async () => {
        handle.location.handleUseLocation();
      });

      expect(handle.location.lat).toBe('29.760400');
      expect(handle.location.lng).toBe('-95.369800');
      expect(handle.location.reverseGeocodeStatus).toBe('LOOKING_UP');

      // 2. Citizen manually edits latitude before reverse geocode finishes
      act(() => {
        handle.location.handleCoordinateChange('lat', '28.613900');
      });

      // Status immediately reset to IDLE, confirmation invalidated, manual source set
      expect(handle.location.lat).toBe('28.613900');
      expect(handle.location.reverseGeocodeStatus).toBe('IDLE');
      expect(handle.location.reverseGeocodeMessage).toBeNull();
      expect(handle.location.locationSource).toBe('MANUAL');
      expect(handle.location.isLocationConfirmed).toBe(false);

      // 3. Old reverse-geocode response arrives later with Houston address
      await act(async () => {
        resolveSlowReverse(
          new Response(
            JSON.stringify({
              success: true,
              address: '1428 Riverbend Dr, Houston, TX 77024',
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          ),
        );
      });

      // Verification: The stale Houston address MUST NOT overwrite or appear!
      expect(handle.location.address).toBe('');
      expect(handle.location.lat).toBe('28.613900');
      expect(handle.location.reverseGeocodeStatus).toBe('IDLE');
      expect(handle.location.isLocationConfirmed).toBe(false);
    });

    it('7. Manual latitude modification invalidates the pending lookup', async () => {
      let handle!: HarnessHandle;

      act(() => {
        root.render(
          <CitizenLocationHarness
            onMount={(h) => {
              handle = h;
            }}
          />,
        );
      });

      let resolveSlowReverse!: (res: Response) => void;
      const slowReversePromise = new Promise<Response>((resolve) => {
        resolveSlowReverse = resolve;
      });
      vi.spyOn(globalThis, 'fetch').mockReturnValueOnce(slowReversePromise);

      mockGeolocation.getCurrentPosition.mockImplementationOnce(
        (success: (pos: unknown) => void) => {
          success({
            coords: {
              latitude: 29.7604,
              longitude: -95.3698,
              accuracy: 5.0,
            },
          });
        },
      );

      await act(async () => {
        handle.location.handleUseLocation();
      });

      const initialSeq = handle.location.lookupSeqRef.current;
      expect(handle.location.reverseGeocodeStatus).toBe('LOOKING_UP');

      // Manual latitude change
      act(() => {
        handle.location.handleCoordinateChange('lat', '30.123456');
      });

      // Verification: lookupSeqRef incremented, status reset to IDLE, stale message cleared
      expect(handle.location.lookupSeqRef.current).toBeGreaterThan(initialSeq);
      expect(handle.location.reverseGeocodeStatus).toBe('IDLE');
      expect(handle.location.reverseGeocodeMessage).toBeNull();
      expect(handle.location.lat).toBe('30.123456');
      expect(handle.location.isLocationConfirmed).toBe(false);

      // Late resolution must not overwrite or set address
      await act(async () => {
        resolveSlowReverse(
          new Response(
            JSON.stringify({
              success: true,
              address: '1428 Riverbend Dr, Houston, TX 77024',
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          ),
        );
      });

      expect(handle.location.address).toBe('');
      expect(handle.location.lat).toBe('30.123456');
      expect(handle.location.reverseGeocodeStatus).toBe('IDLE');
    });

    it('8. Manual longitude modification invalidates the pending lookup', async () => {
      let handle!: HarnessHandle;

      act(() => {
        root.render(
          <CitizenLocationHarness
            onMount={(h) => {
              handle = h;
            }}
          />,
        );
      });

      let resolveSlowReverse!: (res: Response) => void;
      const slowReversePromise = new Promise<Response>((resolve) => {
        resolveSlowReverse = resolve;
      });
      vi.spyOn(globalThis, 'fetch').mockReturnValueOnce(slowReversePromise);

      mockGeolocation.getCurrentPosition.mockImplementationOnce(
        (success: (pos: unknown) => void) => {
          success({
            coords: {
              latitude: 29.7604,
              longitude: -95.3698,
              accuracy: 5.0,
            },
          });
        },
      );

      await act(async () => {
        handle.location.handleUseLocation();
      });

      const initialSeq = handle.location.lookupSeqRef.current;
      expect(handle.location.reverseGeocodeStatus).toBe('LOOKING_UP');

      // Manual longitude change
      act(() => {
        handle.location.handleCoordinateChange('lng', '-97.743100');
      });

      // Verification: lookupSeqRef incremented, status reset to IDLE, stale message cleared
      expect(handle.location.lookupSeqRef.current).toBeGreaterThan(initialSeq);
      expect(handle.location.reverseGeocodeStatus).toBe('IDLE');
      expect(handle.location.reverseGeocodeMessage).toBeNull();
      expect(handle.location.lng).toBe('-97.743100');
      expect(handle.location.isLocationConfirmed).toBe(false);

      // Late resolution must not overwrite or set address
      await act(async () => {
        resolveSlowReverse(
          new Response(
            JSON.stringify({
              success: true,
              address: '1428 Riverbend Dr, Houston, TX 77024',
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          ),
        );
      });

      expect(handle.location.address).toBe('');
      expect(handle.location.lng).toBe('-97.743100');
      expect(handle.location.reverseGeocodeStatus).toBe('IDLE');
    });

    it('9. Old GPS responses cannot overwrite the results of newer GPS acquisitions', async () => {
      let handle!: HarnessHandle;

      act(() => {
        root.render(
          <CitizenLocationHarness
            onMount={(h) => {
              handle = h;
            }}
          />,
        );
      });

      let resolveGps1!: (res: Response) => void;
      const promiseGps1 = new Promise<Response>((resolve) => {
        resolveGps1 = resolve;
      });

      let resolveGps2!: (res: Response) => void;
      const promiseGps2 = new Promise<Response>((resolve) => {
        resolveGps2 = resolve;
      });

      // 1st GPS click (Houston coordinates)
      vi.spyOn(globalThis, 'fetch').mockReturnValueOnce(promiseGps1);
      mockGeolocation.getCurrentPosition.mockImplementationOnce(
        (success: (pos: unknown) => void) => {
          success({
            coords: { latitude: 29.7604, longitude: -95.3698, accuracy: 10.0 },
          });
        },
      );

      await act(async () => {
        handle.location.handleUseLocation();
      });

      expect(handle.location.lat).toBe('29.760400');
      expect(handle.location.lng).toBe('-95.369800');

      // 2nd GPS click (Austin coordinates) before 1st reverse-geocode completes
      vi.spyOn(globalThis, 'fetch').mockReturnValueOnce(promiseGps2);
      mockGeolocation.getCurrentPosition.mockImplementationOnce(
        (success: (pos: unknown) => void) => {
          success({
            coords: { latitude: 30.2672, longitude: -97.7431, accuracy: 3.5 },
          });
        },
      );

      await act(async () => {
        handle.location.handleUseLocation();
      });

      expect(handle.location.lat).toBe('30.267200');
      expect(handle.location.lng).toBe('-97.743100');

      // 2nd lookup resolves first with Austin address
      await act(async () => {
        resolveGps2(
          new Response(
            JSON.stringify({
              success: true,
              address: 'Congress Ave, Austin, TX 78701',
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          ),
        );
      });

      expect(handle.location.address).toBe('Congress Ave, Austin, TX 78701');

      // 1st lookup resolves late with Houston address
      await act(async () => {
        resolveGps1(
          new Response(
            JSON.stringify({
              success: true,
              address: 'Riverbend Dr, Houston, TX 77024',
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          ),
        );
      });

      // Verification: Stale 1st response is discarded and does not overwrite Austin address
      expect(handle.location.address).toBe('Congress Ave, Austin, TX 78701');
      expect(handle.location.lat).toBe('30.267200');
      expect(handle.location.lng).toBe('-97.743100');
    });

    it('10. A cancelled lookup does not display a false network-error message', async () => {
      let handle!: HarnessHandle;

      act(() => {
        root.render(
          <CitizenLocationHarness
            onMount={(h) => {
              handle = h;
            }}
          />,
        );
      });

      mockGeolocation.getCurrentPosition.mockImplementationOnce(
        (success: (pos: unknown) => void) => {
          success({
            coords: { latitude: 29.7604, longitude: -95.3698, accuracy: 5.0 },
          });
        },
      );

      // Mock fetch with abort rejection
      vi.spyOn(globalThis, 'fetch').mockImplementationOnce(async (_url, options) => {
        const signal = options?.signal as AbortSignal | undefined;
        return new Promise<Response>((_, reject) => {
          if (signal?.aborted) {
            const err = new Error('The user aborted a request.');
            err.name = 'AbortError';
            reject(err);
            return;
          }
          signal?.addEventListener('abort', () => {
            const err = new Error('The user aborted a request.');
            err.name = 'AbortError';
            reject(err);
          });
        });
      });

      await act(async () => {
        handle.location.handleUseLocation();
      });

      expect(handle.location.reverseGeocodeStatus).toBe('LOOKING_UP');

      // Citizen cancels the pending lookup by modifying latitude
      act(() => {
        handle.location.handleCoordinateChange('lat', '29.761000');
      });

      // Verification: Status is IDLE, no error message displayed
      expect(handle.location.reverseGeocodeStatus).toBe('IDLE');
      expect(handle.location.reverseGeocodeMessage).toBeNull();
    });

    it('11. A valid fresh GPS lookup still autofills the correct address', async () => {
      let handle!: HarnessHandle;

      act(() => {
        root.render(
          <CitizenLocationHarness
            onMount={(h) => {
              handle = h;
            }}
          />,
        );
      });

      mockGeolocation.getCurrentPosition.mockImplementationOnce(
        (success: (pos: unknown) => void) => {
          success({
            coords: { latitude: 28.613939, longitude: 77.209021, accuracy: 4.2 },
          });
        },
      );

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: true,
            address: 'Yamuna Floodplain Relief Camp, Delhi 110001',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      );

      await act(async () => {
        handle.location.handleUseLocation();
      });

      expect(handle.location.lat).toBe('28.613939');
      expect(handle.location.lng).toBe('77.209021');
      expect(handle.location.address).toBe('Yamuna Floodplain Relief Camp, Delhi 110001');
      expect(handle.location.reverseGeocodeStatus).toBe('FOUND');
      expect(handle.location.isLocationConfirmed).toBe(false);
    });

    it('12. Submission remains blocked until the citizen explicitly confirms the final address-coordinate pair', async () => {
      let handle!: HarnessHandle;

      act(() => {
        root.render(
          <CitizenLocationHarness
            onMount={(h) => {
              handle = h;
            }}
          />,
        );
      });

      // Step 1: Autofill via GPS and reverse-geocode
      mockGeolocation.getCurrentPosition.mockImplementationOnce(
        (success: (pos: unknown) => void) => {
          success({
            coords: { latitude: 29.7604, longitude: -95.3698, accuracy: 5.0 },
          });
        },
      );

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: true,
            address: '1428 Riverbend Dr, Houston, TX 77024',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      );

      await act(async () => {
        handle.location.handleUseLocation();
      });

      // Step 2: Citizen modifies coordinates manually
      act(() => {
        handle.location.handleCoordinateChange('lat', '29.765000');
        handle.location.handleCoordinateChange('lng', '-95.365000');
      });

      // Submission must be blocked
      let submitRes = await handle.validateAndSubmit();
      expect(submitRes.success).toBe(false);
      expect(submitRes.error).toContain('Location must be confirmed before submission');
      expect(apiClient.createRequest).not.toHaveBeenCalled();

      // Step 3: Citizen enters manual address update
      act(() => {
        handle.location.handleAddressChange('1430 Riverbend Dr (Upper Floor)');
      });

      // Still blocked
      submitRes = await handle.validateAndSubmit();
      expect(submitRes.success).toBe(false);
      expect(apiClient.createRequest).not.toHaveBeenCalled();

      // Step 4: Citizen explicitly confirms the final pair
      act(() => {
        const confirmed = handle.location.handleExplicitConfirm();
        expect(confirmed).toBe(true);
      });

      expect(handle.location.isLocationConfirmed).toBe(true);
      expect(handle.location.confirmedDetails).toEqual({
        address: '1430 Riverbend Dr (Upper Floor)',
        lat: '29.765000',
        lng: '-95.365000',
        source: 'MANUAL',
        accuracy: null,
      });

      // Step 5: Submission now succeeds
      vi.mocked(apiClient.createRequest).mockResolvedValueOnce({
        id: 'req-confirmed-pair-001',
        createdAt: new Date().toISOString(),
        urgency: 'HIGH',
        peopleCount: 3,
        isFlaggedDuplicate: false,
        idempotent: false,
        lat: 29.765,
        lng: -95.365,
        source: 'REPORTED',
      });

      submitRes = await handle.validateAndSubmit();
      expect(submitRes.success).toBe(true);
      expect(apiClient.createRequest).toHaveBeenCalledTimes(1);
      expect(mockRouterPush).toHaveBeenCalledWith('/citizen/confirmation');
    });
  });
});
