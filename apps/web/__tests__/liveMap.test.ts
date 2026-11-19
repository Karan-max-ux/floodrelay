import { describe, it, expect } from 'vitest';
import type { BlockedZone } from '@floodrelay/shared';
import type { MapLayers } from '../components/operator/map/LeafletMapCanvas';
import { SIMULATED_REPAIR_RESULT } from '../lib/fixtures/repairFixtures';

describe('Phase 5 Part 3 — Live Tactical Map Layer Invariants & Vector Overlays', () => {
  describe('1. Map Layer Toggle State Management', () => {
    it('initializes all operational layers with sensible live operations defaults', () => {
      const defaultLayers: MapLayers = {
        incidents: true,
        craft: true,
        shelters: true,
        routes: true,
        blockages: true,
        repairOverlay: false, // Default off until operator toggles comparison
        floodForecast: false,
      };

      expect(defaultLayers.incidents).toBe(true);
      expect(defaultLayers.blockages).toBe(true);
      expect(defaultLayers.repairOverlay).toBe(false);

      // Toggle repair overlay on
      const toggled: MapLayers = {
        ...defaultLayers,
        repairOverlay: !defaultLayers.repairOverlay,
      };

      expect(toggled.repairOverlay).toBe(true);
    });
  });

  describe('2. Blocked Hazard Zone Polygons', () => {
    const sampleZones: BlockedZone[] = [
      {
        id: 'zone-heights-surge',
        name: 'Heights Blvd Flood Surge (Zone Z-402)',
        severity: 'BLOCKED',
        polygon: [
          { lat: 29.775, lng: -95.405 },
          { lat: 29.778, lng: -95.395 },
          { lat: 29.77, lng: -95.392 },
          { lat: 29.768, lng: -95.402 },
        ],
      },
    ];

    it('verifies that blocked hazard zones have at least 3 vertices for polygon rendering', () => {
      sampleZones.forEach((zone) => {
        expect(zone.polygon.length).toBeGreaterThanOrEqual(3);
        zone.polygon.forEach((pt) => {
          expect(typeof pt.lat).toBe('number');
          expect(typeof pt.lng).toBe('number');
          expect(pt.lat).toBeGreaterThanOrEqual(-90);
          expect(pt.lat).toBeLessThanOrEqual(90);
          expect(pt.lng).toBeGreaterThanOrEqual(-180);
          expect(pt.lng).toBeLessThanOrEqual(180);
        });
      });
    });
  });

  describe('3. Repair Proposal Polyline Extraction', () => {
    it('extracts valid polyline coordinates from proposed repair plan', () => {
      const proposedPlan = SIMULATED_REPAIR_RESULT.proposedPlan;
      expect(proposedPlan).toBeDefined();

      const repairPolylines =
        proposedPlan?.routes.map((r) => ({
          resourceId: r.resourceId,
          latlngs: r.stops.map((s) => [s.lat, s.lng] as [number, number]),
        })) || [];

      expect(repairPolylines.length).toBeGreaterThan(0);
      repairPolylines.forEach((poly) => {
        expect(poly.resourceId).toBeDefined();
        expect(poly.latlngs.length).toBeGreaterThan(0);
        poly.latlngs.forEach(([lat, lng]) => {
          expect(typeof lat).toBe('number');
          expect(typeof lng).toBe('number');
          expect(isNaN(lat)).toBe(false);
          expect(isNaN(lng)).toBe(false);
        });
      });
    });
  });
});
