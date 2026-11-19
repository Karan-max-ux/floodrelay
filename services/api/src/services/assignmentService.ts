import {
  validateScenario,
  type BlockedZone,
  type BoundingBox,
  type GeoPoint,
  type RescueRequest,
  type RescueResource,
  type ResourceRoute,
  type RouteGeometry,
  type RouteStop,
  type Scenario,
  type ScenarioProvenance,
  type Shelter,
  type SolverPlan,
  type UnservedRequest,
} from '@floodrelay/shared';
import { createHash } from 'node:crypto';
import {
  zonesCrossedBySegment,
  solveClusterAllocation,
  solveNearestFirst,
  solveClarkeWrightBaseline,
  prepareTravelTimeProvider,
  enrichRoutesWithGeometry,
  osrmConfigFromEnv,
  type OsrmProviderOptions,
  type TravelTimeReport,
} from '@floodrelay/solver';
import { PostgisRepository } from '../db/repository.js';
import { ServiceAreaService } from './serviceAreaService.js';
import {
  dbToBlockedZone,
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
  travelTime?: TravelTimeReport;
  provenance?: ScenarioProvenance;
  hasSimulatedResources?: boolean;
  hasSimulatedRequests?: boolean;
  hasSimulatedShelters?: boolean;
  hasUnresolvedProvenance?: boolean;
}

export interface PlanProvenanceAnalysis {
  provenance: ScenarioProvenance;
  hasSimulatedResources: boolean;
  hasSimulatedRequests: boolean;
  hasSimulatedShelters: boolean;
  hasUnresolvedProvenance: boolean;
}

export function analyzePlanProvenance(
  routes: ResourceRoute[],
  resourceMap: Map<string, { source?: 'SIMULATED' | 'REAL' }>,
  requestMap: Map<string, { source?: string }>,
  shelterMap: Map<string, { source?: 'SIMULATED' | 'REAL' }>,
): PlanProvenanceAnalysis {
  const assignedResourceIds = Array.from(new Set(routes.map((r) => r.resourceId)));
  const allStops = routes.flatMap((r) => r.stops || []);
  const pickupRequestIds = Array.from(
    new Set(allStops.filter((s) => s.type === 'PICKUP' && s.targetId).map((s) => s.targetId!)),
  );
  const dropoffShelterIds = Array.from(
    new Set(allStops.filter((s) => s.type === 'DROPOFF' && s.targetId).map((s) => s.targetId!)),
  );

  let realCount = 0;
  let simulatedCount = 0;
  let unresolvedCount = 0;
  let hasSimulatedResources = false;
  let hasSimulatedRequests = false;
  let hasSimulatedShelters = false;

  for (const resId of assignedResourceIds) {
    const res = resourceMap.get(resId);
    if (!res || !res.source) {
      unresolvedCount++;
    } else if (res.source === 'SIMULATED') {
      simulatedCount++;
      hasSimulatedResources = true;
    } else if (res.source === 'REAL') {
      realCount++;
    } else {
      unresolvedCount++;
    }
  }

  for (const reqId of pickupRequestIds) {
    const req = requestMap.get(reqId);
    if (!req || !req.source) {
      unresolvedCount++;
    } else if (req.source === 'SIMULATED') {
      simulatedCount++;
      hasSimulatedRequests = true;
    } else if (
      req.source === 'REPORTED' ||
      (req as unknown as { source?: string }).source === 'REAL'
    ) {
      realCount++;
    } else {
      unresolvedCount++;
    }
  }

  for (const shId of dropoffShelterIds) {
    const sh = shelterMap.get(shId);
    if (!sh || !sh.source) {
      unresolvedCount++;
    } else if (sh.source === 'SIMULATED') {
      simulatedCount++;
      hasSimulatedShelters = true;
    } else if (sh.source === 'REAL') {
      realCount++;
    } else {
      unresolvedCount++;
    }
  }

  const hasUnresolvedProvenance = unresolvedCount > 0;
  let provenance: ScenarioProvenance;

  if (simulatedCount > 0 && realCount === 0 && unresolvedCount === 0) {
    provenance = 'SIMULATED';
  } else if (simulatedCount > 0 || unresolvedCount > 0) {
    provenance = 'MIXED';
  } else {
    // Pure real plan or empty plan with no participating entities
    provenance = 'REAL';
  }

  return {
    provenance,
    hasSimulatedResources,
    hasSimulatedRequests,
    hasSimulatedShelters,
    hasUnresolvedProvenance,
  };
}

export interface AssignmentServiceOptions {
  osrm?: OsrmProviderOptions | null;
}

export interface StoredRouteGeometryEntry {
  geometry: RouteGeometry;
  totalTravelDistanceKm: number;
}

export function serializeRouteGeometries(
  routes: ResourceRoute[],
): Record<string, StoredRouteGeometryEntry> {
  const map: Record<string, StoredRouteGeometryEntry> = {};
  for (const route of routes) {
    if (route.geometry) {
      map[route.resourceId] = {
        geometry: route.geometry,
        totalTravelDistanceKm: route.totalTravelDistanceKm,
      };
    }
  }
  return map;
}

function isStoredGeometryValidForRoute(
  route: ResourceRoute,
  entry: StoredRouteGeometryEntry | undefined,
): entry is StoredRouteGeometryEntry {
  if (!entry?.geometry || !Array.isArray(entry.geometry.coordinates)) {
    return false;
  }
  const orderedStops = [...route.stops].sort((a, b) => a.stopNumber - b.stopNumber);
  if (orderedStops.length === 0) {
    return entry.geometry.coordinates.length <= 1;
  }
  const legs = entry.geometry.legs;
  if (!Array.isArray(legs) || legs.length === 0) {
    return orderedStops.length === 1 && orderedStops[0]!.type === 'DEPOT';
  }
  const firstFromDepot = orderedStops[0]!.type === 'DEPOT';
  const expectedLegs = firstFromDepot ? orderedStops.length - 1 : orderedStops.length;
  if (legs.length !== expectedLegs) {
    return false;
  }
  const expectedTargets = firstFromDepot ? orderedStops.slice(1) : orderedStops;
  return legs.every((leg, idx) => leg.toStopNumber === expectedTargets[idx]!.stopNumber);
}

export interface ProvenanceClassification {
  provenance: ScenarioProvenance;
  simulated?: boolean;
  syntheticDataNote?: string;
  description: string;
}

export function classifyScenarioProvenance(
  requests: RescueRequest[],
  resources: RescueResource[],
  shelters: Shelter[],
): ProvenanceClassification {
  let simulatedCount = 0;
  let realCount = 0;

  for (const req of requests) {
    if (req.source === 'SIMULATED') {
      simulatedCount++;
    } else if (
      req.source === 'REPORTED' ||
      (req as unknown as { source: string }).source === 'REAL'
    ) {
      realCount++;
    }
  }

  for (const res of resources) {
    if (res.source === 'SIMULATED') {
      simulatedCount++;
    } else if (res.source === 'REAL') {
      realCount++;
    }
  }

  for (const sh of shelters) {
    if (sh.source === 'SIMULATED') {
      simulatedCount++;
    } else if (sh.source === 'REAL') {
      realCount++;
    }
  }

  if (realCount > 0 && simulatedCount === 0) {
    return {
      provenance: 'REAL',
      simulated: false,
      syntheticDataNote: undefined,
      description: 'Operational dispatch scenario constructed from real-world platform data',
    };
  }

  if (simulatedCount > 0 && realCount === 0) {
    return {
      provenance: 'SIMULATED',
      simulated: true,
      syntheticDataNote: 'PROPOSED dispatch scenario generated on simulated platform data',
      description: 'Simulation scenario constructed from synthetic platform data',
    };
  }

  if (simulatedCount > 0 && realCount > 0) {
    return {
      provenance: 'MIXED',
      simulated: undefined,
      syntheticDataNote: `MIXED PROVENANCE: Scenario incorporates both real-world (${realCount}) and simulated (${simulatedCount}) operational entities`,
      description: `Mixed-provenance dispatch scenario combining ${realCount} real-world and ${simulatedCount} synthetic entities`,
    };
  }

  return {
    provenance: 'REAL',
    simulated: false,
    syntheticDataNote: undefined,
    description: 'Empty operational scenario constructed from stored platform data',
  };
}

export function computeBoundingBoxFromPoints(points: GeoPoint[]): BoundingBox {
  if (points.length === 0) {
    return {
      minLat: -0.01,
      maxLat: 0.01,
      minLng: -0.01,
      maxLng: 0.01,
    };
  }

  const lats = points.map((p) => p.lat);
  const lngs = points.map((p) => p.lng);

  return {
    minLat: Math.max(-90, Math.min(...lats) - 0.02),
    maxLat: Math.min(90, Math.max(...lats) + 0.02),
    minLng: Math.max(-180, Math.min(...lngs) - 0.02),
    maxLng: Math.min(180, Math.max(...lngs) + 0.02),
  };
}

export function deriveRegionFromCoordinates(points: GeoPoint[]): string {
  if (points.length === 0) {
    return 'Operational Area (Unspecified)';
  }

  const centerLat = points.reduce((sum, p) => sum + p.lat, 0) / points.length;
  const centerLng = points.reduce((sum, p) => sum + p.lng, 0) / points.length;

  if (centerLat >= 28.3 && centerLat <= 28.9 && centerLng >= 76.8 && centerLng <= 77.5) {
    return 'Delhi NCR / Yamuna Floodplain';
  }
  if (centerLat >= 18.8 && centerLat <= 19.4 && centerLng >= 72.7 && centerLng <= 73.2) {
    return 'Mumbai Metropolitan / Konkan Coast';
  }
  if (centerLat >= 8.2 && centerLat <= 12.9 && centerLng >= 74.8 && centerLng <= 77.6) {
    return 'Kerala Flood Region';
  }
  if (centerLat >= 25.5 && centerLat <= 28.2 && centerLng >= 89.5 && centerLng <= 96.2) {
    return 'Assam / Brahmaputra Basin';
  }
  if (centerLat >= 24.8 && centerLat <= 26.8 && centerLng >= 83.8 && centerLng <= 88.2) {
    return 'Bihar / Middle Ganga Basin';
  }
  if (centerLat >= 12.8 && centerLat <= 13.4 && centerLng >= 80.0 && centerLng <= 80.4) {
    return 'Chennai Metropolitan Area';
  }
  if (centerLat >= 22.3 && centerLat <= 23.0 && centerLng >= 88.1 && centerLng <= 88.6) {
    return 'Kolkata / Lower Ganga Basin';
  }
  if (centerLat >= 29.0 && centerLat <= 31.0 && centerLng >= -96.0 && centerLng <= -94.0) {
    return 'Gulf Coast / Greater Houston Region';
  }

  const latStr = `${Math.abs(centerLat).toFixed(2)}°${centerLat >= 0 ? 'N' : 'S'}`;
  const lngStr = `${Math.abs(centerLng).toFixed(2)}°${centerLng >= 0 ? 'E' : 'W'}`;
  return `Operational Area (${latStr}, ${lngStr})`;
}

function canonicalizeJson(obj: unknown): string {
  if (obj === null || typeof obj !== 'object') {
    return JSON.stringify(obj);
  }
  if (Array.isArray(obj)) {
    return `[${obj.map(canonicalizeJson).join(',')}]`;
  }
  const keys = Object.keys(obj as object).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalizeJson((obj as Record<string, unknown>)[k])}`).join(',')}}`;
}

export class AssignmentService {
  private readonly serviceAreaService: ServiceAreaService;

  constructor(
    private readonly repository: PostgisRepository,
    private readonly options?: AssignmentServiceOptions,
  ) {
    this.serviceAreaService = new ServiceAreaService(repository);
  }

  /**
   * Filters operational (non-SIMULATED) entities against the active Delhi NCR service-area boundary.
   * Historical out-of-region records remain untouched in PostgreSQL and are excluded with explicit
   * audit/unserved explanations. Controlled SIMULATED scenarios remain preserved for evaluation.
   */
  private async filterOperationalEntitiesByServiceArea(
    requests: RescueRequest[],
    resources: RescueResource[],
    shelters: Shelter[],
  ): Promise<{
    eligibleRequests: RescueRequest[];
    eligibleResources: RescueResource[];
    eligibleShelters: Shelter[];
    excludedRequestIds: string[];
    excludedResourceIds: string[];
    excludedShelterIds: string[];
  }> {
    const hasOperationalEntities =
      requests.some((r) => r.source !== 'SIMULATED') ||
      resources.some((r) => r.source !== 'SIMULATED') ||
      shelters.some((s) => s.source !== 'SIMULATED');

    if (!hasOperationalEntities) {
      return {
        eligibleRequests: requests,
        eligibleResources: resources,
        eligibleShelters: shelters,
        excludedRequestIds: [],
        excludedResourceIds: [],
        excludedShelterIds: [],
      };
    }

    const eligibleRequests: RescueRequest[] = [];
    const excludedRequestIds: string[] = [];
    for (const req of requests) {
      if (req.source === 'SIMULATED') {
        eligibleRequests.push(req);
        continue;
      }
      const check = await this.serviceAreaService.checkCoordinates(req.lat, req.lng);
      if (check.eligible) {
        eligibleRequests.push(req);
      } else {
        excludedRequestIds.push(req.id);
      }
    }

    const eligibleResources: RescueResource[] = [];
    const excludedResourceIds: string[] = [];
    for (const res of resources) {
      if (res.source === 'SIMULATED') {
        eligibleResources.push(res);
        continue;
      }
      const check = await this.serviceAreaService.checkCoordinates(res.lat, res.lng);
      if (check.eligible) {
        eligibleResources.push(res);
      } else {
        excludedResourceIds.push(res.id);
      }
    }

    const eligibleShelters: Shelter[] = [];
    const excludedShelterIds: string[] = [];
    for (const sh of shelters) {
      if (sh.source === 'SIMULATED') {
        eligibleShelters.push(sh);
        continue;
      }
      const check = await this.serviceAreaService.checkCoordinates(sh.lat, sh.lng);
      if (check.eligible) {
        eligibleShelters.push(sh);
      } else {
        excludedShelterIds.push(sh.id);
      }
    }

    return {
      eligibleRequests,
      eligibleResources,
      eligibleShelters,
      excludedRequestIds,
      excludedResourceIds,
      excludedShelterIds,
    };
  }

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
    const allShelters = await this.repository.listShelters({ activeOnly: true });

    // 3.5. Enforce active Delhi NCR service-area policy on operational (non-SIMULATED) entities
    const {
      eligibleRequests,
      eligibleResources,
      eligibleShelters,
      excludedRequestIds,
      excludedResourceIds,
      excludedShelterIds,
    } = await this.filterOperationalEntitiesByServiceArea(
      requests,
      availableResources,
      allShelters,
    );

    const shelters = eligibleShelters;

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

    // 5. Construct scenario for the solver with validated geographic metadata and provenance
    const scenario = this.constructOperationalScenario(
      input.scenarioId,
      eligibleRequests,
      eligibleResources,
      shelters,
      input.blockedZones,
    );

    const osrmOptions =
      this.options?.osrm === null ? null : (this.options?.osrm ?? osrmConfigFromEnv(process.env));

    const { provider: travelTimeProvider, report: getTravelTimeReport } =
      await prepareTravelTimeProvider(scenario, { osrm: osrmOptions });

    const validation = validateScenario(scenario);
    if (!validation.valid) {
      const err = new Error(`Constructed scenario is invalid: ${validation.errors.join('; ')}`);
      (err as unknown as { code: string; statusCode: number }).code = 'INVALID_SCENARIO';
      (err as unknown as { code: string; statusCode: number }).statusCode = 400;
      throw err;
    }

    // 6. Execute selected solver algorithm
    let plan: SolverPlan;
    if (input.algorithm === 'nearest-first') {
      plan = solveNearestFirst(scenario, {
        travelTimeProvider,
        maxShiftDurationMinutes: input.maxShiftMinutes,
      });
    } else if (input.algorithm === 'savings') {
      plan = solveClarkeWrightBaseline(scenario, {
        travelTimeProvider,
        maxShiftMinutes: input.maxShiftMinutes,
      });
    } else {
      plan = solveClusterAllocation(scenario, {
        existingFrozenRoutes,
        maxShiftMinutes: input.maxShiftMinutes,
        travelTimeProvider,
      });
    }

    const travelTimeReport = getTravelTimeReport();
    if (
      excludedRequestIds.length > 0 ||
      excludedResourceIds.length > 0 ||
      excludedShelterIds.length > 0
    ) {
      for (const excludedReqId of excludedRequestIds) {
        plan.unserved.push({
          requestId: excludedReqId,
          reason: 'ISOLATED_ZONE',
          details:
            'Excluded from operational planning: location is outside the active Delhi NCR service area (historical record preserved untouched).',
        });
      }
      const totalConsidered = plan.metrics.servedRequestsCount + plan.unserved.length;
      plan.metrics.unservedRequestsCount = plan.unserved.length;
      plan.metrics.coveragePercent =
        totalConsidered > 0
          ? Number(((plan.metrics.servedRequestsCount / totalConsidered) * 100).toFixed(1))
          : 0;
      travelTimeReport.warnings.push(
        `Service-area policy excluded out-of-NCR operational records (requests: ${excludedRequestIds.length}, resources: ${excludedResourceIds.length}, shelters: ${excludedShelterIds.length}); historical records remain preserved in database.`,
      );
    }
    for (const warning of travelTimeReport.warnings) {
      console.warn(`[AssignmentService] ${warning}`);
    }

    if (existingFrozenRoutes && input.blockedZones && input.blockedZones.length > 0) {
      for (const route of existingFrozenRoutes) {
        let prevLoc: GeoPoint | null = null;
        for (const stop of route.stops) {
          if (prevLoc) {
            const crossed = zonesCrossedBySegment(prevLoc, stop, input.blockedZones);
            if (crossed.length > 0) {
              const warningMsg = `Frozen committed stop ${stop.stopNumber} for resource '${route.resourceId}' intersects active hazard zone(s) [${crossed.map((z) => z.id).join(', ')}], but frozen committed stops are never rerouted`;
              travelTimeReport.warnings.push(warningMsg);
            }
          }
          prevLoc = stop;
        }
      }
    }

    // 6.5. Enrich routes with OSRM / straight-line route geometries
    const geometryResult = await enrichRoutesWithGeometry(plan.routes, {
      resources: eligibleResources,
      osrm: osrmOptions,
      blockedZones: input.blockedZones,
      travelTimeProvider,
    });
    const enrichedRoutes = geometryResult.routes;
    const routeGeometries = serializeRouteGeometries(enrichedRoutes);

    // 7. Store proposed assignment and stops in the database
    const assignmentId = `assign_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const dbStops: DbAssignmentStop[] = [];

    for (const route of enrichedRoutes) {
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
    const hazardZones = input.blockedZones ?? null;
    const hazardZonesHash = hazardZones
      ? createHash('sha256').update(canonicalizeJson(hazardZones)).digest('hex')
      : null;

    await this.repository.insertAuditEvent({
      entityType: 'ASSIGNMENT',
      entityId: assignmentId,
      eventType: 'ASSIGNMENT_PROPOSED',
      actor: 'SYSTEM',
      payload: {
        scenarioId: input.scenarioId,
        algorithm: input.algorithm,
        metrics: plan.metrics,
        routesCount: enrichedRoutes.length,
        unservedCount: plan.unserved.length,
        travelTime: travelTimeReport,
        routeGeometries,
        hazardZones,
        hazardZonesHash,
        blockedZones: hazardZones,
        excludedOutOfServiceArea:
          excludedRequestIds.length > 0 ||
          excludedResourceIds.length > 0 ||
          excludedShelterIds.length > 0
            ? {
                requestIds: excludedRequestIds,
                resourceIds: excludedResourceIds,
                shelterIds: excludedShelterIds,
              }
            : undefined,
      },
    });

    const resMap = new Map(availableResources.map((r) => [r.id, r]));
    const reqMap = new Map(requests.map((r) => [r.id, r]));
    const shelterMap = new Map(shelters.map((s) => [s.id, s]));

    const planProvenance = analyzePlanProvenance(enrichedRoutes, resMap, reqMap, shelterMap);

    return {
      id: assignmentId,
      scenarioId: input.scenarioId,
      status: 'PROPOSED',
      committedAt: null,
      committedBy: null,
      metrics: plan.metrics,
      unserved: plan.unserved,
      routes: enrichedRoutes,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      travelTime: travelTimeReport,
      provenance: planProvenance.provenance,
      hasSimulatedResources: planProvenance.hasSimulatedResources,
      hasSimulatedRequests: planProvenance.hasSimulatedRequests,
      hasSimulatedShelters: planProvenance.hasSimulatedShelters,
      hasUnresolvedProvenance: planProvenance.hasUnresolvedProvenance,
    };
  }

  /**
   * Retrieves an assignment by ID along with its routes, stops, and route geometries.
   */
  async getAssignment(id: string): Promise<AssignmentDetailResponse | null> {
    const record = await this.repository.getAssignmentWithStops(id);
    if (!record) return null;

    const routes = this.reconstructRoutesFromStops(record.stops);
    const osrmOptions =
      this.options?.osrm === null ? null : (this.options?.osrm ?? osrmConfigFromEnv(process.env));

    let savedGeometries: Record<string, StoredRouteGeometryEntry> | null = null;
    let savedTravelTime: TravelTimeReport | undefined;

    if (typeof this.repository.listAuditEvents === 'function') {
      try {
        const events = await this.repository.listAuditEvents({
          entityType: 'ASSIGNMENT',
          entityId: id,
          limit: 20,
        });
        for (const ev of events) {
          if (
            (ev.event_type === 'ASSIGNMENT_PROPOSED' ||
              ev.event_type === 'REPAIR_PROPOSAL_GENERATED') &&
            ev.payload
          ) {
            if (!savedTravelTime && ev.payload.travelTime) {
              savedTravelTime = ev.payload.travelTime as TravelTimeReport;
            }
            if (!savedGeometries && ev.payload.routeGeometries) {
              savedGeometries = ev.payload.routeGeometries as Record<
                string,
                StoredRouteGeometryEntry
              >;
            }
            break;
          }
        }
      } catch {
        // Minimal test stubs may not implement SELECT FROM audit_events
      }
    }

    const hydratedRoutes: ResourceRoute[] = [];
    const routesNeedingEnrichment: ResourceRoute[] = [];

    for (const route of routes) {
      const saved = savedGeometries?.[route.resourceId];
      if (isStoredGeometryValidForRoute(route, saved)) {
        const dist =
          saved.totalTravelDistanceKm > 0 ? saved.totalTravelDistanceKm : saved.geometry.distanceKm;
        hydratedRoutes.push({
          ...route,
          totalTravelDistanceKm: dist,
          geometry: saved.geometry,
        });
      } else {
        routesNeedingEnrichment.push(route);
      }
    }

    let finalRoutes = hydratedRoutes;

    if (routesNeedingEnrichment.length > 0) {
      let resources: RescueResource[];
      let blockedZones: BlockedZone[] = [];
      try {
        resources = await this.repository.listResources();
      } catch {
        resources = [];
      }
      if (typeof this.repository.listBlockedZones === 'function') {
        try {
          const dbZones = await this.repository.listBlockedZones(true);
          blockedZones = dbZones.map(dbToBlockedZone);
        } catch {
          blockedZones = [];
        }
      }

      const enrichedMissing = await enrichRoutesWithGeometry(routesNeedingEnrichment, {
        resources,
        osrm: osrmOptions,
        blockedZones,
      });

      const byResource = new Map<string, ResourceRoute>();
      for (const r of hydratedRoutes) {
        byResource.set(r.resourceId, r);
      }
      for (const r of enrichedMissing.routes) {
        byResource.set(r.resourceId, {
          ...r,
          totalTravelDistanceKm: r.geometry ? r.geometry.distanceKm : r.totalTravelDistanceKm,
        });
      }

      finalRoutes = routes.map((r) => byResource.get(r.resourceId) ?? r);
    }

    let allRes: RescueResource[] = [];
    let allReq: RescueRequest[] = [];
    let allShelters: Shelter[] = [];
    try {
      allRes = await this.repository.listResources();
    } catch {
      // ignore
    }
    try {
      allReq = await this.repository.listRequests();
    } catch {
      // ignore
    }
    try {
      allShelters = await this.repository.listShelters({ activeOnly: false });
    } catch {
      // ignore
    }

    const resMap = new Map(allRes.map((r) => [r.id, r]));
    const reqMap = new Map(allReq.map((r) => [r.id, r]));
    const shelterMap = new Map(allShelters.map((s) => [s.id, s]));

    const planProvenance = analyzePlanProvenance(finalRoutes, resMap, reqMap, shelterMap);

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
      routes: finalRoutes,
      createdAt: record.assignment.created_at.toISOString(),
      updatedAt: record.assignment.updated_at.toISOString(),
      provenance: planProvenance.provenance,
      hasSimulatedResources: planProvenance.hasSimulatedResources,
      hasSimulatedRequests: planProvenance.hasSimulatedRequests,
      hasSimulatedShelters: planProvenance.hasSimulatedShelters,
      hasUnresolvedProvenance: planProvenance.hasUnresolvedProvenance,
      ...(savedTravelTime ? { travelTime: savedTravelTime } : {}),
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
    return computeBoundingBoxFromPoints(points);
  }

  /**
   * Constructs an operational scenario with coordinate-derived bounds and region,
   * and explicit provenance labeling (REAL, SIMULATED, or MIXED).
   */
  public constructOperationalScenario(
    scenarioId: string,
    requests: RescueRequest[],
    resources: RescueResource[],
    shelters: Shelter[],
    blockedZones?: BlockedZone[],
  ): Scenario {
    const bounds = this.computeBoundingBox(requests, resources, shelters);
    const allPoints = [
      ...requests.map((r) => ({ lat: r.lat, lng: r.lng })),
      ...resources.map((r) => ({ lat: r.lat, lng: r.lng })),
      ...shelters.map((s) => ({ lat: s.lat, lng: s.lng })),
    ];
    const region = deriveRegionFromCoordinates(allPoints);
    const classification = classifyScenarioProvenance(requests, resources, shelters);

    return {
      id: scenarioId,
      simulated: classification.simulated,
      provenance: classification.provenance,
      syntheticDataNote: classification.syntheticDataNote,
      metadata: {
        id: scenarioId,
        name: `Active Scenario (${scenarioId})`,
        description: classification.description,
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
      blockedZones: blockedZones && blockedZones.length > 0 ? blockedZones : undefined,
    };
  }
}
