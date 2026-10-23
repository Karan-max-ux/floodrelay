import type { Scenario } from '@floodrelay/shared';
import { describe, expect, it } from 'vitest';
import { generateScenario } from '../generator.js';
import { solveClarkeWrightBaseline } from './clarkeWrightBaseline.js';

describe('solveClarkeWrightBaseline', () => {
  const scenario: Scenario = {
    id: 'clarke-wright-test-scenario',
    metadata: {
      id: 'clarke-wright-test-scenario',
      name: 'Clarke-Wright Test Scenario',
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
        peopleCount: 2,
        urgency: 'MEDIUM',
        createdAt: '2026-10-15T12:00:00Z',
        source: 'SIMULATED',
      },
    ],
    resources: [
      {
        id: 'res-truck-1',
        name: 'High Water Truck 1',
        type: 'HIGH_WATER_VEHICLE',
        capacity: 10,
        speedKmH: 40,
        lat: 28.5,
        lng: 77.1,
        status: 'AVAILABLE',
      },
    ],
    shelters: [
      {
        id: 'shelter-1',
        name: 'Safe Depot',
        lat: 28.51,
        lng: 77.11,
        capacity: 100,
      },
    ],
  };

  it('serves requests while strictly obeying resource capacity constraints', () => {
    const plan = solveClarkeWrightBaseline(scenario);

    expect(plan.routes).toHaveLength(1);
    const route = plan.routes[0]!;

    let currentLoad = 0;
    for (const stop of route.stops) {
      if (stop.type === 'PICKUP') {
        currentLoad += stop.passengersPickedUp;
        expect(currentLoad).toBeLessThanOrEqual(10);
      } else if (stop.type === 'DROPOFF') {
        currentLoad -= stop.passengersDroppedOff;
        expect(currentLoad).toBe(0);
      }
    }

    expect(route.servedRequestIds).toHaveLength(3);
    expect(plan.metrics.coveragePercent).toBe(100);
    expect(plan.metrics.totalTravelTimeMinutes).toBeGreaterThan(0);
  });

  it('scales to 50 requests reliably', () => {
    const genScenario = generateScenario({
      seed: 888,
      requestCount: 50,
      resourceCount: 6,
      shelterCount: 2,
    });

    const plan = solveClarkeWrightBaseline(genScenario);

    expect(plan.routes.length).toBeGreaterThan(0);
    expect(plan.metrics.coveragePercent).toBeGreaterThan(40);
    expect(plan.metrics.solveDurationMs).toBeLessThan(1000);
  });
});
