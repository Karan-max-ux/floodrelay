import { describe, it, expect } from 'vitest';
import type { ResourceRoute } from '@floodrelay/shared';
import {
  extractRouteLatLngs,
  formatDistanceKm,
  formatDurationMinutes,
  getRouteDisplayMetrics,
  getRoutePolylineStyle,
  getRouteSegmentsForRendering,
  getRouteSourceLabel,
  summarizeAssignmentRoutes,
} from '../components/operator/map/routeDisplay';

function makeBaseRoute(overrides: Partial<ResourceRoute> = {}): ResourceRoute {
  return {
    resourceId: 'res-truck-01',
    stops: [
      {
        stopNumber: 1,
        type: 'PICKUP',
        targetId: 'req-1',
        lat: 28.67,
        lng: 77.22,
        passengersPickedUp: 3,
        passengersDroppedOff: 0,
        estimatedArrivalMinutes: 6,
      },
      {
        stopNumber: 2,
        type: 'DROPOFF',
        targetId: 'sh-1',
        lat: 28.7,
        lng: 77.25,
        passengersPickedUp: 0,
        passengersDroppedOff: 3,
        estimatedArrivalMinutes: 14,
      },
    ],
    totalTravelDistanceKm: 8.83,
    totalDurationMinutes: 14,
    servedRequestIds: ['req-1'],
    ...overrides,
  };
}

describe('routeDisplay map & assignment presentation helpers', () => {
  it('prefers Task B OSRM geometry coordinates when available and falls back to stop points otherwise', () => {
    const roadRoute = makeBaseRoute({
      geometry: {
        coordinates: [
          [28.655, 77.21],
          [28.662, 77.216],
          [28.67, 77.22],
          [28.685, 77.235],
          [28.7, 77.25],
        ],
        distanceKm: 8.83,
        durationMinutes: 13.2,
        source: 'OSRM',
      },
    });

    expect(extractRouteLatLngs(roadRoute)).toHaveLength(5);
    expect(extractRouteLatLngs(makeBaseRoute())).toEqual([
      [28.67, 77.22],
      [28.7, 77.25],
    ]);
  });

  it('styles OSRM road routes solid Google-blue while keeping STRAIGHT_LINE routes dashed', () => {
    const roadStyle = getRoutePolylineStyle('OSRM', 'standard');
    const straightStyle = getRoutePolylineStyle('STRAIGHT_LINE', 'standard');
    const mixedStyle = getRoutePolylineStyle('MIXED', 'standard');

    expect(roadStyle.color).toBe('#1a73e8');
    expect(roadStyle.dashArray).toBeUndefined();
    expect(roadStyle.weight).toBeGreaterThan(straightStyle.weight);

    expect(straightStyle.dashArray).toBe('6, 8');
    expect(mixedStyle.dashArray).toBe('10, 5');
  });

  it('splits MIXED routes into per-leg OSRM vs STRAIGHT_LINE segments so boat/outside legs stay dashed', () => {
    const mixedRoute = makeBaseRoute({
      geometry: {
        coordinates: [
          [28.655, 77.21],
          [28.662, 77.216],
          [28.67, 77.22],
          [28.85, 77.45],
        ],
        distanceKm: 28.4,
        durationMinutes: 42.5,
        source: 'MIXED',
        legs: [
          {
            fromStopNumber: 0,
            toStopNumber: 1,
            distanceKm: 4.1,
            durationMinutes: 7.2,
            source: 'OSRM',
            coordinates: [
              [28.655, 77.21],
              [28.662, 77.216],
              [28.67, 77.22],
            ],
          },
          {
            fromStopNumber: 1,
            toStopNumber: 2,
            distanceKm: 24.3,
            durationMinutes: 35.3,
            source: 'STRAIGHT_LINE',
            coordinates: [
              [28.67, 77.22],
              [28.85, 77.45],
            ],
          },
        ],
      },
    });

    const segments = getRouteSegmentsForRendering(mixedRoute, 'standard');
    expect(segments).toHaveLength(2);
    expect(segments[0]!.source).toBe('OSRM');
    expect(segments[0]!.style.dashArray).toBeUndefined();
    expect(segments[1]!.source).toBe('STRAIGHT_LINE');
    expect(segments[1]!.style.dashArray).toBe('6, 8');
  });

  it('computes route display metrics and plan-wide summaries cleanly', () => {
    const osrmRoute = makeBaseRoute({
      resourceId: 'truck-1',
      geometry: {
        coordinates: [
          [28.655, 77.21],
          [28.67, 77.22],
          [28.7, 77.25],
        ],
        distanceKm: 8.83,
        durationMinutes: 13.2,
        source: 'OSRM',
      },
    });
    const boatRoute = makeBaseRoute({
      resourceId: 'boat-1',
      totalTravelDistanceKm: 5.8,
      totalDurationMinutes: 13.9,
      geometry: {
        coordinates: [
          [28.66, 77.21],
          [28.67, 77.22],
          [28.7, 77.25],
        ],
        distanceKm: 5.8,
        durationMinutes: 13.9,
        source: 'STRAIGHT_LINE',
      },
    });

    const mRoad = getRouteDisplayMetrics(osrmRoute);
    expect(mRoad.isRoadRouted).toBe(true);
    expect(mRoad.distanceKm).toBe(8.83);
    expect(formatDistanceKm(mRoad.distanceKm)).toBe('8.83 km');
    expect(formatDurationMinutes(mRoad.durationMinutes)).toBe('~13 min');
    expect(getRouteSourceLabel(mRoad.source)).toBe('OSRM Road');

    const summary = summarizeAssignmentRoutes([osrmRoute, boatRoute]);
    expect(summary.routeCount).toBe(2);
    expect(summary.totalDistanceKm).toBe(14.63);
    expect(summary.totalDurationMinutes).toBe(27.1);
    expect(summary.osrmRouteCount).toBe(1);
    expect(summary.straightLineRouteCount).toBe(1);
    expect(summary.overallSource).toBe('MIXED');
  });

  describe('Confirmed Road Routing Failure Policy & Route Mode Selector', () => {
    it('successful OSRM response renders road geometry in ROAD mode', () => {
      const roadRoute = makeBaseRoute({
        resourceId: 'res-truck-01',
        geometry: {
          source: 'OSRM',
          coordinates: [
            [28.67, 77.22],
            [28.68, 77.23],
            [28.7, 77.25],
          ],
          distanceKm: 8.83,
          durationMinutes: 13.2,
        },
      });

      const segments = getRouteSegmentsForRendering(roadRoute, 'standard', 'ROAD');
      expect(segments).toHaveLength(1);
      expect(segments[0]!.source).toBe('OSRM');
      expect(segments[0]!.isUnavailable).toBe(false);
      expect(segments[0]!.positions).toHaveLength(3);
      expect(segments[0]!.style.dashArray).toBeUndefined();

      const metrics = getRouteDisplayMetrics(roadRoute, 'ROAD');
      expect(metrics.isRoadRouted).toBe(true);
      expect(metrics.hasUnavailableRoadSegments).toBe(false);
      expect(metrics.distanceKm).toBe(8.83);
      expect(getRouteSourceLabel(metrics.source, 'ROAD')).toBe('OSRM Road');
    });

    it('OSRM NoRoute renders no route line and flags segment unavailable in ROAD mode', () => {
      const failedRoute = makeBaseRoute({
        resourceId: 'res-truck-01',
        geometry: {
          source: 'STRAIGHT_LINE',
          coordinates: [
            [28.67, 77.22],
            [28.7, 77.25],
          ],
          distanceKm: 4.5,
          durationMinutes: 10.8,
          legs: [
            {
              fromStopNumber: 1,
              toStopNumber: 2,
              distanceKm: 4.5,
              durationMinutes: 10.8,
              source: 'STRAIGHT_LINE',
              coordinates: [
                [28.67, 77.22],
                [28.7, 77.25],
              ],
            },
          ],
        },
      });

      const segments = getRouteSegmentsForRendering(failedRoute, 'standard', 'ROAD');
      expect(segments).toHaveLength(1);
      expect(segments[0]!.isUnavailable).toBe(true);
      expect(segments[0]!.positions).toHaveLength(0); // Strict failure policy: NO polyline rendered
      expect(segments[0]!.unavailableReason).toContain(
        'Road route unavailable. OSRM could not calculate a valid road route',
      );

      const metrics = getRouteDisplayMetrics(failedRoute, 'ROAD');
      expect(metrics.hasUnavailableRoadSegments).toBe(true);
      expect(metrics.unavailableSegmentCount).toBe(1);
      expect(metrics.distanceKm).toBe(0); // Does NOT present direct distance as road distance
    });

    it('OSRM timeout / missing geometry renders no route line in ROAD mode', () => {
      const timeoutRoute = makeBaseRoute({
        resourceId: 'res-truck-01',
        geometry: undefined,
      });

      const segments = getRouteSegmentsForRendering(timeoutRoute, 'standard', 'ROAD');
      expect(segments).toHaveLength(1);
      expect(segments[0]!.isUnavailable).toBe(true);
      expect(segments[0]!.positions).toHaveLength(0);
      expect(segments[0]!.unavailableReason).toContain(
        'Road route unavailable. OSRM could not calculate a valid road route',
      );
    });

    it('invalid / degenerate geometry renders no route line in ROAD mode', () => {
      const invalidRoute = makeBaseRoute({
        resourceId: 'res-truck-01',
        geometry: {
          source: 'OSRM',
          coordinates: [[28.67, 77.22]], // Only 1 vertex (invalid line)
          distanceKm: 0,
          durationMinutes: 0,
        },
      });

      const segments = getRouteSegmentsForRendering(invalidRoute, 'standard', 'ROAD');
      expect(segments[0]!.isUnavailable).toBe(true);
      expect(segments[0]!.positions).toHaveLength(0);
    });

    it('switching to DIRECT mode renders straight-line geometry between stops', () => {
      const failedRoute = makeBaseRoute({
        resourceId: 'res-truck-01',
        geometry: {
          source: 'STRAIGHT_LINE',
          coordinates: [
            [28.67, 77.22],
            [28.7, 77.25],
          ],
          distanceKm: 4.5,
          durationMinutes: 10.8,
        },
      });

      // In ROAD mode: no line
      const roadSegments = getRouteSegmentsForRendering(failedRoute, 'standard', 'ROAD');
      expect(roadSegments[0]!.positions).toHaveLength(0);
      expect(roadSegments[0]!.isUnavailable).toBe(true);

      // Operator switches to DIRECT mode:
      const directSegments = getRouteSegmentsForRendering(failedRoute, 'standard', 'DIRECT');
      expect(directSegments).toHaveLength(1);
      expect(directSegments[0]!.isUnavailable).toBe(false);
      expect(directSegments[0]!.source).toBe('STRAIGHT_LINE');
      expect(directSegments[0]!.positions).toEqual([
        [28.67, 77.22],
        [28.7, 77.25],
      ]);
      expect(directSegments[0]!.style.dashArray).toBe('6, 8');

      const directMetrics = getRouteDisplayMetrics(failedRoute, 'DIRECT');
      expect(directMetrics.hasUnavailableRoadSegments).toBe(false);
      expect(directMetrics.source).toBe('STRAIGHT_LINE');
      expect(directMetrics.distanceKm).toBeGreaterThan(0);
      expect(getRouteSourceLabel(directMetrics.source, 'DIRECT')).toBe('Direct (Straight-Line)');
    });

    it('reports unavailable segments individually for multi-segment routes without hiding successful legs', () => {
      const mixedRoute = makeBaseRoute({
        resourceId: 'res-truck-01',
        geometry: {
          source: 'MIXED',
          distanceKm: 12.3,
          durationMinutes: 18.0,
          coordinates: [
            [28.67, 77.22],
            [28.68, 77.23],
            [28.69, 77.24],
          ],
          legs: [
            {
              fromStopNumber: 0,
              toStopNumber: 1,
              distanceKm: 4.1,
              durationMinutes: 6.2,
              source: 'OSRM',
              coordinates: [
                [28.67, 77.22],
                [28.68, 77.23],
              ],
            },
            {
              fromStopNumber: 1,
              toStopNumber: 2,
              distanceKm: 8.2,
              durationMinutes: 11.8,
              source: 'STRAIGHT_LINE', // Failed OSRM leg
              coordinates: [
                [28.68, 77.23],
                [28.7, 77.25],
              ],
            },
          ],
        },
      });

      const segments = getRouteSegmentsForRendering(mixedRoute, 'standard', 'ROAD');
      expect(segments).toHaveLength(2);

      // Leg 0 succeeded: rendered with full road polyline
      expect(segments[0]!.source).toBe('OSRM');
      expect(segments[0]!.isUnavailable).toBe(false);
      expect(segments[0]!.positions).toEqual([
        [28.67, 77.22],
        [28.68, 77.23],
      ]);

      // Leg 1 failed: NOT rendered, reported unavailable individually
      expect(segments[1]!.isUnavailable).toBe(true);
      expect(segments[1]!.positions).toHaveLength(0);
      expect(segments[1]!.unavailableReason).toContain('Stop 1 -> Stop 2');

      const metrics = getRouteDisplayMetrics(mixedRoute, 'ROAD');
      expect(metrics.hasUnavailableRoadSegments).toBe(true);
      expect(metrics.unavailableSegmentCount).toBe(1);
      expect(metrics.distanceKm).toBe(4.1); // Only includes successful OSRM leg distance
    });

    it('preserves non-road resource (BOAT / HELICOPTER) straight-line domain routing without misrepresenting as road', () => {
      const boatRoute = makeBaseRoute({
        resourceId: 'res-boat-01',
        geometry: {
          source: 'STRAIGHT_LINE',
          coordinates: [
            [28.66, 77.21],
            [28.67, 77.22],
            [28.7, 77.25],
          ],
          distanceKm: 5.8,
          durationMinutes: 13.9,
        },
      });

      // In ROAD mode: BOAT renders straight-line transit vector; NOT flagged as unavailable road failure
      const boatSegments = getRouteSegmentsForRendering(boatRoute, 'standard', 'ROAD');
      expect(boatSegments).toHaveLength(1);
      expect(boatSegments[0]!.isNonRoadResource).toBe(true);
      expect(boatSegments[0]!.isUnavailable).toBe(false);
      expect(boatSegments[0]!.source).toBe('STRAIGHT_LINE');
      expect(boatSegments[0]!.positions).toHaveLength(3);
      expect(boatSegments[0]!.style.dashArray).toBe('6, 8');

      const boatMetrics = getRouteDisplayMetrics(boatRoute, 'ROAD');
      expect(boatMetrics.hasUnavailableRoadSegments).toBe(false);
      expect(boatMetrics.isRoadRouted).toBe(false);
      expect(boatMetrics.distanceKm).toBe(5.8);
    });
  });
});
