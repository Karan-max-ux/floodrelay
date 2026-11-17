import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { POST as reverseGeocodePOST } from '../app/api/reverse-geocode/route';
import { POST as geocodePOST } from '../app/api/geocode/route';
import {
  NOMINATIM_USER_AGENT,
  REVERSE_GEOCODE_UNAVAILABLE_MESSAGE,
  REGIONAL_COVERAGE_BBOX,
  isWithinRegionalCoverage,
  findNearestRegionalLandmark,
  formatNominatimAddress,
  fetchNominatimReverse,
  fetchNominatimSearch,
  clearNominatimCache,
  getNominatimCacheStats,
  NOMINATIM_MAX_CACHE_SIZE,
} from '../lib/geocoding';

describe('Phase 3: Graceful Address Reverse-Geocoding & Fallback', () => {
  const originalEnv = process.env.GEOAPIFY_API_KEY;

  beforeEach(() => {
    vi.restoreAllMocks();
    clearNominatimCache();
  });

  afterEach(() => {
    vi.useRealTimers();
    clearNominatimCache();
    process.env.GEOAPIFY_API_KEY = originalEnv;
  });

  // =========================================================================
  // 1. REVERSE GEOCODING ROUTE (POST /api/reverse-geocode)
  // =========================================================================
  describe('Reverse Geocoding (POST /api/reverse-geocode)', () => {
    it('1.1 prefers Geoapify when GEOAPIFY_API_KEY is configured and returns 200 with formatted address', async () => {
      process.env.GEOAPIFY_API_KEY = 'test_valid_geoapify_key';

      const mockGeoapify = {
        results: [
          {
            formatted: '1428 Riverbend Dr, Houston, TX 77024',
            confidence: 0.95,
          },
        ],
      };

      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify(mockGeoapify), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

      const req = new Request('http://localhost:3000/api/reverse-geocode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lat: 29.7604, lng: -95.3698 }),
      });

      const res = await reverseGeocodePOST(req);
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.address).toBe('1428 Riverbend Dr, Houston, TX 77024');
      expect(data.provider).toBe('geoapify');
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining('api.geoapify.com'),
        expect.anything(),
      );
    });

    it('1.2 falls back to OpenStreetMap Nominatim when GEOAPIFY_API_KEY is missing and verifies User-Agent', async () => {
      delete process.env.GEOAPIFY_API_KEY;

      const mockNominatim = {
        place_id: 101,
        lat: '28.668',
        lon: '77.232',
        display_name: 'Kashmere Gate, Mori Gate, Central Delhi, Delhi, 110006, India',
        address: {
          road: 'Ring Road',
          suburb: 'Kashmere Gate',
          city: 'Delhi',
          state: 'Delhi',
          postcode: '110006',
          country: 'India',
        },
      };

      let capturedHeaders: HeadersInit | undefined;
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementationOnce(async (_url, init) => {
        capturedHeaders = init?.headers;
        return new Response(JSON.stringify(mockNominatim), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      });

      const req = new Request('http://localhost:3000/api/reverse-geocode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lat: 28.668, lng: 77.232 }),
      });

      const res = await reverseGeocodePOST(req);
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.address).toContain('Ring Road, Kashmere Gate');
      expect(data.provider).toBe('nominatim');
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining('nominatim.openstreetmap.org/reverse'),
        expect.anything(),
      );
      // Nominatim policy compliance check
      expect((capturedHeaders as Record<string, string>)?.['User-Agent']).toBe(
        NOMINATIM_USER_AGENT,
      );
    });

    it('1.3 falls back to Nominatim when Geoapify returns an HTTP error (e.g. 500 / 401)', async () => {
      process.env.GEOAPIFY_API_KEY = 'test_failing_key';

      const mockNominatim = {
        display_name: 'Main Bazaar Road, Pahar Ganj, Delhi, 110055, India',
        address: {
          road: 'Main Bazaar Road',
          suburb: 'Pahar Ganj',
          city: 'Delhi',
        },
      };

      // 1st call (Geoapify) fails with 500; 2nd call (Nominatim) succeeds
      vi.spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(new Response('Internal Server Error', { status: 500 }))
        .mockResolvedValueOnce(
          new Response(JSON.stringify(mockNominatim), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        );

      const req = new Request('http://localhost:3000/api/reverse-geocode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lat: 28.644, lng: 77.216 }),
      });

      const res = await reverseGeocodePOST(req);
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.address).toContain('Main Bazaar Road');
      expect(data.provider).toBe('nominatim');
    });

    it('1.4 falls back to Nominatim when Geoapify throws a network/timeout error', async () => {
      process.env.GEOAPIFY_API_KEY = 'test_timeout_key';

      const mockNominatim = {
        display_name: 'Yamuna Marg, Civil Lines, Delhi, India',
        address: { road: 'Yamuna Marg', suburb: 'Civil Lines', city: 'Delhi' },
      };

      // 1st call (Geoapify) throws timeout; 2nd call (Nominatim) succeeds
      vi.spyOn(globalThis, 'fetch')
        .mockRejectedValueOnce(new Error('Timeout reaching api.geoapify.com'))
        .mockResolvedValueOnce(
          new Response(JSON.stringify(mockNominatim), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        );

      const req = new Request('http://localhost:3000/api/reverse-geocode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lat: 28.68, lng: 77.22 }),
      });

      const res = await reverseGeocodePOST(req);
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.address).toContain('Yamuna Marg');
      expect(data.provider).toBe('nominatim');
    });

    it('1.5 safely handles malformed JSON responses without unhandled exception', async () => {
      delete process.env.GEOAPIFY_API_KEY;

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response('<html><body>Gateway Timeout</body></html>', {
          status: 200,
          headers: { 'Content-Type': 'text/html' },
        }),
      );

      // Outside coverage coords so we test pure malformed fallback handling
      const req = new Request('http://localhost:3000/api/reverse-geocode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lat: 10.0, lng: 20.0 }),
      });

      const res = await reverseGeocodePOST(req);
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.address).toBeNull();
      expect(data.message).toBe(REVERSE_GEOCODE_UNAVAILABLE_MESSAGE);
    });

    it('1.6 falls back to deterministic regional landmark when external providers fail within regional coverage area', async () => {
      delete process.env.GEOAPIFY_API_KEY;

      // Nominatim network failure
      vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('Network offline'));

      // Coordinates inside Delhi Yamuna Basin (near Kashmere Gate: 28.668, 77.232)
      const req = new Request('http://localhost:3000/api/reverse-geocode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lat: 28.669, lng: 77.231 }),
      });

      const res = await reverseGeocodePOST(req);
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.provider).toBe('regional_fallback');
      expect(data.isApproximate).toBe(true);
      expect(data.address).toContain('Near Yamuna Riverbank, Kashmere Gate (Approximate Landmark)');
      expect(data.message).toContain('Approximate regional landmark identified');
    });

    it('1.7 regional landmark fallback explicitly labels approximate reference and does NOT fabricate verified address', async () => {
      const landmark = findNearestRegionalLandmark(28.704, 77.227); // near Wazirabad
      expect(landmark).not.toBeNull();
      expect(landmark?.landmark.label).toContain('(Approximate Landmark)');
      expect(landmark?.landmark.label).not.toMatch(
        /\d+\s+[A-Z][a-z]+\s+(St|Street|Rd|Road|Ave|Avenue)/,
      ); // no fake street numbers
    });

    it('1.8 returns graceful unavailable response when lookups fail outside regional coverage area', async () => {
      delete process.env.GEOAPIFY_API_KEY;

      vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('Network offline'));

      // Coordinates in Pacific Ocean / far outside Delhi coverage area
      const req = new Request('http://localhost:3000/api/reverse-geocode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lat: 15.0, lng: 90.0 }),
      });

      const res = await reverseGeocodePOST(req);
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.address).toBeNull();
      expect(data.message).toBe(REVERSE_GEOCODE_UNAVAILABLE_MESSAGE);
      expect(data.message).not.toContain('GEOAPIFY');
      expect(data.message).not.toContain('CONFIG_ERROR');
    });

    it('1.9 returns 400 INVALID_REQUEST for malformed request body', async () => {
      const req = new Request('http://localhost:3000/api/reverse-geocode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'invalid-json-body',
      });

      const res = await reverseGeocodePOST(req);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe('INVALID_REQUEST');
    });

    it('1.10 returns 400 VALIDATION_ERROR for out-of-range coordinates', async () => {
      const req = new Request('http://localhost:3000/api/reverse-geocode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lat: 95.0, lng: 77.0 }),
      });

      const res = await reverseGeocodePOST(req);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe('VALIDATION_ERROR');
    });
  });

  // =========================================================================
  // 2. FORWARD GEOCODING ROUTE (POST /api/geocode)
  // =========================================================================
  describe('Forward Geocoding (POST /api/geocode)', () => {
    it('2.1 prefers Geoapify when configured and returns 200 with candidates', async () => {
      process.env.GEOAPIFY_API_KEY = 'test_valid_key';

      const mockGeoapify = {
        results: [
          {
            formatted: 'Civil Lines, North Delhi, Delhi 110054',
            lat: 28.675,
            lon: 77.225,
            confidence: 0.9,
          },
        ],
      };

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify(mockGeoapify), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

      const req = new Request('http://localhost:3000/api/geocode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: 'Civil Lines' }),
      });

      const res = await geocodePOST(req);
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.results[0].formatted).toContain('Civil Lines');
      expect(data.results[0].lat).toBe(28.675);
    });

    it('2.2 falls back to Nominatim search when GEOAPIFY_API_KEY is missing and includes attribution', async () => {
      delete process.env.GEOAPIFY_API_KEY;

      const mockNominatim = [
        {
          place_id: 301,
          lat: '28.668',
          lon: '77.232',
          display_name: 'Kashmere Gate Metro Station, Delhi, India',
          type: 'station',
          importance: 0.88,
        },
      ];

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify(mockNominatim), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

      const req = new Request('http://localhost:3000/api/geocode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: 'Kashmere Gate' }),
      });

      const res = await geocodePOST(req);
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.results[0].formatted).toContain('Kashmere Gate');
      expect(data.results[0].attribution).toBe('OpenStreetMap contributors');
    });

    it('2.3 falls back to Nominatim when Geoapify returns rate-limit or HTTP error', async () => {
      process.env.GEOAPIFY_API_KEY = 'test_key';

      const mockNominatim = [
        {
          display_name: 'Majnu Ka Tila, Delhi, India',
          lat: '28.701',
          lon: '77.227',
          importance: 0.75,
        },
      ];

      vi.spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(new Response('Rate Limit Exceeded', { status: 429 }))
        .mockResolvedValueOnce(
          new Response(JSON.stringify(mockNominatim), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        );

      const req = new Request('http://localhost:3000/api/geocode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: 'Majnu Ka Tila' }),
      });

      const res = await geocodePOST(req);
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.results[0].formatted).toContain('Majnu Ka Tila');
    });

    it('2.4 returns clear no-match response when neither provider matches (does not fabricate fake coordinates)', async () => {
      delete process.env.GEOAPIFY_API_KEY;

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify([]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

      const req = new Request('http://localhost:3000/api/geocode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: 'Nonexistent Unknown Flood Zone XYZ 9999' }),
      });

      const res = await geocodePOST(req);
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.results).toEqual([]);
      expect(data.message).toContain("We couldn't find a matching location");
    });

    it('2.5 validates query text length and rejects empty/short queries with 400', async () => {
      const req = new Request('http://localhost:3000/api/geocode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: 'ab' }), // Less than 3 chars
      });

      const res = await geocodePOST(req);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe('VALIDATION_ERROR');
    });
  });

  // =========================================================================
  // 3. CITIZEN-FACING UX & TECHNICAL TOKEN SANITIZATION
  // =========================================================================
  describe('Citizen-Facing UX & Token Sanitization', () => {
    it('3.1 technical tokens (GEOAPIFY_API_KEY, CONFIG_ERROR) NEVER reach citizen-facing messages', async () => {
      delete process.env.GEOAPIFY_API_KEY;

      vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('Connection failed'));

      // Outside coverage query to test unavailable fallback text
      const req = new Request('http://localhost:3000/api/reverse-geocode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lat: 1.0, lng: 1.0 }),
      });

      const res = await reverseGeocodePOST(req);
      const data = await res.json();

      expect(data.message).not.toContain('GEOAPIFY');
      expect(data.message).not.toContain('CONFIG_ERROR');
      expect(data.message).not.toContain('PROVIDER_');
      expect(data.message).toBe(REVERSE_GEOCODE_UNAVAILABLE_MESSAGE);
    });

    it('3.2 exact citizen-facing unavailable message matches specification', () => {
      expect(REVERSE_GEOCODE_UNAVAILABLE_MESSAGE).toBe(
        'Automatic address lookup is temporarily unavailable. Your GPS coordinates are saved — please specify your street name or a nearby landmark.',
      );
    });
  });

  // =========================================================================
  // 4. REGIONAL COVERAGE & DEFENSIVE BOUNDING BOX
  // =========================================================================
  describe('Regional Coverage & Landmark Fallback', () => {
    it('4.1 identifies points within Delhi NCR bounding box correctly', () => {
      // Inside Kashmere Gate
      expect(isWithinRegionalCoverage(28.668, 77.232)).toBe(true);
      // Boundary checks
      expect(isWithinRegionalCoverage(REGIONAL_COVERAGE_BBOX.minLat, 77.2)).toBe(true);
      expect(isWithinRegionalCoverage(REGIONAL_COVERAGE_BBOX.maxLat, 77.2)).toBe(true);
      // Outside points (e.g. Mumbai, Houston, London)
      expect(isWithinRegionalCoverage(19.076, 72.877)).toBe(false); // Mumbai
      expect(isWithinRegionalCoverage(29.76, -95.36)).toBe(false); // Houston
      expect(isWithinRegionalCoverage(51.5, -0.12)).toBe(false); // London
    });

    it('4.2 formatNominatimAddress formats structured components cleanly', () => {
      const formatted = formatNominatimAddress({
        display_name: 'Complete Raw String',
        address: {
          road: 'Vikas Marg',
          suburb: 'Shakarpur',
          city: 'East Delhi',
          state: 'Delhi',
          postcode: '110092',
        },
      });
      expect(formatted).toBe('Vikas Marg, Shakarpur, East Delhi, Delhi, 110092');
    });
  });

  // =========================================================================
  // 5. NOMINATIM POLICY COMPLIANCE: CACHING & REQUEST SERIALIZATION
  // =========================================================================
  describe('Nominatim Policy Compliance: Caching & Request Serialization', () => {
    it('5.1 caches reverse geocoding responses and serves subsequent calls from cache', async () => {
      const mockData = {
        display_name: 'Alipur Road, Civil Lines, Delhi, India',
        address: { road: 'Alipur Road', suburb: 'Civil Lines', city: 'Delhi' },
      };

      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify(mockData), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

      // Call 1: Fetches from provider
      const res1 = await fetchNominatimReverse(28.67512, 77.22512);
      expect(res1?.address).toBe('Alipur Road, Civil Lines, Delhi');
      expect(fetchSpy).toHaveBeenCalledTimes(1);

      // Call 2: Exact coordinate hit -> cache hit (0 additional fetches)
      const res2 = await fetchNominatimReverse(28.67512, 77.22512);
      expect(res2?.address).toBe('Alipur Road, Civil Lines, Delhi');
      expect(fetchSpy).toHaveBeenCalledTimes(1);

      // Call 3: Coordinates rounded to 5 decimal places (~1.1m) -> cache hit!
      const res3 = await fetchNominatimReverse(28.675124, 77.225121);
      expect(res3?.address).toBe('Alipur Road, Civil Lines, Delhi');
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it('5.2 caches forward search responses and serves identical/normalized queries from cache', async () => {
      const mockSearchData = [
        {
          place_id: 301,
          lat: '28.668',
          lon: '77.232',
          display_name: 'Kashmere Gate, Delhi, India',
          address: { suburb: 'Kashmere Gate', city: 'Delhi' },
          importance: 0.88,
        },
      ];

      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify(mockSearchData), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

      // Call 1: Fetches and caches
      const res1 = await fetchNominatimSearch('Kashmere Gate');
      expect(res1.length).toBe(1);
      expect(res1[0].formatted).toContain('Kashmere Gate');
      expect(fetchSpy).toHaveBeenCalledTimes(1);

      // Call 2: Lowercase, trimmed, whitespace-normalized -> cache hit
      const res2 = await fetchNominatimSearch('  kashmere   gate  ');
      expect(res2.length).toBe(1);
      expect(res2[0].formatted).toContain('Kashmere Gate');
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it('5.3 evicts cache entries after 1-hour TTL expiration', async () => {
      vi.useFakeTimers();

      const mockData = {
        display_name: 'Yamuna Bazar, Delhi, India',
        address: { road: 'Yamuna Bazar', city: 'Delhi' },
      };

      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify(mockData), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

      // Initial lookup at t=0
      await fetchNominatimReverse(28.65, 77.23);
      expect(fetchSpy).toHaveBeenCalledTimes(1);

      // Advance time by 59 minutes (before expiration) -> cache hit
      await vi.advanceTimersByTimeAsync(59 * 60 * 1000);
      await fetchNominatimReverse(28.65, 77.23);
      expect(fetchSpy).toHaveBeenCalledTimes(1);

      // Advance time past 1 hour (TTL expired)
      await vi.advanceTimersByTimeAsync(2 * 60 * 1000); // 61 minutes total
      await fetchNominatimReverse(28.65, 77.23);
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });

    it('5.4 enforces bounded cache capacity and deterministic oldest entry eviction', async () => {
      vi.useFakeTimers();

      const mockData = {
        display_name: 'Test Point, Delhi',
        address: { road: 'Test Point', city: 'Delhi' },
      };

      vi.spyOn(globalThis, 'fetch').mockImplementation(
        async () =>
          new Response(JSON.stringify(mockData), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
      );

      // Insert 501 unique coordinate entries using virtual timer advances
      for (let i = 0; i <= NOMINATIM_MAX_CACHE_SIZE; i++) {
        const p = fetchNominatimReverse(28.0 + i * 0.001, 77.0);
        await vi.advanceTimersByTimeAsync(1000);
        await p;
      }

      const stats = getNominatimCacheStats();
      expect(stats.reverseCacheSize).toBe(NOMINATIM_MAX_CACHE_SIZE);
    });

    it('5.5 does not cache failed or malformed responses as successful entries', async () => {
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(new Response('Server Error', { status: 500 }))
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              display_name: 'Recovered Street, Delhi',
              address: { road: 'Recovered Street', city: 'Delhi' },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          ),
        );

      // Call 1 fails
      const res1 = await fetchNominatimReverse(28.66, 77.22);
      expect(res1).toBeNull();
      expect(getNominatimCacheStats().reverseCacheSize).toBe(0);

      // Call 2 for same coordinates must retry and NOT return cached null
      const res2 = await fetchNominatimReverse(28.66, 77.22);
      expect(res2?.address).toContain('Recovered Street');
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });

    it('5.6 deduplicates duplicate concurrent requests with single-flight execution', async () => {
      const mockData = {
        display_name: 'Mori Gate, Delhi',
        address: { road: 'Mori Gate', city: 'Delhi' },
      };

      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(
        async () =>
          new Response(JSON.stringify(mockData), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
      );

      // 3 concurrent requests for exact same coordinates
      const [r1, r2, r3] = await Promise.all([
        fetchNominatimReverse(28.665, 77.215),
        fetchNominatimReverse(28.665, 77.215),
        fetchNominatimReverse(28.665, 77.215),
      ]);

      expect(r1?.address).toBe('Mori Gate, Delhi');
      expect(r2?.address).toBe('Mori Gate, Delhi');
      expect(r3?.address).toBe('Mori Gate, Delhi');
      // Single-flight ensures only 1 outgoing fetch is dispatched
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it('5.7 enforces shared 1,000ms minimum spacing between consecutive reverse and forward requests', async () => {
      vi.useFakeTimers();

      const fetchTimestamps: number[] = [];
      vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
        fetchTimestamps.push(Date.now());
        return new Response(
          JSON.stringify({
            display_name: 'Timed Location',
            address: { road: 'Timed Location', city: 'Delhi' },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      });

      // Request 1 (Reverse)
      const p1 = fetchNominatimReverse(28.61, 77.21);
      await vi.advanceTimersByTimeAsync(0);
      await p1;

      // Request 2 (Forward search) immediately dispatched
      const p2 = fetchNominatimSearch('Civil Lines Relief');

      // Before 1,000ms, request 2 should be waiting in queue
      expect(fetchTimestamps.length).toBe(1);

      // Advance by 1,000ms
      await vi.advanceTimersByTimeAsync(1000);
      await p2;

      expect(fetchTimestamps.length).toBe(2);
      expect(fetchTimestamps[1] - fetchTimestamps[0]).toBeGreaterThanOrEqual(1000);
    });

    it('5.8 serializes concurrent requests in queue order respecting spacing', async () => {
      vi.useFakeTimers();

      const fetchOrder: string[] = [];
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
        const urlStr = url.toString();
        if (urlStr.includes('lat=28.1')) fetchOrder.push('req1');
        else if (urlStr.includes('lat=28.2')) fetchOrder.push('req2');
        else if (urlStr.includes('lat=28.3')) fetchOrder.push('req3');
        return new Response(
          JSON.stringify({
            display_name: 'Ordered Address',
            address: { road: 'Ordered Road' },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      });

      // 3 concurrent distinct requests
      const p1 = fetchNominatimReverse(28.1, 77.1);
      const p2 = fetchNominatimReverse(28.2, 77.2);
      const p3 = fetchNominatimReverse(28.3, 77.3);

      await vi.advanceTimersByTimeAsync(0);
      expect(fetchOrder).toEqual(['req1']);

      await vi.advanceTimersByTimeAsync(1000);
      expect(fetchOrder).toEqual(['req1', 'req2']);

      await vi.advanceTimersByTimeAsync(1000);
      expect(fetchOrder).toEqual(['req1', 'req2', 'req3']);

      await Promise.all([p1, p2, p3]);
    });

    it('5.9 respects AbortSignal and cancels queued request without calling fetch', async () => {
      vi.useFakeTimers();

      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(
        async () =>
          new Response(
            JSON.stringify({
              display_name: 'Sample Address',
              address: { road: 'Sample' },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          ),
      );

      // Occupy queue with request 1
      const p1 = fetchNominatimReverse(28.51, 77.11);
      await vi.advanceTimersByTimeAsync(0);
      await p1;

      // Queue request 2 with an abort controller
      const abortCtrl = new AbortController();
      const p2 = fetchNominatimReverse(28.52, 77.12, 8000, abortCtrl.signal);

      // Abort while waiting in queue before 1,000ms delay elapses
      abortCtrl.abort();
      await vi.advanceTimersByTimeAsync(1000);

      const res2 = await p2;
      expect(res2).toBeNull();
      // Only request 1 hit fetch; request 2 was cancelled in queue
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it('5.10 clearNominatimCache isolates state completely between tests', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(
          JSON.stringify({
            display_name: 'Iso Address',
            address: { road: 'Iso Road' },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      );

      await fetchNominatimReverse(28.6, 77.2);
      expect(getNominatimCacheStats().reverseCacheSize).toBe(1);

      clearNominatimCache();
      expect(getNominatimCacheStats().reverseCacheSize).toBe(0);
      expect(getNominatimCacheStats().searchCacheSize).toBe(0);
    });
  });
});
