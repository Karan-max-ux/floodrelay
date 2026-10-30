import type { Scenario, SolverPlan } from '@floodrelay/shared';
import { describe, expect, it } from 'vitest';
import { assertValidSolverPlan, validateSolverPlan } from './planValidator.js';

describe('validateSolverPlan and assertValidSolverPlan', () => {
  const baseScenario: Scenario = {
    id: 'val-scenario',
    metadata: {
      id: 'val-scenario',
      name: 'Validation Scenario',
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
        lat: 28.54,
        lng: 77.14,
        peopleCount: 4,
        urgency: 'MEDIUM',
        createdAt: '2026-10-15T12:00:00Z',
        source: 'SIMULATED',
      },
    ],
    resources: [
      {
        id: 'res-boat-1',
        name: 'Boat Alpha',
        type: 'BOAT',
        capacity: 6,
        speedKmH: 25,
        lat: 28.5,
        lng: 77.1,
        status: 'AVAILABLE',
      },
    ],
    shelters: [
      {
        id: 'shelter-1',
        name: 'Relief Camp Alpha',
        lat: 28.51,
        lng: 77.11,
        capacity: 50,
      },
    ],
  };

  const validPlan: SolverPlan = {
    scenarioId: 'val-scenario',
    calculatedAt: '2026-10-15T12:05:00Z',
    routes: [
      {
        resourceId: 'res-boat-1',
        stops: [
          {
            stopNumber: 1,
            type: 'PICKUP',
            targetId: 'req-1',
            lat: 28.52,
            lng: 77.12,
            passengersPickedUp: 3,
            passengersDroppedOff: 0,
            estimatedArrivalMinutes: 5.0,
          },
          {
            stopNumber: 2,
            type: 'DROPOFF',
            targetId: 'shelter-1',
            lat: 28.51,
            lng: 77.11,
            passengersPickedUp: 0,
            passengersDroppedOff: 3,
            estimatedArrivalMinutes: 10.0,
          },
        ],
        totalTravelDistanceKm: 8.5,
        totalDurationMinutes: 10.0,
        servedRequestIds: ['req-1'],
      },
    ],
    unserved: [
      {
        requestId: 'req-2',
        reason: 'CAPACITY_EXCEEDED',
        details: 'Not enough time/capacity',
      },
    ],
    metrics: {
      coveragePercent: 50,
      totalTravelTimeMinutes: 10.0,
      totalTravelDistanceKm: 8.5,
      highPriorityWaitTimeMinutes: 5.0,
      solveDurationMs: 15,
      servedRequestsCount: 1,
      unservedRequestsCount: 1,
    },
  };

  it('passes on a valid plan', () => {
    const res = validateSolverPlan(baseScenario, validPlan);
    expect(res.valid).toBe(true);
    expect(res.errors).toHaveLength(0);
    expect(() => assertValidSolverPlan(baseScenario, validPlan)).not.toThrow();
  });

  it('detects capacity overflow during route', () => {
    const invalidPlan: SolverPlan = {
      ...validPlan,
      routes: [
        {
          resourceId: 'res-boat-1',
          stops: [
            {
              stopNumber: 1,
              type: 'PICKUP',
              targetId: 'req-1',
              lat: 28.52,
              lng: 77.12,
              passengersPickedUp: 3,
              passengersDroppedOff: 0,
              estimatedArrivalMinutes: 5.0,
            },
            {
              stopNumber: 2,
              type: 'PICKUP',
              targetId: 'req-2',
              lat: 28.54,
              lng: 77.14,
              passengersPickedUp: 4, // 3 + 4 = 7 > capacity 6!
              passengersDroppedOff: 0,
              estimatedArrivalMinutes: 8.0,
            },
            {
              stopNumber: 3,
              type: 'DROPOFF',
              targetId: 'shelter-1',
              lat: 28.51,
              lng: 77.11,
              passengersPickedUp: 0,
              passengersDroppedOff: 7,
              estimatedArrivalMinutes: 15.0,
            },
          ],
          totalTravelDistanceKm: 12.0,
          totalDurationMinutes: 15.0,
          servedRequestIds: ['req-1', 'req-2'],
        },
      ],
      unserved: [],
    };

    const res = validateSolverPlan(baseScenario, invalidPlan);
    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => e.includes('exceeded vehicle capacity'))).toBe(true);
    expect(() => assertValidSolverPlan(baseScenario, invalidPlan)).toThrow(
      /exceeded vehicle capacity/,
    );
  });

  it('detects route not ending at shelter or ending with onboard passengers', () => {
    const invalidPlan: SolverPlan = {
      ...validPlan,
      routes: [
        {
          resourceId: 'res-boat-1',
          stops: [
            {
              stopNumber: 1,
              type: 'PICKUP',
              targetId: 'req-1',
              lat: 28.52,
              lng: 77.12,
              passengersPickedUp: 3,
              passengersDroppedOff: 0,
              estimatedArrivalMinutes: 5.0,
            },
          ],
          totalTravelDistanceKm: 4.0,
          totalDurationMinutes: 5.0,
          servedRequestIds: ['req-1'],
        },
      ],
      unserved: [{ requestId: 'req-2', reason: 'CAPACITY_EXCEEDED' }],
    };

    const res = validateSolverPlan(baseScenario, invalidPlan);
    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => e.includes('finished with 3 passengers still onboard'))).toBe(
      true,
    );
    expect(res.errors.some((e) => e.includes('must end with a DROPOFF stop'))).toBe(true);
  });

  it('detects shift limit violation', () => {
    const overtimePlan: SolverPlan = {
      ...validPlan,
      routes: [
        {
          ...validPlan.routes[0]!,
          totalDurationMinutes: 500, // maxShift is 480
        },
      ],
    };

    const res = validateSolverPlan(baseScenario, overtimePlan, { maxShiftMinutes: 480 });
    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => e.includes('exceeds max shift limit'))).toBe(true);
  });

  it('detects arrival time non-monotonicity', () => {
    const nonMonotonicPlan: SolverPlan = {
      ...validPlan,
      routes: [
        {
          ...validPlan.routes[0]!,
          stops: [
            {
              ...validPlan.routes[0]!.stops[0]!,
              estimatedArrivalMinutes: 12.0,
            },
            {
              ...validPlan.routes[0]!.stops[1]!,
              estimatedArrivalMinutes: 6.0, // earlier than stop 1!
            },
          ],
        },
      ],
    };

    const res = validateSolverPlan(baseScenario, nonMonotonicPlan);
    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => e.includes('earlier than previous stop'))).toBe(true);
  });

  it('detects duplicate request assignments across routes', () => {
    const duplicatePlan: SolverPlan = {
      ...validPlan,
      routes: [
        validPlan.routes[0]!,
        {
          resourceId: 'res-boat-1',
          stops: validPlan.routes[0]!.stops,
          totalTravelDistanceKm: 8.5,
          totalDurationMinutes: 10.0,
          servedRequestIds: ['req-1'],
        },
      ],
      unserved: [{ requestId: 'req-2', reason: 'CAPACITY_EXCEEDED' }],
    };

    const res = validateSolverPlan(baseScenario, duplicatePlan);
    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => e.includes('multiple routes'))).toBe(true);
  });

  it('rejects frozen routes and pre-assigned requests when allowFrozen is false', () => {
    const scenarioWithFrozen = {
      ...baseScenario,
      existingFrozenRoutes: [{ resourceId: 'res-boat-1', stops: [] }],
    };

    const res = validateSolverPlan(scenarioWithFrozen as unknown as Scenario, validPlan, {
      allowFrozen: false,
    });
    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => e.includes('existingFrozenRoutes'))).toBe(true);

    const scenarioWithAssignedReq: Scenario = {
      ...baseScenario,
      requests: [
        {
          ...baseScenario.requests[0]!,
          status: 'ASSIGNED',
        },
        baseScenario.requests[1]!,
      ],
    };
    const res2 = validateSolverPlan(scenarioWithAssignedReq, validPlan, { allowFrozen: false });
    expect(res2.valid).toBe(false);
    expect(res2.errors.some((e) => e.includes('pre-assigned status'))).toBe(true);
  });
});
