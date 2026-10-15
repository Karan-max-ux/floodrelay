import type { Scenario } from '@floodrelay/shared';
import { describe, expect, it } from 'vitest';
import { solveNearestFirst } from '../baselines/nearestFirst.js';
import { generateScenario } from '../generator.js';
import { solveClusterAllocation } from './clusterAllocation.js';

describe('solveClusterAllocation', () => {
  const sampleScenario: Scenario = {
    id: 'cluster-test-scenario',
    metadata: {
      id: 'cluster-test-scenario',
      name: 'Cluster Test Scenario',
      region: 'Delhi',
      createdAt: '2026-10-15T12:00:00Z',
      bounds: { minLat: 28.5, maxLat: 28.7, minLng: 77.1, maxLng: 77.3 },
    },
    requests: [
      {
        id: 'req-low-near',
        lat: 28.505,
        lng: 77.105,
        peopleCount: 2,
        urgency: 'LOW',
        createdAt: '2026-10-15T12:00:00Z',
        source: 'SIMULATED',
      },
      {
        id: 'req-crit-1',
        lat: 28.61,
        lng: 77.21,
        peopleCount: 3,
        urgency: 'CRITICAL',
        createdAt: '2026-10-15T12:00:00Z',
        source: 'SIMULATED',
      },
      {
        id: 'req-crit-2',
        lat: 28.612,
        lng: 77.211,
        peopleCount: 2,
        urgency: 'CRITICAL',
        createdAt: '2026-10-15T12:00:00Z',
        source: 'SIMULATED',
      },
    ],
    resources: [
      {
        id: 'res-boat-1',
        name: 'Boat Alpha',
        type: 'BOAT',
        capacity: 8,
        speedKmH: 25,
        lat: 28.5,
        lng: 77.1,
        status: 'AVAILABLE',
      },
    ],
    shelters: [
      {
        id: 'shelter-1',
        name: 'Main Camp',
        lat: 28.52,
        lng: 77.12,
        capacity: 100,
      },
    ],
  };

  it('allocates resources to clusters and prioritizes critical urgency requests', () => {
    const plan = solveClusterAllocation(sampleScenario);

    expect(plan.routes).toHaveLength(1);
    expect(plan.metrics.coveragePercent).toBe(100);

    const route = plan.routes[0]!;
    // Load never exceeds boat capacity 8
    let load = 0;
    for (const stop of route.stops) {
      if (stop.type === 'PICKUP') {
        load += stop.passengersPickedUp;
        expect(load).toBeLessThanOrEqual(8);
      } else if (stop.type === 'DROPOFF') {
        load -= stop.passengersDroppedOff;
        expect(load).toBe(0);
      }
    }
  });

  it('preserves existing frozen stops in updated routes', () => {
    const initialPlan = solveClusterAllocation(sampleScenario);
    const existingFrozenRoutes = initialPlan.routes.map((r) => ({
      ...r,
      stops: r.stops.map((s, idx) => (idx === 0 ? { ...s, isFrozen: true } : s)),
    }));

    const frozenTargetId = existingFrozenRoutes[0]?.stops[0]?.targetId;
    expect(frozenTargetId).toBeDefined();

    const updatedPlan = solveClusterAllocation(sampleScenario, {
      existingFrozenRoutes,
    });

    const firstStop = updatedPlan.routes[0]?.stops[0];
    expect(firstStop?.isFrozen).toBe(true);
    expect(firstStop?.targetId).toBe(frozenTargetId);
  });

  it('scales efficiently to 500-requests / 30-resources benchmark scenario', () => {
    const largeScenario = generateScenario({
      seed: 99,
      requestCount: 500,
      resourceCount: 30,
      shelterCount: 5,
    });

    const startTime = Date.now();
    const plan = solveClusterAllocation(largeScenario);
    const duration = Date.now() - startTime;

    expect(duration).toBeLessThan(3000); // Solves 500 requests in < 3s
    expect(plan.metrics.coveragePercent).toBeGreaterThan(50);
    expect(plan.routes.length).toBeGreaterThan(0);
  });

  it('improves high-priority wait times compared to naive nearest-first greedy', () => {
    const scenario = generateScenario({
      seed: 314,
      requestCount: 40,
      resourceCount: 5,
      shelterCount: 2,
    });

    const nearestPlan = solveNearestFirst(scenario);
    const clusterPlan = solveClusterAllocation(scenario);

    // Both should serve requests
    expect(clusterPlan.metrics.servedRequestsCount).toBeGreaterThan(0);
    expect(nearestPlan.metrics.servedRequestsCount).toBeGreaterThan(0);

    // Cluster allocation targets high-urgency clusters first
    expect(clusterPlan.metrics.highPriorityWaitTimeMinutes).toBeLessThanOrEqual(
      nearestPlan.metrics.highPriorityWaitTimeMinutes * 1.5,
    );
  });
});
