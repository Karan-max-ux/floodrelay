import React from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { RescueRequest } from '@floodrelay/shared';
import type { AssignmentRecord } from '../lib/api/types';
import {
  STAGED_SECTOR_FLEET,
  STAGED_SECTOR_SHELTERS,
  STAGED_SECTOR_BLOCKED_ZONES,
  TACTICAL_MAP_DEFAULT_CENTRE,
  TACTICAL_MAP_DEFAULT_ZOOM,
} from '../lib/fixtures/mapReferenceData';

// Capture rendered Leaflet primitives so we can inspect exact props & children in SSR/mounted render
const capturedMapProps: Array<{ center?: unknown; zoom?: unknown }> = [];
const capturedMarkers: Array<{ position?: unknown }> = [];
const capturedPolylines: Array<{ positions?: unknown }> = [];
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
  Marker: ({ position, children }: { position?: unknown; children?: React.ReactNode }) => {
    capturedMarkers.push({ position });
    return React.createElement('div', { 'data-testid': 'leaflet-marker' }, children);
  },
  Polyline: ({ positions, children }: { positions?: unknown; children?: React.ReactNode }) => {
    capturedPolylines.push({ positions });
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

describe('Phase 8C — Operator Tactical Map Component Rendering & Provenance Guardrails', () => {
  it('renders MapContainer at centralised Delhi–Yamuna centre with visible SIMULATED reference assets and verbatim backend routes', () => {
    capturedMapProps.length = 0;
    capturedMarkers.length = 0;
    capturedPolylines.length = 0;
    capturedPolygons.length = 0;

    const realIncident: RescueRequest = {
      id: 'req-live-db-01',
      lat: 28.6691,
      lng: 77.2312,
      peopleCount: 5,
      urgency: 'CRITICAL',
      createdAt: '2026-11-15T06:00:00.000Z',
      source: 'REPORTED',
      notes: 'Stranded near ISBT Kashmere Gate',
    };

    const backendOsrmCoords: [number, number][] = [
      [28.65, 77.21],
      [28.6612, 77.2245],
      [28.6691, 77.2312],
      [28.668, 77.232],
    ];

    const assignment: AssignmentRecord = {
      id: 'plan-live-01',
      scenarioId: 'live-delhi-ops',
      status: 'PROPOSED',
      provenance: 'REAL',
      createdAt: '2026-11-15T06:05:00.000Z',
      updatedAt: '2026-11-15T06:05:00.000Z',
      routes: [
        {
          resourceId: 'boat-real-01',
          totalTravelDistanceKm: 4.1,
          totalDurationMinutes: 14,
          servedRequestIds: ['req-live-db-01'],
          stops: [
            {
              stopNumber: 1,
              type: 'PICKUP',
              targetId: 'req-live-db-01',
              lat: 28.6691,
              lng: 77.2312,
              passengersPickedUp: 5,
              passengersDroppedOff: 0,
              estimatedArrivalMinutes: 9,
            },
            {
              stopNumber: 2,
              type: 'DROPOFF',
              targetId: 'shelter-real-01',
              lat: 28.668,
              lng: 77.232,
              passengersPickedUp: 0,
              passengersDroppedOff: 5,
              estimatedArrivalMinutes: 14,
            },
          ],
          geometry: {
            coordinates: backendOsrmCoords,
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
        highPriorityWaitTimeMinutes: 9,
        solveDurationMs: 42,
        servedRequestsCount: 1,
        unservedRequestsCount: 0,
      },
    };

    const html = renderToString(
      React.createElement(LeafletMapCanvas, {
        requests: [realIncident],
        stagedFleet: STAGED_SECTOR_FLEET,
        stagedShelters: STAGED_SECTOR_SHELTERS,
        selectedAssignment: assignment,
        blockedZones: STAGED_SECTOR_BLOCKED_ZONES,
        layers: {
          incidents: true,
          craft: true,
          shelters: true,
          routes: true,
          blockages: true,
          repairOverlay: false,
          floodForecast: false,
        },
        urgencyFilter: 'ALL',
        selectedEntity: null,
        onSelectEntity: () => {},
        tileTheme: 'standard',
      }),
    );

    // 1. Initial centre matches centralised REGION_CONFIG tactical demo centre
    expect(capturedMapProps).toHaveLength(1);
    expect(capturedMapProps[0]?.center).toEqual(TACTICAL_MAP_DEFAULT_CENTRE);
    expect(capturedMapProps[0]?.zoom).toBe(TACTICAL_MAP_DEFAULT_ZOOM);

    // 2. Incident + fleet + shelter markers all render at exact coordinates
    expect(capturedMarkers).toHaveLength(
      1 + STAGED_SECTOR_FLEET.length + STAGED_SECTOR_SHELTERS.length,
    );
    expect(capturedMarkers[0]?.position).toEqual([realIncident.lat, realIncident.lng]);

    // 3. Backend-supplied OSRM route geometry is rendered verbatim without rebasing
    expect(capturedPolylines).toHaveLength(1);
    expect(capturedPolylines[0]?.positions).toEqual(backendOsrmCoords);

    // 4. Reference blocked zone polygon renders at exact vertices
    expect(capturedPolygons).toHaveLength(STAGED_SECTOR_BLOCKED_ZONES.length);
    expect(capturedPolygons[0]?.positions).toEqual(
      STAGED_SECTOR_BLOCKED_ZONES[0]!.polygon.map((p) => [p.lat, p.lng]),
    );

    // 5. Provenance labels & no false active shelter status
    expect(html).toContain('REAL / REPORTED');
    expect(html).toContain('SIMULATED • Reference Fleet (Demo Only)');
    expect(html).toContain('SIMULATED • Unverified Reference');
    expect(html).toContain('SIMULATED • Synthetic Reference Hazard');
    expect(html).not.toContain('Open — Primary Relief Camp');
    expect(html).not.toContain('Open — Community Relief Centre');
  });
});
