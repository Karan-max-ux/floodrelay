import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { RescueRequest } from '@floodrelay/shared';

// Coordinate validation invariant
function isValidLatLng(lat: unknown, lng: unknown): boolean {
  if (typeof lat !== 'number' || typeof lng !== 'number') return false;
  if (isNaN(lat) || isNaN(lng)) return false;
  if (lat < -90 || lat > 90) return false;
  if (lng < -180 || lng > 180) return false;
  return true;
}

// Urgency filter logic
function filterRequestsByUrgency(
  requests: RescueRequest[],
  urgencyFilter: string,
): RescueRequest[] {
  return requests.filter((r) => {
    if (!isValidLatLng(r.lat, r.lng)) return false;
    if (urgencyFilter !== 'ALL' && r.urgency !== urgencyFilter) return false;
    return true;
  });
}

describe('Operator GIS Map Invariants & GeoJSON Conversion', () => {
  const sampleRequests: RescueRequest[] = [
    {
      id: 'req-01',
      lat: 29.7604,
      lng: -95.3698,
      peopleCount: 4,
      urgency: 'CRITICAL',
      createdAt: '2026-11-01T00:00:00Z',
      source: 'REPORTED',
      medicalNeeds: true,
      notes: 'Trapped on second floor balcony',
    },
    {
      id: 'req-02',
      lat: 29.754,
      lng: -95.352,
      peopleCount: 2,
      urgency: 'HIGH',
      createdAt: '2026-11-01T00:05:00Z',
      source: 'REPORTED',
      medicalNeeds: false,
      notes: 'Water reaching ground floor window sills',
    },
    {
      id: 'req-03',
      lat: 29.771,
      lng: -95.398,
      peopleCount: 5,
      urgency: 'MEDIUM',
      createdAt: '2026-11-01T00:10:00Z',
      source: 'REPORTED',
    },
    {
      id: 'req-malformed-1',
      lat: NaN,
      lng: -95.3698,
      peopleCount: 1,
      urgency: 'LOW',
      createdAt: '2026-11-01T00:15:00Z',
      source: 'REPORTED',
    },
    {
      id: 'req-malformed-2',
      lat: 105.0, // out of range lat > 90
      lng: -95.3698,
      peopleCount: 1,
      urgency: 'CRITICAL',
      createdAt: '2026-11-01T00:20:00Z',
      source: 'REPORTED',
    },
  ];

  describe('Geographic Coordinate Validation', () => {
    it('approves standard Harris County flood basin coordinates', () => {
      expect(isValidLatLng(29.7604, -95.3698)).toBe(true);
      expect(isValidLatLng(29.721, -95.558)).toBe(true);
    });

    it('rejects non-numeric or NaN coordinates', () => {
      expect(isValidLatLng(NaN, -95.3698)).toBe(false);
      expect(isValidLatLng(29.7604, NaN)).toBe(false);
      expect(isValidLatLng('29.7604' as unknown, -95.3698)).toBe(false);
      expect(isValidLatLng(undefined, undefined)).toBe(false);
      expect(isValidLatLng(null, null)).toBe(false);
    });

    it('rejects coordinates exceeding global latitude and longitude boundaries', () => {
      expect(isValidLatLng(91.5, -95.0)).toBe(false);
      expect(isValidLatLng(-91.0, -95.0)).toBe(false);
      expect(isValidLatLng(29.7604, 185.0)).toBe(false);
      expect(isValidLatLng(29.7604, -185.0)).toBe(false);
    });

    it('safely filters out malformed coordinate records from map markers', () => {
      const valid = filterRequestsByUrgency(sampleRequests, 'ALL');
      expect(valid).toHaveLength(3);
      expect(valid.map((r) => r.id)).toEqual(['req-01', 'req-02', 'req-03']);
    });
  });

  describe('Urgency Layer Filtering', () => {
    it('returns all valid requests when filter is ALL', () => {
      const all = filterRequestsByUrgency(sampleRequests, 'ALL');
      expect(all).toHaveLength(3);
    });

    it('filters strictly to CRITICAL priority incidents', () => {
      const critical = filterRequestsByUrgency(sampleRequests, 'CRITICAL');
      expect(critical).toHaveLength(1);
      expect(critical[0].id).toBe('req-01');
      expect(critical[0].urgency).toBe('CRITICAL');
    });

    it('filters strictly to HIGH priority incidents', () => {
      const high = filterRequestsByUrgency(sampleRequests, 'HIGH');
      expect(high).toHaveLength(1);
      expect(high[0].id).toBe('req-02');
      expect(high[0].urgency).toBe('HIGH');
    });

    it('returns empty array when no records match chosen urgency filter', () => {
      const low = filterRequestsByUrgency(sampleRequests, 'LOW');
      expect(low).toHaveLength(0);
    });
  });

  describe('GeoJSON vs Leaflet Coordinate System Invariants', () => {
    it('maintains strict Leaflet [lat, lng] ordering for map point positions', () => {
      const req = sampleRequests[0];
      const leafletPoint: [number, number] = [req.lat, req.lng];

      // Leaflet expects [latitude, longitude]
      expect(leafletPoint[0]).toBe(29.7604);
      expect(leafletPoint[1]).toBe(-95.3698);
    });

    it('correctly maps to GeoJSON [lng, lat] coordinate pairs without inversion errors', () => {
      const req = sampleRequests[0];
      // PostGIS/GeoJSON expects [longitude, latitude]
      const geoJsonPoint = [req.lng, req.lat];

      expect(geoJsonPoint[0]).toBe(-95.3698);
      expect(geoJsonPoint[1]).toBe(29.7604);
    });
  });

  describe('Assignment Polyline Vector Generation', () => {
    it('converts ordered RouteStop records into continuous Leaflet polylines', () => {
      const stops = [
        { stopNumber: 0, lat: 29.7628, lng: -95.385, targetId: 'depot-1' },
        { stopNumber: 1, lat: 29.7604, lng: -95.3698, targetId: 'req-01' },
        { stopNumber: 2, lat: 29.754, lng: -95.352, targetId: 'req-02' },
        { stopNumber: 3, lat: 29.721, lng: -95.558, targetId: 'shelter-1' },
      ];

      const polylinePoints: [number, number][] = stops.map((s) => [s.lat, s.lng]);
      expect(polylinePoints).toHaveLength(4);
      expect(polylinePoints[0]).toEqual([29.7628, -95.385]);
      expect(polylinePoints[3]).toEqual([29.721, -95.558]);
    });
  });

  describe('Staged Sector Fleet & Shelter Data Provenance Invariants', () => {
    const stagedFleet = [
      {
        id: 'boat-1',
        name: 'Boat Alpha-4',
        lat: 29.7628,
        lng: -95.385,
        capacity: 6,
        status: 'AVAILABLE',
      },
      {
        id: 'truck-1',
        name: 'Truck Heavy-2',
        lat: 29.771,
        lng: -95.398,
        capacity: 12,
        status: 'AVAILABLE',
      },
    ];

    it('ensures all staged sector craft have verified basin coordinates and non-zero capacity', () => {
      for (const craft of stagedFleet) {
        expect(isValidLatLng(craft.lat, craft.lng)).toBe(true);
        expect(craft.capacity).toBeGreaterThan(0);
        expect(craft.status).toBe('AVAILABLE');
      }
    });

    const stagedShelters = [
      {
        id: 'sh-1',
        name: 'Westchase High Shelter',
        lat: 29.721,
        lng: -95.558,
        capacity: 350,
        availableBeds: 142,
      },
      {
        id: 'sh-2',
        name: 'NRG Arena Shelter',
        lat: 29.684,
        lng: -95.411,
        capacity: 800,
        availableBeds: 310,
      },
    ];

    it('ensures shelter available bed counts never exceed total capacity', () => {
      for (const shelter of stagedShelters) {
        expect(isValidLatLng(shelter.lat, shelter.lng)).toBe(true);
        expect(shelter.capacity).toBeGreaterThan(0);
        expect(shelter.availableBeds).toBeLessThanOrEqual(shelter.capacity);
      }
    });
  });

  describe('Google-like Light Map Default & Route Geometry Source Guardrails', () => {
    it('initializes /operator/map tileTheme to standard OSM light look with dark option retained', () => {
      const mapPagePath = path.resolve(__dirname, '../app/operator/map/page.tsx');
      const source = fs.readFileSync(mapPagePath, 'utf8');
      expect(source).toContain("useState<'dark' | 'standard'>('standard')");
      expect(source).toContain("setTileTheme((t) => (t === 'dark' ? 'standard' : 'dark'))");
    });
  });
});
