import type {
  RescueRequest,
  UrgencyLevel,
  RequestStatus,
  VerificationStatus,
  RescueResource,
  ResourceType,
  ResourceStatus,
  Shelter,
  RouteStop,
  ResourceRoute,
  RouteGeometry,
  RouteLegGeometry,
  RouteGeometrySource,
  UnservedRequest,
  SolverMetrics,
  ScenarioProvenance,
  OperationalEvent,
  OperationalEventType,
  EventEntityType,
  EventActorType,
  EventProcessingStatus,
  AffectedScopeResult,
  RepairInput,
  RepairResult,
  FrozenStopReference,
  BlockedZone,
  HazardLevel,
  SolverPlan,
} from '@floodrelay/shared';

export type {
  RescueRequest,
  UrgencyLevel,
  RequestStatus,
  VerificationStatus,
  RescueResource,
  ResourceType,
  ResourceStatus,
  Shelter,
  RouteStop,
  ResourceRoute,
  RouteGeometry,
  RouteLegGeometry,
  RouteGeometrySource,
  UnservedRequest,
  SolverMetrics,
  ScenarioProvenance,
  OperationalEvent,
  OperationalEventType,
  EventEntityType,
  EventActorType,
  EventProcessingStatus,
  AffectedScopeResult,
  RepairInput,
  RepairResult,
  FrozenStopReference,
  BlockedZone,
  HazardLevel,
  SolverPlan,
};

export interface ServiceAreaUncertaintyAssessment {
  isNearBoundary: boolean;
  boundaryDistanceMeters: number;
  thresholdMeters: number;
  justification: string;
  hasPoorAccuracy?: boolean;
}

export interface ServiceAreaCheckResult {
  eligible: boolean;
  status: 'INSIDE' | 'NEAR_BOUNDARY_OUTSIDE' | 'OUTSIDE';
  distanceToBoundaryMeters: number;
  regionId: string;
  regionName: string;
  boundaryVersion: string;
  inclusiveBoundaryPolicy: 'ST_COVERS';
  uncertaintyAssessment?: ServiceAreaUncertaintyAssessment;
}

export interface CreateRequestInput {
  lat: number;
  lng: number;
  peopleCount: number;
  urgency: UrgencyLevel;
  medicalNeeds?: boolean;
  notes?: string;
  source?: 'SIMULATED' | 'REPORTED';
  idempotencyKey?: string;
}

export interface ListRequestsFilter {
  status?: RequestStatus;
  urgency?: UrgencyLevel;
  limit?: number;
  offset?: number;
}

export interface NearbyRequestsFilter {
  lat: number;
  lng: number;
  radiusKm?: number;
  status?: RequestStatus;
  limit?: number;
}

export interface AssignmentRecord {
  id: string;
  title?: string;
  description?: string;
  scenarioId?: string | null;
  scenario_id?: string | null;
  status: 'PROPOSED' | 'COMMITTED';
  metrics?: SolverMetrics | null;
  unserved?: UnservedRequest[] | null;
  routes?: ResourceRoute[];
  stops?: RouteStop[];
  assetsAssigned?: string[];
  committedAt?: string | null;
  committed_at?: string | null;
  committedBy?: string | null;
  committed_by?: string | null;
  createdAt: string;
  created_at?: string;
  updatedAt: string;
  updated_at?: string;
  provenance?: 'REAL' | 'SIMULATED' | 'MIXED';
  hasSimulatedResources?: boolean;
  hasSimulatedRequests?: boolean;
  hasSimulatedShelters?: boolean;
  hasUnresolvedProvenance?: boolean;
}

export interface ProposeAssignmentInput {
  scenarioId?: string;
  algorithm?: 'cluster-allocation' | 'nearest-first' | 'savings';
  includeUnverified?: boolean;
  preserveFrozen?: boolean;
  maxShiftMinutes?: number;
}

export interface CommitAssignmentInput {
  operatorId: string;
  notes?: string;
}

export interface ModifyStopInput {
  isFrozen?: boolean;
  stopNumber?: number;
  resourceId?: string;
}

export interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
  idempotent?: boolean;
  count?: number;
}

export interface ApiErrorPayload {
  error: {
    code: string;
    message: string;
    details?: unknown;
    timestamp?: string;
  };
}

export interface OperatorProfile {
  id: string;
  username: string;
  name: string;
  role: 'OPERATOR' | 'ADMIN' | 'DISPATCHER';
}

export interface LoginResult {
  token: string;
  operator: OperatorProfile;
  expiresAt: string;
}

export interface ListOperationalEventsFilter {
  type?: OperationalEventType;
  entityType?: EventEntityType;
  entityId?: string;
  status?: EventProcessingStatus;
  actorId?: string;
  limit?: number;
  offset?: number;
}

export interface ListAuditEventsFilter {
  entityType?: string;
  entityId?: string;
  eventType?: string;
  actor?: string;
  limit?: number;
  offset?: number;
}

export interface ListResourcesFilter {
  status?: ResourceStatus;
  type?: ResourceType;
}

export interface AuditEventRecord {
  id?: string;
  entityType?: string;
  entity_type?: string;
  entityId?: string;
  entity_id?: string;
  eventType?: string;
  event_type?: string;
  actor: string;
  timestamp?: string;
  createdAt?: string;
  created_at?: string;
  payload: Record<string, unknown>;
}

export interface UpdateResourceStatusInput {
  status: ResourceStatus;
  reason?: string;
}

export interface UpdateResourceStatusResult {
  resource: RescueResource;
  event: OperationalEvent | null;
  affectedScope: AffectedScopeResult | null;
}

export interface AffectedScopeResponse {
  event: OperationalEvent;
  affectedScope: AffectedScopeResult;
}

export interface CreateRoadZoneInput {
  name: string;
  severity: HazardLevel;
  polygon: { lat: number; lng: number }[];
  reason?: string;
}

export interface RoadZoneOperationResult {
  zone: BlockedZone | null;
  event: OperationalEvent;
  affectedScope: AffectedScopeResult;
}

export interface RequestRepairInput {
  eventId: string;
  baselineAssignmentId?: string | null;
  expectedVersion?: number;
}

export type { FloodForecastContext } from '@floodrelay/shared';
