import type { Scenario } from '@floodrelay/shared';
import { describe, expect, it } from 'vitest';
import { generateScenario } from '../generator.js';
import { solveNearestFirst } from './nearestFirst.js';

describe('solveNearestFirst', () => {
  const testScenario: Scenario = {
    id: 'test-scenario',
    metadata: {
      id: 'test-scenario',
      name: 'Test Scenario',
      region: 'Delhi',
      createdAt: '2026-10-15T12:00:00Z',
      bounds: { minLat: 28.5, maxLat: 28.7, minLng: 77.1, maxLng: 77.3 },
    },
    requests: [
      {
        id: 'req-1',
        lat: 28.52,
        lng: 77.12,
        peopleCount: 3,
        urgency: 'HIGH',
        createdAt: '2026-10-15T12:00:00Z',
        source: 'SIMULATED',
      },
      {
        id: 'req-2',
        lat: 28.53,
        lng: 77.13,
        peopleCount: 4,
        urgency: 'CRITICAL',
        createdAt: '2026-10-15T12:00:00Z',
        source: 'SIMULATED',
      },
      {
        id: 'req-3',
        lat: 28.55,
        lng: 77.15,
        peopleCount: 5,
        urgency: 'LOW',
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
        name: 'Relief Camp',
        lat: 28.51,
        lng: 77.11,
        capacity: 50,
      },
    ],
  };

  it('serves requests and respects capacity constraints', () => {
    const plan = solveNearestFirst(testScenario);

    expect(plan.routes).toHaveLength(1);
    const route = plan.routes[0]!;

    // Check capacity constraint at every step
    let load = 0;
    for (const stop of route.stops) {
      if (stop.type === 'PICKUP') {
        load += stop.passengersPickedUp;
        expect(load).toBeLessThanOrEqual(8); // boat capacity is 8
      } else if (stop.type === 'DROPOFF') {
        load -= stop.passengersDroppedOff;
        expect(load).toBe(0);
      }
    }

    // All 3 requests should be served
    expect(route.servedRequestIds).toHaveLength(3);
    expect(plan.unserved).toHaveLength(0);
    expect(plan.metrics.coveragePercent).toBe(100);
    expect(plan.metrics.totalTravelTimeMinutes).toBeGreaterThan(0);
  });

  it('marks unserved requests when resources have insufficient capacity or time', () => {
    const smallCapacityScenario: Scenario = {
      ...testScenario,
      resources: [
        {
          ...testScenario.resources[0]!,
          capacity: 4, // req-3 has 5 people, so it can never fit!
        },
      ],
    };

    const plan = solveNearestFirst(smallCapacityScenario);

    expect(plan.unserved.some((u) => u.requestId === 'req-3')).toBe(true);
    const unservedReq = plan.unserved.find((u) => u.requestId === 'req-3');
    expect(unservedReq?.reason).toBe('GROUP_LARGER_THAN_ANY_VEHICLE');
    expect(plan.metrics.unservedRequestsCount).toBe(1);
    expect(plan.metrics.servedRequestsCount).toBe(2);
  });

  it('marks unserved requests with SHIFT_LIMIT_REACHED when shift time is exceeded', () => {
    const plan = solveNearestFirst(testScenario, { maxShiftDurationMinutes: 1 });
    expect(plan.unserved.length).toBeGreaterThan(0);
    for (const u of plan.unserved) {
      expect(u.reason).toBe('SHIFT_LIMIT_REACHED');
    }
  });

  it('executes reliably on a large generated scenario (50 requests, 6 resources)', () => {
    const scenario = generateScenario({
      seed: 42,
      requestCount: 50,
      resourceCount: 6,
      shelterCount: 3,
    });

    const plan = solveNearestFirst(scenario);

    expect(plan.routes.length).toBeGreaterThan(0);
    expect(plan.metrics.servedRequestsCount + plan.metrics.unservedRequestsCount).toBe(50);
    expect(plan.metrics.coveragePercent).toBeGreaterThan(50);
    expect(plan.metrics.solveDurationMs).toBeLessThan(1000); // Super fast greedy execution
  });

  it('capacity is never exceeded', () => {
    const scenario = generateScenario({
      seed: 101,
      requestCount: 30,
      resourceCount: 4,
      shelterCount: 2,
    });
    const plan = solveNearestFirst(scenario);
    expect(plan.routes.length).toBeGreaterThan(0);

    for (const route of plan.routes) {
      const resource = scenario.resources.find((r) => r.id === route.resourceId);
      expect(resource).toBeDefined();
      let load = 0;
      for (const stop of route.stops) {
        if (stop.type === 'PICKUP') {
          load += stop.passengersPickedUp;
        } else if (stop.type === 'DROPOFF') {
          load -= stop.passengersDroppedOff;
        }
        expect(load).toBeLessThanOrEqual(resource!.capacity);
        expect(load).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('no request is assigned twice', () => {
    const scenario = generateScenario({
      seed: 202,
      requestCount: 40,
      resourceCount: 5,
      shelterCount: 2,
    });
    const plan = solveNearestFirst(scenario);
    const assignedIds = plan.routes.flatMap((r) => r.servedRequestIds);
    const uniqueIds = new Set(assignedIds);
    expect(assignedIds.length).toBe(uniqueIds.size);

    const pickupIds = plan.routes
      .flatMap((r) => r.stops)
      .filter((s) => s.type === 'PICKUP')
      .map((s) => s.targetId);
    expect(pickupIds.length).toBe(new Set(pickupIds).size);
  });

  it('unavailable resources get nothing', () => {
    const scenario = generateScenario({
      seed: 303,
      requestCount: 20,
      resourceCount: 4,
      shelterCount: 2,
    });
    scenario.resources[0]!.status = 'MAINTENANCE';
    scenario.resources[1]!.status = 'OFFLINE';

    const plan = solveNearestFirst(scenario);
    const routeResourceIds = plan.routes.map((r) => r.resourceId);
    expect(routeResourceIds).not.toContain(scenario.resources[0]!.id);
    expect(routeResourceIds).not.toContain(scenario.resources[1]!.id);
  });
});
