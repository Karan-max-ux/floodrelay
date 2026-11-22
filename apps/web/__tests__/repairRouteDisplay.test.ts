import { describe, it, expect } from 'vitest';
import type { ResourceRoute, RouteStop } from '@floodrelay/shared';
import {
  extractRepairStops,
  getRepairRouteStyle,
  getRouteDisplayMetrics,
  getRouteSegmentsForRendering,
  isRepairAssignment,
} from '../components/operator/map/routeDisplay';

describe('Google Maps-Style Repair Route Visualization & Routing Rules', () => {
  const depotStop: RouteStop = {
    stopNumber: 1,
    type: 'DEPOT',
    targetId: 'depot_ncr_central',
    lat: 28.65,
    lng: 77.23,
    passengersPickedUp: 0,
    passengersDroppedOff: 0,
    estimatedArrivalMinutes: 0,
  };

  const pickupStop: RouteStop = {
    stopNumber: 2,
    type: 'PICKUP',
    targetId: 'req-repair-target-01',
    lat: 28.66,
    lng: 77.24,
    passengersPickedUp: 3,
    passengersDroppedOff: 0,
    estimatedArrivalMinutes: 8.5,
  };

  const dropoffStop: RouteStop = {
    stopNumber: 3,
    type: 'DROPOFF',
    targetId: 'shelter_ncr_safe',
    lat: 28.67,
    lng: 77.25,
    passengersPickedUp: 0,
    passengersDroppedOff: 3,
    estimatedArrivalMinutes: 16.2,
  };

  const sampleOsrmCoordinates: [number, number][] = [
    [28.65, 77.23],
    [28.652, 77.232],
    [28.655, 77.236],
    [28.66, 77.24],
    [28.665, 77.245],
    [28.67, 77.25],
  ];

  const validOsrmRepairRoute: ResourceRoute = {
    resourceId: 'res_truck_repair_1',
    stops: [depotStop, pickupStop, dropoffStop],
    totalTravelDistanceKm: 6.8,
    totalDurationMinutes: 16.2,
    servedRequestIds: ['req-repair-target-01'],
    geometry: {
      coordinates: sampleOsrmCoordinates,
      distanceKm: 6.8,
      durationMinutes: 16.2,
      source: 'OSRM',
    },
  };

  // 1. Valid OSRM repair route geometry
  describe('1. Valid OSRM repair route geometry', () => {
    it('produces valid road-following OSRM segments and Google Maps styling', () => {
      const segments = getRouteSegmentsForRendering(
        validOsrmRepairRoute,
        'standard',
        'ROAD',
        'HIGH_WATER_VEHICLE',
      );
      expect(segments).toHaveLength(1);
      expect(segments[0]!.source).toBe('OSRM');
      expect(segments[0]!.positions.length).toBe(sampleOsrmCoordinates.length);
      expect(segments[0]!.isUnavailable).toBe(false);

      // Google Maps style verification
      const style = getRepairRouteStyle(true, 'ROAD', 'standard');
      expect(style.main.color).toBe('#4285F4');
      expect(style.main.weight).toBe(5);
      expect(style.main.opacity).toBe(1.0);
      expect(style.main.lineCap).toBe('round');
      expect(style.main.lineJoin).toBe('round');
      expect(style.main.dashArray).toBeUndefined(); // Solid line, not dashed!

      // White halo casing underneath for contrast
      expect(style.casing.color).toBe('#ffffff');
      expect(style.casing.weight).toBe(9);
      expect(style.casing.opacity).toBe(0.9);
      expect(style.casing.lineCap).toBe('round');
      expect(style.casing.lineJoin).toBe('round');
    });
  });

  // 2. OSRM NoRoute response
  describe('2. OSRM NoRoute response', () => {
    it('enforces strict failure policy: positions is empty [] and no fallback line is drawn in Road mode', () => {
      const noRouteRepair: ResourceRoute = {
        resourceId: 'res_truck_repair_1',
        stops: [depotStop, pickupStop, dropoffStop],
        totalTravelDistanceKm: 0,
        totalDurationMinutes: 0,
        servedRequestIds: ['req-repair-target-01'],
        geometry: {
          coordinates: [],
          distanceKm: 0,
          durationMinutes: 0,
          source: 'STRAIGHT_LINE', // OSRM failed / fallback
        },
      };

      const segments = getRouteSegmentsForRendering(
        noRouteRepair,
        'standard',
        'ROAD',
        'HIGH_WATER_VEHICLE',
      );
      expect(segments).toHaveLength(1);
      expect(segments[0]!.positions).toEqual([]); // No fallback line!
      expect(segments[0]!.isUnavailable).toBe(true);
      expect(segments[0]!.unavailableReason).toContain('Road route unavailable');
    });
  });

  // 3. OSRM timeout / error
  describe('3. OSRM timeout / error', () => {
    it('renders no polyline when OSRM times out and geometry is missing', () => {
      const timeoutRoute: ResourceRoute = {
        resourceId: 'res_truck_repair_1',
        stops: [depotStop, pickupStop],
        totalTravelDistanceKm: 0,
        totalDurationMinutes: 0,
        servedRequestIds: ['req-repair-target-01'],
        geometry: undefined,
      };

      const segments = getRouteSegmentsForRendering(
        timeoutRoute,
        'standard',
        'ROAD',
        'HIGH_WATER_VEHICLE',
      );
      expect(segments).toHaveLength(1);
      expect(segments[0]!.positions).toEqual([]);
      expect(segments[0]!.isUnavailable).toBe(true);
    });
  });

  // 4. Missing or invalid route geometry
  describe('4. Missing or invalid route geometry', () => {
    it('gracefully filters corrupt or NaN coordinates and maintains strict failure policy', () => {
      const corruptRoute: ResourceRoute = {
        resourceId: 'res_truck_repair_1',
        stops: [depotStop, pickupStop],
        totalTravelDistanceKm: 0,
        totalDurationMinutes: 0,
        servedRequestIds: ['req-repair-target-01'],
        geometry: {
          coordinates: [
            [NaN, 77.23],
            [28.65, Infinity],
          ] as unknown as [number, number][],
          distanceKm: 0,
          durationMinutes: 0,
          source: 'OSRM',
        },
      };

      const segments = getRouteSegmentsForRendering(
        corruptRoute,
        'standard',
        'ROAD',
        'HIGH_WATER_VEHICLE',
      );
      expect(segments).toHaveLength(1);
      expect(segments[0]!.positions).toEqual([]);
      expect(segments[0]!.isUnavailable).toBe(true);
    });
  });

  // 5. Correct start and destination markers
  describe('5. Correct start, intermediate, and destination markers', () => {
    it('classifies stops into Start, Intermediate (numbered), and Destination with original DB coordinates', () => {
      const stops = extractRepairStops(validOsrmRepairRoute);
      expect(stops).toHaveLength(3);

      // Start stop (depot)
      expect(stops[0]!.isStart).toBe(true);
      expect(stops[0]!.isEnd).toBe(false);
      expect(stops[0]!.isIntermediate).toBe(false);
      expect(stops[0]!.lat).toBe(28.65);
      expect(stops[0]!.lng).toBe(77.23);
      expect(stops[0]!.label).toContain('Start');

      // Intermediate stop (pickup)
      expect(stops[1]!.isStart).toBe(false);
      expect(stops[1]!.isEnd).toBe(false);
      expect(stops[1]!.isIntermediate).toBe(true);
      expect(stops[1]!.stopNumber).toBe(2);
      expect(stops[1]!.lat).toBe(28.66);
      expect(stops[1]!.lng).toBe(77.24);

      // Destination stop (dropoff / shelter)
      expect(stops[2]!.isStart).toBe(false);
      expect(stops[2]!.isEnd).toBe(true);
      expect(stops[2]!.isIntermediate).toBe(false);
      expect(stops[2]!.lat).toBe(28.67);
      expect(stops[2]!.lng).toBe(77.25);
      expect(stops[2]!.label).toContain('Destination');
    });
  });

  // 6. Multiple repair assignments
  describe('6. Multiple repair assignments identification', () => {
    it('accurately identifies repair proposals and distinguishes them from normal rescue assignments', () => {
      const repairProposal1 = { id: 'prop-repair-a1b2c3d4', scenarioId: 'delhi-yamuna-demo' };
      const repairProposal2 = { id: 'assign_repair_7718', scenarioId: 'delhi-yamuna-repaired' };
      const rescueAssignment = { id: 'assign_1795362473494', scenarioId: 'scenario-delhi-demo' };

      expect(isRepairAssignment(repairProposal1)).toBe(true);
      expect(isRepairAssignment(repairProposal2)).toBe(true);
      expect(isRepairAssignment(rescueAssignment)).toBe(false);
      expect(isRepairAssignment(null)).toBe(false);
    });
  });

  // 7. Selected repair route highlighting
  describe('7. Selected repair route highlighting', () => {
    it('applies strong visual emphasis to active route and reduced opacity to inactive routes', () => {
      const activeStyle = getRepairRouteStyle(true, 'ROAD', 'standard');
      const inactiveStyle = getRepairRouteStyle(false, 'ROAD', 'standard');

      expect(activeStyle.main.opacity).toBe(1.0);
      expect(activeStyle.main.weight).toBe(5);
      expect(activeStyle.casing.weight).toBe(9);

      expect(inactiveStyle.main.opacity).toBe(0.5);
      expect(inactiveStyle.main.weight).toBe(3.5);
      expect(inactiveStyle.casing.weight).toBe(6);
    });
  });

  // 8. Empty repair assignment state
  describe('8. Empty repair assignment state', () => {
    it('handles empty assignments cleanly without fabricating routes', () => {
      const assignments: Array<{ id: string; scenarioId: string }> = [];
      const repairAssignments = assignments.filter(isRepairAssignment);
      expect(repairAssignments).toHaveLength(0);
    });
  });

  // 9. No synthetic routes presented as real assignments
  describe('9. No synthetic routes presented as real assignments', () => {
    it('verifies synthetic fixtures are not treated as live database assignments without proper identity', () => {
      const realProposed = { id: 'prop-repair-e2e-1', scenarioId: 'delhi-live' };
      expect(isRepairAssignment(realProposed)).toBe(true);

      const standardLive = { id: 'assign_live_01', scenarioId: 'live-operations' };
      expect(isRepairAssignment(standardLive)).toBe(false);
    });
  });

  // 10. Existing rescue routes remain unaffected
  describe('10. Existing rescue routes remain unaffected', () => {
    it('preserves standard rescue route telemetry and non-road transit vectors', () => {
      const boatRoute: ResourceRoute = {
        resourceId: 'res_boat_01',
        stops: [depotStop, dropoffStop],
        totalTravelDistanceKm: 4.2,
        totalDurationMinutes: 10.5,
        servedRequestIds: ['req-01'],
      };

      const metrics = getRouteDisplayMetrics(boatRoute, 'ROAD', 'BOAT');
      expect(metrics.isRoadRouted).toBe(false);
      expect(metrics.source).toBe('STRAIGHT_LINE');

      const segments = getRouteSegmentsForRendering(boatRoute, 'standard', 'ROAD', 'BOAT');
      expect(segments).toHaveLength(1);
      expect(segments[0]!.isNonRoadResource).toBe(true);
      expect(segments[0]!.positions.length).toBe(2);
    });
  });
});
