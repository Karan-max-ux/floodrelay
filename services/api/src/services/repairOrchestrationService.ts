import crypto from 'node:crypto';
import type {
  RepairInput,
  RepairResult,
  FrozenStopReference,
  Scenario,
  SolverPlan,
  GeoPoint,
} from '@floodrelay/shared';
import type { PostgisRepository } from '../db/repository.js';
import {
  parsePointWkt,
  dbToBlockedZone,
  routeStopToDb,
  type DbAssignmentStop,
} from '../db/schema.js';
import {
  computeBoundingBoxFromPoints,
  deriveRegionFromCoordinates,
  classifyScenarioProvenance,
  serializeRouteGeometries,
} from './assignmentService.js';

export interface RepairSolver {
  solveRepair(input: RepairInput): Promise<RepairResult>;
}

export class RepairOrchestrationService {
  constructor(
    private readonly repo: PostgisRepository,
    private readonly repairSolver?: RepairSolver,
  ) {}

  /**
   * Orchestrates an incremental plan repair triggered by an operational event.
   * In Phase 5 Part 1, returns REPAIR_ENGINE_UNAVAILABLE if no repair solver is injected.
   */
  async orchestrateRepair(
    eventId: string,
    options?: {
      baselineAssignmentId?: string | null;
      expectedVersion?: number;
    },
  ): Promise<RepairResult> {
    if (!this.repairSolver) {
      const err = new Error(
        'Incremental repair engine is not available. Part 1 establishes backend contracts; solver integration is reserved for Part 2.',
      );
      (err as unknown as { code: string; statusCode: number }).code = 'REPAIR_ENGINE_UNAVAILABLE';
      (err as unknown as { code: string; statusCode: number }).statusCode = 503;
      throw err;
    }

    const eventRow = await this.repo.getOperationalEvent(eventId);
    if (!eventRow) {
      const err = new Error(`Operational event with id "${eventId}" not found`);
      (err as unknown as { code: string; statusCode: number }).code = 'NOT_FOUND';
      (err as unknown as { code: string; statusCode: number }).statusCode = 404;
      throw err;
    }

    // Concurrency guard: expected-version verification
    if (
      options?.expectedVersion !== undefined &&
      eventRow.entity_version !== options.expectedVersion
    ) {
      const err = new Error(
        `Version conflict: operational event "${eventId}" has version ${eventRow.entity_version}, but caller expected ${options.expectedVersion}`,
      );
      (err as unknown as { code: string; statusCode: number }).code = 'VERSION_CONFLICT';
      (err as unknown as { code: string; statusCode: number }).statusCode = 409;
      throw err;
    }

    // Complete safety snapshot loading: no arbitrary limits
    const requests = await this.repo.listRequests();
    const resources = await this.repo.listResources();
    const shelters = await this.repo.listShelters();
    const rawBlockedZones = await this.repo.listBlockedZones(true);
    const blockedZones = rawBlockedZones.map(dbToBlockedZone);

    // Fail-closed safety check: ensure affected entity is present in the loaded state
    if (eventRow.entity_type === 'REQUEST' && !requests.some((r) => r.id === eventRow.entity_id)) {
      const err = new Error(
        `Safety-critical state incomplete: affected request "${eventRow.entity_id}" is missing from loaded scenario snapshot. Failing closed.`,
      );
      (err as unknown as { code: string; statusCode: number }).code = 'SAFETY_SNAPSHOT_INCOMPLETE';
      (err as unknown as { code: string; statusCode: number }).statusCode = 500;
      throw err;
    }

    if (
      eventRow.entity_type === 'RESOURCE' &&
      !resources.some((r) => r.id === eventRow.entity_id)
    ) {
      const err = new Error(
        `Safety-critical state incomplete: affected resource "${eventRow.entity_id}" is missing from loaded scenario snapshot. Failing closed.`,
      );
      (err as unknown as { code: string; statusCode: number }).code = 'SAFETY_SNAPSHOT_INCOMPLETE';
      (err as unknown as { code: string; statusCode: number }).statusCode = 500;
      throw err;
    }

    // Dynamically derive geographic metadata from actual coordinates (no hardcoded NCR bounds)
    const allPoints: GeoPoint[] = [
      ...requests.map((r) => ({ lat: r.lat, lng: r.lng })),
      ...resources.map((r) => ({ lat: r.lat, lng: r.lng })),
      ...shelters.map((s) => ({ lat: s.lat, lng: s.lng })),
    ];
    const bounds = computeBoundingBoxFromPoints(allPoints);
    const region = deriveRegionFromCoordinates(allPoints);
    const classification = classifyScenarioProvenance(requests, resources, shelters);

    const scenarioSnapshot: Scenario = {
      id: `operational-snapshot-${eventId}`,
      simulated: classification.simulated,
      provenance: classification.provenance,
      syntheticDataNote: classification.syntheticDataNote,
      metadata: {
        id: `operational-snapshot-${eventId}`,
        name: `Operational Replanning Snapshot (${region})`,
        region,
        createdAt: new Date().toISOString(),
        bounds,
        simulated: classification.simulated,
        provenance: classification.provenance,
        syntheticDataNote: classification.syntheticDataNote,
      },
      requests,
      resources,
      shelters,
      blockedZones: blockedZones.length > 0 ? blockedZones : undefined,
    };

    // Load complete applicable frozen stops using actual coordinates, scoped to this scenario
    const scenarioResourceIds = new Set(resources.map((r) => r.id));
    const frozenStops = await this.loadCommittedFrozenStops(
      options?.baselineAssignmentId,
      scenarioResourceIds,
    );

    // Capture state for concurrency & stale snapshot detection
    const initialEventVersion = eventRow.entity_version;
    const initialCommitted =
      typeof this.repo.getLatestCommittedAssignment === 'function'
        ? await this.repo.getLatestCommittedAssignment()
        : null;

    const input: RepairInput = {
      eventId,
      baselineAssignmentId: options?.baselineAssignmentId ?? null,
      scenarioSnapshot,
      frozenStops,
      affectedRequestIds: eventRow.entity_type === 'REQUEST' ? [eventRow.entity_id] : [],
      affectedResourceIds: eventRow.entity_type === 'RESOURCE' ? [eventRow.entity_id] : [],
      expectedVersion: options?.expectedVersion ?? eventRow.entity_version,
    };

    const result = await this.repairSolver.solveRepair(input);

    // Solver-output validation & safe PROPOSED persistence under transactional concurrency guard
    if (result.status === 'PROPOSED' && result.proposedPlan) {
      // 1. Validate frozen stop invariants first (coordinates, order, duplicates, identity)
      this.validateFrozenStopInvariants(result.proposedPlan, frozenStops);

      // 2. Validate solver plan domain invariants (capacity, resource availability, duplicate allocations)
      this.validateProposedPlanDomainRules(scenarioSnapshot, result.proposedPlan);

      // 3. Atomically check for TOCTOU concurrency conflicts and persist PROPOSED assignment
      const proposalId = await this.persistRepairProposal({
        plan: result.proposedPlan,
        scenarioId: scenarioSnapshot.id,
        eventId,
        initialEventVersion,
        expectedVersion: options?.expectedVersion,
        initialCommittedAssignmentId: initialCommitted?.assignment.id ?? null,
        affectedRequestIds: input.affectedRequestIds,
        resources: scenarioSnapshot.resources,
      });
      result.proposalId = proposalId;
    }

    return result;
  }

  /**
   * Retrieves all frozen stops from committed assignments with actual parsed coordinates,
   * scoped strictly to the relevant scenario resources (and baseline assignment if provided).
   * Unrelated historical committed assignments for other resources or scenarios are excluded.
   */
  private async loadCommittedFrozenStops(
    baselineAssignmentId?: string | null,
    scenarioResourceIds?: Set<string>,
  ): Promise<FrozenStopReference[]> {
    let allFrozen: FrozenStopReference[];
    if (typeof this.repo.listCommittedFrozenStops === 'function') {
      allFrozen = await this.repo.listCommittedFrozenStops();
    } else {
      // Fallback: unconstrained traversal across all committed assignments
      const committedAssignments = await this.repo.listAssignments({ status: 'COMMITTED' });
      const stops: FrozenStopReference[] = [];

      for (const ca of committedAssignments) {
        const detail = await this.repo.getAssignmentWithStops(ca.id);
        if (detail && detail.stops) {
          for (const s of detail.stops) {
            if (s.is_frozen) {
              const geo = parsePointWkt(s.location);
              stops.push({
                assignmentId: s.assignment_id,
                resourceId: s.resource_id,
                stopNumber: s.stop_number,
                targetId: s.target_id,
                type: s.type,
                lat: geo.lat,
                lng: geo.lng,
              });
            }
          }
        }
      }
      allFrozen = stops;
    }

    return allFrozen.filter((fs) => {
      if (baselineAssignmentId) {
        return fs.assignmentId === baselineAssignmentId;
      }
      if (scenarioResourceIds && !scenarioResourceIds.has(fs.resourceId)) {
        return false;
      }
      return true;
    });
  }

  /**
   * Validates that the solver's proposed plan preserves all frozen stops exactly.
   * Checks resourceId, sequence (stopNumber), stop type, targetId, coordinates (lat/lng),
   * and prevents duplicate occurrences of frozen stops.
   */
  private validateFrozenStopInvariants(
    plan: SolverPlan,
    frozenStops: ReadonlyArray<FrozenStopReference>,
  ): void {
    const COORDINATE_TOLERANCE = 1e-4; // ~11 meters tolerance

    for (const fs of frozenStops) {
      const route = plan.routes.find((r) => r.resourceId === fs.resourceId);
      if (!route) {
        const err = new Error(
          `Solver output validation failure: route for resource "${fs.resourceId}" is missing, violating frozen stop invariant for target "${fs.targetId}"`,
        );
        (err as unknown as { code: string; statusCode: number }).code =
          'FROZEN_STOP_INVARIANT_VIOLATED';
        (err as unknown as { code: string; statusCode: number }).statusCode = 500;
        throw err;
      }

      // Check duplicates
      if (fs.type === 'PICKUP') {
        const duplicates = route.stops.filter(
          (s) => s.targetId === fs.targetId && s.type === fs.type,
        );
        if (duplicates.length > 1) {
          const err = new Error(
            `Solver output validation failure: frozen stop for target "${fs.targetId}" is duplicated ${duplicates.length} times on resource "${fs.resourceId}"`,
          );
          (err as unknown as { code: string; statusCode: number }).code =
            'FROZEN_STOP_INVARIANT_VIOLATED';
          (err as unknown as { code: string; statusCode: number }).statusCode = 500;
          throw err;
        }
      } else {
        const otherFrozen = route.stops.filter(
          (s) =>
            Boolean(s.isFrozen) &&
            s.stopNumber !== fs.stopNumber &&
            s.targetId === fs.targetId &&
            s.type === fs.type,
        );
        if (otherFrozen.length > 0) {
          const err = new Error(
            `Solver output validation failure: frozen stop for target "${fs.targetId}" is duplicated across multiple frozen positions on resource "${fs.resourceId}"`,
          );
          (err as unknown as { code: string; statusCode: number }).code =
            'FROZEN_STOP_INVARIANT_VIOLATED';
          (err as unknown as { code: string; statusCode: number }).statusCode = 500;
          throw err;
        }
      }

      const matchingStop = route.stops.find(
        (s) => s.stopNumber === fs.stopNumber && s.targetId === fs.targetId && s.type === fs.type,
      );

      if (!matchingStop) {
        const err = new Error(
          `Solver output validation failure: frozen stop #${fs.stopNumber} for target "${fs.targetId}" on resource "${fs.resourceId}" was modified, reordered, or dropped`,
        );
        (err as unknown as { code: string; statusCode: number }).code =
          'FROZEN_STOP_INVARIANT_VIOLATED';
        (err as unknown as { code: string; statusCode: number }).statusCode = 500;
        throw err;
      }

      // Check coordinate integrity (lat and lng must match authoritative frozen stop)
      const latDiff = Math.abs(matchingStop.lat - fs.lat);
      const lngDiff = Math.abs(matchingStop.lng - fs.lng);
      if (latDiff > COORDINATE_TOLERANCE || lngDiff > COORDINATE_TOLERANCE) {
        const err = new Error(
          `Solver output validation failure: coordinates for frozen stop #${fs.stopNumber} (${matchingStop.lat}, ${matchingStop.lng}) do not match authoritative committed coordinates (${fs.lat}, ${fs.lng})`,
        );
        (err as unknown as { code: string; statusCode: number }).code =
          'FROZEN_STOP_INVARIANT_VIOLATED';
        (err as unknown as { code: string; statusCode: number }).statusCode = 500;
        throw err;
      }
    }
  }

  /**
   * Validates structural and domain invariants of the solver's proposed plan:
   * resource availability, uniqueness, non-overlapping requests, capacity limits, and unserved integrity.
   */
  private validateProposedPlanDomainRules(scenario: Scenario, plan: SolverPlan): void {
    const resourceMap = new Map(scenario.resources.map((r) => [r.id, r]));
    const seenResourceIds = new Set<string>();
    const seenServedRequestIds = new Set<string>();

    for (const route of plan.routes) {
      if (seenResourceIds.has(route.resourceId)) {
        const err = new Error(
          `Solver output validation failure: duplicate route found for resource "${route.resourceId}"`,
        );
        (err as unknown as { code: string; statusCode: number }).code = 'SOLVER_OUTPUT_INVALID';
        (err as unknown as { code: string; statusCode: number }).statusCode = 500;
        throw err;
      }
      seenResourceIds.add(route.resourceId);

      const resource = resourceMap.get(route.resourceId);
      if (!resource) {
        const err = new Error(
          `Solver output validation failure: route references unknown resource "${route.resourceId}"`,
        );
        (err as unknown as { code: string; statusCode: number }).code = 'SOLVER_OUTPUT_INVALID';
        (err as unknown as { code: string; statusCode: number }).statusCode = 500;
        throw err;
      }

      if (resource.status === 'OFFLINE' || resource.status === 'MAINTENANCE') {
        const err = new Error(
          `Solver output validation failure: resource "${resource.id}" is unavailable (${resource.status}) but was assigned a route`,
        );
        (err as unknown as { code: string; statusCode: number }).code = 'SOLVER_OUTPUT_INVALID';
        (err as unknown as { code: string; statusCode: number }).statusCode = 500;
        throw err;
      }

      // Check duplicate request allocations across routes
      for (const reqId of route.servedRequestIds) {
        if (seenServedRequestIds.has(reqId)) {
          const err = new Error(
            `Solver output validation failure: request "${reqId}" is allocated to multiple routes`,
          );
          (err as unknown as { code: string; statusCode: number }).code = 'SOLVER_OUTPUT_INVALID';
          (err as unknown as { code: string; statusCode: number }).statusCode = 500;
          throw err;
        }
        seenServedRequestIds.add(reqId);
      }

      // Check capacity feasibility and pickup/dropoff ordering along the route
      let currentLoad = 0;
      let prevArrival = 0;

      for (const stop of route.stops) {
        if (stop.estimatedArrivalMinutes < prevArrival) {
          const err = new Error(
            `Solver output validation failure: arrival times are not monotonic for resource "${route.resourceId}" at stop #${stop.stopNumber}`,
          );
          (err as unknown as { code: string; statusCode: number }).code = 'SOLVER_OUTPUT_INVALID';
          (err as unknown as { code: string; statusCode: number }).statusCode = 500;
          throw err;
        }
        prevArrival = stop.estimatedArrivalMinutes;

        if (stop.type === 'PICKUP') {
          currentLoad += stop.passengersPickedUp;
        } else if (stop.type === 'DROPOFF') {
          currentLoad -= stop.passengersDroppedOff;
        }

        if (currentLoad < 0 || currentLoad > resource.capacity) {
          const err = new Error(
            `Solver output validation failure: capacity violated on resource "${route.resourceId}" at stop #${stop.stopNumber} (current load ${currentLoad}, capacity ${resource.capacity})`,
          );
          (err as unknown as { code: string; statusCode: number }).code = 'SOLVER_OUTPUT_INVALID';
          (err as unknown as { code: string; statusCode: number }).statusCode = 500;
          throw err;
        }
      }
    }

    // Validate unserved list consistency
    for (const unserved of plan.unserved) {
      if (seenServedRequestIds.has(unserved.requestId)) {
        const err = new Error(
          `Solver output validation failure: request "${unserved.requestId}" is listed as both served and unserved`,
        );
        (err as unknown as { code: string; statusCode: number }).code = 'SOLVER_OUTPUT_INVALID';
        (err as unknown as { code: string; statusCode: number }).statusCode = 500;
        throw err;
      }
    }
  }

  /**
   * Safely persists the solver's repair proposal with PROPOSED status,
   * revalidating database concurrency state under a transaction.
   * Guarantees no physical or committed assignments are mutated without operator approval.
   */
  private async persistRepairProposal(params: {
    plan: SolverPlan;
    scenarioId: string;
    eventId: string;
    initialEventVersion: number;
    expectedVersion?: number;
    initialCommittedAssignmentId: string | null;
    affectedRequestIds: string[];
    resources: Scenario['resources'];
  }): Promise<string> {
    const {
      plan,
      scenarioId,
      eventId,
      initialEventVersion,
      expectedVersion,
      initialCommittedAssignmentId,
      affectedRequestIds,
      resources,
    } = params;

    const proposalId = `prop-repair-${crypto.randomUUID().slice(0, 8)}`;
    const dbStops: DbAssignmentStop[] = [];

    for (const route of plan.routes) {
      for (const stop of route.stops) {
        dbStops.push({
          ...routeStopToDb(stop, proposalId, route.resourceId),
          created_at: new Date(),
        });
      }
    }

    const persistAction = async (txRepo: PostgisRepository): Promise<string> => {
      // 1. Re-verify operational event version (guard against event mutation while solving)
      if (typeof txRepo.getOperationalEvent === 'function') {
        const currentEvent = await txRepo.getOperationalEvent(eventId);
        if (!currentEvent) {
          const err = new Error(`Operational event "${eventId}" no longer exists`);
          (err as unknown as { code: string; statusCode: number }).code = 'NOT_FOUND';
          (err as unknown as { code: string; statusCode: number }).statusCode = 404;
          throw err;
        }
        if (
          currentEvent.entity_version !== initialEventVersion ||
          (expectedVersion !== undefined && currentEvent.entity_version !== expectedVersion)
        ) {
          const err = new Error(
            `Version conflict: operational event "${eventId}" was modified during solver execution (version ${currentEvent.entity_version} vs expected ${initialEventVersion})`,
          );
          (err as unknown as { code: string; statusCode: number }).code = 'VERSION_CONFLICT';
          (err as unknown as { code: string; statusCode: number }).statusCode = 409;
          throw err;
        }
      }

      // 2. Re-verify committed assignment state (guard against concurrent commitment while solving)
      if (typeof txRepo.getLatestCommittedAssignment === 'function') {
        const currentCommitted = await txRepo.getLatestCommittedAssignment();
        const currentCommittedId = currentCommitted?.assignment.id ?? null;
        if (currentCommittedId !== initialCommittedAssignmentId) {
          const err = new Error(
            `Stale planning state: a new assignment was committed while repair was solving (committed assignment "${currentCommittedId}" replaced "${initialCommittedAssignmentId}")`,
          );
          (err as unknown as { code: string; statusCode: number }).code = 'VERSION_CONFLICT';
          (err as unknown as { code: string; statusCode: number }).statusCode = 409;
          throw err;
        }
      }

      // 3. Re-verify resource statuses
      if (typeof txRepo.getResourceById === 'function') {
        for (const res of resources) {
          const freshRes = await txRepo.getResourceById(res.id);
          if (freshRes && freshRes.status !== res.status) {
            const err = new Error(
              `Stale planning state: resource "${res.id}" status changed from "${res.status}" to "${freshRes.status}" during solver execution`,
            );
            (err as unknown as { code: string; statusCode: number }).code = 'VERSION_CONFLICT';
            (err as unknown as { code: string; statusCode: number }).statusCode = 409;
            throw err;
          }
        }
      }

      // 4. Re-verify affected request statuses
      if (typeof txRepo.getRequestById === 'function') {
        for (const reqId of affectedRequestIds) {
          const freshReq = await txRepo.getRequestById(reqId);
          if (freshReq && freshReq.status === 'CANCELLED') {
            const err = new Error(
              `Stale planning state: affected request "${reqId}" was cancelled during solver execution`,
            );
            (err as unknown as { code: string; statusCode: number }).code = 'VERSION_CONFLICT';
            (err as unknown as { code: string; statusCode: number }).statusCode = 409;
            throw err;
          }
        }
      }

      // 5. Persist PROPOSED assignment
      await txRepo.insertAssignmentWithStops(
        {
          id: proposalId,
          scenario_id: scenarioId,
          status: 'PROPOSED',
          metrics: plan.metrics,
          unserved: plan.unserved,
          committed_at: null,
          committed_by: null,
          created_at: new Date(),
          updated_at: new Date(),
        },
        dbStops,
      );

      // 6. Record audit provenance for the repair proposal
      if (typeof txRepo.insertAuditEvent === 'function') {
        await txRepo.insertAuditEvent({
          entityType: 'ASSIGNMENT',
          entityId: proposalId,
          eventType: 'REPAIR_PROPOSAL_GENERATED',
          actor: 'SYSTEM',
          payload: {
            proposalId,
            scenarioId,
            eventId,
            metrics: plan.metrics,
            routeGeometries: serializeRouteGeometries(plan.routes),
          },
        });
      }

      return proposalId;
    };

    if (typeof this.repo.withTransaction === 'function') {
      return await this.repo.withTransaction((txRepo) => persistAction(txRepo));
    }
    return await persistAction(this.repo);
  }
}
