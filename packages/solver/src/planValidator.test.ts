import type { Scenario, SolverPlan, UnservedReason } from '@floodrelay/shared';
import { describe, expect, it } from 'vitest';
import { assertValidSolverPlan, validateSolverPlan } from './planValidator.js';
import { StraightLineTravelTimeProvider } from './routing/travelTime.js';

describe('validateSolverPlan and assertValidSolverPlan', () => {
  const provider = new StraightLineTravelTimeProvider();

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

  // Build a physically exact valid plan using the travel provider
  const res = baseScenario.resources[0]!;
  const req1 = baseScenario.requests[0]!;
  const sh1 = baseScenario.shelters[0]!;

  const leg1 = provider.getTravelEstimate(
    { lat: res.lat, lng: res.lng },
    { lat: req1.lat, lng: req1.lng },
    res.speedKmH,
  );
  const leg2 = provider.getTravelEstimate(
    { lat: req1.lat, lng: req1.lng },
    { lat: sh1.lat, lng: sh1.lng },
    res.speedKmH,
  );

  const t1 = leg1.durationMinutes;
  const t2 = t1 + leg2.durationMinutes;
  const totalDist = Number((leg1.distanceKm + leg2.distanceKm).toFixed(2));
  const totalDur = Number(t2.toFixed(2));

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
            lat: req1.lat,
            lng: req1.lng,
            passengersPickedUp: 3,
            passengersDroppedOff: 0,
            estimatedArrivalMinutes: t1,
          },
          {
            stopNumber: 2,
            type: 'DROPOFF',
            targetId: 'shelter-1',
            lat: sh1.lat,
            lng: sh1.lng,
            passengersPickedUp: 0,
            passengersDroppedOff: 3,
            estimatedArrivalMinutes: totalDur,
          },
        ],
        totalTravelDistanceKm: totalDist,
        totalDurationMinutes: totalDur,
        servedRequestIds: ['req-1'],
      },
    ],
    unserved: [
      {
        requestId: 'req-2',
        reason: 'UNASSIGNED',
        details: 'Not selected within search bounds',
      },
    ],
    metrics: {
      coveragePercent: 50,
      totalTravelTimeMinutes: totalDur,
      totalTravelDistanceKm: totalDist,
      highPriorityWaitTimeMinutes: t1,
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

  it('rejects duplicate routes for the same resource', () => {
    const duplicateRoutePlan: SolverPlan = {
      ...validPlan,
      routes: [validPlan.routes[0]!, validPlan.routes[0]!],
    };
    const res = validateSolverPlan(baseScenario, duplicateRoutePlan);
    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => e.includes('Duplicate route for resource'))).toBe(true);
  });

  it('rejects physically impossible stop arrival times (too fast)', () => {
    const fastPlan: SolverPlan = {
      ...validPlan,
      routes: [
        {
          ...validPlan.routes[0]!,
          stops: [
            {
              ...validPlan.routes[0]!.stops[0]!,
              estimatedArrivalMinutes: 0.5, // Physically requires ~9.7 min
            },
            validPlan.routes[0]!.stops[1]!,
          ],
        },
      ],
    };
    const res = validateSolverPlan(baseScenario, fastPlan);
    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => e.includes('physically impossible'))).toBe(true);
  });

  it('rejects reported totalTravelDistanceKm inconsistent with actual stops', () => {
    const fakeDistPlan: SolverPlan = {
      ...validPlan,
      routes: [
        {
          ...validPlan.routes[0]!,
          totalTravelDistanceKm: 1.0, // actual is ~6.1 km
        },
      ],
    };
    const res = validateSolverPlan(baseScenario, fakeDistPlan);
    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => e.includes('inconsistent with recomputed stops distance'))).toBe(
      true,
    );
  });

  it('rejects reported totalDurationMinutes inconsistent with actual stops', () => {
    const fakeDurPlan: SolverPlan = {
      ...validPlan,
      routes: [
        {
          ...validPlan.routes[0]!,
          totalDurationMinutes: 2.0, // actual is ~14.6 min
        },
      ],
    };
    const res = validateSolverPlan(baseScenario, fakeDurPlan);
    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => e.includes('inconsistent with recomputed stops duration'))).toBe(
      true,
    );
  });

  it('rejects dropoff exceeding currently onboard passengers', () => {
    const badDropoffPlan: SolverPlan = {
      ...validPlan,
      routes: [
        {
          ...validPlan.routes[0]!,
          stops: [
            validPlan.routes[0]!.stops[0]!, // picked up 3
            {
              ...validPlan.routes[0]!.stops[1]!,
              passengersDroppedOff: 5, // dropping off 5 > 3 onboard!
            },
          ],
        },
      ],
    };
    const res = validateSolverPlan(baseScenario, badDropoffPlan);
    expect(res.valid).toBe(false);
    expect(
      res.errors.some((e) => e.includes('dropped off 5 passengers, but only 3 were onboard')),
    ).toBe(true);
  });

  it('rejects route ending with undelivered requests still onboard', () => {
    const undeliveredPlan: SolverPlan = {
      ...validPlan,
      routes: [
        {
          ...validPlan.routes[0]!,
          stops: [
            validPlan.routes[0]!.stops[0]!, // picked up req-1
            {
              ...validPlan.routes[0]!.stops[1]!,
              passengersDroppedOff: 1, // only dropped off 1, 2 still onboard!
            },
          ],
        },
      ],
    };
    const res = validateSolverPlan(baseScenario, undeliveredPlan);
    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => e.includes('still onboard'))).toBe(true);
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
              estimatedArrivalMinutes: t1,
            },
            {
              stopNumber: 2,
              type: 'PICKUP',
              targetId: 'req-2',
              lat: 28.54,
              lng: 77.14,
              passengersPickedUp: 4, // 3 + 4 = 7 > capacity 6!
              passengersDroppedOff: 0,
              estimatedArrivalMinutes: t1 + 8.0,
            },
            {
              stopNumber: 3,
              type: 'DROPOFF',
              targetId: 'shelter-1',
              lat: 28.51,
              lng: 77.11,
              passengersPickedUp: 0,
              passengersDroppedOff: 7,
              estimatedArrivalMinutes: t1 + 18.0,
            },
          ],
          totalTravelDistanceKm: 15.0,
          totalDurationMinutes: t1 + 18.0,
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

  it('detects route not ending at shelter', () => {
    const invalidPlan: SolverPlan = {
      ...validPlan,
      routes: [
        {
          resourceId: 'res-boat-1',
          stops: [validPlan.routes[0]!.stops[0]!],
          totalTravelDistanceKm: leg1.distanceKm,
          totalDurationMinutes: leg1.durationMinutes,
          servedRequestIds: ['req-1'],
        },
      ],
      unserved: [{ requestId: 'req-2', reason: 'UNASSIGNED' }],
    };

    const res = validateSolverPlan(baseScenario, invalidPlan);
    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => e.includes('must end with a DROPOFF stop'))).toBe(true);
  });

  it('detects shift limit violation', () => {
    const overtimePlan: SolverPlan = {
      ...validPlan,
      routes: [
        {
          ...validPlan.routes[0]!,
          totalDurationMinutes: 500,
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
              estimatedArrivalMinutes: 15.0,
            },
            {
              ...validPlan.routes[0]!.stops[1]!,
              estimatedArrivalMinutes: 5.0, // earlier than stop 1!
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
          resourceId: 'res-boat-2', // different resource id to test request duplication
          stops: validPlan.routes[0]!.stops,
          totalTravelDistanceKm: totalDist,
          totalDurationMinutes: totalDur,
          servedRequestIds: ['req-1'],
        },
      ],
      unserved: [{ requestId: 'req-2', reason: 'UNASSIGNED' }],
    };

    const scenarioWithTwoResources: Scenario = {
      ...baseScenario,
      resources: [
        baseScenario.resources[0]!,
        {
          ...baseScenario.resources[0]!,
          id: 'res-boat-2',
        },
      ],
    };

    const res = validateSolverPlan(scenarioWithTwoResources, duplicatePlan);
    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => e.includes('multiple routes'))).toBe(true);
  });

  it('rejects invalid unserved reason', () => {
    const badReasonPlan: SolverPlan = {
      ...validPlan,
      unserved: [
        {
          requestId: 'req-2',
          reason: 'INVALID_REASON_CODE' as unknown as UnservedReason,
        },
      ],
    };
    const res = validateSolverPlan(baseScenario, badReasonPlan);
    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => e.includes('has invalid reason'))).toBe(true);
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
