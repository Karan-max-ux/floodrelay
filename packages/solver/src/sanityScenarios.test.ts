import type { Scenario } from '@floodrelay/shared';
import { describe, expect, it, vi } from 'vitest';
import {
  solveClarkeWrightBaseline,
  solveClusterAllocation,
  solveNearestFirst,
  solveOrToolsBaseline,
} from './index.js';
import { StraightLineTravelTimeProvider } from './routing/travelTime.js';

// Tests that spawn the OR-Tools Python process can exceed vitest's 5 s default when the full suite runs in parallel.
vi.setConfig({ testTimeout: 30_000 });

describe('Sanity Scenarios', () => {
  it('straight line scenario: Urgency-batched savings + 2-opt total travel time is <= nearest-first', () => {
    // 1 vehicle with capacity for all requests, requests placed along a line
    const straightLineScenario: Scenario = {
      id: 'straight-line-sanity',
      metadata: {
        id: 'straight-line-sanity',
        name: 'Straight Line Sanity',
        region: 'Delhi',
        createdAt: '2026-10-15T12:00:00Z',
        bounds: { minLat: 28.5, maxLat: 28.65, minLng: 77.1, maxLng: 77.15 },
      },
      requests: [
        {
          id: 'req-3',
          lat: 28.56,
          lng: 77.1,
          peopleCount: 2,
          urgency: 'LOW',
          createdAt: '2026-10-15T12:00:00Z',
          source: 'SIMULATED',
        },
        {
          id: 'req-1',
          lat: 28.52,
          lng: 77.1,
          peopleCount: 2,
          urgency: 'HIGH',
          createdAt: '2026-10-15T12:00:00Z',
          source: 'SIMULATED',
        },
        {
          id: 'req-5',
          lat: 28.6,
          lng: 77.1,
          peopleCount: 2,
          urgency: 'LOW',
          createdAt: '2026-10-15T12:00:00Z',
          source: 'SIMULATED',
        },
        {
          id: 'req-2',
          lat: 28.54,
          lng: 77.1,
          peopleCount: 2,
          urgency: 'CRITICAL',
          createdAt: '2026-10-15T12:00:00Z',
          source: 'SIMULATED',
        },
        {
          id: 'req-4',
          lat: 28.58,
          lng: 77.1,
          peopleCount: 2,
          urgency: 'MEDIUM',
          createdAt: '2026-10-15T12:00:00Z',
          source: 'SIMULATED',
        },
      ],
      resources: [
        {
          id: 'res-truck-1',
          name: 'Rescue Truck Alpha',
          type: 'HIGH_WATER_VEHICLE',
          capacity: 25, // Plenty of capacity for all 10 people
          speedKmH: 30,
          lat: 28.5,
          lng: 77.1,
          status: 'AVAILABLE',
        },
      ],
      shelters: [
        {
          id: 'shelter-depot',
          name: 'Home Depot Shelter',
          lat: 28.5,
          lng: 77.1,
          capacity: 100,
        },
      ],
    };

    const nfPlan = solveNearestFirst(straightLineScenario);
    const cwPlan = solveClarkeWrightBaseline(straightLineScenario);
    const caPlan = solveClusterAllocation(straightLineScenario);

    expect(nfPlan.metrics.coveragePercent).toBe(100);
    expect(cwPlan.metrics.coveragePercent).toBe(100);
    expect(caPlan.metrics.coveragePercent).toBe(100);

    // Required check: Urgency-batched savings + 2-opt total travel time <= nearest-first
    expect(cwPlan.metrics.totalTravelTimeMinutes).toBeLessThanOrEqual(
      nfPlan.metrics.totalTravelTimeMinutes,
    );
  });

  it('bidirectional straight line scenario: requests on both sides of vehicle start point', () => {
    // Vehicle starts at center (28.55, 77.10) with depot/shelter at center.
    // Requests on both sides along the north-south line, all with HIGH urgency.
    const bidirectionalLineScenario: Scenario = {
      id: 'bidirectional-line-sanity',
      metadata: {
        id: 'bidirectional-line-sanity',
        name: 'Bidirectional Line Sanity',
        region: 'Delhi',
        createdAt: '2026-10-15T12:00:00Z',
        bounds: { minLat: 28.5, maxLat: 28.6, minLng: 77.1, maxLng: 77.1 },
      },
      requests: [
        {
          id: 'req-n1',
          lat: 28.57,
          lng: 77.1,
          peopleCount: 2,
          urgency: 'HIGH',
          createdAt: '2026-10-15T12:00:00Z',
          source: 'SIMULATED',
        },
        {
          id: 'req-n2',
          lat: 28.59,
          lng: 77.1,
          peopleCount: 2,
          urgency: 'HIGH',
          createdAt: '2026-10-15T12:00:00Z',
          source: 'SIMULATED',
        },
        {
          id: 'req-s1',
          lat: 28.53,
          lng: 77.1,
          peopleCount: 2,
          urgency: 'HIGH',
          createdAt: '2026-10-15T12:00:00Z',
          source: 'SIMULATED',
        },
        {
          id: 'req-s2',
          lat: 28.51,
          lng: 77.1,
          peopleCount: 2,
          urgency: 'HIGH',
          createdAt: '2026-10-15T12:00:00Z',
          source: 'SIMULATED',
        },
      ],
      resources: [
        {
          id: 'res-truck-1',
          name: 'Rescue Truck Alpha',
          type: 'HIGH_WATER_VEHICLE',
          capacity: 20, // Enough capacity for all 8 people
          speedKmH: 30,
          lat: 28.55,
          lng: 77.1,
          status: 'AVAILABLE',
        },
      ],
      shelters: [
        {
          id: 'shelter-center',
          name: 'Center Depot Shelter',
          lat: 28.55,
          lng: 77.1,
          capacity: 100,
        },
      ],
    };

    const nfPlan = solveNearestFirst(bidirectionalLineScenario);
    const cwPlan = solveClarkeWrightBaseline(bidirectionalLineScenario);

    console.log(
      `[Sanity Check] Bidirectional line: Savings baseline total travel time = ${cwPlan.metrics.totalTravelTimeMinutes} min, Nearest-First = ${nfPlan.metrics.totalTravelTimeMinutes} min`,
    );

    expect(nfPlan.metrics.coveragePercent).toBe(100);
    expect(cwPlan.metrics.coveragePercent).toBe(100);
    expect(cwPlan.metrics.totalTravelTimeMinutes).toBeLessThanOrEqual(
      nfPlan.metrics.totalTravelTimeMinutes,
    );
  });

  it('two clusters far apart scenario: validates solver allocation behavior', () => {
    // Cluster 1 (South, near initial vehicle position, LOW urgency)
    // Cluster 2 (North, ~20 km away, CRITICAL urgency)
    const twoClustersScenario: Scenario = {
      id: 'two-clusters-sanity',
      metadata: {
        id: 'two-clusters-sanity',
        name: 'Two Clusters Far Apart',
        region: 'Delhi',
        createdAt: '2026-10-15T12:00:00Z',
        bounds: { minLat: 28.5, maxLat: 28.75, minLng: 77.1, maxLng: 77.3 },
      },
      requests: [
        // Cluster 1 (South) - LOW urgency
        {
          id: 'c1-req-1',
          lat: 28.505,
          lng: 77.105,
          peopleCount: 2,
          urgency: 'LOW',
          createdAt: '2026-10-15T12:00:00Z',
          source: 'SIMULATED',
        },
        {
          id: 'c1-req-2',
          lat: 28.51,
          lng: 77.11,
          peopleCount: 2,
          urgency: 'LOW',
          createdAt: '2026-10-15T12:00:00Z',
          source: 'SIMULATED',
        },
        {
          id: 'c1-req-3',
          lat: 28.515,
          lng: 77.105,
          peopleCount: 2,
          urgency: 'LOW',
          createdAt: '2026-10-15T12:00:00Z',
          source: 'SIMULATED',
        },

        // Cluster 2 (North, ~22km north) - CRITICAL urgency
        {
          id: 'c2-req-1',
          lat: 28.7,
          lng: 77.25,
          peopleCount: 2,
          urgency: 'CRITICAL',
          createdAt: '2026-10-15T12:00:00Z',
          source: 'SIMULATED',
        },
        {
          id: 'c2-req-2',
          lat: 28.705,
          lng: 77.255,
          peopleCount: 2,
          urgency: 'CRITICAL',
          createdAt: '2026-10-15T12:00:00Z',
          source: 'SIMULATED',
        },
        {
          id: 'c2-req-3',
          lat: 28.71,
          lng: 77.25,
          peopleCount: 2,
          urgency: 'CRITICAL',
          createdAt: '2026-10-15T12:00:00Z',
          source: 'SIMULATED',
        },
      ],
      resources: [
        {
          id: 'res-truck-1',
          name: 'High Water Truck 1',
          type: 'HIGH_WATER_VEHICLE',
          capacity: 20,
          speedKmH: 30,
          lat: 28.5,
          lng: 77.1,
          status: 'AVAILABLE',
        },
      ],
      shelters: [
        {
          id: 'shelter-south',
          name: 'South Camp',
          lat: 28.5,
          lng: 77.1,
          capacity: 50,
        },
        {
          id: 'shelter-north',
          name: 'North Camp',
          lat: 28.7,
          lng: 77.25,
          capacity: 50,
        },
      ],
    };

    const nfPlan = solveNearestFirst(twoClustersScenario);
    const cwPlan = solveClarkeWrightBaseline(twoClustersScenario);
    const caPlan = solveClusterAllocation(twoClustersScenario);

    // All three solvers successfully serve all requests
    expect(nfPlan.metrics.coveragePercent).toBe(100);
    expect(cwPlan.metrics.coveragePercent).toBe(100);
    expect(caPlan.metrics.coveragePercent).toBe(100);

    // Nearest-first visits the South cluster first (closest to vehicle start)
    const nfFirstPickup = nfPlan.routes[0]?.stops.find((s) => s.type === 'PICKUP');
    expect(nfFirstPickup?.targetId.startsWith('c1-')).toBe(true);

    // Cluster-Allocation prioritizes the CRITICAL cluster via DBSCAN cluster triage, visiting North first
    const caFirstPickup = caPlan.routes[0]?.stops.find((s) => s.type === 'PICKUP');
    expect(caFirstPickup?.targetId.startsWith('c2-')).toBe(true);

    // Clarke-Wright constructs a round-trip tour serving both clusters within shift limit
    expect(cwPlan.routes[0]?.servedRequestIds).toHaveLength(6);
  });

  it('exhaustive sanity test: no solver reports travel time below brute-force optimum', () => {
    const provider = new StraightLineTravelTimeProvider();

    const tinyScenario: Scenario = {
      id: 'tiny-exhaustive-sanity',
      metadata: {
        id: 'tiny-exhaustive-sanity',
        name: 'Tiny Exhaustive Sanity',
        region: 'Delhi',
        createdAt: '2026-10-15T12:00:00Z',
        bounds: { minLat: 28.5, maxLat: 28.65, minLng: 77.1, maxLng: 77.25 },
      },
      requests: [
        {
          id: 'req-1',
          lat: 28.52,
          lng: 77.12,
          peopleCount: 2,
          urgency: 'HIGH',
          createdAt: '2026-10-15T12:00:00Z',
          source: 'SIMULATED',
        },
        {
          id: 'req-2',
          lat: 28.56,
          lng: 77.18,
          peopleCount: 1,
          urgency: 'MEDIUM',
          createdAt: '2026-10-15T12:00:00Z',
          source: 'SIMULATED',
        },
        {
          id: 'req-3',
          lat: 28.61,
          lng: 77.15,
          peopleCount: 3,
          urgency: 'LOW',
          createdAt: '2026-10-15T12:00:00Z',
          source: 'SIMULATED',
        },
        {
          id: 'req-4',
          lat: 28.58,
          lng: 77.22,
          peopleCount: 2,
          urgency: 'CRITICAL',
          createdAt: '2026-10-15T12:00:00Z',
          source: 'SIMULATED',
        },
        {
          id: 'req-5',
          lat: 28.54,
          lng: 77.14,
          peopleCount: 2,
          urgency: 'HIGH',
          createdAt: '2026-10-15T12:00:00Z',
          source: 'SIMULATED',
        },
      ],
      resources: [
        {
          id: 'res-1',
          name: 'Rescue Alpha',
          type: 'HIGH_WATER_VEHICLE',
          capacity: 20, // ample capacity for all 10 passengers
          speedKmH: 30,
          lat: 28.5,
          lng: 77.1,
          status: 'AVAILABLE',
        },
      ],
      shelters: [
        {
          id: 'shelter-main',
          name: 'Main Safe Shelter',
          lat: 28.5,
          lng: 77.1,
          capacity: 100,
        },
      ],
    };

    function getPermutations<T>(items: T[]): T[][] {
      if (items.length <= 1) return [items];
      const result: T[][] = [];
      for (let i = 0; i < items.length; i++) {
        const current = items[i]!;
        const remaining = [...items.slice(0, i), ...items.slice(i + 1)];
        for (const p of getPermutations(remaining)) {
          result.push([current, ...p]);
        }
      }
      return result;
    }

    const reqs = tinyScenario.requests;
    const perms = getPermutations(reqs);
    const resource = tinyScenario.resources[0]!;
    const shelter = tinyScenario.shelters[0]!;

    let optimalDuration = Number.POSITIVE_INFINITY;
    for (const order of perms) {
      let time = 0;
      let loc = { lat: resource.lat, lng: resource.lng };
      for (const r of order) {
        time += provider.getTravelEstimate(loc, r, resource.speedKmH).durationMinutes;
        loc = { lat: r.lat, lng: r.lng };
      }
      time += provider.getTravelEstimate(loc, shelter, resource.speedKmH).durationMinutes;
      if (time < optimalDuration) {
        optimalDuration = time;
      }
    }

    const nfPlan = solveNearestFirst(tinyScenario);
    const cwPlan = solveClarkeWrightBaseline(tinyScenario);
    const caPlan = solveClusterAllocation(tinyScenario);
    const otPlan = solveOrToolsBaseline(tinyScenario, { timeLimitSeconds: 2 });

    console.log(
      `[Exhaustive Sanity] Brute-force optimum: ${optimalDuration.toFixed(2)} min | NF: ${nfPlan.metrics.totalTravelTimeMinutes.toFixed(2)} min | CW: ${cwPlan.metrics.totalTravelTimeMinutes.toFixed(2)} min | CA: ${caPlan.metrics.totalTravelTimeMinutes.toFixed(2)} min | OT: ${otPlan.metrics.totalTravelTimeMinutes.toFixed(2)} min`,
    );

    expect(nfPlan.metrics.coveragePercent).toBe(100);
    expect(cwPlan.metrics.coveragePercent).toBe(100);
    expect(caPlan.metrics.coveragePercent).toBe(100);
    expect(otPlan.metrics.coveragePercent).toBe(100);

    // No solver can report a travel time below the exhaustive theoretical optimum
    expect(nfPlan.metrics.totalTravelTimeMinutes).toBeGreaterThanOrEqual(optimalDuration - 1e-4);
    expect(cwPlan.metrics.totalTravelTimeMinutes).toBeGreaterThanOrEqual(optimalDuration - 1e-4);
    expect(caPlan.metrics.totalTravelTimeMinutes).toBeGreaterThanOrEqual(optimalDuration - 1e-4);
    expect(otPlan.metrics.totalTravelTimeMinutes).toBeGreaterThanOrEqual(optimalDuration - 1e-4);
  });
});
