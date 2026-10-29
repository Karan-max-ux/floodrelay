import type { Scenario, SolverPlan } from '@floodrelay/shared';
import { describe, expect, it } from 'vitest';
import { calculateChurn, calculatePlanMetrics } from './metrics.js';

describe('calculatePlanMetrics', () => {
  const sampleScenario: Scenario = {
    id: 'test-scenario',
    metadata: {
      id: 'test-scenario',
      name: 'Test Scenario',
      region: 'Delhi',
      createdAt: '2026-10-15T12:00:00Z',
      bounds: { minLat: 28, maxLat: 29, minLng: 77, maxLng: 78 },
    },
    requests: [
      {
        id: 'req-1',
        lat: 28.1,
        lng: 77.1,
        peopleCount: 2,
        urgency: 'CRITICAL',
        createdAt: '2026-10-15T12:00:00Z',
        source: 'SIMULATED',
      },
      {
        id: 'req-2',
        lat: 28.2,
        lng: 77.2,
        peopleCount: 4,
        urgency: 'HIGH',
        createdAt: '2026-10-15T12:00:00Z',
        source: 'SIMULATED',
      },
      {
        id: 'req-3',
        lat: 28.3,
        lng: 77.3,
        peopleCount: 3,
        urgency: 'LOW',
        createdAt: '2026-10-15T12:00:00Z',
        source: 'SIMULATED',
      },
      {
        id: 'req-4',
        lat: 28.4,
        lng: 77.4,
        peopleCount: 1,
        urgency: 'LOW',
        createdAt: '2026-10-15T12:00:00Z',
        source: 'SIMULATED',
      },
    ],
    resources: [
      {
        id: 'res-1',
        name: 'Boat 1',
        type: 'BOAT',
        capacity: 10,
        speedKmH: 25,
        lat: 28.0,
        lng: 77.0,
        status: 'AVAILABLE',
      },
    ],
    shelters: [
      {
        id: 'shelter-1',
        name: 'Camp 1',
        lat: 28.5,
        lng: 77.5,
        capacity: 50,
      },
    ],
  };

  it('computes 50% coverage when 2 out of 4 requests are served', () => {
    const plan: SolverPlan = {
      scenarioId: 'test-scenario',
      calculatedAt: '2026-10-15T12:05:00Z',
      routes: [
        {
          resourceId: 'res-1',
          totalTravelDistanceKm: 15.5,
          totalDurationMinutes: 37.2,
          servedRequestIds: ['req-1', 'req-2'],
          stops: [
            {
              stopNumber: 1,
              type: 'PICKUP',
              targetId: 'req-1',
              lat: 28.1,
              lng: 77.1,
              passengersPickedUp: 2,
              passengersDroppedOff: 0,
              estimatedArrivalMinutes: 10,
            },
            {
              stopNumber: 2,
              type: 'PICKUP',
              targetId: 'req-2',
              lat: 28.2,
              lng: 77.2,
              passengersPickedUp: 4,
              passengersDroppedOff: 0,
              estimatedArrivalMinutes: 20,
            },
          ],
        },
      ],
      unserved: [
        { requestId: 'req-3', reason: 'CAPACITY_EXCEEDED' },
        { requestId: 'req-4', reason: 'CAPACITY_EXCEEDED' },
      ],
      metrics: {
        coveragePercent: 0,
        totalTravelTimeMinutes: 0,
        totalTravelDistanceKm: 0,
        highPriorityWaitTimeMinutes: 0,
        solveDurationMs: 0,
        servedRequestsCount: 0,
        unservedRequestsCount: 0,
      },
    };

    const metrics = calculatePlanMetrics(sampleScenario, plan, 45);

    expect(metrics.coveragePercent).toBe(50);
    expect(metrics.servedRequestsCount).toBe(2);
    expect(metrics.unservedRequestsCount).toBe(2);
    expect(metrics.totalTravelDistanceKm).toBe(15.5);
    expect(metrics.totalTravelTimeMinutes).toBe(37.2);
    expect(metrics.solveDurationMs).toBe(45);
    // req-1 (CRITICAL) waited 10 min, req-2 (HIGH) waited 20 min -> avg high priority = 15 min
    expect(metrics.highPriorityWaitTimeMinutes).toBe(15);
    expect(metrics.criticalWaitTimeMinutes).toBe(10);
    expect(metrics.maxWaitTimeMinutes).toBe(20);
  });

  it('returns 100% coverage for empty scenarios', () => {
    const emptyScenario: Scenario = { ...sampleScenario, requests: [] };
    const emptyPlan: SolverPlan = {
      scenarioId: 'test',
      calculatedAt: '2026-10-15T12:00:00Z',
      routes: [],
      unserved: [],
      metrics: {
        coveragePercent: 0,
        totalTravelTimeMinutes: 0,
        totalTravelDistanceKm: 0,
        highPriorityWaitTimeMinutes: 0,
        solveDurationMs: 0,
        servedRequestsCount: 0,
        unservedRequestsCount: 0,
      },
    };

    const metrics = calculatePlanMetrics(emptyScenario, emptyPlan);
    expect(metrics.coveragePercent).toBe(100);
    expect(metrics.servedRequestsCount).toBe(0);
    expect(metrics.unservedRequestsCount).toBe(0);
  });
});

describe('calculateChurn', () => {
  const planA: SolverPlan = {
    scenarioId: 'test',
    calculatedAt: '2026-10-15T12:00:00Z',
    routes: [
      {
        resourceId: 'boat-1',
        servedRequestIds: ['req-1', 'req-2'],
        totalDurationMinutes: 30,
        totalTravelDistanceKm: 10,
        stops: [
          {
            stopNumber: 1,
            type: 'PICKUP',
            targetId: 'req-1',
            lat: 28.1,
            lng: 77.1,
            passengersPickedUp: 2,
            passengersDroppedOff: 0,
            estimatedArrivalMinutes: 10,
            isFrozen: true, // Frozen committed stop
          },
          {
            stopNumber: 2,
            type: 'PICKUP',
            targetId: 'req-2',
            lat: 28.2,
            lng: 77.2,
            passengersPickedUp: 2,
            passengersDroppedOff: 0,
            estimatedArrivalMinutes: 20,
          },
        ],
      },
    ],
    unserved: [],
    metrics: {
      coveragePercent: 100,
      totalTravelTimeMinutes: 30,
      totalTravelDistanceKm: 10,
      highPriorityWaitTimeMinutes: 10,
      solveDurationMs: 5,
      servedRequestsCount: 2,
      unservedRequestsCount: 0,
    },
  };

  it('calculates 0% churn when assignments are unchanged', () => {
    const churn = calculateChurn(planA, planA);
    expect(churn.churnPercent).toBe(0);
    expect(churn.reassignedRequestsCount).toBe(0);
    expect(churn.frozenStopsViolated).toBe(0);
  });

  it('detects churn and frozen violations when assignments shift', () => {
    const planB: SolverPlan = {
      ...planA,
      routes: [
        {
          resourceId: 'truck-2', // reassigned to a different resource!
          servedRequestIds: ['req-1'],
          totalDurationMinutes: 20,
          totalTravelDistanceKm: 8,
          stops: [
            {
              stopNumber: 1,
              type: 'PICKUP',
              targetId: 'req-1',
              lat: 28.1,
              lng: 77.1,
              passengersPickedUp: 2,
              passengersDroppedOff: 0,
              estimatedArrivalMinutes: 15,
            },
          ],
        },
      ],
    };

    const churn = calculateChurn(planA, planB);
    // req-1 moved from boat-1 to truck-2, req-2 is now unassigned -> 2 reassignments out of 2 = 100% churn
    expect(churn.reassignedRequestsCount).toBe(2);
    expect(churn.churnPercent).toBe(100);
    // Frozen stop req-1 on boat-1 was moved, violating frozen stop
    expect(churn.frozenStopsViolated).toBe(1);
  });
});
