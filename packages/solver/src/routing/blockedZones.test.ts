import { describe, it, expect } from 'vitest';
import type { BlockedZone, GeoPoint, RescueRequest, SolverPlan } from '@floodrelay/shared';
import {
  pointInPolygon,
  segmentsIntersect,
  segmentIntersectsPolygon,
  hazardAtPoint,
  zonesCrossedBySegment,
  isSegmentBlocked,
  legImpedanceMultiplier,
  findRequestsInBlockedZones,
  flagPlanHazards,
} from './blockedZones.js';
import { HazardAwareTravelTimeProvider } from './hazardAwareTravelTime.js';
import { StraightLineTravelTimeProvider } from './travelTime.js';

describe('BlockedZones & Geometry Helpers', () => {
  // Rectangle: lat [28.0, 28.2], lng [77.0, 77.2]
  const rectPolygon: GeoPoint[] = [
    { lat: 28.0, lng: 77.0 },
    { lat: 28.2, lng: 77.0 },
    { lat: 28.2, lng: 77.2 },
    { lat: 28.0, lng: 77.2 },
  ];

  // Concave U-shaped polygon:
  // (0,0) -> (3,0) -> (3,3) -> (2,3) -> (2,1) -> (1,1) -> (1,3) -> (0,3)
  const uPolygon: GeoPoint[] = [
    { lat: 0, lng: 0 },
    { lat: 0, lng: 3 },
    { lat: 3, lng: 3 },
    { lat: 3, lng: 2 },
    { lat: 1, lng: 2 },
    { lat: 1, lng: 1 },
    { lat: 3, lng: 1 },
    { lat: 3, lng: 0 },
  ];

  describe('pointInPolygon', () => {
    it('detects point strictly inside convex polygon', () => {
      expect(pointInPolygon({ lat: 28.1, lng: 77.1 }, rectPolygon)).toBe(true);
    });

    it('detects point strictly outside convex polygon', () => {
      expect(pointInPolygon({ lat: 28.3, lng: 77.1 }, rectPolygon)).toBe(false);
      expect(pointInPolygon({ lat: 27.9, lng: 77.1 }, rectPolygon)).toBe(false);
      expect(pointInPolygon({ lat: 28.1, lng: 76.9 }, rectPolygon)).toBe(false);
      expect(pointInPolygon({ lat: 28.1, lng: 77.3 }, rectPolygon)).toBe(false);
    });

    it('counts boundary edges and vertices as inside', () => {
      // On edge
      expect(pointInPolygon({ lat: 28.1, lng: 77.0 }, rectPolygon)).toBe(true);
      expect(pointInPolygon({ lat: 28.2, lng: 77.1 }, rectPolygon)).toBe(true);
      // On vertex
      expect(pointInPolygon({ lat: 28.0, lng: 77.0 }, rectPolygon)).toBe(true);
      expect(pointInPolygon({ lat: 28.2, lng: 77.2 }, rectPolygon)).toBe(true);
    });

    it('correctly tests concave U-shaped polygon', () => {
      // Inside the base
      expect(pointInPolygon({ lat: 0.5, lng: 1.5 }, uPolygon)).toBe(true);
      // Inside left arm
      expect(pointInPolygon({ lat: 2.0, lng: 0.5 }, uPolygon)).toBe(true);
      // Inside right arm
      expect(pointInPolygon({ lat: 2.0, lng: 2.5 }, uPolygon)).toBe(true);
      // In the middle hollow cavity (outside the polygon!)
      expect(pointInPolygon({ lat: 2.0, lng: 1.5 }, uPolygon)).toBe(false);
    });

    it('returns false for degenerate polygon with fewer than 3 vertices', () => {
      expect(
        pointInPolygon({ lat: 1, lng: 1 }, [
          { lat: 0, lng: 0 },
          { lat: 2, lng: 2 },
        ]),
      ).toBe(false);
      expect(pointInPolygon({ lat: 1, lng: 1 }, [])).toBe(false);
    });
  });

  describe('segmentsIntersect', () => {
    it('detects intersecting cross segments', () => {
      const a = { lat: 0, lng: 0 };
      const b = { lat: 2, lng: 2 };
      const c = { lat: 0, lng: 2 };
      const d = { lat: 2, lng: 0 };
      expect(segmentsIntersect(a, b, c, d)).toBe(true);
    });

    it('returns false for parallel non-intersecting segments', () => {
      const a = { lat: 0, lng: 0 };
      const b = { lat: 2, lng: 0 };
      const c = { lat: 0, lng: 1 };
      const d = { lat: 2, lng: 1 };
      expect(segmentsIntersect(a, b, c, d)).toBe(false);
    });

    it('returns false for non-parallel segments that do not meet', () => {
      const a = { lat: 0, lng: 0 };
      const b = { lat: 1, lng: 1 };
      const c = { lat: 2, lng: 3 };
      const d = { lat: 3, lng: 2 };
      expect(segmentsIntersect(a, b, c, d)).toBe(false);
    });

    it('detects touching endpoints as intersecting', () => {
      const a = { lat: 0, lng: 0 };
      const b = { lat: 1, lng: 1 };
      const c = { lat: 1, lng: 1 };
      const d = { lat: 2, lng: 1 };
      expect(segmentsIntersect(a, b, c, d)).toBe(true);
    });

    it('detects collinear overlapping segments as intersecting', () => {
      const a = { lat: 0, lng: 0 };
      const b = { lat: 2, lng: 2 };
      const c = { lat: 1, lng: 1 };
      const d = { lat: 3, lng: 3 };
      expect(segmentsIntersect(a, b, c, d)).toBe(true);
    });
  });

  describe('segmentIntersectsPolygon', () => {
    it('detects segment crossing through polygon', () => {
      const p1 = { lat: 28.1, lng: 76.9 };
      const p2 = { lat: 28.1, lng: 77.3 };
      expect(segmentIntersectsPolygon(p1, p2, rectPolygon)).toBe(true);
    });

    it('detects segment completely inside polygon', () => {
      const p1 = { lat: 28.05, lng: 77.05 };
      const p2 = { lat: 28.15, lng: 77.15 };
      expect(segmentIntersectsPolygon(p1, p2, rectPolygon)).toBe(true);
    });

    it('detects segment with one point inside and one outside', () => {
      const p1 = { lat: 28.1, lng: 77.1 };
      const p2 = { lat: 28.5, lng: 77.5 };
      expect(segmentIntersectsPolygon(p1, p2, rectPolygon)).toBe(true);
    });

    it('returns false for segment completely outside polygon', () => {
      const p1 = { lat: 28.3, lng: 77.0 };
      const p2 = { lat: 28.4, lng: 77.2 };
      expect(segmentIntersectsPolygon(p1, p2, rectPolygon)).toBe(false);
    });
  });

  describe('hazard zone helpers', () => {
    const zones: BlockedZone[] = [
      {
        id: 'zone-caution',
        name: 'Caution Area',
        severity: 'CAUTION',
        polygon: [
          { lat: 28.0, lng: 77.0 },
          { lat: 28.2, lng: 77.0 },
          { lat: 28.2, lng: 77.2 },
          { lat: 28.0, lng: 77.2 },
        ],
      },
      {
        id: 'zone-blocked',
        name: 'Submerged Highway Block',
        severity: 'BLOCKED',
        polygon: [
          { lat: 28.5, lng: 77.5 },
          { lat: 28.7, lng: 77.5 },
          { lat: 28.7, lng: 77.7 },
          { lat: 28.5, lng: 77.7 },
        ],
      },
      {
        id: 'zone-water-surge',
        name: 'River Flash Surge',
        severity: 'WATER_SURGE',
        polygon: [
          { lat: 28.1, lng: 77.1 },
          { lat: 28.3, lng: 77.1 },
          { lat: 28.3, lng: 77.3 },
          { lat: 28.1, lng: 77.3 },
        ],
      },
    ];

    it('hazardAtPoint returns highest hazard severity or null', () => {
      expect(hazardAtPoint({ lat: 27.0, lng: 76.0 }, zones)).toBeNull();
      expect(hazardAtPoint({ lat: 28.05, lng: 77.05 }, zones)).toBe('CAUTION');
      expect(hazardAtPoint({ lat: 28.6, lng: 77.6 }, zones)).toBe('BLOCKED');
      // Overlap of CAUTION and WATER_SURGE => WATER_SURGE takes precedence
      expect(hazardAtPoint({ lat: 28.15, lng: 77.15 }, zones)).toBe('WATER_SURGE');
    });

    it('zonesCrossedBySegment returns all zones intersected by the segment', () => {
      const crossed = zonesCrossedBySegment(
        { lat: 28.4, lng: 77.6 },
        { lat: 28.8, lng: 77.6 },
        zones,
      );
      expect(crossed).toHaveLength(1);
      expect(crossed[0]?.id).toBe('zone-blocked');
    });

    it('isSegmentBlocked returns true if and only if segment crosses a BLOCKED zone', () => {
      expect(isSegmentBlocked({ lat: 28.0, lng: 77.0 }, { lat: 28.2, lng: 77.2 }, zones)).toBe(
        false,
      );
      expect(isSegmentBlocked({ lat: 28.4, lng: 77.6 }, { lat: 28.8, lng: 77.6 }, zones)).toBe(
        true,
      );
    });

    it('legImpedanceMultiplier calculates appropriate cost scaling', () => {
      // Clear leg
      expect(
        legImpedanceMultiplier({ lat: 27.0, lng: 76.0 }, { lat: 27.1, lng: 76.1 }, zones),
      ).toBe(1.0);
      // Caution leg
      expect(
        legImpedanceMultiplier({ lat: 28.05, lng: 77.05 }, { lat: 28.08, lng: 77.08 }, zones),
      ).toBe(1.25);
      // Water surge leg
      expect(
        legImpedanceMultiplier({ lat: 28.25, lng: 77.25 }, { lat: 28.28, lng: 77.28 }, zones),
      ).toBe(2.0);
      // Blocked leg default => Infinity
      expect(
        legImpedanceMultiplier({ lat: 28.4, lng: 77.6 }, { lat: 28.8, lng: 77.6 }, zones),
      ).toBe(Infinity);
      // Blocked leg with PENALTY policy => 10.0 (or custom)
      expect(
        legImpedanceMultiplier({ lat: 28.4, lng: 77.6 }, { lat: 28.8, lng: 77.6 }, zones, {
          blockedPolicy: 'PENALTY',
        }),
      ).toBe(10.0);
      expect(
        legImpedanceMultiplier({ lat: 28.4, lng: 77.6 }, { lat: 28.8, lng: 77.6 }, zones, {
          blockedPolicy: 'PENALTY',
          penaltyMultiplier: 15.0,
        }),
      ).toBe(15.0);
    });

    it('findRequestsInBlockedZones filters requests within blocked polygons', () => {
      const requests: RescueRequest[] = [
        {
          id: 'req-safe',
          lat: 27.5,
          lng: 76.5,
          peopleCount: 2,
          urgency: 'LOW',
          status: 'PENDING',
          source: 'SIMULATED',
          createdAt: new Date().toISOString(),
        },
        {
          id: 'req-blocked',
          lat: 28.6,
          lng: 77.6,
          peopleCount: 4,
          urgency: 'HIGH',
          status: 'PENDING',
          source: 'SIMULATED',
          createdAt: new Date().toISOString(),
        },
      ];

      const found = findRequestsInBlockedZones(requests, zones);
      expect(found).toHaveLength(1);
      expect(found[0]!.request.id).toBe('req-blocked');
      expect(found[0]!.zone.id).toBe('zone-blocked');
    });

    it('flagPlanHazards inspects route legs and generates a hazard report', () => {
      const plan: SolverPlan = {
        scenarioId: 'test-sc',
        calculatedAt: new Date().toISOString(),
        routes: [
          {
            resourceId: 'boat-1',
            stops: [
              {
                stopNumber: 1,
                type: 'DEPOT',
                targetId: 'depot-1',
                lat: 27.0,
                lng: 76.0,
                passengersPickedUp: 0,
                passengersDroppedOff: 0,
                estimatedArrivalMinutes: 0,
              },
              {
                stopNumber: 2,
                type: 'PICKUP',
                targetId: 'req-1',
                lat: 28.15,
                lng: 77.15, // in CAUTION & WATER_SURGE
                passengersPickedUp: 2,
                passengersDroppedOff: 0,
                estimatedArrivalMinutes: 20,
              },
              {
                stopNumber: 3,
                type: 'DROPOFF',
                targetId: 'shelter-1',
                lat: 28.6,
                lng: 77.6, // in BLOCKED
                passengersPickedUp: 0,
                passengersDroppedOff: 2,
                estimatedArrivalMinutes: 50,
              },
            ],
            totalDurationMinutes: 60,
            totalTravelDistanceKm: 40,
            servedRequestIds: ['req-1'],
          },
        ],
        unserved: [],
        metrics: {
          totalTravelTimeMinutes: 60,
          totalTravelDistanceKm: 40,
          highPriorityWaitTimeMinutes: 0,
          solveDurationMs: 1,
          servedRequestsCount: 1,
          unservedRequestsCount: 0,
          coveragePercent: 100,
        },
      };

      const report = flagPlanHazards(plan, zones);
      expect(report.totalLegs).toBe(2);
      expect(report.hazardLegs).toBe(2);
      expect(report.blockedLegs).toBe(1);
      expect(report.legDetails[0]!.info.hazard).toBe('WATER_SURGE');
      expect(report.legDetails[1]!.info.hazard).toBe('BLOCKED');
      expect(report.legDetails[1]!.info.isBlocked).toBe(true);
    });
  });

  describe('HazardAwareTravelTimeProvider', () => {
    const baseProvider = new StraightLineTravelTimeProvider();
    const zones: BlockedZone[] = [
      {
        id: 'zone-caution',
        severity: 'CAUTION',
        polygon: [
          { lat: 28.0, lng: 77.0 },
          { lat: 28.2, lng: 77.0 },
          { lat: 28.2, lng: 77.2 },
          { lat: 28.0, lng: 77.2 },
        ],
      },
      {
        id: 'zone-surge',
        severity: 'WATER_SURGE',
        polygon: [
          { lat: 28.3, lng: 77.3 },
          { lat: 28.5, lng: 77.3 },
          { lat: 28.5, lng: 77.5 },
          { lat: 28.3, lng: 77.5 },
        ],
      },
      {
        id: 'zone-blocked',
        severity: 'BLOCKED',
        polygon: [
          { lat: 28.6, lng: 77.6 },
          { lat: 28.8, lng: 77.6 },
          { lat: 28.8, lng: 77.8 },
          { lat: 28.6, lng: 77.8 },
        ],
      },
    ];

    it('leaves clear legs unscaled with no hazard flag', () => {
      const provider = new HazardAwareTravelTimeProvider(baseProvider, zones);
      const est = provider.getTravelEstimate({ lat: 27.0, lng: 76.0 }, { lat: 27.1, lng: 76.1 });

      expect(est.hazard).toBeUndefined();
      expect(est.blocked).toBeUndefined();
      expect(est.distanceKm).toBeGreaterThan(0);
      expect(est.durationMinutes).toBeGreaterThan(0);
    });

    it('scales duration and distance by 1.25 for legs crossing CAUTION', () => {
      const provider = new HazardAwareTravelTimeProvider(baseProvider, zones);
      const from = { lat: 28.05, lng: 77.05 };
      const to = { lat: 28.15, lng: 77.15 };

      const baseEst = baseProvider.getTravelEstimate(from, to);
      const hazardEst = provider.getTravelEstimate(from, to);

      expect(hazardEst.hazard).toBe('CAUTION');
      expect(hazardEst.distanceKm).toBeCloseTo(Number((baseEst.distanceKm * 1.25).toFixed(3)), 2);
      expect(hazardEst.durationMinutes).toBeCloseTo(
        Number((baseEst.durationMinutes * 1.25).toFixed(2)),
        2,
      );
    });

    it('scales duration and distance by 2.0 for legs crossing WATER_SURGE', () => {
      const provider = new HazardAwareTravelTimeProvider(baseProvider, zones);
      const from = { lat: 28.35, lng: 77.35 };
      const to = { lat: 28.45, lng: 77.45 };

      const baseEst = baseProvider.getTravelEstimate(from, to);
      const hazardEst = provider.getTravelEstimate(from, to);

      expect(hazardEst.hazard).toBe('WATER_SURGE');
      expect(hazardEst.distanceKm).toBeCloseTo(Number((baseEst.distanceKm * 2.0).toFixed(3)), 2);
      expect(hazardEst.durationMinutes).toBeCloseTo(
        Number((baseEst.durationMinutes * 2.0).toFixed(2)),
        2,
      );
    });

    it('returns Infinity and blocked:true for BLOCKED legs under default INFINITE policy', () => {
      const provider = new HazardAwareTravelTimeProvider(baseProvider, zones);
      const from = { lat: 28.65, lng: 77.65 };
      const to = { lat: 28.75, lng: 77.75 };

      const est = provider.getTravelEstimate(from, to);
      expect(est.hazard).toBe('BLOCKED');
      expect(est.blocked).toBe(true);
      expect(est.distanceKm).toBe(Infinity);
      expect(est.durationMinutes).toBe(Infinity);
    });

    it('applies penalty multiplier for BLOCKED legs under PENALTY policy', () => {
      const provider = new HazardAwareTravelTimeProvider(baseProvider, zones, {
        blockedPolicy: 'PENALTY',
        penaltyMultiplier: 10.0,
      });
      const from = { lat: 28.65, lng: 77.65 };
      const to = { lat: 28.75, lng: 77.75 };

      const baseEst = baseProvider.getTravelEstimate(from, to);
      const est = provider.getTravelEstimate(from, to);

      expect(est.hazard).toBe('BLOCKED');
      expect(est.blocked).toBe(true);
      expect(est.distanceKm).toBeCloseTo(Number((baseEst.distanceKm * 10.0).toFixed(3)), 2);
      expect(est.durationMinutes).toBeCloseTo(
        Number((baseEst.durationMinutes * 10.0).toFixed(2)),
        2,
      );
    });

    it('correctly maps 2D matrix in getMatrix()', () => {
      const provider = new HazardAwareTravelTimeProvider(baseProvider, zones);
      const origins = [
        { lat: 27.0, lng: 76.0 },
        { lat: 28.65, lng: 77.65 },
      ];
      const dests = [
        { lat: 27.1, lng: 76.1 },
        { lat: 28.75, lng: 77.75 },
      ];

      const matrix = provider.getMatrix(origins, dests);
      expect(matrix).toHaveLength(2);
      expect(matrix[0]![0]!.blocked).toBeUndefined(); // clear
      expect(matrix[1]![1]!.blocked).toBe(true); // blocked
    });
  });
});
