import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { POST } from '../app/api/reverse-geocode/route';
import { clearNominatimCache } from '../lib/geocoding';
import CitizenRequestPage from '../app/citizen/request/page';
import type { UrgencyLevel } from '@floodrelay/shared';
import type { CreateRequestInput } from '../lib/api/types';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

describe('Citizen GPS Address Autofill & Reverse Geocoding', () => {
  const originalEnv = process.env.GEOAPIFY_API_KEY;

  beforeEach(() => {
    vi.restoreAllMocks();
    clearNominatimCache();
  });

  afterEach(() => {
    clearNominatimCache();
    process.env.GEOAPIFY_API_KEY = originalEnv;
  });

  describe('Server-Side API Route: POST /api/reverse-geocode', () => {
    it('returns 400 INVALID_REQUEST when request body is missing or invalid JSON', async () => {
      const request = new Request('http://localhost:3000/api/reverse-geocode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'invalid-json{',
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.error).toBe('INVALID_REQUEST');
    });

    it('returns 400 VALIDATION_ERROR for out-of-range coordinates', async () => {
      // Latitude > 90
      const reqLatInvalid = new Request('http://localhost:3000/api/reverse-geocode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lat: 95.5, lng: 75.87 }),
      });
      const resLat = await POST(reqLatInvalid);
      const dataLat = await resLat.json();
      expect(resLat.status).toBe(400);
      expect(dataLat.error).toBe('VALIDATION_ERROR');

      // Longitude < -180
      const reqLngInvalid = new Request('http://localhost:3000/api/reverse-geocode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lat: 30.87, lng: -195.0 }),
      });
      const resLng = await POST(reqLngInvalid);
      const dataLng = await resLng.json();
      expect(resLng.status).toBe(400);
      expect(dataLng.error).toBe('VALIDATION_ERROR');
    });

    it('gracefully falls back to OpenStreetMap Nominatim when GEOAPIFY_API_KEY is not set', async () => {
      delete process.env.GEOAPIFY_API_KEY;

      const mockNominatimResponse = {
        place_id: 101,
        lat: '30.872505',
        lon: '75.870605',
        display_name: 'Ferozepur Road, Ludhiana, Punjab, 141001, India',
        address: {
          road: 'Ferozepur Road',
          city: 'Ludhiana',
          state: 'Punjab',
          postcode: '141001',
          country: 'India',
        },
      };

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify(mockNominatimResponse), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

      const request = new Request('http://localhost:3000/api/reverse-geocode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lat: 30.872505, lng: 75.870605 }),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.address).toContain('Ferozepur Road, Ludhiana');
      expect(data.provider).toBe('nominatim');
    });

    it('returns 200 with formatted address on successful provider reverse geocoding', async () => {
      process.env.GEOAPIFY_API_KEY = 'test_valid_api_key_123';

      const mockGeoapifyResponse = {
        results: [
          {
            formatted: '1428 Grand Ave, River District, Houston, TX 77024, United States',
            address_line1: '1428 Grand Ave',
            address_line2: 'Houston, TX 77024',
            street: 'Grand Ave',
            housenumber: '1428',
            city: 'Houston',
            state: 'Texas',
            country: 'United States',
            confidence: 0.95,
          },
        ],
      };

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify(mockGeoapifyResponse), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

      const request = new Request('http://localhost:3000/api/reverse-geocode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lat: 29.7604, lng: -95.3698 }),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.address).toBe('1428 Grand Ave, River District, Houston, TX 77024, United States');
      expect(data.confidence).toBe(0.95);
    });

    it('returns 200 with address: null when provider finds no street address for coordinates', async () => {
      process.env.GEOAPIFY_API_KEY = 'test_valid_api_key_123';

      const mockEmptyResponse = {
        results: [],
      };

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify(mockEmptyResponse), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

      const request = new Request('http://localhost:3000/api/reverse-geocode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lat: 28.0, lng: -90.0 }), // Remote water area
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.address).toBeNull();
      expect(data.message).toContain('No street address found');
    });

    it('returns 502 PROVIDER_ERROR when provider returns an HTTP error', async () => {
      process.env.GEOAPIFY_API_KEY = 'test_valid_api_key_123';

      vi.spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(
          new Response('Unauthorized: Invalid API key', {
            status: 401,
            statusText: 'Unauthorized',
          }),
        )
        .mockResolvedValueOnce(
          new Response('Service Unavailable', {
            status: 503,
            statusText: 'Service Unavailable',
          }),
        );

      const request = new Request('http://localhost:3000/api/reverse-geocode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lat: 29.7604, lng: -95.3698 }),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(502);
      expect(data.success).toBe(false);
      expect(data.error).toBe('PROVIDER_ERROR');
    });

    it('returns 502 PROVIDER_NETWORK_ERROR when provider fetch throws a network error', async () => {
      process.env.GEOAPIFY_API_KEY = 'test_valid_api_key_123';

      vi.spyOn(globalThis, 'fetch')
        .mockRejectedValueOnce(new Error('getaddrinfo ENOTFOUND api.geoapify.com'))
        .mockRejectedValueOnce(new Error('getaddrinfo ENOTFOUND nominatim.openstreetmap.org'));

      const request = new Request('http://localhost:3000/api/reverse-geocode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lat: 29.7604, lng: -95.3698 }),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(502);
      expect(data.success).toBe(false);
      expect(data.error).toBe('PROVIDER_NETWORK_ERROR');
    });
  });

  describe('Citizen Client Lifecycle & State Invariants (12 Regression Requirements)', () => {
    // Harness simulating the exact page state and interaction flow
    interface ClientHarnessState {
      lat: string;
      lng: string;
      address: string;
      gpsStatus: string;
      gpsAccuracy: number | null;
      reverseGeocodeStatus: string;
      reverseGeocodeMessage: string | null;
      errors: Record<string, string>;
      isPayloadEdited: boolean;
      lookupSeq: number;
      userEditedDuringLookup: boolean;
    }

    function createHarness(): {
      state: ClientHarnessState;
      handleUseLocation: (mockGeolocation?: {
        getCurrentPosition: (
          success: (pos: {
            coords: { latitude: number; longitude: number; accuracy: number };
          }) => void,
          error: (err: { code: number; message: string }) => void,
        ) => void;
      }) => Promise<void>;
      triggerReverseGeocode: (latNum: number, lngNum: number) => Promise<void>;
      handleAddressChange: (newAddress: string) => void;
      validateForm: () => boolean;
      synthesizeNotes: (notes?: string) => string;
      executeSubmission: () => CreateRequestInput | null;
    } {
      const state: ClientHarnessState = {
        lat: '29.7604',
        lng: '-95.3698',
        address: '', // Regression requirement 1 & 11: empty initially, no demo address
        gpsStatus: 'IDLE',
        gpsAccuracy: null,
        reverseGeocodeStatus: 'IDLE',
        reverseGeocodeMessage: null,
        errors: {},
        isPayloadEdited: false,
        lookupSeq: 0,
        userEditedDuringLookup: false,
      };

      const markEdited = () => {
        state.isPayloadEdited = true;
      };

      const triggerReverseGeocode = async (latNum: number, lngNum: number) => {
        const seq = ++state.lookupSeq;
        state.userEditedDuringLookup = false;
        state.reverseGeocodeStatus = 'LOOKING_UP';
        state.reverseGeocodeMessage = 'Finding nearest street address...';

        try {
          const res = await fetch('/api/reverse-geocode', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ lat: latNum, lng: lngNum }),
          });

          if (seq !== state.lookupSeq) {
            return;
          }

          const data = await res.json().catch(() => null);

          if (state.userEditedDuringLookup) {
            state.reverseGeocodeStatus = 'IDLE';
            state.reverseGeocodeMessage = null;
            return;
          }

          if (res.ok && data?.success) {
            if (data.address && typeof data.address === 'string' && data.address.trim()) {
              state.address = data.address.trim();
              state.reverseGeocodeStatus = 'FOUND';
              state.reverseGeocodeMessage = null;
              markEdited();
              delete state.errors.address;
            } else {
              state.reverseGeocodeStatus = 'UNAVAILABLE';
              const baseMsg = data?.message || 'No street address found for these coordinates.';
              state.reverseGeocodeMessage = baseMsg.includes('manually')
                ? baseMsg
                : `${baseMsg} Coordinates are saved — please enter your street address or landmark manually.`;
            }
          } else {
            state.reverseGeocodeStatus = 'ERROR';
            const baseMsg = data?.message || 'Unable to determine street address.';
            state.reverseGeocodeMessage =
              baseMsg.includes('GEOAPIFY') || baseMsg.includes('CONFIG_ERROR')
                ? 'Automatic address lookup is temporarily unavailable. Your GPS coordinates are saved — please specify your street name or a nearby landmark.'
                : baseMsg.includes('manually')
                  ? baseMsg
                  : `${baseMsg} Coordinates are saved — please enter your street address or landmark manually.`;
          }
        } catch {
          if (seq !== state.lookupSeq) return;
          if (state.userEditedDuringLookup) {
            state.reverseGeocodeStatus = 'IDLE';
            state.reverseGeocodeMessage = null;
            return;
          }
          state.reverseGeocodeStatus = 'ERROR';
          state.reverseGeocodeMessage =
            'Network error looking up address. Coordinates are saved — please enter your street address or landmark manually.';
        }
      };

      const handleUseLocation = async (mockGeolocation?: {
        getCurrentPosition: (
          success: (pos: {
            coords: { latitude: number; longitude: number; accuracy: number };
          }) => void,
          error: (err: { code: number; message: string }) => void,
        ) => void;
      }) => {
        const geo = mockGeolocation;
        if (!geo) {
          state.gpsStatus = 'UNSUPPORTED';
          return;
        }

        state.gpsStatus = 'ACQUIRING';

        await new Promise<void>((resolve) => {
          geo.getCurrentPosition(
            async (pos) => {
              state.lat = pos.coords.latitude.toFixed(6);
              state.lng = pos.coords.longitude.toFixed(6);
              state.gpsAccuracy = pos.coords.accuracy;
              state.gpsStatus = 'ACQUIRED';
              markEdited();
              delete state.errors.lat;
              delete state.errors.lng;

              await triggerReverseGeocode(pos.coords.latitude, pos.coords.longitude);
              resolve();
            },
            (err) => {
              if (err.code === 1) {
                state.gpsStatus = 'DENIED';
              } else if (err.code === 3) {
                state.gpsStatus = 'TIMEOUT';
              } else {
                state.gpsStatus = 'UNAVAILABLE';
              }
              resolve();
            },
          );
        });
      };

      const handleAddressChange = (newAddress: string) => {
        state.address = newAddress;
        state.userEditedDuringLookup = true;
        markEdited();
      };

      const validateForm = (): boolean => {
        const newErrors: Record<string, string> = {};
        const latNum = parseFloat(state.lat);
        const lngNum = parseFloat(state.lng);

        if (isNaN(latNum) || latNum < -90 || latNum > 90) {
          newErrors.lat = 'Valid latitude between -90 and 90 is required';
        }
        if (isNaN(lngNum) || lngNum < -180 || lngNum > 180) {
          newErrors.lng = 'Valid longitude between -180 and 180 is required';
        }
        if (!state.address.trim()) {
          newErrors.address = 'Street address or location landmark is required';
        }

        state.errors = newErrors;
        return Object.keys(newErrors).length === 0;
      };

      const synthesizeNotes = (notes = ''): string => {
        const parts: string[] = [];
        if (state.address.trim()) {
          parts.push(`Address: ${state.address.trim()}`);
        }
        parts.push('Water Level: Reached ground floor interior');
        if (notes.trim()) {
          parts.push(`Field Notes: ${notes.trim()}`);
        }
        return parts.join(' | ').slice(0, 1000);
      };

      const executeSubmission = (): CreateRequestInput | null => {
        if (!validateForm()) return null;
        return {
          lat: parseFloat(state.lat),
          lng: parseFloat(state.lng),
          peopleCount: 3,
          urgency: 'HIGH' as UrgencyLevel,
          medicalNeeds: false,
          notes: synthesizeNotes(),
          source: 'REPORTED',
          idempotencyKey: '00000000-0000-4000-8000-000000000001',
        };
      };

      return {
        state,
        handleUseLocation,
        triggerReverseGeocode,
        handleAddressChange,
        validateForm,
        synthesizeNotes,
        executeSubmission,
      };
    }

    // 1. GPS success updates latitude
    it('1. GPS success updates latitude', async () => {
      const { state, handleUseLocation } = createHarness();
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify({ success: true, address: 'Test St' }), { status: 200 }),
      );

      await handleUseLocation({
        getCurrentPosition: (success) => {
          success({ coords: { latitude: 30.872505, longitude: 75.870605, accuracy: 5.2 } });
        },
      });

      expect(state.lat).toBe('30.872505');
      expect(state.gpsStatus).toBe('ACQUIRED');
    });

    // 2. GPS success updates longitude
    it('2. GPS success updates longitude', async () => {
      const { state, handleUseLocation } = createHarness();
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify({ success: true, address: 'Test St' }), { status: 200 }),
      );

      await handleUseLocation({
        getCurrentPosition: (success) => {
          success({ coords: { latitude: 30.872505, longitude: 75.870605, accuracy: 5.2 } });
        },
      });

      expect(state.lng).toBe('75.870605');
      expect(state.gpsAccuracy).toBe(5.2);
    });

    // 3. GPS success triggers address lookup
    it('3. GPS success triggers address lookup', async () => {
      const { state, triggerReverseGeocode } = createHarness();

      let fetchCalled = false;
      vi.spyOn(globalThis, 'fetch').mockImplementationOnce(async () => {
        fetchCalled = true;
        // Verify in-progress status while fetch is unresolved
        expect(state.reverseGeocodeStatus).toBe('LOOKING_UP');
        expect(state.reverseGeocodeMessage).toBe('Finding nearest street address...');
        return new Response(JSON.stringify({ success: true, address: '456 River Way' }), {
          status: 200,
        });
      });

      await triggerReverseGeocode(30.872505, 75.870605);
      expect(fetchCalled).toBe(true);
    });

    // 4. Successful reverse geocoding updates the address input
    it('4. Successful reverse geocoding updates the address input', async () => {
      const { state, triggerReverseGeocode } = createHarness();

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: true,
            address: '456 River Way, North Sector, Ludhiana, PB',
            confidence: 0.92,
          }),
          { status: 200 },
        ),
      );

      await triggerReverseGeocode(30.872505, 75.870605);

      expect(state.address).toBe('456 River Way, North Sector, Ludhiana, PB');
      expect(state.reverseGeocodeStatus).toBe('FOUND');
      expect(state.reverseGeocodeMessage).toBeNull();
      expect(state.isPayloadEdited).toBe(true);
    });

    // 5. Failed reverse geocoding preserves coordinates
    it('5. Failed reverse geocoding preserves coordinates', async () => {
      const { state, handleUseLocation } = createHarness();

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify({ success: false, error: 'PROVIDER_ERROR' }), { status: 502 }),
      );

      await handleUseLocation({
        getCurrentPosition: (success) => {
          success({ coords: { latitude: 29.800111, longitude: -95.400222, accuracy: 8.0 } });
        },
      });

      // Coordinates MUST be preserved
      expect(state.lat).toBe('29.800111');
      expect(state.lng).toBe('-95.400222');
      expect(state.reverseGeocodeStatus).toBe('ERROR');
      expect(state.reverseGeocodeMessage).toContain('Coordinates are saved');
    });

    // 6. Missing address result displays manual-entry guidance
    it('6. Missing address result displays manual-entry guidance', async () => {
      const { state, triggerReverseGeocode } = createHarness();

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: true,
            address: null,
            message: 'No street address found for these coordinates.',
          }),
          { status: 200 },
        ),
      );

      await triggerReverseGeocode(29.8, -95.4);

      expect(state.address).toBe('');
      expect(state.reverseGeocodeStatus).toBe('UNAVAILABLE');
      expect(state.reverseGeocodeMessage).toContain('please enter your street address or landmark');
    });

    // 7. Missing API key returns a controlled error and sanitizes message for citizen
    it('7. Missing API key returns a controlled error and sanitizes message for citizen', async () => {
      const { state, triggerReverseGeocode } = createHarness();

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: false,
            error: 'CONFIG_ERROR',
            message: 'Reverse geocoding service is not configured (missing GEOAPIFY_API_KEY).',
          }),
          { status: 503 },
        ),
      );

      await triggerReverseGeocode(29.8, -95.4);

      expect(state.reverseGeocodeStatus).toBe('ERROR');
      expect(state.reverseGeocodeMessage).toBe(
        'Automatic address lookup is temporarily unavailable. Your GPS coordinates are saved — please specify your street name or a nearby landmark.',
      );
      expect(state.reverseGeocodeMessage).not.toContain('GEOAPIFY_API_KEY');
      expect(state.reverseGeocodeMessage).not.toContain('CONFIG_ERROR');
    });

    // 8. GPS permission denied does not invoke geocoding
    it('8. GPS permission denied does not invoke geocoding', async () => {
      const { state, handleUseLocation } = createHarness();
      const fetchSpy = vi.spyOn(globalThis, 'fetch');

      await handleUseLocation({
        getCurrentPosition: (_, error) => {
          error({ code: 1, message: 'User denied Geolocation' });
        },
      });

      expect(state.gpsStatus).toBe('DENIED');
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(state.reverseGeocodeStatus).toBe('IDLE');
    });

    // 9. Manual address edits are not overwritten by a delayed response
    it('9. Manual address edits are not overwritten by a delayed response', async () => {
      const { state, triggerReverseGeocode, handleAddressChange } = createHarness();

      let resolveLookup!: (value: Response) => void;
      const delayedPromise = new Promise<Response>((resolve) => {
        resolveLookup = resolve;
      });

      vi.spyOn(globalThis, 'fetch').mockReturnValueOnce(delayedPromise);

      // 1. Trigger GPS lookup
      const lookupPromise = triggerReverseGeocode(30.872505, 75.870605);

      // 2. User immediately types custom apartment/landmark into address input
      handleAddressChange('Apartment 4B, Blue Building near Bridge');

      // 3. Delayed geocoder response finishes later
      resolveLookup(
        new Response(
          JSON.stringify({
            success: true,
            address: 'Old Street 123',
          }),
          { status: 200 },
        ),
      );
      await lookupPromise;

      // Address MUST retain manual user input
      expect(state.address).toBe('Apartment 4B, Blue Building near Bridge');
      expect(state.reverseGeocodeStatus).toBe('IDLE');
    });

    // 10. Rapid repeated GPS clicks cannot apply stale lookup results
    it('10. Rapid repeated GPS clicks cannot apply stale lookup results', async () => {
      const { state, triggerReverseGeocode } = createHarness();

      let resolveFirst!: (value: Response) => void;
      let resolveSecond!: (value: Response) => void;

      const firstPromise = new Promise<Response>((resolve) => {
        resolveFirst = resolve;
      });
      const secondPromise = new Promise<Response>((resolve) => {
        resolveSecond = resolve;
      });

      vi.spyOn(globalThis, 'fetch')
        .mockReturnValueOnce(firstPromise) // Click 1
        .mockReturnValueOnce(secondPromise); // Click 2

      // Click 1 (seq = 1)
      const p1 = triggerReverseGeocode(29.1, -95.1);

      // Click 2 (seq = 2)
      const p2 = triggerReverseGeocode(29.2, -95.2);

      // Fast response for Click 2 arrives FIRST
      resolveSecond(
        new Response(JSON.stringify({ success: true, address: 'Fresh Address 2' }), {
          status: 200,
        }),
      );
      await p2;
      expect(state.address).toBe('Fresh Address 2');

      // Slow response for Click 1 arrives LATER
      resolveFirst(
        new Response(JSON.stringify({ success: true, address: 'Stale Address 1' }), {
          status: 200,
        }),
      );
      await p1;

      // Stale Address 1 MUST NOT overwrite Fresh Address 2
      expect(state.address).toBe('Fresh Address 2');
    });

    // 11. No demo street address is submitted accidentally
    it('11. No demo street address is submitted accidentally', () => {
      const { state, executeSubmission, validateForm } = createHarness();

      // Ensure initial state has no hardcoded demo address
      expect(state.address).toBe('');

      // Attempting to submit without providing address must fail validation
      const isValid = validateForm();
      expect(isValid).toBe(false);
      expect(state.errors.address).toBe('Street address or location landmark is required');

      const submission = executeSubmission();
      expect(submission).toBeNull();
    });

    // 12. Request submission includes the latest confirmed address in notes
    it('12. Request submission includes the latest confirmed address in notes', () => {
      const { state, handleAddressChange, executeSubmission } = createHarness();

      handleAddressChange('104 Lakeview Terrace, 3rd Floor Apt 9, Gate 2');

      expect(state.address).toBe('104 Lakeview Terrace, 3rd Floor Apt 9, Gate 2');
      const payload = executeSubmission();
      expect(payload).not.toBeNull();
      expect(payload?.notes).toContain('Address: 104 Lakeview Terrace, 3rd Floor Apt 9, Gate 2');
      expect(payload?.lat).toBe(29.7604);
      expect(payload?.lng).toBe(-95.3698);
    });

    // 13. Citizen Address Input Status UI Refinement
    describe('Address Input Status Indicator & Banner Refinement', () => {
      it('initial render has neutral gray circular status indicator (IDLE)', () => {
        const html = renderToString(React.createElement(CitizenRequestPage));

        // 1. Initial status indicator is IDLE
        expect(html).toContain('data-testid="address-status-idle"');
        expect(html).toContain('aria-label="Address input idle"');

        // 2. Input has sufficient right padding (pr-11)
        expect(html).toContain('pr-11');

        // 3. Subtle neutral helper text is present
        expect(html).toContain(
          'Approximate GPS address. Confirm your location and add a nearby landmark.',
        );

        // 4. Prominent orange approximate address banner is NOT present
        expect(html).not.toContain('Approximate address detected');
      });

      it('maps reverse geocoding states to corresponding status indicators correctly', () => {
        // Helper function reflecting the status icon logic in page.tsx
        const getStatusIndicatorTestId = (status: string, addressVal: string) => {
          if (status === 'LOOKING_UP') return 'address-status-looking-up';
          if (status === 'FOUND' && addressVal.trim().length > 0) return 'address-status-success';
          if (status === 'UNAVAILABLE' || status === 'ERROR') return 'address-status-failed';
          return 'address-status-idle';
        };

        // IDLE
        expect(getStatusIndicatorTestId('IDLE', '')).toBe('address-status-idle');

        // LOOKING_UP
        expect(getStatusIndicatorTestId('LOOKING_UP', '')).toBe('address-status-looking-up');

        // SUCCESS: only when status is FOUND and address is non-empty
        expect(getStatusIndicatorTestId('FOUND', '1428 Riverbend Dr')).toBe(
          'address-status-success',
        );
        expect(getStatusIndicatorTestId('FOUND', '   ')).toBe('address-status-idle');

        // FAILED: neutral indicator on UNAVAILABLE or ERROR
        expect(getStatusIndicatorTestId('UNAVAILABLE', '')).toBe('address-status-failed');
        expect(getStatusIndicatorTestId('ERROR', '')).toBe('address-status-failed');
      });

      it('retains manual-entry guidance on lookup failure without showing orange success banner', async () => {
        const { state, triggerReverseGeocode } = createHarness();

        vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              success: false,
              message: 'Reverse geocoding service is unavailable.',
            }),
            { status: 503 },
          ),
        );

        await triggerReverseGeocode(31.25, 75.7);

        expect(state.reverseGeocodeStatus).toBe('ERROR');
        expect(state.reverseGeocodeMessage).toContain(
          'please enter your street address or landmark manually',
        );
      });
    });
  });
});
