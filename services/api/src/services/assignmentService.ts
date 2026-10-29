import type {
  BoundingBox,
  RescueRequest,
  RescueResource,
  ResourceRoute,
  RouteStop,
  Scenario,
  Shelter,
  SolverPlan,
  UnservedRequest,
} from '@floodrelay/shared';
import {
  solveClusterAllocation,
  solveNearestFirst,
  solveClarkeWrightBaseline,
} from '@floodrelay/solver';
import { PostgisRepository } from '../db/repository.js';
import {
  dbToRouteStop,
  routeStopToDb,
  type AssignmentStatus,
  type DbAssignment,
  type DbAssignmentStop,
} from '../db/schema.js';
import type {
  CommitAssignmentInput,
  ListAssignmentsFilter,
  ModifyStopInput,
  ProposeAssignmentInput,
} from '../validation/assignmentSchema.js';

export interface AssignmentDetailResponse {
  id: string;
  scenarioId: string | null;
  status: AssignmentStatus;
  committedAt: string | null;
  committedBy: string | null;
  metrics: SolverPlan['metrics'];
  unserved: UnservedRequest[];
  routes: ResourceRoute[];
  createdAt: string;
  updatedAt: string;
}

export class AssignmentService {
  constructor(private readonly repository: PostgisRepository) {}

  /**
   * Runs the solver on stored database data and proposes an assignment plan.
   * Note: The solver ONLY proposes; an assignment remains PROPOSED until an operator commits.
   */
  async proposeAssignment(input: ProposeAssignmentInput): Promise<AssignmentDetailResponse> {
    // 1. Fetch pending requests (excluding flagged duplicates to avoid double-allocation)
    const requests = await this.repository.listRequests({
      status: 'PENDING',
      excludeFlaggedDuplicates: true,
    });

    // 2. Fetch available rescue resources
    const allResources = await this.repository.listResources();
    const availableResources = allResources.filter(
      (r) => r.status === 'AVAILABLE' || r.status === 'ASSIGNED',
    );

    // 3. Fetch safe shelters
    const shelters = await this.repository.listShelters({ activeOnly: true });

    // 4. Retrieve existing frozen routes if requested, and validate algorithm capability
    let existingFrozenRoutes: ResourceRoute[] | undefined;
    const latestCommitted = await this.repository.getLatestCommittedAssignment(input.scenarioId);
    const hasCommittedFrozenStops = Boolean(
      latestCommitted && latestCommitted.stops.some((s) => s.is_frozen),
    );

    if (
      hasCommittedFrozenStops &&
      (input.algorithm === 'nearest-first' || input.algorithm === 'savings') &&
      input.preserveFrozen !== false
    ) {
      const err = new Error(
        `Algorithm "${input.algorithm}" does not support preserving frozen routes. Committed frozen stops exist in scenario "${input.scenarioId}". Please use "cluster-allocation" for incremental replanning with frozen stops, or explicitly specify preserveFrozen: false to ignore existing frozen routes.`,
      );
      (err as unknown as { code: string; statusCode: number }).code =
        'UNSUPPORTED_ALGORITHM_OPTION';
      (err as unknown as { code: string; statusCode: number }).statusCode = 400;
      throw err;
    }

    if (input.preserveFrozen && latestCommitted && latestCommitted.stops.length > 0) {
      existingFrozenRoutes = this.reconstructRoutesFromStops(
        latestCommitted.stops.filter((s) => s.is_frozen),
      );
    }

    // 5. Construct scenario for the solver
    const bounds = this.computeBoundingBox(requests, availableResources, shelters);
    const scenario: Scenario = {
      id: input.scenarioId,
      simulated: true,
      syntheticDataNote: 'PROPOSED dispatch scenario generated on simulated platform data',
      metadata: {
        id: input.scenarioId,
        name: `Active Scenario (${input.scenarioId})`,
        description: 'Dynamic dispatch scenario constructed from stored platform data',
        region: 'Delhi / Yamuna Floodplain',
        createdAt: new Date().toISOString(),
        bounds,
        simulated: true,
      },
      requests,
      resources: availableResources,
      shelters,
    };

    // 6. Execute selected solver algorithm
    let plan: SolverPlan;
    if (input.algorithm === 'nearest-first') {
      plan = solveNearestFirst(scenario);
    } else if (input.algorithm === 'savings') {
      plan = solveClarkeWrightBaseline(scenario);
    } else {
      plan = solveClusterAllocation(scenario, {
        existingFrozenRoutes,
        maxShiftMinutes: input.maxShiftMinutes,
      });
    }

    // 7. Store proposed assignment and stops in the database
    const assignmentId = `assign_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const dbStops: DbAssignmentStop[] = [];

    for (const route of plan.routes) {
      for (const stop of route.stops) {
        const mapped = routeStopToDb(stop, assignmentId, route.resourceId);
        dbStops.push({
          ...mapped,
          created_at: new Date(),
        });
      }
    }

    const now = new Date();
    const dbAssignment: DbAssignment = {
      id: assignmentId,
      scenario_id: input.scenarioId,
      status: 'PROPOSED',
      metrics: plan.metrics,
      unserved: plan.unserved,
      committed_at: null,
      committed_by: null,
      created_at: now,
      updated_at: now,
    };

    await this.repository.insertAssignmentWithStops(dbAssignment, dbStops);

    // 8. Log audit event
    await this.repository.insertAuditEvent({
      entityType: 'ASSIGNMENT',
      entityId: assignmentId,
      eventType: 'ASSIGNMENT_PROPOSED',
      actor: 'SYSTEM',
      payload: {
        scenarioId: input.scenarioId,
        algorithm: input.algorithm,
        metrics: plan.metrics,
        routesCount: plan.routes.length,
        unservedCount: plan.unserved.length,
      },
    });

    return {
      id: assignmentId,
      scenarioId: input.scenarioId,
      status: 'PROPOSED',
      committedAt: null,
      committedBy: null,
      metrics: plan.metrics,
      unserved: plan.unserved,
      routes: plan.routes,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };
  }

  /**
   * Retrieves an assignment by ID along with its routes and stops.
   */
  async getAssignment(id: string): Promise<AssignmentDetailResponse | null> {
    const record = await this.repository.getAssignmentWithStops(id);
    if (!record) return null;

    const routes = this.reconstructRoutesFromStops(record.stops);

    return {
      id: record.assignment.id,
      scenarioId: record.assignment.scenario_id,
      status: record.assignment.status,
      committedAt: record.assignment.committed_at
        ? record.assignment.committed_at.toISOString()
        : null,
      committedBy: record.assignment.committed_by,
      metrics: record.assignment.metrics || {
        coveragePercent: 0,
        totalTravelTimeMinutes: 0,
        totalTravelDistanceKm: 0,
        highPriorityWaitTimeMinutes: 0,
        solveDurationMs: 0,
        servedRequestsCount: 0,
        unservedRequestsCount: record.assignment.unserved?.length ?? 0,
      },
      unserved: record.assignment.unserved ?? [],
      routes,
      createdAt: record.assignment.created_at.toISOString(),
      updatedAt: record.assignment.updated_at.toISOString(),
    };
  }

  /**
   * Lists stored assignments with optional filtering by status or scenario.
   */
  async listAssignments(filter?: ListAssignmentsFilter): Promise<DbAssignment[]> {
    return this.repository.listAssignments(filter);
  }

  /**
   * Operator commits an assignment plan.
   * Freezes all stops in the plan and marks served requests as ASSIGNED.
   */
  async commitAssignment(id: string, input: CommitAssignmentInput): Promise<boolean> {
    return this.repository.commitAssignment(id, input.operatorId, input.notes);
  }

  /**
   * Operator modifies a stop on a PROPOSED assignment (e.g. toggle freeze, reorder stop).
   */
  async modifyStop(
    assignmentId: string,
    stopId: string,
    input: ModifyStopInput,
    operatorId = 'OPERATOR',
  ): Promise<RouteStop> {
    const record = await this.repository.getAssignmentWithStops(assignmentId);
    if (!record) {
      const err = new Error(`Assignment "${assignmentId}" not found`);
      (err as unknown as { code: string }).code = 'NOT_FOUND';
      throw err;
    }

    if (record.assignment.status !== 'PROPOSED') {
      const err = new Error(
        `Cannot modify stops on assignment "${assignmentId}" because status is "${record.assignment.status}". Only PROPOSED plans can be modified.`,
      );
      (err as unknown as { code: string }).code = 'CANNOT_MODIFY_COMMITTED';
      throw err;
    }

    const updated = await this.repository.updateAssignmentStop(assignmentId, stopId, {
      is_frozen: input.isFrozen,
      stop_number: input.stopNumber,
      resource_id: input.resourceId,
    });

    if (!updated) {
      const err = new Error(`Stop "${stopId}" not found on assignment "${assignmentId}"`);
      (err as unknown as { code: string }).code = 'NOT_FOUND';
      throw err;
    }

    await this.repository.insertAuditEvent({
      entityType: 'ASSIGNMENT_STOP',
      entityId: stopId,
      eventType: 'ASSIGNMENT_STOP_MODIFIED',
      actor: operatorId,
      payload: { assignmentId, updates: input },
    });

    return dbToRouteStop(updated);
  }

  /**
   * Reconstructs ResourceRoute[] structure from flat DbAssignmentStop[] rows.
   */
  private reconstructRoutesFromStops(stops: DbAssignmentStop[]): ResourceRoute[] {
    const routesByResource = new Map<string, RouteStop[]>();

    for (const stopRow of stops) {
      const routeStop = dbToRouteStop(stopRow);
      const list = routesByResource.get(stopRow.resource_id) || [];
      list.push(routeStop);
      routesByResource.set(stopRow.resource_id, list);
    }

    const routes: ResourceRoute[] = [];
    for (const [resourceId, stopList] of routesByResource.entries()) {
      stopList.sort((a, b) => a.stopNumber - b.stopNumber);

      const servedRequestIds = stopList.filter((s) => s.type === 'PICKUP').map((s) => s.targetId);

      const lastStop = stopList[stopList.length - 1];
      const totalDurationMinutes = lastStop ? lastStop.estimatedArrivalMinutes : 0;

      routes.push({
        resourceId,
        stops: stopList,
        totalTravelDistanceKm: 0,
        totalDurationMinutes,
        servedRequestIds,
      });
    }

    return routes;
  }

  /**
   * Derives a bounding box encompassing all points, with fallback boundaries.
   */
  private computeBoundingBox(
    requests: RescueRequest[],
    resources: RescueResource[],
    shelters: Shelter[],
  ): BoundingBox {
    const points = [
      ...requests.map((r) => ({ lat: r.lat, lng: r.lng })),
      ...resources.map((r) => ({ lat: r.lat, lng: r.lng })),
      ...shelters.map((s) => ({ lat: s.lat, lng: s.lng })),
    ];

    if (points.length === 0) {
      return {
        minLat: 28.5,
        maxLat: 28.8,
        minLng: 77.1,
        maxLng: 77.4,
      };
    }

    const lats = points.map((p) => p.lat);
    const lngs = points.map((p) => p.lng);

    return {
      minLat: Math.min(...lats) - 0.02,
      maxLat: Math.max(...lats) + 0.02,
      minLng: Math.min(...lngs) - 0.02,
      maxLng: Math.max(...lngs) + 0.02,
    };
  }
}
