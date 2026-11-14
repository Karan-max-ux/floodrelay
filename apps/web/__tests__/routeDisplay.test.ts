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
});
