import { describe, it, expect } from 'vitest';
import type { GeoPoint, RescueRequest, Scenario, SolverPlan } from '@floodrelay/shared';
import {
  computePlanChurn,
  PerturbedTravelTimeProvider,
  perturbRequestTimestamps,
} from './perturbation.js';
import { StraightLineTravelTimeProvider } from '../routing/travelTime.js';
import { solveNearestFirst } from '../baselines/nearestFirst.js';

describe('Perturbation Modeling & Plan Churn', () => {
  const dummyPlanA: SolverPlan = {
    scenarioId: 'sc-test',
    calculatedAt: new Date().toISOString(),
    routes: [
      {
        resourceId: 'veh-1',
        totalDurationMinutes: 60,
        totalTravelDistanceKm: 20,
        servedRequestIds: ['req-1', 'req-2'],
        stops: [
          {
            stopNumber: 1,
            type: 'PICKUP',
            targetId: 'req-1',
            lat: 28.6,
            lng: 77.2,
            passengersPickedUp: 2,
            passengersDroppedOff: 0,
            estimatedArrivalMinutes: 10,
          },
          {
            stopNumber: 2,
            type: 'PICKUP',
            targetId: 'req-2',
            lat: 28.7,
            lng: 77.3,
            passengersPickedUp: 3,
            passengersDroppedOff: 0,
            estimatedArrivalMinutes: 30,
          },
        ],
      },
      {
        resourceId: 'veh-2',
        totalDurationMinutes: 45,
        totalTravelDistanceKm: 15,
        servedRequestIds: ['req-3'],
        stops: [
          {
            stopNumber: 1,
            type: 'PICKUP',
            targetId: 'req-3',
            lat: 28.5,
            lng: 77.1,
            passengersPickedUp: 1,
            passengersDroppedOff: 0,
            estimatedArrivalMinutes: 15,
          },
        ],
      },
    ],
    unserved: [],
    metrics: {
      totalTravelTimeMinutes: 105,
      totalTravelDistanceKm: 35,
      highPriorityWaitTimeMinutes: 0,
      solveDurationMs: 5,
      servedRequestsCount: 3,
      unservedRequestsCount: 0,
      coveragePercent: 100,
    },
  };

  describe('computePlanChurn', () => {
    it('returns zero churn for identical plans', () => {
      const churn = computePlanChurn(dummyPlanA, dummyPlanA);

      expect(churn.assignmentChurnRate).toBe(0);
      expect(churn.routeChurnRate).toBe(0);
      expect(churn.sequenceChurnRate).toBe(0);
      expect(churn.servedSetChanged).toBe(0);
      expect(churn.coverageDelta).toBe(0);
    });

    it('detects assignment churn when requests swap vehicles', () => {
      // Create swapped plan: req-1 assigned to veh-2, req-3 assigned to veh-1
      const swappedPlan: SolverPlan = {
        ...dummyPlanA,
        routes: [
          {
            ...dummyPlanA.routes[0]!,
            stops: [
              { ...dummyPlanA.routes[0]!.stops[1]!, stopNumber: 1, targetId: 'req-2' },
              { ...dummyPlanA.routes[1]!.stops[0]!, stopNumber: 2, targetId: 'req-3' },
            ],
          },
          {
            ...dummyPlanA.routes[1]!,
            stops: [{ ...dummyPlanA.routes[0]!.stops[0]!, stopNumber: 1, targetId: 'req-1' }],
          },
        ],
      };

      const churn = computePlanChurn(dummyPlanA, swappedPlan);
      // 2 of 3 requests changed vehicle => assignment churn = 2/3 = 0.6667
      expect(churn.assignmentChurnRate).toBeCloseTo(0.6667, 2);
      expect(churn.routeChurnRate).toBe(1.0); // both vehicles changed route
      expect(churn.coverageDelta).toBe(0);
    });

    it('detects route and sequence churn with 0 assignment churn on pure reorder', () => {
      // Reorder veh-1 pickups: req-2 then req-1
      const reorderedPlan: SolverPlan = {
        ...dummyPlanA,
        routes: [
          {
            ...dummyPlanA.routes[0]!,
            stops: [
              { ...dummyPlanA.routes[0]!.stops[1]!, stopNumber: 1, targetId: 'req-2' },
              { ...dummyPlanA.routes[0]!.stops[0]!, stopNumber: 2, targetId: 'req-1' },
            ],
          },
          dummyPlanA.routes[1]!,
        ],
      };

      const churn = computePlanChurn(dummyPlanA, reorderedPlan);
      // All requests remained on the same vehicle!
      expect(churn.assignmentChurnRate).toBe(0);
      // veh-1 route order changed (1 of 2 vehicles => 0.5)
      expect(churn.routeChurnRate).toBe(0.5);
      // Predecessors changed: req-1 predecessor was null, now req-2; req-2 was req-1, now null
      expect(churn.sequenceChurnRate).toBeGreaterThan(0);
      expect(churn.servedSetChanged).toBe(0);
    });
  });

  describe('PerturbedTravelTimeProvider', () => {
    it('returns exact base estimates when magnitude is zero (Control)', () => {
      const base = new StraightLineTravelTimeProvider();
      const pert = new PerturbedTravelTimeProvider(base, 0.0, 42);

      const from = { lat: 28.6, lng: 77.2 };
      const to = { lat: 28.7, lng: 77.3 };

      const baseEst = base.getTravelEstimate(from, to);
      const pertEst = pert.getTravelEstimate(from, to);

      expect(pertEst.distanceKm).toBe(baseEst.distanceKm);
      expect(pertEst.durationMinutes).toBe(baseEst.durationMinutes);
    });

    it('consistently and deterministically perturbs pairs within bounds', () => {
      const base = new StraightLineTravelTimeProvider();
      const pert = new PerturbedTravelTimeProvider(base, 0.25, 12345);

      const from = { lat: 28.6, lng: 77.2 };
      const to = { lat: 28.7, lng: 77.3 };

      const baseEst = base.getTravelEstimate(from, to);
      const est1 = pert.getTravelEstimate(from, to);
      const est2 = pert.getTravelEstimate(from, to);

      // Determinism
      expect(est1.distanceKm).toBe(est2.distanceKm);
      expect(est1.durationMinutes).toBe(est2.durationMinutes);

      // Within [0.75, 1.25]
      expect(est1.distanceKm).toBeGreaterThanOrEqual(baseEst.distanceKm * 0.74);
      expect(est1.distanceKm).toBeLessThanOrEqual(baseEst.distanceKm * 1.26);
    });

    it('verifies that solvers actually consume the injected travelTimeProvider', () => {
      const testScenario: Scenario = {
        id: 'mock-sc',
        metadata: {
          id: 'mock-sc',
          name: 'Mock Scenario',
          region: 'delhi',
          createdAt: new Date().toISOString(),
          bounds: { minLat: 28, maxLat: 29, minLng: 77, maxLng: 78 },
        },
        requests: [
          {
            id: 'r1',
            lat: 28.1,
            lng: 77.1,
            peopleCount: 1,
            urgency: 'LOW',
            status: 'PENDING',
            source: 'SIMULATED',
            createdAt: new Date().toISOString(),
          },
          {
            id: 'r2',
            lat: 28.2,
            lng: 77.2,
            peopleCount: 1,
            urgency: 'MEDIUM',
            status: 'PENDING',
            source: 'SIMULATED',
            createdAt: new Date().toISOString(),
          },
        ],
        resources: [
          {
            id: 'v1',
            name: 'Rescue Boat 1',
            type: 'BOAT',
            capacity: 5,
            speedKmH: 30,
            status: 'AVAILABLE',
            lat: 28.0,
            lng: 77.0,
          },
        ],
        shelters: [
          {
            id: 'sh1',
            name: 'Shelter 1',
            capacity: 50,
            lat: 28.3,
            lng: 77.3,
          },
        ],
      };

      const normalPlan = solveNearestFirst(testScenario, { maxShiftDurationMinutes: 10000 });
      expect(normalPlan.routes).toHaveLength(1);

      // Now inject a travel time provider that inflates travel times by 3x
      class InflatingProvider extends StraightLineTravelTimeProvider {
        override getTravelEstimate(from: GeoPoint, to: GeoPoint, speed?: number, flood?: boolean) {
          const res = super.getTravelEstimate(from, to, speed, flood);
          return {
            ...res,
            distanceKm: Number((res.distanceKm * 3.0).toFixed(3)),
            durationMinutes: Number((res.durationMinutes * 3.0).toFixed(2)),
          };
        }
      }

      const inflatedPlan = solveNearestFirst(testScenario, {
        travelTimeProvider: new InflatingProvider(),
        maxShiftDurationMinutes: 10000,
      });

      expect(inflatedPlan.routes).toHaveLength(1);
      expect(inflatedPlan.routes[0]!.totalTravelDistanceKm).toBeGreaterThan(
        normalPlan.routes[0]!.totalTravelDistanceKm * 2,
      );
    });
  });

  describe('perturbRequestTimestamps', () => {
    it('perturbs createdAt ISO timestamps within specified minute window', () => {
      const originalTime = new Date('2026-10-31T10:00:00Z').toISOString();
      const requests: RescueRequest[] = [
        {
          id: 'req-1',
          lat: 28.6,
          lng: 77.2,
          peopleCount: 2,
          urgency: 'HIGH',
          status: 'PENDING',
          source: 'SIMULATED',
          createdAt: originalTime,
        },
      ];

      const perturbed = perturbRequestTimestamps(requests, 30, 42);
      expect(perturbed).toHaveLength(1);

      const perturbedMs = new Date(perturbed[0]!.createdAt).getTime();
      const originalMs = new Date(originalTime).getTime();

      const diffMinutes = Math.abs(perturbedMs - originalMs) / (60 * 1000);
      expect(diffMinutes).toBeLessThanOrEqual(30);
    });
  });
});
