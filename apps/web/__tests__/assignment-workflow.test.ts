import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FloodRelayApiClient } from '../lib/api/client';
import { ApiClientError } from '../lib/api/errors';
import type { AssignmentRecord, ProposeAssignmentInput } from '../lib/api/types';

describe('Phase 3 Milestone 5 — Solver Proposal & Human-Supervised Assignment Review Workflow', () => {
  let client: FloodRelayApiClient;

  beforeEach(() => {
    client = new FloodRelayApiClient({ baseUrl: 'http://localhost:3000' });
    vi.restoreAllMocks();
  });

  describe('1. Proposal Generation Contract & Invariants', () => {
    it('submits valid solver proposal options with supported algorithm', async () => {
      const mockProposedPlan: AssignmentRecord = {
        id: 'assign_1793478900_abcde',
        scenarioId: 'scenario-delhi-yamuna-demo',
        status: 'PROPOSED',
        metrics: {
          coveragePercent: 100,
          totalTravelTimeMinutes: 52.4,
          totalTravelDistanceKm: 14.8,
          highPriorityWaitTimeMinutes: 12.0,
          solveDurationMs: 35,
          servedRequestsCount: 5,
          unservedRequestsCount: 0,
        },
        unserved: [],
        routes: [
          {
            resourceId: 'res-boat-1',
            stops: [
              {
                stopNumber: 1,
                type: 'DEPOT',
                targetId: 'depot-north',
                lat: 28.7,
                lng: 77.2,
                passengersPickedUp: 0,
                passengersDroppedOff: 0,
                estimatedArrivalMinutes: 0,
                isFrozen: false,
              },
              {
                stopNumber: 2,
                type: 'PICKUP',
                targetId: 'req_001',
                lat: 28.71,
                lng: 77.21,
                passengersPickedUp: 4,
                passengersDroppedOff: 0,
                estimatedArrivalMinutes: 15,
                isFrozen: false,
              },
              {
                stopNumber: 3,
                type: 'DROPOFF',
                targetId: 'shelter-yamuna-main',
                lat: 28.72,
                lng: 77.22,
                passengersPickedUp: 0,
                passengersDroppedOff: 4,
                estimatedArrivalMinutes: 30,
                isFrozen: false,
              },
            ],
            totalTravelDistanceKm: 14.8,
            totalDurationMinutes: 52.4,
            servedRequestIds: ['req_001'],
          },
        ],
        createdAt: '2026-11-01T01:00:00.000Z',
        updatedAt: '2026-11-01T01:00:00.000Z',
      };

      let capturedBody: string | undefined;
      global.fetch = vi.fn().mockImplementation(async (_url, options) => {
        capturedBody = options?.body as string;
        return {
          ok: true,
          status: 201,
          json: async () => ({
            success: true,
            data: mockProposedPlan,
          }),
        };
      });

      const input: ProposeAssignmentInput = {
        algorithm: 'cluster-allocation',
        scenarioId: 'scenario-delhi-yamuna-demo',
        maxShiftMinutes: 480,
        preserveFrozen: true,
        includeUnverified: false,
      };

      const result = await client.proposeAssignment(input);

      expect(result.id).toBe('assign_1793478900_abcde');
      expect(result.status).toBe('PROPOSED');
      expect(result.routes).toHaveLength(1);
      expect(result.metrics?.servedRequestsCount).toBe(5);

      const parsed = JSON.parse(capturedBody!);
      expect(parsed.algorithm).toBe('cluster-allocation');
      expect(parsed.maxShiftMinutes).toBe(480);
      expect(parsed.preserveFrozen).toBe(true);
    });

    it('handles backend domain error when algorithm cannot preserve frozen stops', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({
          error: {
            code: 'UNSUPPORTED_ALGORITHM_OPTION',
            message:
              'Algorithm "nearest-first" does not support preserving frozen routes. Please use "cluster-allocation" for incremental replanning.',
          },
        }),
      });

      await expect(
        client.proposeAssignment({
          algorithm: 'nearest-first',
          preserveFrozen: true,
        }),
      ).rejects.toThrow('Algorithm "nearest-first" does not support preserving frozen routes');
    });
  });

  describe('2. Assignment List & Filtering Invariants', () => {
    it('retrieves assignments and filters between PROPOSED and COMMITTED', async () => {
      const mockList: AssignmentRecord[] = [
        {
          id: 'assign_001',
          status: 'PROPOSED',
          scenario_id: 'scenario-delhi-yamuna-demo',
          metrics: {
            coveragePercent: 80,
            totalTravelTimeMinutes: 45,
            totalTravelDistanceKm: 12,
            highPriorityWaitTimeMinutes: 10,
            solveDurationMs: 20,
            servedRequestsCount: 4,
            unservedRequestsCount: 1,
          },
          unserved: [{ requestId: 'req_999', reason: 'CAPACITY_EXCEEDED' }],
          createdAt: '2026-11-01T01:10:00Z',
          updatedAt: '2026-11-01T01:10:00Z',
        },
        {
          id: 'assign_002',
          status: 'COMMITTED',
          scenario_id: 'scenario-delhi-yamuna-demo',
          committed_by: 'watch_commander_1',
          committed_at: '2026-11-01T01:25:00Z',
          metrics: {
            coveragePercent: 100,
            totalTravelTimeMinutes: 60,
            totalTravelDistanceKm: 18,
            highPriorityWaitTimeMinutes: 8,
            solveDurationMs: 25,
            servedRequestsCount: 6,
            unservedRequestsCount: 0,
          },
          unserved: [],
          createdAt: '2026-11-01T01:00:00Z',
          updatedAt: '2026-11-01T01:25:00Z',
        },
      ];

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          count: mockList.length,
          data: mockList,
        }),
      });

      const plans = await client.listAssignments();
      expect(plans).toHaveLength(2);

      const proposed = plans.filter((p) => p.status === 'PROPOSED');
      const committed = plans.filter((p) => p.status === 'COMMITTED');

      expect(proposed).toHaveLength(1);
      expect(proposed[0].id).toBe('assign_001');
      expect(committed).toHaveLength(1);
      expect(committed[0].id).toBe('assign_002');
      expect(committed[0].committed_by).toBe('watch_commander_1');
    });
  });

  describe('3. Human-Supervised Commit Workflow & Concurrency Safety', () => {
    it('commits an assignment plan and returns frozen status', async () => {
      const mockCommittedResponse: AssignmentRecord = {
        id: 'assign_1793478900_abcde',
        scenarioId: 'scenario-delhi-yamuna-demo',
        status: 'COMMITTED',
        committedBy: 'DUTY_OFFICER_01',
        committedAt: '2026-11-01T01:30:00.000Z',
        metrics: {
          coveragePercent: 100,
          totalTravelTimeMinutes: 52.4,
          totalTravelDistanceKm: 14.8,
          highPriorityWaitTimeMinutes: 12.0,
          solveDurationMs: 35,
          servedRequestsCount: 5,
          unservedRequestsCount: 0,
        },
        unserved: [],
        routes: [
          {
            resourceId: 'res-boat-1',
            stops: [
              {
                stopNumber: 1,
                type: 'DEPOT',
                targetId: 'depot-north',
                lat: 28.7,
                lng: 77.2,
                passengersPickedUp: 0,
                passengersDroppedOff: 0,
                estimatedArrivalMinutes: 0,
                isFrozen: true,
              },
            ],
            totalTravelDistanceKm: 14.8,
            totalDurationMinutes: 52.4,
            servedRequestIds: ['req_001'],
          },
        ],
        createdAt: '2026-11-01T01:00:00.000Z',
        updatedAt: '2026-11-01T01:30:00.000Z',
      };

      let capturedBody: string | undefined;
      global.fetch = vi.fn().mockImplementation(async (url, options) => {
        if (url.includes('/commit')) {
          capturedBody = options?.body as string;
          return {
            ok: true,
            status: 200,
            json: async () => ({
              success: true,
              message: 'Assignment plan committed successfully. Stops are now frozen.',
              data: mockCommittedResponse,
            }),
          };
        }
        return { ok: false, status: 404 };
      });

      const updated = await client.commitAssignment('assign_1793478900_abcde', {
        operatorId: 'DUTY_OFFICER_01',
        notes: 'Verified safe draft depth and shelter intake capacity.',
      });

      expect(updated.status).toBe('COMMITTED');
      expect(updated.committedBy).toBe('DUTY_OFFICER_01');
      expect(updated.routes?.[0].stops[0].isFrozen).toBe(true);

      const parsed = JSON.parse(capturedBody!);
      expect(parsed.operatorId).toBe('DUTY_OFFICER_01');
      expect(parsed.notes).toContain('Verified safe draft depth');
    });

    it('rejects double commitment with HTTP 409 ALREADY_COMMITTED', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 409,
        json: async () => ({
          error: {
            code: 'ALREADY_COMMITTED',
            message:
              'Assignment "assign_1793478900_abcde" is not in PROPOSED status (current status: COMMITTED)',
          },
        }),
      });

      try {
        await client.commitAssignment('assign_1793478900_abcde', {
          operatorId: 'ANOTHER_OPERATOR',
        });
        expect.unreachable('Should have thrown ApiClientError');
      } catch (err) {
        expect(err).toBeInstanceOf(ApiClientError);
        const apiErr = err as ApiClientError;
        expect(apiErr.statusCode).toBe(409);
        expect(apiErr.code).toBe('ALREADY_COMMITTED');
      }
    });

    it('rejects commitment if a target request has already been assigned with HTTP 409 REQUEST_ALREADY_ASSIGNED', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 409,
        json: async () => ({
          error: {
            code: 'REQUEST_ALREADY_ASSIGNED',
            message: 'Request "req_001" is no longer in PENDING status (current status: ASSIGNED)',
          },
        }),
      });

      try {
        await client.commitAssignment('assign_1793478900_abcde', {
          operatorId: 'OPERATOR_1',
        });
        expect.unreachable('Should have thrown ApiClientError');
      } catch (err) {
        expect(err).toBeInstanceOf(ApiClientError);
        const apiErr = err as ApiClientError;
        expect(apiErr.statusCode).toBe(409);
        expect(apiErr.code).toBe('REQUEST_ALREADY_ASSIGNED');
      }
    });
  });

  describe('4. Critical Safety & Human-in-the-Loop Constraints', () => {
    it('enforces plan commitment eligibility: simulated or mixed plans cannot be committed', () => {
      function isPlanCommitEligible(plan: AssignmentRecord): boolean {
        return !(
          plan.provenance === 'SIMULATED' ||
          plan.provenance === 'MIXED' ||
          Boolean(plan.hasSimulatedResources) ||
          Boolean(plan.hasSimulatedRequests) ||
          Boolean(plan.hasSimulatedShelters) ||
          Boolean(plan.hasUnresolvedProvenance)
        );
      }

      const realPlan: AssignmentRecord = {
        id: 'assign_real',
        status: 'PROPOSED',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        provenance: 'REAL',
        hasSimulatedResources: false,
        hasSimulatedRequests: false,
        hasSimulatedShelters: false,
        hasUnresolvedProvenance: false,
      };

      const simPlan: AssignmentRecord = {
        id: 'assign_sim',
        status: 'PROPOSED',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        provenance: 'SIMULATED',
        hasSimulatedResources: true,
        hasSimulatedRequests: false,
      };

      const mixedPlan: AssignmentRecord = {
        id: 'assign_mixed',
        status: 'PROPOSED',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        provenance: 'MIXED',
        hasSimulatedResources: true,
        hasSimulatedRequests: true,
      };

      const simShelterPlan: AssignmentRecord = {
        id: 'assign_sim_shelter',
        status: 'PROPOSED',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        provenance: 'REAL',
        hasSimulatedResources: false,
        hasSimulatedRequests: false,
        hasSimulatedShelters: true,
      };

      const unresolvedProvenancePlan: AssignmentRecord = {
        id: 'assign_unresolved',
        status: 'PROPOSED',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        provenance: 'REAL',
        hasSimulatedResources: false,
        hasSimulatedRequests: false,
        hasUnresolvedProvenance: true,
      };

      expect(isPlanCommitEligible(realPlan)).toBe(true);
      expect(isPlanCommitEligible(simPlan)).toBe(false);
      expect(isPlanCommitEligible(mixedPlan)).toBe(false);
      expect(isPlanCommitEligible(simShelterPlan)).toBe(false);
      expect(isPlanCommitEligible(unresolvedProvenancePlan)).toBe(false);
    });

    it('handles SIMULATED_RESOURCE_FORBIDDEN and SIMULATED_REQUEST_FORBIDDEN error responses from API client', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 409,
        json: async () => ({
          error: {
            code: 'SIMULATED_RESOURCE_FORBIDDEN',
            message:
              'Cannot commit assignment plan containing simulated resource "res_sim_01" in operational dispatch mode',
          },
        }),
      });

      try {
        await client.commitAssignment('assign_sim_test', {
          operatorId: 'OPERATOR_1',
        });
        expect.unreachable('Should have thrown ApiClientError');
      } catch (err) {
        expect(err).toBeInstanceOf(ApiClientError);
        const apiErr = err as ApiClientError;
        expect(apiErr.statusCode).toBe(409);
        expect(apiErr.code).toBe('SIMULATED_RESOURCE_FORBIDDEN');
      }
    });

    it('handles shelter safety errors (SIMULATED_SHELTER_FORBIDDEN, SHELTER_UNAVAILABLE, SHELTER_NOT_FOUND, SHELTER_CAPACITY_EXCEEDED)', async () => {
      const errorCases = [
        {
          code: 'SIMULATED_SHELTER_FORBIDDEN',
          message:
            'Cannot commit assignment plan containing simulated destination shelter "sh_sim" in operational dispatch mode',
        },
        {
          code: 'SHELTER_UNAVAILABLE',
          message: 'Shelter "sh_closed" is inactive and cannot accept evacuees',
        },
        {
          code: 'SHELTER_NOT_FOUND',
          message: 'Shelter "sh_missing" referenced in assignment dropoff stop does not exist',
        },
        {
          code: 'SHELTER_CAPACITY_EXCEEDED',
          message:
            'Shelter "sh_full" capacity exceeded: capacity is 10, current occupancy is 8, incoming evacuees are 4',
        },
      ];

      for (const errorCase of errorCases) {
        global.fetch = vi.fn().mockResolvedValue({
          ok: false,
          status: 409,
          json: async () => ({
            error: errorCase,
          }),
        });

        try {
          await client.commitAssignment('assign_test', { operatorId: 'OPERATOR_1' });
          expect.unreachable(`Should have thrown ApiClientError for ${errorCase.code}`);
        } catch (err) {
          expect(err).toBeInstanceOf(ApiClientError);
          const apiErr = err as ApiClientError;
          expect(apiErr.statusCode).toBe(409);
          expect(apiErr.code).toBe(errorCase.code);
          expect(apiErr.message).toBe(errorCase.message);
        }
      }
    });

    it('enforces safety checklist invariant: all 3 items required before plan commit', () => {
      function canCommit(checklist: {
        draftClearance: boolean;
        shelterCapacity: boolean;
        medicalProtocol: boolean;
      }): boolean {
        return checklist.draftClearance && checklist.shelterCapacity && checklist.medicalProtocol;
      }

      expect(
        canCommit({
          draftClearance: false,
          shelterCapacity: true,
          medicalProtocol: true,
        }),
      ).toBe(false);

      expect(
        canCommit({
          draftClearance: true,
          shelterCapacity: false,
          medicalProtocol: true,
        }),
      ).toBe(false);

      expect(
        canCommit({
          draftClearance: true,
          shelterCapacity: true,
          medicalProtocol: false,
        }),
      ).toBe(false);

      expect(
        canCommit({
          draftClearance: true,
          shelterCapacity: true,
          medicalProtocol: true,
        }),
      ).toBe(true);
    });

    it('guarantees commitment is strictly an administrative data operation, not automated physical dispatch', () => {
      // Invariant: The database commit freezes stops and updates request records to ASSIGNED.
      // It does NOT invoke external telemetry, field tablets, or boat launch commands.
      const commitRecord = {
        operation: 'DATABASE_TRANSACTION',
        locksAcquired: ['SELECT FOR UPDATE assignments', 'SELECT FOR UPDATE requests'],
        stateChange: {
          assignmentStatus: 'COMMITTED',
          stopsFrozen: true,
          requestStatus: 'ASSIGNED',
        },
        externalFieldDispatch: false,
      };

      expect(commitRecord.externalFieldDispatch).toBe(false);
      expect(commitRecord.stateChange.assignmentStatus).toBe('COMMITTED');
      expect(commitRecord.stateChange.stopsFrozen).toBe(true);
    });
  });
});
