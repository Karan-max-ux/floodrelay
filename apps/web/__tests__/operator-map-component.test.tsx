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

  it('renders NO polyline in ROAD mode when road vehicle OSRM routing fails (Confirmed Failure Policy)', () => {
    capturedPolylines.length = 0;

    const realIncident: RescueRequest = {
      id: 'req-live-02',
      lat: 28.5476,
      lng: 77.2013,
      peopleCount: 2,
      urgency: 'HIGH',
      createdAt: '2026-11-15T06:00:00.000Z',
      source: 'REPORTED',
    };

    const failedRoadAssignment: AssignmentRecord = {
      id: 'plan-failed-osrm',
      status: 'PROPOSED',
      provenance: 'REAL',
      createdAt: '2026-11-15T06:00:00.000Z',
      updatedAt: '2026-11-15T06:00:00.000Z',
      routes: [
        {
          resourceId: 'res-truck-01',
          totalTravelDistanceKm: 15.2,
          totalDurationMinutes: 30,
          servedRequestIds: ['req-live-02'],
          stops: [
            {
              stopNumber: 1,
              type: 'PICKUP',
              targetId: 'req-live-02',
              lat: 28.5476,
              lng: 77.2013,
              passengersPickedUp: 2,
              passengersDroppedOff: 0,
              estimatedArrivalMinutes: 10,
            },
            {
              stopNumber: 2,
              type: 'DROPOFF',
              targetId: 'sh-1',
              lat: 28.667,
              lng: 77.228,
              passengersPickedUp: 0,
              passengersDroppedOff: 2,
              estimatedArrivalMinutes: 30,
            },
          ],
          geometry: {
            source: 'STRAIGHT_LINE',
            distanceKm: 15.2,
            durationMinutes: 30,
            coordinates: [
              [28.5476, 77.2013],
              [28.667, 77.228],
            ],
            legs: [
              {
                fromStopNumber: 1,
                toStopNumber: 2,
                distanceKm: 15.2,
                durationMinutes: 30,
                source: 'STRAIGHT_LINE',
                coordinates: [
                  [28.5476, 77.2013],
                  [28.667, 77.228],
                ],
              },
            ],
          },
        },
      ],
    };

    renderToString(
      React.createElement(LeafletMapCanvas, {
        requests: [realIncident],
        stagedFleet: STAGED_SECTOR_FLEET,
        stagedShelters: STAGED_SECTOR_SHELTERS,
        selectedAssignment: failedRoadAssignment,
        layers: {
          incidents: true,
          craft: false,
          shelters: false,
          routes: true,
          blockages: false,
          repairOverlay: false,
          floodForecast: false,
        },
        urgencyFilter: 'ALL',
        selectedEntity: null,
        onSelectEntity: () => {},
        tileTheme: 'standard',
        routeMode: 'ROAD',
      }),
    );

    // In ROAD mode, failed OSRM leg must NOT render a polyline or fallback dashed line
    expect(capturedPolylines).toHaveLength(0);
  });

  it('renders straight-line polyline when switched to DIRECT mode', () => {
    capturedPolylines.length = 0;

    const realIncident: RescueRequest = {
      id: 'req-live-03',
      lat: 28.5476,
      lng: 77.2013,
      peopleCount: 2,
      urgency: 'HIGH',
      createdAt: '2026-11-15T06:00:00.000Z',
      source: 'REPORTED',
    };

    const assignment: AssignmentRecord = {
      id: 'plan-direct-01',
      status: 'PROPOSED',
      provenance: 'REAL',
      createdAt: '2026-11-15T06:00:00.000Z',
      updatedAt: '2026-11-15T06:00:00.000Z',
      routes: [
        {
          resourceId: 'res-truck-01',
          totalTravelDistanceKm: 15.2,
          totalDurationMinutes: 30,
          servedRequestIds: ['req-live-03'],
          stops: [
            {
              stopNumber: 1,
              type: 'PICKUP',
              targetId: 'req-live-03',
              lat: 28.5476,
              lng: 77.2013,
              passengersPickedUp: 2,
              passengersDroppedOff: 0,
              estimatedArrivalMinutes: 10,
            },
            {
              stopNumber: 2,
              type: 'DROPOFF',
              targetId: 'sh-1',
              lat: 28.667,
              lng: 77.228,
              passengersPickedUp: 0,
              passengersDroppedOff: 2,
              estimatedArrivalMinutes: 30,
            },
          ],
        },
      ],
    };

    const html = renderToString(
      React.createElement(LeafletMapCanvas, {
        requests: [realIncident],
        stagedFleet: STAGED_SECTOR_FLEET,
        stagedShelters: STAGED_SECTOR_SHELTERS,
        selectedAssignment: assignment,
        layers: {
          incidents: true,
          craft: false,
          shelters: false,
          routes: true,
          blockages: false,
          repairOverlay: false,
          floodForecast: false,
        },
        urgencyFilter: 'ALL',
        selectedEntity: null,
        onSelectEntity: () => {},
        tileTheme: 'standard',
        routeMode: 'DIRECT',
      }),
    );

    // In DIRECT mode, straight-line segment is rendered connecting the stops
    expect(capturedPolylines).toHaveLength(1);
    expect(capturedPolylines[0]?.positions).toEqual([
      [28.5476, 77.2013],
      [28.667, 77.228],
    ]);
    expect(html).toContain('Direct / Air Straight-Line');
  });

  it('highlights the route serving the selected incident on the map', () => {
    capturedPolylines.length = 0;

    const incidentA: RescueRequest = {
      id: 'req-A',
      lat: 28.55,
      lng: 77.21,
      peopleCount: 1,
      urgency: 'HIGH',
      createdAt: '2026-11-15T06:00:00.000Z',
      source: 'REPORTED',
    };

    const multiRouteAssignment: AssignmentRecord = {
      id: 'plan-multi-01',
      status: 'PROPOSED',
      provenance: 'REAL',
      createdAt: '2026-11-15T06:00:00.000Z',
      updatedAt: '2026-11-15T06:00:00.000Z',
      routes: [
        {
          resourceId: 'truck-A',
          totalTravelDistanceKm: 5.0,
          totalDurationMinutes: 10,
          servedRequestIds: ['req-A'],
          stops: [
            {
              stopNumber: 1,
              type: 'PICKUP',
              targetId: 'req-A',
              lat: 28.55,
              lng: 77.21,
              passengersPickedUp: 1,
              passengersDroppedOff: 0,
              estimatedArrivalMinutes: 5,
            },
            {
              stopNumber: 2,
              type: 'DROPOFF',
              targetId: 'sh-1',
              lat: 28.66,
              lng: 77.22,
              passengersPickedUp: 0,
              passengersDroppedOff: 1,
              estimatedArrivalMinutes: 10,
            },
          ],
          geometry: {
            source: 'OSRM',
            coordinates: [
              [28.55, 77.21],
              [28.66, 77.22],
            ],
            distanceKm: 5.0,
            durationMinutes: 10,
          },
        },
        {
          resourceId: 'truck-B',
          totalTravelDistanceKm: 6.0,
          totalDurationMinutes: 12,
          servedRequestIds: ['req-B'],
          stops: [
            {
              stopNumber: 1,
              type: 'PICKUP',
              targetId: 'req-B',
              lat: 28.7,
              lng: 77.25,
              passengersPickedUp: 2,
              passengersDroppedOff: 0,
              estimatedArrivalMinutes: 6,
            },
            {
              stopNumber: 2,
              type: 'DROPOFF',
              targetId: 'sh-1',
              lat: 28.66,
              lng: 77.22,
              passengersPickedUp: 0,
              passengersDroppedOff: 2,
              estimatedArrivalMinutes: 12,
            },
          ],
          geometry: {
            source: 'OSRM',
            coordinates: [
              [28.7, 77.25],
              [28.66, 77.22],
            ],
            distanceKm: 6.0,
            durationMinutes: 12,
          },
        },
      ],
    };

    const html = renderToString(
      React.createElement(LeafletMapCanvas, {
        requests: [incidentA],
        stagedFleet: STAGED_SECTOR_FLEET,
        stagedShelters: STAGED_SECTOR_SHELTERS,
        selectedAssignment: multiRouteAssignment,
        layers: {
          incidents: true,
          craft: false,
          shelters: false,
          routes: true,
          blockages: false,
          repairOverlay: false,
          floodForecast: false,
        },
        urgencyFilter: 'ALL',
        selectedEntity: { type: 'incident', item: incidentA },
        onSelectEntity: () => {},
        tileTheme: 'standard',
        routeMode: 'ROAD',
      }),
    );

    // Both routes rendered, but the selected incident's route popup indicates it serves the request
    expect(capturedPolylines).toHaveLength(2);
    expect(html).toContain('Serves Selected Request');
  });

  it('renders Google Maps-style repair route with casing beneath main polyline, start/dest markers, and popup', () => {
    capturedMapProps.length = 0;
    capturedMarkers.length = 0;
    capturedPolylines.length = 0;
    capturedPolygons.length = 0;

    const repairAssignment: AssignmentRecord = {
      id: 'prop-repair-e2e-01',
      scenarioId: 'delhi-yamuna-repaired',
      status: 'PROPOSED',
      createdAt: '2026-11-20T00:00:00.000Z',
      updatedAt: '2026-11-20T00:00:00.000Z',
      routes: [
        {
          resourceId: 'res_truck_ncr_1',
          servedRequestIds: ['req-repair-01'],
          totalTravelDistanceKm: 6.2,
          totalDurationMinutes: 12.4,
          stops: [
            {
              stopNumber: 1,
              type: 'DEPOT',
              targetId: 'depot_central',
              lat: 28.65,
              lng: 77.23,
              passengersPickedUp: 0,
              passengersDroppedOff: 0,
              estimatedArrivalMinutes: 0,
            },
            {
              stopNumber: 2,
              type: 'PICKUP',
              targetId: 'req-repair-01',
              lat: 28.66,
              lng: 77.24,
              passengersPickedUp: 3,
              passengersDroppedOff: 0,
              estimatedArrivalMinutes: 6.2,
            },
            {
              stopNumber: 3,
              type: 'DROPOFF',
              targetId: 'shelter_north',
              lat: 28.67,
              lng: 77.25,
              passengersPickedUp: 0,
              passengersDroppedOff: 3,
              estimatedArrivalMinutes: 12.4,
            },
          ],
          geometry: {
            source: 'OSRM',
            coordinates: [
              [28.65, 77.23],
              [28.655, 77.235],
              [28.66, 77.24],
              [28.665, 77.245],
              [28.67, 77.25],
            ],
            distanceKm: 6.2,
            durationMinutes: 12.4,
          },
        },
      ],
    };

    const html = renderToString(
      React.createElement(LeafletMapCanvas, {
        requests: [],
        stagedFleet: STAGED_SECTOR_FLEET,
        stagedShelters: STAGED_SECTOR_SHELTERS,
        selectedAssignment: null,
        selectedRepairAssignment: repairAssignment,
        activeRepairRouteIndex: 0,
        layers: {
          incidents: false,
          craft: false,
          shelters: false,
          routes: false,
          blockages: false,
          repairOverlay: true,
          floodForecast: false,
        },
        urgencyFilter: 'ALL',
        selectedEntity: null,
        onSelectEntity: () => {},
        tileTheme: 'standard',
        routeMode: 'ROAD',
      }),
    );

    // Two polylines rendered for the road route: 1 casing + 1 main line
    expect(capturedPolylines).toHaveLength(2);

    const casing = capturedPolylines[0]!;
    const main = capturedPolylines[1]!;

    // Casing: white, slightly wider (weight 9), rounded joins
    expect((casing.pathOptions as Record<string, unknown>).color).toBe('#ffffff');
    expect((casing.pathOptions as Record<string, unknown>).weight).toBe(9);
    expect((casing.pathOptions as Record<string, unknown>).lineCap).toBe('round');

    // Main line: Google Maps solid blue (#4285F4), weight 5, full opacity, solid (no dashArray)
    expect((main.pathOptions as Record<string, unknown>).color).toBe('#4285F4');
    expect((main.pathOptions as Record<string, unknown>).weight).toBe(5);
    expect((main.pathOptions as Record<string, unknown>).opacity).toBe(1.0);
    expect((main.pathOptions as Record<string, unknown>).dashArray).toBeUndefined();

    // Start, intermediate numbered, and destination markers rendered
    expect(capturedMarkers).toHaveLength(3);
    expect(capturedMarkers[0]!.position).toEqual([28.65, 77.23]); // Depot start
    expect(capturedMarkers[1]!.position).toEqual([28.66, 77.24]); // Intermediate pickup (#2)
    expect(capturedMarkers[2]!.position).toEqual([28.67, 77.25]); // Shelter destination

    // Popup text contains Google Maps style repair details
    expect(html).toContain('Google Maps-Style Road Route');
    expect(html).toContain('Active Repair Route');
    expect(html).toContain('res_truck_ncr_1');
  });

  it('renders zero repair polylines when no repair assignment is present (clean empty state)', () => {
    capturedMapProps.length = 0;
    capturedMarkers.length = 0;
    capturedPolylines.length = 0;
    capturedPolygons.length = 0;

    renderToString(
      React.createElement(LeafletMapCanvas, {
        requests: [],
        stagedFleet: STAGED_SECTOR_FLEET,
        stagedShelters: STAGED_SECTOR_SHELTERS,
        selectedAssignment: null,
        selectedRepairAssignment: null,
        activeRepairRouteIndex: 0,
        layers: {
          incidents: false,
          craft: false,
          shelters: false,
          routes: false,
          blockages: false,
          repairOverlay: true,
          floodForecast: false,
        },
        urgencyFilter: 'ALL',
        selectedEntity: null,
        onSelectEntity: () => {},
        tileTheme: 'standard',
        routeMode: 'ROAD',
      }),
    );

    // Absolutely zero synthetic polylines or fake markers drawn
    expect(capturedPolylines).toHaveLength(0);
    expect(capturedMarkers).toHaveLength(0);
  });

  it('renders road truck route with solid polyline and boat route with dashed transit vector in ROAD mode', () => {
    capturedMapProps.length = 0;
    capturedMarkers.length = 0;
    capturedPolylines.length = 0;
    capturedPolygons.length = 0;

    const assignment: unknown = {
      id: 'assign-mixed-test',
      status: 'PROPOSED',
      routes: [
        {
          resourceId: 'res_in_ncr_live_1',
          servedRequestIds: ['req-boat-incident'],
          stops: [
            {
              stopNumber: 0,
              type: 'DEPOT',
              targetId: 'depot',
              lat: 28.66,
              lng: 77.24,
              passengersPickedUp: 0,
              passengersDroppedOff: 0,
              estimatedArrivalMinutes: 0,
            },
            {
              stopNumber: 1,
              type: 'PICKUP',
              targetId: 'req-boat-incident',
              lat: 28.65,
              lng: 77.23,
              passengersPickedUp: 3,
              passengersDroppedOff: 0,
              estimatedArrivalMinutes: 5,
            },
            {
              stopNumber: 2,
              type: 'DROPOFF',
              targetId: 'sh_in_ncr_live_1',
              lat: 28.667,
              lng: 77.228,
              passengersPickedUp: 0,
              passengersDroppedOff: 3,
              estimatedArrivalMinutes: 10.55,
            },
          ],
          geometry: {
            source: 'STRAIGHT_LINE',
            distanceKm: 4.39,
            durationMinutes: 10.55,
            coordinates: [
              [28.66, 77.24],
              [28.65, 77.23],
              [28.667, 77.228],
            ],
          },
        },
        {
          resourceId: 'res_truck_ncr_1',
          servedRequestIds: ['req-fe0bd693'],
          stops: [
            {
              stopNumber: 0,
              type: 'DEPOT',
              targetId: 'depot',
              lat: 28.665,
              lng: 77.218,
              passengersPickedUp: 0,
              passengersDroppedOff: 0,
              estimatedArrivalMinutes: 0,
            },
            {
              stopNumber: 1,
              type: 'PICKUP',
              targetId: 'req-fe0bd693',
              lat: 28.612933,
              lng: 77.229493,
              passengersPickedUp: 3,
              passengersDroppedOff: 0,
              estimatedArrivalMinutes: 17.11,
            },
            {
              stopNumber: 2,
              type: 'DROPOFF',
              targetId: 'sh_in_ncr_live_1',
              lat: 28.667,
              lng: 77.228,
              passengersPickedUp: 0,
              passengersDroppedOff: 3,
              estimatedArrivalMinutes: 32.33,
            },
          ],
          geometry: {
            source: 'OSRM',
            distanceKm: 16.16,
            durationMinutes: 32.33,
            coordinates: [
              [28.665, 77.218],
              [28.64, 77.22],
              [28.612933, 77.229493],
              [28.65, 77.225],
              [28.667, 77.228],
            ],
          },
        },
      ],
      metrics: {
        servedRequestsCount: 2,
        unservedRequestsCount: 0,
        totalTravelTimeMinutes: 42.88,
        coveragePercent: 100,
      },
      unserved: [],
    };

    renderToString(
      React.createElement(LeafletMapCanvas, {
        requests: [
          {
            id: 'req-fe0bd693',
            lat: 28.612933,
            lng: 77.229493,
            peopleCount: 3,
            urgency: 'CRITICAL',
            createdAt: '2026-11-22T00:00:00.000Z',
            source: 'REPORTED',
          },
        ],
        stagedFleet: [
          {
            id: 'res_truck_ncr_1',
            name: 'Delhi Rescue Truck 1',
            type: 'HIGH_WATER_VEHICLE',
            capacity: 10,
            speedKmH: 30,
            lat: 28.665,
            lng: 77.218,
            depotName: 'Kashmere Gate Depot',
            source: 'REAL',
            status: 'AVAILABLE',
          },
          {
            id: 'res_in_ncr_live_1',
            name: 'Delhi Boat Live 1',
            type: 'BOAT',
            capacity: 6,
            speedKmH: 25,
            lat: 28.66,
            lng: 77.24,
            depotName: 'Yamuna Ghat Depot',
            source: 'REAL',
            status: 'AVAILABLE',
          },
        ],
        stagedShelters: STAGED_SECTOR_SHELTERS,
        selectedAssignment: assignment as unknown as AssignmentRecord,
        selectedRepairAssignment: null,
        activeRepairRouteIndex: 0,
        layers: {
          incidents: true,
          craft: true,
          shelters: true,
          routes: true,
          blockages: false,
          repairOverlay: false,
          floodForecast: false,
        },
        urgencyFilter: 'ALL',
        selectedEntity: {
          type: 'incident',
          item: {
            id: 'req-fe0bd693',
            lat: 28.612933,
            lng: 77.229493,
            peopleCount: 3,
            urgency: 'CRITICAL',
            createdAt: '2026-11-22T00:00:00.000Z',
            source: 'REPORTED',
          },
        },
        onSelectEntity: () => {},
        tileTheme: 'standard',
        routeMode: 'ROAD',
      }),
    );

    // Expect 2 route polylines rendered: 1 boat (dashed) + 1 truck (solid)
    expect(capturedPolylines).toHaveLength(2);

    const boatPolyline = capturedPolylines.find(
      (p) => (p.pathOptions as Record<string, unknown>).dashArray !== undefined,
    );
    const truckPolyline = capturedPolylines.find(
      (p) => (p.pathOptions as Record<string, unknown>).dashArray === undefined,
    );

    expect(boatPolyline).toBeDefined();
    expect(truckPolyline).toBeDefined();

    // Truck polyline is highlighted because it serves the selected incident req-fe0bd693
    expect((truckPolyline!.pathOptions as Record<string, unknown>).color).toBe('#1d4ed8');
    expect((truckPolyline!.pathOptions as Record<string, unknown>).opacity).toBe(1.0);

    // Boat polyline is dimmed because it serves another request
    expect((boatPolyline!.pathOptions as Record<string, unknown>).opacity).toBe(0.35);
  });
});
