import type { Scenario } from '@floodrelay/shared';
import { describe, expect, it, vi } from 'vitest';

vi.setConfig({ testTimeout: 30_000 });
import { generateScenario } from '../generator.js';
import { solveOrToolsBaseline } from './ortoolsBaseline.js';

describe('solveOrToolsBaseline', () => {
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
    const plan = solveOrToolsBaseline(testScenario, { timeLimitSeconds: 2 });

    expect(plan.scenarioId).toBe('test-scenario');
    expect(plan.routes).toHaveLength(1);
    const route = plan.routes[0]!;

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
    expect(load).toBe(0);

    expect(route.servedRequestIds).toHaveLength(3);
    expect(plan.unserved).toHaveLength(0);
    expect(plan.metrics.coveragePercent).toBe(100);
    expect(plan.metrics.totalTravelTimeMinutes).toBeGreaterThan(0);
  });

  it('handles empty scenario', () => {
    const emptyScenario: Scenario = {
      ...testScenario,
      requests: [],
    };
    const plan = solveOrToolsBaseline(emptyScenario, { timeLimitSeconds: 1 });
    expect(plan.routes).toHaveLength(0);
    expect(plan.unserved).toHaveLength(0);
    expect(plan.metrics.coveragePercent).toBe(100);
  });

  it('marks unserved requests when peopleCount exceeds any vehicle capacity', () => {
    const oversizedScenario: Scenario = {
      ...testScenario,
      requests: [
        {
          id: 'req-huge',
          lat: 28.52,
          lng: 77.12,
          peopleCount: 15, // boat capacity is 8
          urgency: 'CRITICAL',
          createdAt: '2026-10-15T12:00:00Z',
          source: 'SIMULATED',
        },
      ],
    };

    const plan = solveOrToolsBaseline(oversizedScenario, { timeLimitSeconds: 1 });
    expect(plan.routes).toHaveLength(0);
    expect(plan.unserved).toHaveLength(1);
    expect(plan.unserved[0]?.reason).toBe('GROUP_LARGER_THAN_ANY_VEHICLE');
    expect(plan.metrics.coveragePercent).toBe(0);
  });

  it('marks unserved requests when resources are unavailable', () => {
    const offlineScenario: Scenario = {
      ...testScenario,
      resources: [
        {
          ...testScenario.resources[0]!,
          status: 'OFFLINE',
        },
      ],
    };

    const plan = solveOrToolsBaseline(offlineScenario, { timeLimitSeconds: 1 });
    expect(plan.routes).toHaveLength(0);
    expect(plan.unserved).toHaveLength(3);
    for (const u of plan.unserved) {
      expect(u.reason).toBe('CAPACITY_EXCEEDED');
    }
    expect(plan.metrics.coveragePercent).toBe(0);
  });

  it('marks unserved requests when no shelters exist', () => {
    const noSheltersScenario: Scenario = {
      ...testScenario,
      shelters: [],
    };

    const plan = solveOrToolsBaseline(noSheltersScenario, { timeLimitSeconds: 1 });
    expect(plan.routes).toHaveLength(0);
    expect(plan.unserved).toHaveLength(3);
    for (const u of plan.unserved) {
      expect(u.reason).toBe('NO_REACHABLE_RESOURCE');
    }
  });

  it('strictly enforces return leg to shelter within shift limit', () => {
    // 1 request ~10 km away. Round trip at 30 km/h is ~52 minutes.
    // Setting max shift duration to 35 minutes means vehicle can reach pickup,
    // but CANNOT return to shelter within shift limit.
    const regressionScenario: Scenario = {
      id: 'return-regression',
      metadata: testScenario.metadata,
      requests: [
        {
          id: 'req-distant',
          lat: 28.59,
          lng: 77.1,
          peopleCount: 2,
          urgency: 'HIGH',
          createdAt: '2026-10-15T12:00:00Z',
          source: 'SIMULATED',
        },
      ],
      resources: [
        {
          id: 'res-truck',
          name: 'Truck Alpha',
          type: 'HIGH_WATER_VEHICLE',
          capacity: 10,
          speedKmH: 30,
          lat: 28.5,
          lng: 77.1,
          status: 'AVAILABLE',
        },
      ],
      shelters: [
        {
          id: 'shelter-base',
          name: 'Base Shelter',
          lat: 28.5,
          lng: 77.1,
          capacity: 100,
        },
      ],
    };

    const plan = solveOrToolsBaseline(regressionScenario, {
      maxShiftMinutes: 35,
      timeLimitSeconds: 2,
    });

    expect(plan.routes).toHaveLength(0);
    expect(plan.unserved).toHaveLength(1);
    expect(plan.unserved[0]?.requestId).toBe('req-distant');
    expect(plan.unserved[0]?.reason).toBe('SHIFT_LIMIT_REACHED');
  });

  it('throws descriptive error on invalid script path', () => {
    expect(() =>
      solveOrToolsBaseline(testScenario, { scriptPath: '/non/existent/script.py' }),
    ).toThrow(/not found at/);
  });

  it('rejects scenario with existingFrozenRoutes in options or scenario', () => {
    expect(() =>
      solveOrToolsBaseline(testScenario, {
        existingFrozenRoutes: [
          {
            resourceId: 'res-boat-1',
            stops: [],
            totalTravelDistanceKm: 0,
            totalDurationMinutes: 0,
            servedRequestIds: [],
          },
        ],
      }),
    ).toThrow(/does not support frozen stops or existing frozen routes/);

    const scenarioWithFrozen = {
      ...testScenario,
      existingFrozenRoutes: [{ resourceId: 'res-boat-1', stops: [] }],
    };
    expect(() => solveOrToolsBaseline(scenarioWithFrozen as unknown as Scenario)).toThrow(
      /does not support frozen stops or existing frozen routes/,
    );
  });

  it('rejects scenario with pre-assigned requests', () => {
    const scenarioWithAssigned: Scenario = {
      ...testScenario,
      requests: [
        {
          ...testScenario.requests[0]!,
          status: 'IN_TRANSIT',
        },
      ],
    };
    expect(() => solveOrToolsBaseline(scenarioWithAssigned)).toThrow(
      /does not support pre-assigned\/frozen requests/,
    );
  });

  it('executes reliably on a generated scenario and satisfies invariants', () => {
    const scenario = generateScenario({
      seed: 42,
      requestCount: 20,
      resourceCount: 4,
      shelterCount: 2,
    });

    const plan = solveOrToolsBaseline(scenario, { timeLimitSeconds: 2 });

    expect(plan.routes.length).toBeGreaterThan(0);
    expect(plan.metrics.servedRequestsCount + plan.metrics.unservedRequestsCount).toBe(20);
    expect(plan.metrics.coveragePercent).toBeGreaterThan(50);

    // Invariant: capacity never exceeded at any stop
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
      expect(load).toBe(0);
      expect(route.totalDurationMinutes).toBeLessThanOrEqual(480.01);
    }

    // Invariant: no request assigned twice
    const assignedIds = plan.routes.flatMap((r) => r.servedRequestIds);
    expect(assignedIds.length).toBe(new Set(assignedIds).size);
  });
});
