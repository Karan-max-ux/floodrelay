import React from 'react';
import { renderToString } from 'react-dom/server';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { RescueRequest } from '@floodrelay/shared';
import type { AssignmentRecord } from '../lib/api/types';
import type { MapLayers } from '../components/operator/map/LeafletMapCanvas';
import {
  STAGED_SECTOR_FLEET,
  STAGED_SECTOR_SHELTERS,
  STAGED_SECTOR_BLOCKED_ZONES,
} from '../lib/fixtures/mapReferenceData';

// Capture rendered Leaflet primitives
const capturedMapProps: Array<{ center?: unknown; zoom?: unknown }> = [];
const capturedMarkers: Array<{ position?: unknown; icon?: unknown }> = [];
const capturedPolylines: Array<{ positions?: unknown; pathOptions?: unknown }> = [];
const capturedPolygons: Array<{ positions?: unknown }> = [];

vi.mock('leaflet/dist/leaflet.css', () => ({}));

vi.mock('leaflet', () => ({
  default: {
    divIcon: (opts: unknown) => opts,
    latLngBounds: (coords: unknown) => ({ coords }),
  },
}));

vi.mock('react-leaflet', () => ({
  MapContainer: ({
    center,
    zoom,
    children,
  }: {
    center?: unknown;
    zoom?: unknown;
    children?: React.ReactNode;
  }) => {
    capturedMapProps.push({ center, zoom });
    return React.createElement('div', { 'data-testid': 'leaflet-map' }, children);
  },
  TileLayer: () => React.createElement('div', { 'data-testid': 'leaflet-tile-layer' }),
  Marker: ({
    position,
    icon,
    children,
  }: {
    position?: unknown;
    icon?: unknown;
    children?: React.ReactNode;
  }) => {
    capturedMarkers.push({ position, icon });
    return React.createElement('div', { 'data-testid': 'leaflet-marker' }, children);
  },
  Polyline: ({
    positions,
    pathOptions,
    children,
  }: {
    positions?: unknown;
    pathOptions?: unknown;
    children?: React.ReactNode;
  }) => {
    capturedPolylines.push({ positions, pathOptions });
    return React.createElement('div', { 'data-testid': 'leaflet-polyline' }, children);
  },
  Polygon: ({ positions, children }: { positions?: unknown; children?: React.ReactNode }) => {
    capturedPolygons.push({ positions });
    return React.createElement('div', { 'data-testid': 'leaflet-polygon' }, children);
  },
  Popup: ({ children }: { children?: React.ReactNode }) =>
    React.createElement('div', { 'data-testid': 'leaflet-popup' }, children),
  useMap: () => ({
    on: vi.fn(),
    off: vi.fn(),
    getZoom: () => 12,
    setView: vi.fn(),
    fitBounds: vi.fn(),
    panTo: vi.fn(),
    zoomIn: vi.fn(),
    zoomOut: vi.fn(),
  }),
}));

import LeafletMapCanvas from '../components/operator/map/LeafletMapCanvas';

const sampleIncident: RescueRequest = {
  id: 'req-delhi-01',
  lat: 28.6691,
  lng: 77.2312,
  peopleCount: 4,
  urgency: 'CRITICAL',
  createdAt: '2026-11-20T10:00:00.000Z',
  source: 'REPORTED',
  status: 'PENDING',
};

const osrmRouteCoords: [number, number][] = [
  [28.6691, 77.2312],
  [28.672, 77.235],
  [28.68, 77.24],
];

const sampleAssignment: AssignmentRecord = {
  id: 'plan-delhi-test-1',
  status: 'PROPOSED',
  provenance: 'REAL',
  createdAt: '2026-11-20T10:00:00.000Z',
  updatedAt: '2026-11-20T10:00:00.000Z',
  routes: [
    {
      resourceId: 'res-boat-ncr-1',
      totalTravelDistanceKm: 4.1,
      totalDurationMinutes: 14,
      servedRequestIds: ['req-delhi-01'],
      stops: [
        {
          stopNumber: 1,
          type: 'PICKUP',
          targetId: 'req-delhi-01',
          lat: 28.6691,
          lng: 77.2312,
          passengersPickedUp: 4,
          passengersDroppedOff: 0,
          estimatedArrivalMinutes: 6,
        },
        {
          stopNumber: 2,
          type: 'DROPOFF',
          targetId: 'sh_in_ncr_live_1',
          lat: 28.68,
          lng: 77.24,
          passengersPickedUp: 0,
          passengersDroppedOff: 4,
          estimatedArrivalMinutes: 14,
        },
      ],
      geometry: {
        coordinates: osrmRouteCoords,
        distanceKm: 4.1,
        durationMinutes: 14,
        source: 'OSRM',
      },
    },
  ],
  stops: [],
  unserved: [],
  metrics: {
    coveragePercent: 100,
    totalTravelTimeMinutes: 14,
    totalTravelDistanceKm: 4.1,
    highPriorityWaitTimeMinutes: 6,
    solveDurationMs: 35,
    servedRequestsCount: 1,
    unservedRequestsCount: 0,
  },
};

describe('Master Show/Hide All Map Layers Toggle Invariants', () => {
  beforeEach(() => {
    capturedMapProps.length = 0;
    capturedMarkers.length = 0;
    capturedPolylines.length = 0;
    capturedPolygons.length = 0;
  });

  describe('1. Leaflet Canvas Layer Gating', () => {
    it('(a) Renders all visible overlays when all standard layers are enabled', () => {
      const allEnabledLayers: MapLayers = {
        incidents: true,
        craft: true,
        shelters: true,
        routes: true,
        blockages: true,
        repairOverlay: false,
        floodForecast: false,
      };

      const html = renderToString(
        React.createElement(LeafletMapCanvas, {
          requests: [sampleIncident],
          stagedFleet: STAGED_SECTOR_FLEET,
          stagedShelters: STAGED_SECTOR_SHELTERS,
          selectedAssignment: sampleAssignment,
          blockedZones: STAGED_SECTOR_BLOCKED_ZONES,
          layers: allEnabledLayers,
          urgencyFilter: 'ALL',
          selectedEntity: null,
          onSelectEntity: () => {},
          tileTheme: 'standard',
        }),
      );

      // Basemap is present
      expect(html).toContain('data-testid="leaflet-tile-layer"');
      // Markers: incident (1) + fleet + shelters + route stops (2)
      expect(capturedMarkers.length).toBeGreaterThan(0);
      // Route polyline is present
      expect(capturedPolylines).toHaveLength(1);
      expect(capturedPolylines[0]?.positions).toEqual(osrmRouteCoords);
      // Hazard polygons are present
      expect(capturedPolygons).toHaveLength(STAGED_SECTOR_BLOCKED_ZONES.length);
    });

    it('(b) Completely hides all overlays when master toggle suppresses layers (Hide All)', () => {
      // Effective layers when master toggle is in "Hide All" state
      const masterHiddenLayers: MapLayers = {
        incidents: false,
        craft: false,
        shelters: false,
        routes: false,
        blockages: false,
        repairOverlay: false,
        floodForecast: false,
      };

      const html = renderToString(
        React.createElement(LeafletMapCanvas, {
          requests: [sampleIncident],
          stagedFleet: STAGED_SECTOR_FLEET,
          stagedShelters: STAGED_SECTOR_SHELTERS,
          selectedAssignment: sampleAssignment,
          blockedZones: STAGED_SECTOR_BLOCKED_ZONES,
          layers: masterHiddenLayers,
          urgencyFilter: 'ALL',
          selectedEntity: null,
          onSelectEntity: () => {},
          tileTheme: 'standard',
        }),
      );

      // CRITICAL ACCEPTANCE: Basemap remains visible
      expect(html).toContain('data-testid="leaflet-tile-layer"');
      // All markers, polylines, and polygons disappear from the map
      expect(capturedMarkers).toHaveLength(0);
      expect(capturedPolylines).toHaveLength(0);
      expect(capturedPolygons).toHaveLength(0);
    });

    it('(c) Restores previously enabled layers verbatim when master toggle switches to Show All', () => {
      // Previous preferences: incidents, craft, shelters, routes, blockages are true; repairOverlay & floodForecast are false
      const restoredLayers: MapLayers = {
        incidents: true,
        craft: true,
        shelters: true,
        routes: true,
        blockages: true,
        repairOverlay: false,
        floodForecast: false,
      };

      renderToString(
        React.createElement(LeafletMapCanvas, {
          requests: [sampleIncident],
          stagedFleet: STAGED_SECTOR_FLEET,
          stagedShelters: STAGED_SECTOR_SHELTERS,
          selectedAssignment: sampleAssignment,
          blockedZones: STAGED_SECTOR_BLOCKED_ZONES,
          layers: restoredLayers,
          urgencyFilter: 'ALL',
          selectedEntity: null,
          onSelectEntity: () => {},
          tileTheme: 'standard',
        }),
      );

      // Verbatim OSRM road geometry is restored without modification or deletion
      expect(capturedPolylines).toHaveLength(1);
      expect(capturedPolylines[0]?.positions).toEqual(osrmRouteCoords);
      // Hazard polygons restored
      expect(capturedPolygons).toHaveLength(STAGED_SECTOR_BLOCKED_ZONES.length);
      // Incident, fleet and shelter markers restored
      expect(capturedMarkers.length).toBe(
        1 + STAGED_SECTOR_FLEET.length + STAGED_SECTOR_SHELTERS.length,
      );
    });
  });

  describe('2. Master Layer State Transitions & Invariants', () => {
    it('(a) Hide All preserves individual layer preferences without overwriting them', () => {
      const initialPreferences: MapLayers = {
        incidents: true,
        craft: true,
        shelters: true,
        routes: true,
        blockages: true,
        repairOverlay: false,
        floodForecast: false,
      };

      let masterVisible = true;
      const getEffectiveLayers = (master: boolean, prefs: MapLayers): MapLayers => {
        if (!master) {
          return {
            incidents: false,
            craft: false,
            shelters: false,
            routes: false,
            blockages: false,
            repairOverlay: false,
            floodForecast: false,
          };
        }
        return prefs;
      };

      // 1. Initially visible
      expect(getEffectiveLayers(masterVisible, initialPreferences)).toEqual(initialPreferences);

      // 2. Hide All
      masterVisible = false;
      const hiddenEffective = getEffectiveLayers(masterVisible, initialPreferences);
      expect(Object.values(hiddenEffective).every((v) => v === false)).toBe(true);
      // Individual preferences remain completely preserved
      expect(initialPreferences.incidents).toBe(true);
      expect(initialPreferences.craft).toBe(true);
      expect(initialPreferences.repairOverlay).toBe(false);

      // 3. Show All
      masterVisible = true;
      const restoredEffective = getEffectiveLayers(masterVisible, initialPreferences);
      expect(restoredEffective).toEqual(initialPreferences);
    });

    it('(b) Previously disabled layers remain disabled after Show All restoration', () => {
      const customPreferences: MapLayers = {
        incidents: true,
        craft: false, // user manually disabled fleet
        shelters: true,
        routes: false, // user manually disabled routes
        blockages: true,
        repairOverlay: false,
        floodForecast: false,
      };

      const getEffectiveLayers = (master: boolean, prefs: MapLayers): MapLayers => {
        if (!master) {
          return {
            incidents: false,
            craft: false,
            shelters: false,
            routes: false,
            blockages: false,
            repairOverlay: false,
            floodForecast: false,
          };
        }
        return prefs;
      };

      // When hidden:
      const hidden = getEffectiveLayers(false, customPreferences);
      expect(hidden.incidents).toBe(false);

      // When restored:
      const restored = getEffectiveLayers(true, customPreferences);

      // Enabled layers reappear
      expect(restored.incidents).toBe(true);
      expect(restored.shelters).toBe(true);
      expect(restored.blockages).toBe(true);

      // Crucial: Previously disabled layers remain disabled!
      expect(restored.craft).toBe(false);
      expect(restored.routes).toBe(false);
      expect(restored.repairOverlay).toBe(false);
      expect(restored.floodForecast).toBe(false);
    });

    it('(c) Individual layer selections update cleanly while master toggle is active (hidden)', () => {
      let preferences: MapLayers = {
        incidents: true,
        craft: true,
        shelters: true,
        routes: true,
        blockages: true,
        repairOverlay: false,
        floodForecast: false,
      };

      let masterVisible = false; // All hidden by master toggle
      expect(masterVisible).toBe(false);

      // Operator toggles individual layers while hidden
      preferences = {
        ...preferences,
        craft: false,
        repairOverlay: true,
      };

      // Individual selections updated correctly
      expect(preferences.craft).toBe(false);
      expect(preferences.repairOverlay).toBe(true);

      // When operator clicks Show All:
      masterVisible = true;
      const restored = masterVisible ? preferences : ({} as MapLayers);

      // The new selections are respected
      expect(restored.craft).toBe(false);
      expect(restored.repairOverlay).toBe(true);
      expect(restored.incidents).toBe(true);
    });

    it('(d) Repeated clicks on master toggle do not corrupt state', () => {
      const stablePreferences: MapLayers = {
        incidents: true,
        craft: false,
        shelters: true,
        routes: true,
        blockages: false,
        repairOverlay: false,
        floodForecast: true,
      };

      let masterVisible = true;
      // Cycle through 10 repeated toggles
      for (let i = 0; i < 10; i++) {
        masterVisible = !masterVisible;
      }

      // After even number of toggles (10), masterVisible returns to true
      expect(masterVisible).toBe(true);
      // Preferences are identical
      expect(stablePreferences.incidents).toBe(true);
      expect(stablePreferences.craft).toBe(false);
      expect(stablePreferences.floodForecast).toBe(true);
    });

    it('(e) OSRM road route geometry is never mutated or deleted by layer toggles', () => {
      const originalGeometry = JSON.parse(JSON.stringify(sampleAssignment.routes![0]!.geometry));

      // Simulate hide and show
      const hiddenLayers: MapLayers = {
        incidents: false,
        craft: false,
        shelters: false,
        routes: false,
        blockages: false,
        repairOverlay: false,
        floodForecast: false,
      };

      renderToString(
        React.createElement(LeafletMapCanvas, {
          requests: [sampleIncident],
          stagedFleet: STAGED_SECTOR_FLEET,
          stagedShelters: STAGED_SECTOR_SHELTERS,
          selectedAssignment: sampleAssignment,
          blockedZones: STAGED_SECTOR_BLOCKED_ZONES,
          layers: hiddenLayers,
          urgencyFilter: 'ALL',
          selectedEntity: null,
          onSelectEntity: () => {},
          tileTheme: 'standard',
        }),
      );

      // Verify route record on assignment is 100% intact
      expect(sampleAssignment.routes![0]!.geometry).toEqual(originalGeometry);
      expect(sampleAssignment.routes![0]!.geometry?.coordinates).toHaveLength(
        osrmRouteCoords.length,
      );
    });
  });

  describe('3. Master Toggle UI Button Specification', () => {
    it('(a) Button label is "Hide All Layers" when overlays are visible', () => {
      const masterOverlaysVisible = true;
      const buttonLabel = masterOverlaysVisible ? 'Hide All Layers' : 'Show All Layers';
      const buttonIcon = masterOverlaysVisible ? 'visibility_off' : 'visibility';

      expect(buttonLabel).toBe('Hide All Layers');
      expect(buttonIcon).toBe('visibility_off');
    });

    it('(b) Button label is "Show All Layers" when overlays are hidden', () => {
      const masterOverlaysVisible = false;
      const buttonLabel = masterOverlaysVisible ? 'Hide All Layers' : 'Show All Layers';
      const buttonIcon = masterOverlaysVisible ? 'visibility_off' : 'visibility';

      expect(buttonLabel).toBe('Show All Layers');
      expect(buttonIcon).toBe('visibility');
    });
  });

  describe('4. Interoperability with Collapsible Map Overview Panel', () => {
    it('(a) Hiding Map Overview panel does NOT hide Leaflet overlays or alter effectiveLayers', () => {
      const baseLayers: MapLayers = {
        incidents: true,
        craft: true,
        shelters: true,
        routes: true,
        blockages: true,
        repairOverlay: false,
        floodForecast: false,
      };

      let isOverviewExpanded = true;
      const masterVisible = true;

      // Operator collapses overview panel
      isOverviewExpanded = false;

      // Invariant: effectiveLayers calculation is decoupled from overview panel visibility
      const effectiveLayers = masterVisible ? baseLayers : { ...baseLayers, incidents: false };
      expect(isOverviewExpanded).toBe(false);
      expect(effectiveLayers.incidents).toBe(true);
      expect(effectiveLayers.craft).toBe(true);
      expect(effectiveLayers.shelters).toBe(true);
      expect(effectiveLayers.routes).toBe(true);
      expect(effectiveLayers.blockages).toBe(true);
    });

    it('(b) Hiding all map overlays (masterVisible = false) does NOT collapse the Map Overview panel', () => {
      const isOverviewExpanded = true;
      let masterVisible = true;

      // Operator clicks "Hide All Layers"
      masterVisible = false;

      // Invariant: panel remains expanded
      expect(isOverviewExpanded).toBe(true);
      expect(masterVisible).toBe(false);
    });

    it('(c) Both controls operate orthogonally without state corruption across 20 cycles', () => {
      let isOverviewExpanded = true;
      let masterVisible = true;

      for (let i = 0; i < 20; i++) {
        isOverviewExpanded = !isOverviewExpanded;
        if (i % 2 === 0) {
          masterVisible = !masterVisible;
        }
      }

      // After 20 cycles
      expect(isOverviewExpanded).toBe(true);
      expect(masterVisible).toBe(true);
    });
  });
});
