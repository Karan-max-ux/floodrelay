import { describe, expect, it } from 'vitest';
import {
  generateScenario,
  solveClarkeWrightBaseline,
  solveClusterAllocation,
  solveNearestFirst,
} from './index.js';

describe('Shift-limit invariant across solvers (seeds 2026-2030, large scenario)', () => {
  const seeds = [2026, 2027, 2028, 2029, 2030];
  const maxShiftMinutes = 480;

  const solvers = [
    { name: 'Nearest-First (Greedy)', fn: solveNearestFirst },
    { name: 'Cluster-Allocation', fn: solveClusterAllocation },
    { name: 'Urgency-batched savings + 2-opt', fn: solveClarkeWrightBaseline },
  ];

  for (const { name, fn } of solvers) {
    it(`${name} strictly respects maxShiftMinutes on every route`, () => {
      for (const seed of seeds) {
        const scenario = generateScenario({
          seed,
          requestCount: 500,
          resourceCount: 30,
          shelterCount: 5,
        });

        const plan = fn(scenario);
        for (const route of plan.routes) {
          expect(
            route.totalDurationMinutes,
            `Route for resource ${route.resourceId} in seed ${seed} exceeded maxShiftMinutes (${route.totalDurationMinutes} > ${maxShiftMinutes})`,
          ).toBeLessThanOrEqual(maxShiftMinutes);
        }
      }
    });
  }
});
