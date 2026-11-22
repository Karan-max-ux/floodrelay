import type { Scenario } from '@floodrelay/shared';
import { describe, expect, it } from 'vitest';
import { solveNearestFirst } from '../baselines/nearestFirst.js';
import { generateScenario } from '../generator.js';
import type { TravelTimeProvider } from '../routing/travelTime.js';
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

  it('frozen stops are not moved by replanning', () => {
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

  it('capacity is never exceeded', () => {
    const scenario = generateScenario({
      seed: 404,
      requestCount: 30,
      resourceCount: 4,
      shelterCount: 2,
    });
    const plan = solveClusterAllocation(scenario);
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
      seed: 505,
      requestCount: 40,
      resourceCount: 5,
      shelterCount: 2,
    });
    const plan = solveClusterAllocation(scenario);
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
      seed: 606,
      requestCount: 20,
      resourceCount: 4,
      shelterCount: 2,
    });
    scenario.resources[0]!.status = 'MAINTENANCE';
    scenario.resources[1]!.status = 'OFFLINE';

    const plan = solveClusterAllocation(scenario);
    const routeResourceIds = plan.routes.map((r) => r.resourceId);
    expect(routeResourceIds).not.toContain(scenario.resources[0]!.id);
    expect(routeResourceIds).not.toContain(scenario.resources[1]!.id);
  });

  it('prefers road-capable vehicle with OSRM over boat with straight-line for road-accessible incident', () => {
    const scenario: Scenario = {
      id: 'test-road-pref',
      metadata: {
        id: 'test-road-pref',
        name: 'Road Pref Test',
        region: 'Delhi',
        createdAt: '2026-10-15T12:00:00Z',
        bounds: { minLat: 28.5, maxLat: 28.7, minLng: 77.1, maxLng: 77.3 },
      },
      requests: [
        {
          id: 'req-terrestrial-1',
          lat: 28.612,
          lng: 77.229,
          peopleCount: 3,
          urgency: 'CRITICAL',
          createdAt: '2026-10-15T12:00:00Z',
          source: 'SIMULATED',
        },
      ],
      resources: [
        {
          id: 'res-boat-1',
          name: 'Rescue Boat',
          type: 'BOAT',
          capacity: 6,
          speedKmH: 25,
          lat: 28.66,
          lng: 77.24,
          status: 'AVAILABLE',
        },
        {
          id: 'res-truck-1',
          name: 'Rescue Truck',
          type: 'HIGH_WATER_VEHICLE',
          capacity: 10,
          speedKmH: 30,
          lat: 28.665,
          lng: 77.218,
          status: 'AVAILABLE',
        },
      ],
      shelters: [
        {
          id: 'sh-1',
          name: 'Relief Shelter',
          capacity: 100,
          lat: 28.667,
          lng: 77.228,
        },
      ],
    };

    // Provider where boat has lower straight-line time (10 min), but truck has genuine OSRM road time (15 min)
    const mockProvider: TravelTimeProvider = {
      getTravelEstimate: (
        _from,
        _to,
        _speed?: number,
        _isFlooded?: boolean,
        resourceType?: string,
      ) => {
        if (resourceType === 'HIGH_WATER_VEHICLE') {
          return { distanceKm: 15, durationMinutes: 15, source: 'OSRM' };
        }
        return { distanceKm: 8, durationMinutes: 10, source: 'STRAIGHT_LINE' };
      },
      getMatrix: () => [],
    };

    const plan = solveClusterAllocation(scenario, { travelTimeProvider: mockProvider });
    expect(plan.routes.length).toBeGreaterThan(0);
    const assignedRoute = plan.routes.find((r) => r.servedRequestIds.includes('req-terrestrial-1'));
    expect(assignedRoute).toBeDefined();
    expect(assignedRoute!.resourceId).toBe('res-truck-1');
  });

  it('selects boat when road vehicle is blocked or has NoRoute (water-accessible incident)', () => {
    const scenario: Scenario = {
      id: 'water-scenario',
      metadata: {
        id: 'water-scenario',
        name: 'Water Access Scenario',
        region: 'Delhi',
        createdAt: '2026-10-15T12:00:00Z',
        bounds: { minLat: 28.5, maxLat: 28.7, minLng: 77.1, maxLng: 77.3 },
      },
      requests: [
        {
          id: 'req-island-1',
          lat: 28.612,
          lng: 77.229,
          peopleCount: 4,
          urgency: 'CRITICAL',
          createdAt: '2026-10-15T12:00:00Z',
          source: 'SIMULATED',
        },
      ],
      resources: [
        {
          id: 'res-truck-1',
          name: 'Rescue Truck',
          type: 'HIGH_WATER_VEHICLE',
          capacity: 10,
          speedKmH: 30,
          lat: 28.665,
          lng: 77.218,
          status: 'AVAILABLE',
        },
        {
          id: 'res-boat-1',
          name: 'Rescue Boat',
          type: 'BOAT',
          capacity: 6,
          speedKmH: 25,
          lat: 28.66,
          lng: 77.24,
          status: 'AVAILABLE',
        },
      ],
      shelters: [
        {
          id: 'sh-1',
          name: 'Relief Shelter',
          capacity: 100,
          lat: 28.667,
          lng: 77.228,
        },
      ],
    };

    const mockProvider: TravelTimeProvider = {
      getTravelEstimate: (
        _from,
        _to,
        _speed?: number,
        _isFlooded?: boolean,
        resourceType?: string,
      ) => {
        if (resourceType === 'HIGH_WATER_VEHICLE') {
          // Road route blocked by floodwaters or no road network
          return {
            distanceKm: Number.POSITIVE_INFINITY,
            durationMinutes: Number.POSITIVE_INFINITY,
            blocked: true,
          };
        }
        return { distanceKm: 5, durationMinutes: 12, source: 'STRAIGHT_LINE' };
      },
      getMatrix: () => [],
    };

    const plan = solveClusterAllocation(scenario, { travelTimeProvider: mockProvider });
    expect(plan.routes.length).toBeGreaterThan(0);
    const assignedRoute = plan.routes.find((r) => r.servedRequestIds.includes('req-island-1'));
    expect(assignedRoute).toBeDefined();
    expect(assignedRoute!.resourceId).toBe('res-boat-1');
  });

  it('selects helicopter when aircraft access is appropriate and faster', () => {
    const scenario: Scenario = {
      id: 'heli-scenario',
      metadata: {
        id: 'heli-scenario',
        name: 'Air Evacuation Scenario',
        region: 'Delhi',
        createdAt: '2026-10-15T12:00:00Z',
        bounds: { minLat: 28.5, maxLat: 28.7, minLng: 77.1, maxLng: 77.3 },
      },
      requests: [
        {
          id: 'req-remote-1',
          lat: 28.612,
          lng: 77.229,
          peopleCount: 2,
          urgency: 'CRITICAL',
          createdAt: '2026-10-15T12:00:00Z',
          source: 'SIMULATED',
        },
      ],
      resources: [
        {
          id: 'res-truck-1',
          name: 'Rescue Truck',
          type: 'HIGH_WATER_VEHICLE',
          capacity: 10,
          speedKmH: 30,
          lat: 28.665,
          lng: 77.218,
          status: 'AVAILABLE',
        },
        {
          id: 'res-heli-1',
          name: 'Rescue Helicopter',
          type: 'HELICOPTER',
          capacity: 4,
          speedKmH: 150,
          lat: 28.7,
          lng: 77.1,
          status: 'AVAILABLE',
        },
      ],
      shelters: [
        {
          id: 'sh-1',
          name: 'Relief Shelter',
          capacity: 100,
          lat: 28.667,
          lng: 77.228,
        },
      ],
    };

    const mockProvider: TravelTimeProvider = {
      getTravelEstimate: (
        _from,
        _to,
        _speed?: number,
        _isFlooded?: boolean,
        resourceType?: string,
      ) => {
        if (resourceType === 'HIGH_WATER_VEHICLE') {
          // Road route has NoRoute / blocked
          return {
            distanceKm: Number.POSITIVE_INFINITY,
            durationMinutes: Number.POSITIVE_INFINITY,
            blocked: true,
          };
        }
        return { distanceKm: 15, durationMinutes: 6, source: 'STRAIGHT_LINE' };
      },
      getMatrix: () => [],
    };

    const plan = solveClusterAllocation(scenario, { travelTimeProvider: mockProvider });
    expect(plan.routes.length).toBeGreaterThan(0);
    const assignedRoute = plan.routes.find((r) => r.servedRequestIds.includes('req-remote-1'));
    expect(assignedRoute).toBeDefined();
    expect(assignedRoute!.resourceId).toBe('res-heli-1');
  });

  it('strictly respects vehicle capacity constraints during allocation', () => {
    const scenario: Scenario = {
      id: 'capacity-scenario',
      metadata: {
        id: 'capacity-scenario',
        name: 'Capacity Scenario',
        region: 'Delhi',
        createdAt: '2026-10-15T12:00:00Z',
        bounds: { minLat: 28.5, maxLat: 28.7, minLng: 77.1, maxLng: 77.3 },
      },
      requests: [
        {
          id: 'req-large-family',
          lat: 28.612,
          lng: 77.229,
          peopleCount: 8,
          urgency: 'HIGH',
          createdAt: '2026-10-15T12:00:00Z',
          source: 'SIMULATED',
        },
      ],
      resources: [
        {
          id: 'res-boat-small',
          name: 'Small Boat',
          type: 'BOAT',
          capacity: 4, // Cannot fit 8
          speedKmH: 25,
          lat: 28.62,
          lng: 77.23,
          status: 'AVAILABLE',
        },
        {
          id: 'res-truck-large',
          name: 'Large Truck',
          type: 'HIGH_WATER_VEHICLE',
          capacity: 10, // Can fit 8
          speedKmH: 30,
          lat: 28.63,
          lng: 77.24,
          status: 'AVAILABLE',
        },
      ],
      shelters: [
        {
          id: 'sh-1',
          name: 'Relief Shelter',
          capacity: 100,
          lat: 28.64,
          lng: 77.25,
        },
      ],
    };

    const mockProvider: TravelTimeProvider = {
      getTravelEstimate: () => ({ distanceKm: 5, durationMinutes: 10, source: 'STRAIGHT_LINE' }),
      getMatrix: () => [],
    };

    const plan = solveClusterAllocation(scenario, { travelTimeProvider: mockProvider });
    const assignedRoute = plan.routes.find((r) => r.servedRequestIds.includes('req-large-family'));
    expect(assignedRoute).toBeDefined();
    expect(assignedRoute!.resourceId).toBe('res-truck-large');
  });

  it('constructs multi-stop pickup and shelter-dropoff legs correctly', () => {
    const scenario: Scenario = {
      id: 'multistop-scenario',
      metadata: {
        id: 'multistop-scenario',
        name: 'Multi-stop Scenario',
        region: 'Delhi',
        createdAt: '2026-10-15T12:00:00Z',
        bounds: { minLat: 28.5, maxLat: 28.7, minLng: 77.1, maxLng: 77.3 },
      },
      requests: [
        {
          id: 'req-stop-1',
          lat: 28.612,
          lng: 77.229,
          peopleCount: 3,
          urgency: 'HIGH',
          createdAt: '2026-10-15T12:00:00Z',
          source: 'SIMULATED',
        },
        {
          id: 'req-stop-2',
          lat: 28.615,
          lng: 77.231,
          peopleCount: 4,
          urgency: 'MEDIUM',
          createdAt: '2026-10-15T12:00:00Z',
          source: 'SIMULATED',
        },
      ],
      resources: [
        {
          id: 'res-truck-1',
          name: 'Large Truck',
          type: 'HIGH_WATER_VEHICLE',
          capacity: 10,
          speedKmH: 30,
          lat: 28.61,
          lng: 77.22,
          status: 'AVAILABLE',
        },
      ],
      shelters: [
        {
          id: 'sh-1',
          name: 'Relief Shelter',
          capacity: 100,
          lat: 28.63,
          lng: 77.25,
        },
      ],
    };

    const mockProvider: TravelTimeProvider = {
      getTravelEstimate: () => ({ distanceKm: 3, durationMinutes: 8, source: 'OSRM' }),
      getMatrix: () => [],
    };

    const plan = solveClusterAllocation(scenario, { travelTimeProvider: mockProvider });
    expect(plan.routes.length).toBe(1);
    const route = plan.routes[0]!;
    expect(route.servedRequestIds).toContain('req-stop-1');
    expect(route.servedRequestIds).toContain('req-stop-2');
    // Verify stops include pickups followed by dropoff at shelter
    const pickups = route.stops.filter((s) => s.type === 'PICKUP');
    const dropoffs = route.stops.filter((s) => s.type === 'DROPOFF');
    expect(pickups.length).toBe(2);
    expect(dropoffs.length).toBeGreaterThanOrEqual(1);
    expect(dropoffs[dropoffs.length - 1]!.targetId).toBe('sh-1');
  });

  it('safely handles scenario where no suitable resource is available', () => {
    const scenario: Scenario = {
      id: 'no-resource-scenario',
      metadata: {
        id: 'no-resource-scenario',
        name: 'No Resource Scenario',
        region: 'Delhi',
        createdAt: '2026-10-15T12:00:00Z',
        bounds: { minLat: 28.5, maxLat: 28.7, minLng: 77.1, maxLng: 77.3 },
      },
      requests: [
        {
          id: 'req-impossible',
          lat: 28.612,
          lng: 77.229,
          peopleCount: 20, // Exceeds all capacities
          urgency: 'HIGH',
          createdAt: '2026-10-15T12:00:00Z',
          source: 'SIMULATED',
        },
      ],
      resources: [
        {
          id: 'res-small',
          name: 'Small Boat',
          type: 'BOAT',
          capacity: 5,
          speedKmH: 25,
          lat: 28.61,
          lng: 77.22,
          status: 'AVAILABLE',
        },
      ],
      shelters: [
        {
          id: 'sh-1',
          name: 'Relief Shelter',
          capacity: 100,
          lat: 28.63,
          lng: 77.25,
        },
      ],
    };

    const mockProvider: TravelTimeProvider = {
      getTravelEstimate: () => ({ distanceKm: 5, durationMinutes: 10, source: 'STRAIGHT_LINE' }),
      getMatrix: () => [],
    };

    const plan = solveClusterAllocation(scenario, { travelTimeProvider: mockProvider });
    // Since req-impossible cannot fit into any resource, no route can serve it
    const served = plan.routes.flatMap((r) => r.servedRequestIds);
    expect(served).not.toContain('req-impossible');
  });
});
