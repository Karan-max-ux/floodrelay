import type { Scenario } from '@floodrelay/shared';
import { describe, expect, it } from 'vitest';
import { solveClarkeWrightBaseline, solveClusterAllocation, solveNearestFirst } from './index.js';

describe('Sanity Scenarios', () => {
  it('straight line scenario: Clarke-Wright + 2-opt total travel time is <= nearest-first', () => {
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

    // Required check: Clarke-Wright + 2-opt total travel time <= nearest-first
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
});
