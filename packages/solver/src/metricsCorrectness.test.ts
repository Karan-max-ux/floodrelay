import { describe, expect, it } from 'vitest';
import {
  calculatePlanMetrics,
  generateScenario,
  solveClarkeWrightBaseline,
  solveClusterAllocation,
  solveNearestFirst,
  StraightLineTravelTimeProvider,
} from './index.js';

describe('Metric correctness across solvers', () => {
  const seeds = [2026, 101, 777];

  for (const seed of seeds) {
    it(`recomputed total travel time matches reported metric for seed ${seed}`, () => {
      const scenario = generateScenario({
        seed,
        requestCount: 35,
        resourceCount: 4,
        shelterCount: 2,
      });

      const provider = new StraightLineTravelTimeProvider();

      const solvers = [
        { name: 'Nearest-First', fn: solveNearestFirst },
        { name: 'Cluster-Allocation', fn: solveClusterAllocation },
        { name: 'Clarke-Wright + 2-opt', fn: solveClarkeWrightBaseline },
      ];

      for (const { name, fn } of solvers) {
        const plan = fn(scenario, { travelTimeProvider: provider });
        const metrics = calculatePlanMetrics(scenario, plan);

        // Recompute each route's travel time independently from its stops
        let recomputedPlanTotalMinutes = 0;

        for (const route of plan.routes) {
          const resource = scenario.resources.find((r) => r.id === route.resourceId);
          expect(resource, `Resource ${route.resourceId} not found in scenario`).toBeDefined();

          let currentLocation = { lat: resource!.lat, lng: resource!.lng };
          let recomputedRouteMinutes = 0;

          for (const stop of route.stops) {
            const estimate = provider.getTravelEstimate(
              currentLocation,
              { lat: stop.lat, lng: stop.lng },
              resource!.speedKmH,
            );
            recomputedRouteMinutes += estimate.durationMinutes;
            currentLocation = { lat: stop.lat, lng: stop.lng };
          }

          const routeReported = route.totalDurationMinutes;
          const routeRecomputed = Number(recomputedRouteMinutes.toFixed(2));

          expect(
            routeRecomputed,
            `Route duration mismatch for resource ${route.resourceId} in ${name}`,
          ).toBe(routeReported);

          recomputedPlanTotalMinutes += routeRecomputed;
        }

        const planRecomputed = Number(recomputedPlanTotalMinutes.toFixed(2));

        expect(
          plan.metrics.totalTravelTimeMinutes,
          `Plan metrics total travel time mismatch in ${name} (seed ${seed})`,
        ).toBe(planRecomputed);

        expect(
          metrics.totalTravelTimeMinutes,
          `calculatePlanMetrics total travel time mismatch in ${name} (seed ${seed})`,
        ).toBe(planRecomputed);
      }
    });
  }
});
