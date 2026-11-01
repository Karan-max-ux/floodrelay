import { describe, it, expect } from 'vitest';
import type {
  BlockedZone,
  GeoPoint,
  RescueRequest,
  Scenario,
  SolverPlan,
} from '@floodrelay/shared';
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
  hasFiniteRoundTrip,
} from './blockedZones.js';
import { HazardAwareTravelTimeProvider } from './hazardAwareTravelTime.js';
import { StraightLineTravelTimeProvider } from './travelTime.js';
import { generateScenario } from '../generator.js';
import { solveNearestFirst } from '../baselines/nearestFirst.js';
import { solveClarkeWrightBaseline } from '../baselines/clarkeWrightBaseline.js';
import { solveClusterAllocation } from '../heuristics/clusterAllocation.js';
import { validateSolverPlan } from '../planValidator.js';

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
    it('scales WATER_SURGE legs by 2.0 under PENALTY policy (policy applies to BLOCKED only)', () => {
      const provider = new HazardAwareTravelTimeProvider(baseProvider, zones, {
        blockedPolicy: 'PENALTY',
        penaltyMultiplier: 10.0,
      });
      const from = { lat: 28.35, lng: 77.35 };
      const to = { lat: 28.45, lng: 77.45 };

      const baseEst = baseProvider.getTravelEstimate(from, to);
      const est = provider.getTravelEstimate(from, to);

      expect(est.hazard).toBe('WATER_SURGE');
      expect(est.blocked).toBeUndefined();
      expect(est.distanceKm).toBeCloseTo(Number((baseEst.distanceKm * 2.0).toFixed(3)), 2);
      expect(est.durationMinutes).toBeCloseTo(
        Number((baseEst.durationMinutes * 2.0).toFixed(2)),
        2,
      );
    });

    it('scales CAUTION legs by 1.25 under PENALTY policy (policy applies to BLOCKED only)', () => {
      const provider = new HazardAwareTravelTimeProvider(baseProvider, zones, {
        blockedPolicy: 'PENALTY',
        penaltyMultiplier: 10.0,
      });
      const from = { lat: 28.05, lng: 77.05 };
      const to = { lat: 28.15, lng: 77.15 };

      const baseEst = baseProvider.getTravelEstimate(from, to);
      const est = provider.getTravelEstimate(from, to);

      expect(est.hazard).toBe('CAUTION');
      expect(est.blocked).toBeUndefined();
      expect(est.distanceKm).toBeCloseTo(Number((baseEst.distanceKm * 1.25).toFixed(3)), 2);
      expect(est.durationMinutes).toBeCloseTo(
        Number((baseEst.durationMinutes * 1.25).toFixed(2)),
        2,
      );
    });

    it('executes worst-case hazard input (10 zones x 200 vertices = 2000 vertices) on Large scenario efficiently', () => {
      const scenario = generateScenario({ seed: 42, requestCount: 500, resourceCount: 30 });

      // Maximum allowed input: 10 zones of 200 vertices each = 2000 total vertices
      const maxZones: BlockedZone[] = [];
      for (let z = 0; z < 10; z++) {
        const centerLat = 28.5 + (z % 3) * 0.1;
        const centerLng = 77.1 + Math.floor(z / 3) * 0.1;
        const radius = 0.02;
        const polygon: GeoPoint[] = [];
        const N = 200;
        for (let i = 0; i < N; i++) {
          const angle = (2 * Math.PI * i) / N;
          polygon.push({
            lat: Number((centerLat + radius * Math.cos(angle)).toFixed(6)),
            lng: Number((centerLng + radius * Math.sin(angle)).toFixed(6)),
          });
        }
        maxZones.push({
          id: `zone-worst-${z}`,
          severity: z === 0 ? 'BLOCKED' : z % 2 === 0 ? 'WATER_SURGE' : 'CAUTION',
          polygon,
        });
      }

      expect(maxZones).toHaveLength(10);
      const totalVertices = maxZones.reduce((s, z) => s + z.polygon.length, 0);
      expect(totalVertices).toBe(2000);

      const provider = new HazardAwareTravelTimeProvider(baseProvider, maxZones);

      const start = performance.now();
      const plan = solveNearestFirst(
        { ...scenario, blockedZones: maxZones },
        { travelTimeProvider: provider },
      );
      const elapsed = performance.now() - start;

      expect(plan.routes.length).toBeGreaterThan(0);
      expect(plan.metrics.servedRequestsCount).toBeGreaterThan(0);
      // Confirms bounding-box prefilter and per-leg cache execute well within standard timeout
      expect(elapsed).toBeLessThan(5000);
    });
  });

  describe('Item 4: UNREACHABLE_DUE_TO_HAZARD and Plan Validation across all Solvers', () => {
    const enclosingZone: BlockedZone = {
      id: 'enclosing-zone',
      severity: 'BLOCKED',
      polygon: [
        { lat: 28.69, lng: 77.29 },
        { lat: 28.71, lng: 77.29 },
        { lat: 28.71, lng: 77.31 },
        { lat: 28.69, lng: 77.31 },
      ],
    };

    const testScenario: Scenario = {
      id: 'hazard-unreachable-test',
      metadata: {
        id: 'hazard-unreachable-test',
        name: 'Hazard Unreachable Scenario',
        region: 'Delhi',
        createdAt: '2026-11-01T00:00:00Z',
        bounds: { minLat: 28.4, maxLat: 28.8, minLng: 77.0, maxLng: 77.4 },
      },
      shelters: [
        {
          id: 'shelter-1',
          name: 'Main Shelter',
          lat: 28.5,
          lng: 77.1,
          capacity: 100,
        },
      ],
      resources: [
        {
          id: 'res-hwv-1',
          name: 'HWV Alpha',
          type: 'HIGH_WATER_VEHICLE',
          capacity: 5,
          speedKmH: 30,
          lat: 28.5,
          lng: 77.1,
          status: 'AVAILABLE',
        },
      ],
      requests: [
        {
          id: 'req-reachable',
          lat: 28.52,
          lng: 77.12,
          peopleCount: 2,
          urgency: 'HIGH',
          createdAt: '2026-11-01T00:00:00Z',
          source: 'SIMULATED',
        },
        {
          id: 'req-unreachable',
          lat: 28.7, // enclosed inside enclosingZone
          lng: 77.3,
          peopleCount: 2,
          urgency: 'HIGH',
          createdAt: '2026-11-01T00:00:00Z',
          source: 'SIMULATED',
        },
      ],
      blockedZones: [enclosingZone],
    };

    const hazardProvider = new HazardAwareTravelTimeProvider(
      new StraightLineTravelTimeProvider(),
      [enclosingZone],
      { blockedPolicy: 'INFINITE' },
    );

    it('proves hasFiniteRoundTrip identifies enclosed requests correctly', () => {
      const reachableRoundTrip = hasFiniteRoundTrip(
        testScenario.requests[0]!,
        testScenario.resources,
        testScenario.shelters,
        hazardProvider,
      );
      expect(reachableRoundTrip).toBe(true);

      const unreachableRoundTrip = hasFiniteRoundTrip(
        testScenario.requests[1]!,
        testScenario.resources,
        testScenario.shelters,
        hazardProvider,
      );
      expect(unreachableRoundTrip).toBe(false);
    });

    it('Nearest-First solver marks enclosed request as UNREACHABLE_DUE_TO_HAZARD and serves reachable request', () => {
      const plan = solveNearestFirst(testScenario, { travelTimeProvider: hazardProvider });

      expect(plan.routes[0]?.servedRequestIds).toContain('req-reachable');
      const unserved = plan.unserved.find((u) => u.requestId === 'req-unreachable');
      expect(unserved).toBeDefined();
      expect(unserved?.reason).toBe('UNREACHABLE_DUE_TO_HAZARD');

      // Validator check: no leg crosses blocked zone under INFINITE
      const valResult = validateSolverPlan(testScenario, plan, {
        travelTimeProvider: hazardProvider,
      });
      expect(valResult.valid).toBe(true);
      expect(valResult.errors).toHaveLength(0);
    });

    it('Urgency-batched savings (Clarke-Wright) marks enclosed request as UNREACHABLE_DUE_TO_HAZARD and serves reachable request', () => {
      const plan = solveClarkeWrightBaseline(testScenario, { travelTimeProvider: hazardProvider });

      expect(plan.routes[0]?.servedRequestIds).toContain('req-reachable');
      const unserved = plan.unserved.find((u) => u.requestId === 'req-unreachable');
      expect(unserved).toBeDefined();
      expect(unserved?.reason).toBe('UNREACHABLE_DUE_TO_HAZARD');

      // Validator check: no leg crosses blocked zone under INFINITE
      const valResult = validateSolverPlan(testScenario, plan, {
        travelTimeProvider: hazardProvider,
      });
      expect(valResult.valid).toBe(true);
      expect(valResult.errors).toHaveLength(0);
    });

    it('Cluster-Allocation marks enclosed request as UNREACHABLE_DUE_TO_HAZARD and serves reachable request', () => {
      const plan = solveClusterAllocation(testScenario, { travelTimeProvider: hazardProvider });

      expect(plan.routes[0]?.servedRequestIds).toContain('req-reachable');
      const unserved = plan.unserved.find((u) => u.requestId === 'req-unreachable');
      expect(unserved).toBeDefined();
      expect(unserved?.reason).toBe('UNREACHABLE_DUE_TO_HAZARD');

      // Validator check: no leg crosses blocked zone under INFINITE
      const valResult = validateSolverPlan(testScenario, plan, {
        travelTimeProvider: hazardProvider,
      });
      expect(valResult.valid).toBe(true);
      expect(valResult.errors).toHaveLength(0);
    });

    it('validateSolverPlan detects and rejects any route leg that crosses an impassable hazard zone under INFINITE policy', () => {
      // Construct an invalid plan that attempts to visit the enclosed request
      const illegalPlan: SolverPlan = {
        scenarioId: testScenario.id,
        calculatedAt: '2026-11-01T00:00:00Z',
        routes: [
          {
            resourceId: 'res-hwv-1',
            stops: [
              {
                stopNumber: 1,
                type: 'PICKUP',
                targetId: 'req-unreachable',
                lat: 28.7,
                lng: 77.3,
                passengersPickedUp: 2,
                passengersDroppedOff: 0,
                estimatedArrivalMinutes: 50,
              },
              {
                stopNumber: 2,
                type: 'DROPOFF',
                targetId: 'shelter-1',
                lat: 28.5,
                lng: 77.1,
                passengersPickedUp: 0,
                passengersDroppedOff: 2,
                estimatedArrivalMinutes: 100,
              },
            ],
            totalDurationMinutes: 100,
            totalTravelDistanceKm: 50,
            servedRequestIds: ['req-unreachable'],
          },
        ],
        unserved: [
          {
            requestId: 'req-reachable',
            reason: 'SHIFT_LIMIT_REACHED',
          },
        ],
        metrics: {
          coveragePercent: 50,
          totalTravelDistanceKm: 50,
          totalTravelTimeMinutes: 100,
          highPriorityWaitTimeMinutes: 50,
          solveDurationMs: 10,
          servedRequestsCount: 1,
          unservedRequestsCount: 1,
        },
      };

      const valResult = validateSolverPlan(testScenario, illegalPlan, {
        travelTimeProvider: hazardProvider,
      });
      expect(valResult.valid).toBe(false);
      expect(
        valResult.errors.some((err) =>
          err.includes('crosses an impassable hazard zone under INFINITE policy'),
        ),
      ).toBe(true);
    });
  });
});
