/**
 * Unit tests for IncrementalRepairSolverAdapter
 *
 * Tests the bridge between Part 1's RepairSolver contract and Part 2's
 * repairIncrementally() algorithm. Uses in-memory stubs for the repository.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RepairInput, FrozenStopReference, Scenario, SolverPlan } from '@floodrelay/shared';
import { IncrementalRepairSolverAdapter } from './incrementalRepairSolverAdapter.js';
import type { PostgisRepository } from '../db/repository.js';

// ---------------------------------------------------------------------------
// Minimal fixtures
// ---------------------------------------------------------------------------

const SCENARIO: Scenario = {
  id: 'scenario-1',
  metadata: {
    id: 'scenario-1',
    name: 'Test Scenario',
    region: 'Test Region',
    createdAt: new Date().toISOString(),
    bounds: { minLat: 28.5, maxLat: 29.0, minLng: 77.0, maxLng: 77.5 },
  },
  requests: [
    {
      id: 'req-1',
      lat: 28.6,
      lng: 77.1,
      peopleCount: 2,
      urgency: 'HIGH',
      createdAt: new Date().toISOString(),
      source: 'SIMULATED',
      status: 'PENDING',
    },
    {
      id: 'req-2',
      lat: 28.7,
      lng: 77.2,
      peopleCount: 1,
      urgency: 'MEDIUM',
      createdAt: new Date().toISOString(),
      source: 'SIMULATED',
      status: 'PENDING',
    },
  ],
  resources: [
    {
      id: 'res-1',
      name: 'Boat 1',
      type: 'BOAT',
      capacity: 5,
      speedKmH: 20,
      lat: 28.5,
      lng: 77.0,
      status: 'AVAILABLE',
    },
  ],
  shelters: [
    {
      id: 'shelter-1',
      name: 'Shelter A',
      lat: 28.65,
      lng: 77.15,
      capacity: 100,
    },
  ],
};

const makeBaselinePlan = (): SolverPlan => ({
  scenarioId: 'scenario-1',
  calculatedAt: new Date().toISOString(),
  solverStatus: 'SOLVER_STATUS_OPTIMAL',
  routes: [
    {
      resourceId: 'res-1',
      stops: [
        {
          stopNumber: 1,
          type: 'PICKUP',
          targetId: 'req-1',
          lat: 28.6,
          lng: 77.1,
          passengersPickedUp: 2,
          passengersDroppedOff: 0,
          estimatedArrivalMinutes: 10,
          isFrozen: false,
        },
        {
          stopNumber: 2,
          type: 'DROPOFF',
          targetId: 'shelter-1',
          lat: 28.65,
          lng: 77.15,
          passengersPickedUp: 0,
          passengersDroppedOff: 2,
          estimatedArrivalMinutes: 20,
          isFrozen: false,
        },
      ],
      totalDurationMinutes: 20,
      totalTravelDistanceKm: 15,
      servedRequestIds: ['req-1'],
    },
  ],
  unserved: [{ requestId: 'req-2', reason: 'UNASSIGNED' }],
  metrics: {
    coveragePercent: 50,
    totalTravelTimeMinutes: 20,
    totalTravelDistanceKm: 15,
    highPriorityWaitTimeMinutes: 10,
    solveDurationMs: 5,
    servedRequestsCount: 1,
    unservedRequestsCount: 1,
  },
});

/** Build a minimal mock repository. */
function makeRepo(overrides?: Partial<PostgisRepository>): PostgisRepository {
  const mockRepo = {
    getOperationalEvent: vi.fn(),
    getAssignmentWithStops: vi.fn(),
    getLatestCommittedAssignment: vi.fn(),
    listRequests: vi.fn(),
    listResources: vi.fn(),
    listShelters: vi.fn(),
    listBlockedZones: vi.fn(),
    ...overrides,
  } as unknown as PostgisRepository;
  return mockRepo;
}

/** Minimal DB event row for a REQUEST_CREATED event. */
function makeDbEvent(type: string, entityId: string, payload: Record<string, unknown> = {}) {
  return {
    id: `evt-${type}`,
    event_type: type,
    entity_type: 'REQUEST',
    entity_id: entityId,
    actor_id: null,
    actor_type: 'OPERATOR',
    payload,
    correlation_id: null,
    idempotency_key: null,
    entity_version: 1,
    processing_status: 'RECORDED',
    processing_attempts: 0,
    last_error_code: null,
    occurred_at: new Date(),
    created_at: new Date(),
    processed_at: null,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('IncrementalRepairSolverAdapter', () => {
  let repo: PostgisRepository;
  let adapter: IncrementalRepairSolverAdapter;

  beforeEach(() => {
    repo = makeRepo();
    adapter = new IncrementalRepairSolverAdapter(repo);
  });

  it('returns NO_FEASIBLE_REPAIR when operational event not found', async () => {
    vi.mocked(repo.getOperationalEvent).mockResolvedValue(null);

    const input: RepairInput = {
      eventId: 'evt-missing',
      baselineAssignmentId: null,
      scenarioSnapshot: SCENARIO,
      frozenStops: [],
      affectedRequestIds: [],
      affectedResourceIds: [],
    };

    const result = await adapter.solveRepair(input);
    expect(result.status).toBe('NO_FEASIBLE_REPAIR');
    expect(result.warnings[0]).toContain('evt-missing');
  });

  it('returns NO_FEASIBLE_REPAIR for unhandled event types (ROAD_REOPENED)', async () => {
    vi.mocked(repo.getOperationalEvent).mockResolvedValue(
      makeDbEvent('ROAD_REOPENED', 'zone-1') as never,
    );

    const input: RepairInput = {
      eventId: 'evt-road',
      baselineAssignmentId: null,
      scenarioSnapshot: SCENARIO,
      frozenStops: [],
      affectedRequestIds: [],
      affectedResourceIds: [],
    };

    const result = await adapter.solveRepair(input);
    expect(result.status).toBe('NO_FEASIBLE_REPAIR');
    expect(result.warnings[0]).toContain('ROAD_REOPENED');
  });

  it('returns NO_FEASIBLE_REPAIR when baselineAssignmentId is set but not found in DB', async () => {
    vi.mocked(repo.getOperationalEvent).mockResolvedValue(
      makeDbEvent('REQUEST_CREATED', 'req-2') as never,
    );
    vi.mocked(repo.getAssignmentWithStops).mockResolvedValue(null);

    const input: RepairInput = {
      eventId: 'evt-create',
      baselineAssignmentId: 'assign-missing',
      scenarioSnapshot: SCENARIO,
      frozenStops: [],
      affectedRequestIds: ['req-2'],
      affectedResourceIds: [],
    };

    const result = await adapter.solveRepair(input);
    expect(result.status).toBe('NO_FEASIBLE_REPAIR');
    expect(result.warnings[0]).toContain('assign-missing');
  });

  it('attempts insertion for REQUEST_CREATED when no baseline assignment exists', async () => {
    vi.mocked(repo.getOperationalEvent).mockResolvedValue(
      makeDbEvent('REQUEST_CREATED', 'req-2') as never,
    );
    // No DB baseline — adapter uses emptyBaselinePlan
    const input: RepairInput = {
      eventId: 'evt-create',
      baselineAssignmentId: null,
      scenarioSnapshot: SCENARIO,
      frozenStops: [],
      affectedRequestIds: ['req-2'],
      affectedResourceIds: [],
    };

    const result = await adapter.solveRepair(input);
    // The solver will attempt insertion; result may be PROPOSED or NO_FEASIBLE_REPAIR
    // but should never throw and must return a valid status.
    expect(['PROPOSED', 'NO_FEASIBLE_REPAIR']).toContain(result.status);
    expect(Array.isArray(result.warnings)).toBe(true);
    expect(Array.isArray(result.unservedRequestIds)).toBe(true);
  });

  it('applies authoritative frozen stops from FrozenStopReference to baseline plan', async () => {
    // The baseline assignment has req-1 pickup at stop #1 (not isFrozen in DB)
    // but Part 1 FrozenStopReference says it IS frozen
    vi.mocked(repo.getOperationalEvent).mockResolvedValue(
      makeDbEvent('REQUEST_CANCELLED', 'req-2') as never,
    );

    const dbAssignment = {
      assignment: {
        id: 'assign-1',
        scenario_id: 'scenario-1',
        status: 'COMMITTED' as never,
        metrics: makeBaselinePlan().metrics,
        unserved: makeBaselinePlan().unserved,
        committed_at: null,
        committed_by: null,
        created_at: new Date(),
        updated_at: new Date(),
      },
      stops: [
        {
          id: 'stop-1',
          assignment_id: 'assign-1',
          resource_id: 'res-1',
          stop_number: 1,
          type: 'PICKUP' as const,
          target_id: 'req-1',
          location: 'POINT(77.1 28.6)',
          passengers_picked_up: 2,
          passengers_dropped_off: 0,
          estimated_arrival_minutes: 10,
          is_frozen: false, // DB says NOT frozen
          created_at: new Date(),
        },
        {
          id: 'stop-2',
          assignment_id: 'assign-1',
          resource_id: 'res-1',
          stop_number: 2,
          type: 'DROPOFF' as const,
          target_id: 'shelter-1',
          location: 'POINT(77.15 28.65)',
          passengers_picked_up: 0,
          passengers_dropped_off: 2,
          estimated_arrival_minutes: 20,
          is_frozen: false,
          created_at: new Date(),
        },
      ],
    };
    vi.mocked(repo.getAssignmentWithStops).mockResolvedValue(dbAssignment as never);

    const frozenStops: FrozenStopReference[] = [
      {
        assignmentId: 'assign-1',
        resourceId: 'res-1',
        stopNumber: 1, // This stop should be frozen by Part 1 ref
        targetId: 'req-1',
        type: 'PICKUP',
        lat: 28.6,
        lng: 77.1,
      },
    ];

    const input: RepairInput = {
      eventId: 'evt-cancel',
      baselineAssignmentId: 'assign-1',
      scenarioSnapshot: SCENARIO,
      frozenStops,
      affectedRequestIds: ['req-2'],
      affectedResourceIds: [],
    };

    // If the cancellation targets req-2 (which is unserved), solver should produce PROPOSED
    // with the frozen req-1 stop intact.
    const result = await adapter.solveRepair(input);
    expect(['PROPOSED', 'NO_FEASIBLE_REPAIR']).toContain(result.status);

    if (result.status === 'PROPOSED' && result.proposedPlan) {
      const route = result.proposedPlan.routes.find((r) => r.resourceId === 'res-1');
      expect(route).toBeDefined();
      const frozenStop = route?.stops.find((s) => s.targetId === 'req-1' && s.type === 'PICKUP');
      // The frozen stop must be preserved
      expect(frozenStop).toBeDefined();
      expect(frozenStop?.isFrozen).toBe(true);
    }
  });

  it('preserves valid rescue work and rejects automatic cancellation on REQUEST_FLAGGED_DUPLICATE', async () => {
    vi.mocked(repo.getOperationalEvent).mockResolvedValue(
      makeDbEvent('REQUEST_FLAGGED_DUPLICATE', 'req-1') as never,
    );

    const input: RepairInput = {
      eventId: 'evt-dup',
      baselineAssignmentId: null,
      scenarioSnapshot: SCENARIO,
      frozenStops: [],
      affectedRequestIds: ['req-1'],
      affectedResourceIds: [],
    };

    const result = await adapter.solveRepair(input);
    // Duplicate flag must NOT automatically cancel or modify assignments; requires operator triage
    expect(result.status).toBe('NO_FEASIBLE_REPAIR');
    expect(result.unservedRequestIds).toContain('req-1');
    expect(result.warnings.some((w) => w.includes('suspected duplicate'))).toBe(true);
    expect(result.warnings.some((w) => w.includes('human operator review'))).toBe(true);
  });

  it('safely handles ROAD_REOPENED by preserving baseline and emitting an unsupported warning', async () => {
    vi.mocked(repo.getOperationalEvent).mockResolvedValue(
      makeDbEvent('ROAD_REOPENED', 'zone-1') as never,
    );

    const input: RepairInput = {
      eventId: 'evt-road-reopened',
      baselineAssignmentId: null,
      scenarioSnapshot: SCENARIO,
      frozenStops: [],
      affectedRequestIds: [],
      affectedResourceIds: [],
    };

    const result = await adapter.solveRepair(input);
    expect(result.status).toBe('NO_FEASIBLE_REPAIR');
    expect(result.warnings.some((w) => w.includes('ROAD_REOPENED'))).toBe(true);
  });

  it('recovers authoritative committed baseline when baselineAssignmentId is omitted', async () => {
    const mockAssignment = {
      id: 'assign-committed-recovered',
      scenario_id: 'scen-recovered',
      metrics: {
        coveragePercent: 100,
        totalTravelTimeMinutes: 20,
        totalTravelDistanceKm: 10,
        highPriorityWaitTimeMinutes: 0,
        solveDurationMs: 5,
        servedRequestsCount: 1,
        unservedRequestsCount: 0,
      },
      unserved: [],
    };

    const mockStops = [
      {
        id: 'stop-rec-1',
        assignment_id: 'assign-committed-recovered',
        resource_id: 'res-1',
        stop_number: 1,
        type: 'PICKUP',
        target_id: 'req-1',
        location: 'POINT(77.21 28.51)',
        passengers_picked_up: 2,
        passengers_dropped_off: 0,
        estimated_arrival_minutes: 5,
        is_frozen: true,
      },
      {
        id: 'stop-rec-2',
        assignment_id: 'assign-committed-recovered',
        resource_id: 'res-1',
        stop_number: 2,
        type: 'DROPOFF',
        target_id: 'shelter-1',
        location: 'POINT(77.25 28.55)',
        passengers_picked_up: 0,
        passengers_dropped_off: 2,
        estimated_arrival_minutes: 20,
        is_frozen: true,
      },
    ];

    vi.mocked(repo.getLatestCommittedAssignment).mockResolvedValue({
      assignment: mockAssignment as never,
      stops: mockStops as never,
    });

    vi.mocked(repo.getOperationalEvent).mockResolvedValue(
      makeDbEvent('REQUEST_CREATED', 'req-2') as never,
    );

    const input: RepairInput = {
      eventId: 'evt-recover-base',
      baselineAssignmentId: null, // omitted
      scenarioSnapshot: SCENARIO,
      frozenStops: [
        {
          assignmentId: 'assign-committed-recovered',
          resourceId: 'res-1',
          stopNumber: 1,
          targetId: 'req-1',
          type: 'PICKUP',
          lat: 28.51,
          lng: 77.21,
        },
        {
          assignmentId: 'assign-committed-recovered',
          resourceId: 'res-1',
          stopNumber: 2,
          targetId: 'shelter-1',
          type: 'DROPOFF',
          lat: 28.55,
          lng: 77.25,
        },
      ],
      affectedRequestIds: ['req-2'],
      affectedResourceIds: [],
    };

    const result = await adapter.solveRepair(input);
    expect(repo.getLatestCommittedAssignment).toHaveBeenCalled();
    expect(['PROPOSED', 'NO_FEASIBLE_REPAIR']).toContain(result.status);
    if (result.status === 'PROPOSED') {
      expect(result.churn).toBeDefined();
    }
  });

  it('maps RESOURCE_OFFLINE event and returns a plan proposal or infeasibility', async () => {
    vi.mocked(repo.getOperationalEvent).mockResolvedValue({
      ...makeDbEvent('RESOURCE_OFFLINE', 'res-1'),
      entity_type: 'RESOURCE',
    } as never);

    const input: RepairInput = {
      eventId: 'evt-offline',
      baselineAssignmentId: null,
      scenarioSnapshot: SCENARIO,
      frozenStops: [],
      affectedRequestIds: [],
      affectedResourceIds: ['res-1'],
    };

    const result = await adapter.solveRepair(input);
    expect(['PROPOSED', 'NO_FEASIBLE_REPAIR']).toContain(result.status);
    expect(Array.isArray(result.warnings)).toBe(true);
  });

  it('propagates solver warnings to RepairResult', async () => {
    // Use an event where the request is NOT in the scenario (should produce a warning)
    vi.mocked(repo.getOperationalEvent).mockResolvedValue(
      makeDbEvent('REQUEST_CREATED', 'req-nonexistent') as never,
    );

    const input: RepairInput = {
      eventId: 'evt-create-missing',
      baselineAssignmentId: null,
      scenarioSnapshot: SCENARIO,
      frozenStops: [],
      affectedRequestIds: ['req-nonexistent'],
      affectedResourceIds: [],
    };

    // req-nonexistent is not in SCENARIO.requests, so mapDbEventToSolverEvent returns null
    const result = await adapter.solveRepair(input);
    expect(result.status).toBe('NO_FEASIBLE_REPAIR');
    // Warning explains the unhandled/missing event entity
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('attaches straight-line route geometry on proposed repair plan when OSRM is disabled', async () => {
    vi.mocked(repo.getOperationalEvent).mockResolvedValue(
      makeDbEvent('REQUEST_CREATED', 'req-1') as never,
    );

    const input: RepairInput = {
      eventId: 'evt-repair-geom',
      baselineAssignmentId: null,
      scenarioSnapshot: SCENARIO,
      frozenStops: [],
      affectedRequestIds: ['req-1'],
      affectedResourceIds: [],
    };

    const result = await adapter.solveRepair(input);
    expect(result.status).toBe('PROPOSED');
    expect(result.proposedPlan?.routes.length).toBeGreaterThan(0);
    const geom = result.proposedPlan!.routes[0]!.geometry;
    expect(geom).toBeDefined();
    expect(geom!.source).toBe('STRAIGHT_LINE');
    expect(geom!.coordinates.length).toBeGreaterThanOrEqual(2);
    expect(geom!.legs?.length).toBeGreaterThanOrEqual(1);
  });
});
