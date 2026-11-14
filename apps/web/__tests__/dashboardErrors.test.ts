import { describe, it, expect } from 'vitest';
import type { AssignmentRecord, OperationalEvent } from '../lib/api/types';
import type { RescueRequest } from '@floodrelay/shared';
import { isAbortError } from '../lib/api/errors';

describe('Phase 5 Part 3 — Dashboard Real API Error Preservation', () => {
  // Simulator for the dashboard's fetchDashboardData logic with error preservation
  async function simulateFetchDashboardData(
    mockApis: {
      listRequests: () => Promise<RescueRequest[]>;
      listAssignments: () => Promise<AssignmentRecord[]>;
      listEvents: () => Promise<OperationalEvent[]>;
    },
    previousData: {
      assignments: AssignmentRecord[] | null;
      recentEvents: OperationalEvent[] | null;
    },
    signal?: AbortSignal,
  ) {
    const [requestsResult, assignmentsResult, eventsResult] = await Promise.allSettled([
      mockApis.listRequests(),
      mockApis.listAssignments(),
      mockApis.listEvents(),
    ]);

    if (signal?.aborted) {
      throw (
        (requestsResult.status === 'rejected' && isAbortError(requestsResult.reason)
          ? requestsResult.reason
          : null) || new DOMException('The operation was aborted', 'AbortError')
      );
    }

    if (requestsResult.status === 'rejected') {
      if (isAbortError(requestsResult.reason)) {
        throw requestsResult.reason;
      }
      throw requestsResult.reason;
    }
    const requests = requestsResult.value || [];

    let assignments: AssignmentRecord[] | null = null;
    let assignmentsError: string | null = null;
    let assignmentsStale = false;

    if (assignmentsResult.status === 'fulfilled') {
      assignments = assignmentsResult.value || [];
      previousData.assignments = assignments;
    } else {
      const err = assignmentsResult.reason as Error;
      if (!isAbortError(err)) {
        assignmentsError = err?.message || 'Failed to fetch assignments';
        if (previousData.assignments !== null) {
          assignments = previousData.assignments;
          assignmentsStale = true;
        }
      } else {
        assignments = previousData.assignments;
      }
    }

    let recentEvents: OperationalEvent[] | null = null;
    let eventsError: string | null = null;
    let eventsStale = false;

    if (eventsResult.status === 'fulfilled') {
      recentEvents = eventsResult.value || [];
      previousData.recentEvents = recentEvents;
    } else {
      const err = eventsResult.reason as Error;
      if (!isAbortError(err)) {
        eventsError = err?.message || 'Failed to fetch operational events';
        if (previousData.recentEvents !== null) {
          recentEvents = previousData.recentEvents;
          eventsStale = true;
        }
      } else {
        recentEvents = previousData.recentEvents;
      }
    }

    return {
      requests,
      assignments,
      recentEvents,
      assignmentsError,
      assignmentsStale,
      eventsError,
      eventsStale,
      hasPartialFailure: Boolean(assignmentsError || eventsError),
    };
  }

  it('preserves cached assignments data and sets stale flag when assignments endpoint fails', async () => {
    const cachedAssignment: AssignmentRecord = {
      id: 'plan-harris-001',
      scenario_id: 'sector-4',
      status: 'COMMITTED',
      routes: [],
      unserved: [],
      metrics: {
        coveragePercent: 85,
        totalTravelTimeMinutes: 120,
        totalTravelDistanceKm: 45,
        highPriorityWaitTimeMinutes: 15,
        solveDurationMs: 400,
        servedRequestsCount: 12,
        unservedRequestsCount: 2,
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const previousCache = {
      assignments: [cachedAssignment],
      recentEvents: null,
    };

    const result = await simulateFetchDashboardData(
      {
        listRequests: async () => [
          {
            id: 'req-1',
            lat: 29.7,
            lng: -95.3,
            urgency: 'HIGH',
            peopleCount: 2,
            source: 'REPORTED',
            createdAt: new Date().toISOString(),
          },
        ],
        listAssignments: async () => {
          throw new Error('503 Service Unavailable: Solver engine down');
        },
        listEvents: async () => [],
      },
      previousCache,
    );

    // Error must be preserved, NOT swallowed into empty array
    expect(result.assignmentsError).toBe('503 Service Unavailable: Solver engine down');
    expect(result.assignmentsStale).toBe(true);
    // Cached assignment is retained, not zeroed out!
    expect(result.assignments).toHaveLength(1);
    expect(result.assignments![0].id).toBe('plan-harris-001');
    expect(result.hasPartialFailure).toBe(true);
  });

  it('marks assignments as null (Data Unavailable) rather than false 0 when initial fetch fails', async () => {
    const previousCache = {
      assignments: null,
      recentEvents: null,
    };

    const result = await simulateFetchDashboardData(
      {
        listRequests: async () => [],
        listAssignments: async () => {
          throw new Error('500 Internal Server Error: Database connection refused');
        },
        listEvents: async () => [],
      },
      previousCache,
    );

    // Initial failure with no cache must yield null data, not []
    expect(result.assignments).toBeNull();
    expect(result.assignmentsError).toBe('500 Internal Server Error: Database connection refused');
    expect(result.assignmentsStale).toBe(false);
    expect(result.hasPartialFailure).toBe(true);
  });

  it('distinguishes between genuine empty response and network error', async () => {
    const previousCache = {
      assignments: null,
      recentEvents: null,
    };

    // Successful empty
    const successResult = await simulateFetchDashboardData(
      {
        listRequests: async () => [],
        listAssignments: async () => [], // Successfully returned 0 assignments
        listEvents: async () => [],
      },
      previousCache,
    );

    expect(successResult.assignments).toEqual([]);
    expect(successResult.assignmentsError).toBeNull();
    expect(successResult.hasPartialFailure).toBe(false);

    // Failure without prior cache
    const freshCache = {
      assignments: null,
      recentEvents: null,
    };
    const failureResult = await simulateFetchDashboardData(
      {
        listRequests: async () => [],
        listAssignments: async () => {
          throw new Error('Network error');
        },
        listEvents: async () => [],
      },
      freshCache,
    );

    expect(failureResult.assignments).toBeNull();
    expect(failureResult.assignmentsError).toBe('Network error');
    expect(failureResult.hasPartialFailure).toBe(true);
  });

  it('preserves cached operational events and sets stale flag when events endpoint fails', async () => {
    const cachedEvent: OperationalEvent = {
      id: 'evt-101',
      type: 'ROAD_BLOCKED',
      entityType: 'ROAD_ZONE',
      entityId: 'zone-north-braeswood',
      actorId: 'op-001',
      actorType: 'OPERATOR',
      occurredAt: new Date().toISOString(),
      recordedAt: new Date().toISOString(),
      entityVersion: 1,
      processingStatus: 'SCOPE_IDENTIFIED',
      processingAttempts: 1,
      payload: { reason: 'Severe high-water surge' },
    };

    const previousCache = {
      assignments: null,
      recentEvents: [cachedEvent],
    };

    const result = await simulateFetchDashboardData(
      {
        listRequests: async () => [],
        listAssignments: async () => [],
        listEvents: async () => {
          throw new Error('503 Service Unavailable: Event bus partitioned');
        },
      },
      previousCache,
    );

    expect(result.eventsError).toBe('503 Service Unavailable: Event bus partitioned');
    expect(result.eventsStale).toBe(true);
    expect(result.recentEvents).toHaveLength(1);
    expect(result.recentEvents![0].id).toBe('evt-101');
    expect(result.hasPartialFailure).toBe(true);
  });

  it('marks operational events as null (Data Unavailable) when initial fetch fails without prior cache', async () => {
    const previousCache = {
      assignments: null,
      recentEvents: null,
    };

    const result = await simulateFetchDashboardData(
      {
        listRequests: async () => [],
        listAssignments: async () => [],
        listEvents: async () => {
          throw new Error('Events API request failed with HTTP 500');
        },
      },
      previousCache,
    );

    expect(result.recentEvents).toBeNull();
    expect(result.eventsError).toBe('Events API request failed with HTTP 500');
    expect(result.eventsStale).toBe(false);
    expect(result.hasPartialFailure).toBe(true);
  });

  it('confirms that an empty events response returns HTTP 200 with an empty list, not a failure', async () => {
    const previousCache = {
      assignments: null,
      recentEvents: null,
    };

    const result = await simulateFetchDashboardData(
      {
        listRequests: async () => [],
        listAssignments: async () => [],
        listEvents: async () => [], // Genuine HTTP 200 with empty array []
      },
      previousCache,
    );

    expect(result.recentEvents).toEqual([]);
    expect(result.eventsError).toBeNull();
    expect(result.eventsStale).toBe(false);
    expect(result.hasPartialFailure).toBe(false);
  });

  it('clears partial failure warning when previously failed events recover to healthy feed', async () => {
    const cachedEvent: OperationalEvent = {
      id: 'evt-cached',
      type: 'RESOURCE_OFFLINE',
      entityType: 'RESOURCE',
      entityId: 'res-boat-1',
      actorId: 'op-002',
      actorType: 'OPERATOR',
      occurredAt: new Date().toISOString(),
      recordedAt: new Date().toISOString(),
      entityVersion: 1,
      processingStatus: 'AWAITING_REPAIR',
      processingAttempts: 1,
      payload: {},
    };

    const state = {
      assignments: null,
      recentEvents: [cachedEvent],
    };

    // Step 1: Failed polling cycle
    const failedCycle = await simulateFetchDashboardData(
      {
        listRequests: async () => [],
        listAssignments: async () => [],
        listEvents: async () => {
          throw new Error('404 Not Found');
        },
      },
      state,
    );
    expect(failedCycle.hasPartialFailure).toBe(true);
    expect(failedCycle.eventsStale).toBe(true);

    // Step 2: Next cycle, proxy route is fixed, returns fresh events
    const recoveredEvent: OperationalEvent = {
      id: 'evt-fresh',
      type: 'REQUEST_CREATED',
      entityType: 'REQUEST',
      entityId: 'req-new',
      actorId: null,
      actorType: 'CITIZEN',
      occurredAt: new Date().toISOString(),
      recordedAt: new Date().toISOString(),
      entityVersion: 1,
      processingStatus: 'RECORDED',
      processingAttempts: 0,
      payload: {},
    };

    const recoveredCycle = await simulateFetchDashboardData(
      {
        listRequests: async () => [],
        listAssignments: async () => [],
        listEvents: async () => [recoveredEvent],
      },
      state,
    );

    expect(recoveredCycle.hasPartialFailure).toBe(false);
    expect(recoveredCycle.eventsError).toBeNull();
    expect(recoveredCycle.eventsStale).toBe(false);
    expect(recoveredCycle.recentEvents).toEqual([recoveredEvent]);
  });

  it('re-throws AbortError on cancellation without corrupting cache or recording false failure', async () => {
    const cachedAssignment: AssignmentRecord = {
      id: 'plan-001',
      scenario_id: 'sector-4',
      status: 'COMMITTED',
      routes: [],
      unserved: [],
      metrics: {
        coveragePercent: 90,
        totalTravelTimeMinutes: 100,
        totalTravelDistanceKm: 30,
        highPriorityWaitTimeMinutes: 10,
        solveDurationMs: 250,
        servedRequestsCount: 10,
        unservedRequestsCount: 1,
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const previousCache = {
      assignments: [cachedAssignment],
      recentEvents: null,
    };

    const controller = new AbortController();
    controller.abort();

    const abortError = new DOMException('signal is aborted without reason', 'AbortError');

    await expect(
      simulateFetchDashboardData(
        {
          listRequests: async () => {
            throw abortError;
          },
          listAssignments: async () => {
            throw abortError;
          },
          listEvents: async () => {
            throw abortError;
          },
        },
        previousCache,
        controller.signal,
      ),
    ).rejects.toSatisfy(isAbortError);

    // Cache must remain preserved and not corrupted
    expect(previousCache.assignments).toHaveLength(1);
    expect(previousCache.assignments![0].id).toBe('plan-001');
  });

  it('ensures genuine backend failures (HTTP 404, 500, network error) remain visible', async () => {
    const previousCache = {
      assignments: null,
      recentEvents: null,
    };

    // 1. Genuine 500 on requests
    await expect(
      simulateFetchDashboardData(
        {
          listRequests: async () => {
            throw new Error('API request failed with HTTP 500');
          },
          listAssignments: async () => [],
          listEvents: async () => [],
        },
        previousCache,
      ),
    ).rejects.toThrow('API request failed with HTTP 500');

    // 2. Genuine 404 on assignments (preserved in domain error)
    const result = await simulateFetchDashboardData(
      {
        listRequests: async () => [],
        listAssignments: async () => {
          throw new Error('API request failed with HTTP 404');
        },
        listEvents: async () => [],
      },
      previousCache,
    );
    expect(result.hasPartialFailure).toBe(true);
    expect(result.assignmentsError).toBe('API request failed with HTTP 404');
  });
});
