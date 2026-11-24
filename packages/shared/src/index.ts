// Coordinates and bounds
export interface GeoPoint {
  lat: number;
  lng: number;
}

export interface BoundingBox {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

// Rescue requests
export type UrgencyLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type RequestSource = 'SIMULATED' | 'REPORTED';
export type RequestStatus = 'PENDING' | 'ASSIGNED' | 'IN_TRANSIT' | 'RESCUED' | 'CANCELLED';
export type VerificationStatus = 'UNVERIFIED' | 'VERIFIED' | 'REJECTED';

export interface RescueRequest {
  id: string;
  lat: number;
  lng: number;
  peopleCount: number;
  urgency: UrgencyLevel;
  createdAt: string;
  source: RequestSource;
  status?: RequestStatus;
  verificationStatus?: VerificationStatus;
  medicalNeeds?: boolean;
  notes?: string;
  isFlaggedDuplicate?: boolean;
  duplicateOfId?: string | null;
  idempotencyKey?: string | null;
}

// Rescue resources (vehicles, boats, etc.)
export type ResourceType = 'BOAT' | 'HIGH_WATER_VEHICLE' | 'AMBULANCE' | 'HELICOPTER';
export type ResourceStatus = 'AVAILABLE' | 'ASSIGNED' | 'EN_ROUTE' | 'MAINTENANCE' | 'OFFLINE';

export interface RescueResource {
  id: string;
  name: string;
  type: ResourceType;
  capacity: number;
  speedKmH: number;
  lat: number;
  lng: number;
  status: ResourceStatus;
  depotId?: string;
  source?: 'SIMULATED' | 'REAL';
  modelId?: string;
  notes?: string;
  version?: number;
  createdBy?: string;
  updatedBy?: string;
  createdAt?: string;
  updatedAt?: string;
}

export type VehicleCategory =
  'Rescue Boat' | 'High-Water Rescue Vehicle' | 'Ambulance' | 'Rescue Helicopter';

export interface VehicleCatalogModel {
  id: string;
  name: string;
  category: VehicleCategory;
  type: ResourceType;
  defaultCapacity: number;
  defaultSpeedKmH: number;
  minCapacity: number;
  maxCapacity: number;
  minSpeedKmH: number;
  maxSpeedKmH: number;
  description: string;
}

export const APPROVED_VEHICLE_CATALOG: readonly VehicleCatalogModel[] = [
  {
    id: 'boat-irb-standard',
    name: 'Inflatable Rescue Boat (IRB)',
    category: 'Rescue Boat',
    type: 'BOAT',
    defaultCapacity: 8,
    defaultSpeedKmH: 25,
    minCapacity: 2,
    maxCapacity: 12,
    minSpeedKmH: 5,
    maxSpeedKmH: 45,
    description:
      'Shallow-draft motorized inflatable rescue craft optimized for flooded residential sectors and submerged streets.',
  },
  {
    id: 'boat-flood-rescue-craft',
    name: 'Rigid Flood Rescue Craft (FRC)',
    category: 'Rescue Boat',
    type: 'BOAT',
    defaultCapacity: 12,
    defaultSpeedKmH: 30,
    minCapacity: 4,
    maxCapacity: 20,
    minSpeedKmH: 10,
    maxSpeedKmH: 50,
    description:
      'Reinforced rigid hull flood rescue craft designed for turbulent river margins, debris corridors, and larger evacuee groups.',
  },
  {
    id: 'high-water-truck-heavy',
    name: 'High-Clearance Rescue Truck (4x4/6x6)',
    category: 'High-Water Rescue Vehicle',
    type: 'HIGH_WATER_VEHICLE',
    defaultCapacity: 16,
    defaultSpeedKmH: 40,
    minCapacity: 4,
    maxCapacity: 30,
    minSpeedKmH: 10,
    maxSpeedKmH: 80,
    description:
      'Heavy tactical high-water vehicle with elevated snorkel intake capable of wading through up to 1.2m standing floodwater.',
  },
  {
    id: 'high-water-carrier-light',
    name: 'Light High-Water Utility Carrier',
    category: 'High-Water Rescue Vehicle',
    type: 'HIGH_WATER_VEHICLE',
    defaultCapacity: 8,
    defaultSpeedKmH: 45,
    minCapacity: 2,
    maxCapacity: 12,
    minSpeedKmH: 10,
    maxSpeedKmH: 90,
    description:
      'Agile medium-clearance response utility transport suitable for narrow roads and peripheral suburban rescue routes.',
  },
  {
    id: 'ambulance-als-advanced',
    name: 'Advanced Life Support (ALS) Ambulance',
    category: 'Ambulance',
    type: 'AMBULANCE',
    defaultCapacity: 4,
    defaultSpeedKmH: 50,
    minCapacity: 1,
    maxCapacity: 6,
    minSpeedKmH: 15,
    maxSpeedKmH: 100,
    description:
      'Emergency medical response unit equipped with patient monitoring, oxygenation, and specialized paramedic life-support systems.',
  },
  {
    id: 'ambulance-bls-standard',
    name: 'Basic Life Support (BLS) Ambulance',
    category: 'Ambulance',
    type: 'AMBULANCE',
    defaultCapacity: 4,
    defaultSpeedKmH: 50,
    minCapacity: 1,
    maxCapacity: 8,
    minSpeedKmH: 15,
    maxSpeedKmH: 100,
    description:
      'Standard emergency medical transport for non-critical triage transfers to regional staging hospitals and relief shelters.',
  },
  {
    id: 'helicopter-medium-rescue',
    name: 'Medium Aviation Rescue Helicopter',
    category: 'Rescue Helicopter',
    type: 'HELICOPTER',
    defaultCapacity: 12,
    defaultSpeedKmH: 180,
    minCapacity: 2,
    maxCapacity: 20,
    minSpeedKmH: 60,
    maxSpeedKmH: 260,
    description:
      'Twin-engine hoist-capable aviation resource for rapid extraction from isolated rooftops, embankments, and stranded flood islands.',
  },
  {
    id: 'helicopter-light-utility',
    name: 'Light Aviation Recon & Extract Helicopter',
    category: 'Rescue Helicopter',
    type: 'HELICOPTER',
    defaultCapacity: 4,
    defaultSpeedKmH: 200,
    minCapacity: 1,
    maxCapacity: 6,
    minSpeedKmH: 80,
    maxSpeedKmH: 280,
    description:
      'Rapid response aviation craft for critical reconnaissance, aerial assessment, and single-patient emergency aerial extraction.',
  },
];

export function getVehicleCatalogModel(modelId: string): VehicleCatalogModel | undefined {
  return APPROVED_VEHICLE_CATALOG.find((m) => m.id === modelId);
}

export function isValidCatalogModel(modelId: string): boolean {
  return APPROVED_VEHICLE_CATALOG.some((m) => m.id === modelId);
}

// Safe Shelters and Depots
export interface Shelter {
  id: string;
  name: string;
  lat: number;
  lng: number;
  capacity: number;
  currentOccupancy?: number;
  source?: 'SIMULATED' | 'REAL';
}

// Hazard and Blocked zones
export type HazardLevel = 'BLOCKED' | 'WATER_SURGE' | 'CAUTION';

export interface BlockedZone {
  id: string;
  name?: string;
  severity: HazardLevel;
  polygon: GeoPoint[];
}

// Scenario provenance classification
export type ScenarioProvenance = 'REAL' | 'SIMULATED' | 'MIXED';

// Scenario definition
export interface ScenarioMetadata {
  id: string;
  name: string;
  description?: string;
  region: string;
  seed?: number;
  createdAt: string;
  bounds: BoundingBox;
  simulated?: boolean;
  provenance?: ScenarioProvenance;
  syntheticDataNote?: string;
}

export interface Scenario {
  id: string;
  simulated?: boolean;
  provenance?: ScenarioProvenance;
  syntheticDataNote?: string;
  metadata: ScenarioMetadata;
  requests: RescueRequest[];
  resources: RescueResource[];
  shelters: Shelter[];
  blockedZones?: BlockedZone[];
}

// Solver assignment and output types
export type StopType = 'PICKUP' | 'DROPOFF' | 'DEPOT';

export interface RouteStop {
  stopNumber: number;
  type: StopType;
  targetId: string;
  lat: number;
  lng: number;
  passengersPickedUp: number;
  passengersDroppedOff: number;
  estimatedArrivalMinutes: number;
  isFrozen?: boolean;
}

export type RouteGeometrySource = 'OSRM' | 'STRAIGHT_LINE' | 'MIXED';

export interface RouteLegGeometry {
  fromStopNumber: number;
  toStopNumber: number;
  distanceKm: number;
  durationMinutes: number;
  source: 'OSRM' | 'STRAIGHT_LINE';
  /** Ordered path vertices for this leg as [lat, lng] decimal degree pairs. */
  coordinates: [number, number][];
}

export interface RouteGeometry {
  /** Ordered polyline coordinates covering all legs as [lat, lng] decimal degree pairs. */
  coordinates: [number, number][];
  /** Sum of leg distances in kilometers. */
  distanceKm: number;
  /** Sum of leg durations in minutes. */
  durationMinutes: number;
  source: RouteGeometrySource;
  legs?: RouteLegGeometry[];
}

export interface ResourceRoute {
  resourceId: string;
  stops: RouteStop[];
  totalTravelDistanceKm: number;
  totalDurationMinutes: number;
  servedRequestIds: string[];
  geometry?: RouteGeometry;
}

export type UnservedReason =
  | 'CAPACITY_EXCEEDED'
  | 'NO_REACHABLE_RESOURCE'
  | 'TIME_WINDOW_EXCEEDED'
  | 'ISOLATED_ZONE'
  | 'GROUP_LARGER_THAN_ANY_VEHICLE'
  | 'SHIFT_LIMIT_REACHED'
  | 'UNREACHABLE_DUE_TO_HAZARD'
  | 'UNASSIGNED';

export const VALID_UNSERVED_REASONS: ReadonlySet<UnservedReason> = new Set([
  'CAPACITY_EXCEEDED',
  'NO_REACHABLE_RESOURCE',
  'TIME_WINDOW_EXCEEDED',
  'ISOLATED_ZONE',
  'GROUP_LARGER_THAN_ANY_VEHICLE',
  'SHIFT_LIMIT_REACHED',
  'UNREACHABLE_DUE_TO_HAZARD',
  'UNASSIGNED',
]);

export interface UnservedRequest {
  requestId: string;
  reason: UnservedReason;
  details?: string;
}

export interface SolverMetrics {
  coveragePercent: number;
  totalTravelTimeMinutes: number;
  totalTravelDistanceKm: number;
  highPriorityWaitTimeMinutes: number;
  solveDurationMs: number;
  servedRequestsCount: number;
  unservedRequestsCount: number;
}

export interface SolverPlan {
  scenarioId: string;
  calculatedAt: string;
  solverStatus?: string;
  routes: ResourceRoute[];
  unserved: UnservedRequest[];
  metrics: SolverMetrics;
}

// Validation helpers
export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

const VALID_URGENCIES: ReadonlySet<string> = new Set(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);
const VALID_SOURCES: ReadonlySet<string> = new Set(['SIMULATED', 'REPORTED']);
const VALID_RESOURCE_TYPES: ReadonlySet<string> = new Set([
  'BOAT',
  'HIGH_WATER_VEHICLE',
  'AMBULANCE',
  'HELICOPTER',
]);
const VALID_RESOURCE_STATUSES: ReadonlySet<string> = new Set([
  'AVAILABLE',
  'ASSIGNED',
  'EN_ROUTE',
  'MAINTENANCE',
  'OFFLINE',
]);

function isValidCoord(lat: unknown, lng: unknown): boolean {
  return (
    typeof lat === 'number' &&
    typeof lng === 'number' &&
    !Number.isNaN(lat) &&
    !Number.isNaN(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );
}

export function validateScenario(input: unknown): ValidationResult {
  const errors: string[] = [];

  if (!input || typeof input !== 'object') {
    return { valid: false, errors: ['Scenario must be a non-null object'] };
  }

  const s = input as Partial<Scenario>;

  if (typeof s.id !== 'string' || s.id.trim() === '') {
    errors.push('Scenario id must be a non-empty string');
  }

  if (!s.metadata || typeof s.metadata !== 'object') {
    errors.push('Scenario metadata is required and must be an object');
  } else {
    const m = s.metadata;
    if (typeof m.name !== 'string' || m.name.trim() === '') {
      errors.push('Metadata name must be a non-empty string');
    }
    if (typeof m.region !== 'string' || m.region.trim() === '') {
      errors.push('Metadata region must be a non-empty string');
    }
    if (!m.bounds || typeof m.bounds !== 'object') {
      errors.push('Metadata bounds are required and must be an object');
    } else {
      const b = m.bounds;
      if (!isValidCoord(b.minLat, b.minLng) || !isValidCoord(b.maxLat, b.maxLng)) {
        errors.push(
          'Metadata bounds must contain valid minLat, maxLat, minLng, maxLng coordinates',
        );
      } else if (b.minLat > b.maxLat) {
        errors.push('Metadata bounds minLat must be less than or equal to maxLat');
      } else if (b.minLng > b.maxLng) {
        errors.push('Metadata bounds minLng must be less than or equal to maxLng');
      }
    }
  }

  const seenIds = new Set<string>();

  if (!Array.isArray(s.requests)) {
    errors.push('Scenario requests must be an array');
  } else {
    s.requests.forEach((req, idx) => {
      if (!req || typeof req !== 'object') {
        errors.push(`Request at index ${idx} must be an object`);
        return;
      }
      if (typeof req.id !== 'string' || req.id.trim() === '') {
        errors.push(`Request at index ${idx} must have a non-empty string id`);
      } else if (seenIds.has(req.id)) {
        errors.push(`Duplicate request id: "${req.id}"`);
      } else {
        seenIds.add(req.id);
      }

      if (!isValidCoord(req.lat, req.lng)) {
        errors.push(`Request "${req.id || idx}" has invalid lat/lng coordinates`);
      }

      if (
        typeof req.peopleCount !== 'number' ||
        !Number.isInteger(req.peopleCount) ||
        req.peopleCount <= 0
      ) {
        errors.push(`Request "${req.id || idx}" peopleCount must be a positive integer`);
      }

      if (!VALID_URGENCIES.has(req.urgency as string)) {
        errors.push(`Request "${req.id || idx}" has invalid urgency: "${req.urgency}"`);
      }

      if (!VALID_SOURCES.has(req.source as string)) {
        errors.push(`Request "${req.id || idx}" has invalid source: "${req.source}"`);
      }
    });
  }

  const seenResourceIds = new Set<string>();

  if (!Array.isArray(s.resources)) {
    errors.push('Scenario resources must be an array');
  } else {
    s.resources.forEach((res, idx) => {
      if (!res || typeof res !== 'object') {
        errors.push(`Resource at index ${idx} must be an object`);
        return;
      }
      if (typeof res.id !== 'string' || res.id.trim() === '') {
        errors.push(`Resource at index ${idx} must have a non-empty string id`);
      } else if (seenResourceIds.has(res.id)) {
        errors.push(`Duplicate resource id: "${res.id}"`);
      } else {
        seenResourceIds.add(res.id);
      }

      if (!isValidCoord(res.lat, res.lng)) {
        errors.push(`Resource "${res.id || idx}" has invalid lat/lng coordinates`);
      }

      if (
        typeof res.capacity !== 'number' ||
        !Number.isInteger(res.capacity) ||
        res.capacity <= 0
      ) {
        errors.push(`Resource "${res.id || idx}" capacity must be a positive integer`);
      }

      if (typeof res.speedKmH !== 'number' || res.speedKmH <= 0) {
        errors.push(`Resource "${res.id || idx}" speedKmH must be a positive number`);
      }

      if (!VALID_RESOURCE_TYPES.has(res.type as string)) {
        errors.push(`Resource "${res.id || idx}" has invalid type: "${res.type}"`);
      }

      if (!VALID_RESOURCE_STATUSES.has(res.status as string)) {
        errors.push(`Resource "${res.id || idx}" has invalid status: "${res.status}"`);
      }

      if (res.source !== undefined && res.source !== 'SIMULATED' && res.source !== 'REAL') {
        errors.push(`Resource "${res.id || idx}" has invalid source: "${res.source}"`);
      }
    });
  }

  const seenShelterIds = new Set<string>();

  if (!Array.isArray(s.shelters)) {
    errors.push('Scenario shelters must be an array');
  } else {
    s.shelters.forEach((sh, idx) => {
      if (!sh || typeof sh !== 'object') {
        errors.push(`Shelter at index ${idx} must be an object`);
        return;
      }
      if (typeof sh.id !== 'string' || sh.id.trim() === '') {
        errors.push(`Shelter at index ${idx} must have a non-empty string id`);
      } else if (seenShelterIds.has(sh.id)) {
        errors.push(`Duplicate shelter id: "${sh.id}"`);
      } else {
        seenShelterIds.add(sh.id);
      }

      if (!isValidCoord(sh.lat, sh.lng)) {
        errors.push(`Shelter "${sh.id || idx}" has invalid lat/lng coordinates`);
      }

      if (typeof sh.capacity !== 'number' || !Number.isInteger(sh.capacity) || sh.capacity <= 0) {
        errors.push(`Shelter "${sh.id || idx}" capacity must be a positive integer`);
      }

      if (sh.source !== undefined && sh.source !== 'SIMULATED' && sh.source !== 'REAL') {
        errors.push(`Shelter "${sh.id || idx}" has invalid source: "${sh.source}"`);
      }
    });
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

// ==========================================
// Operational Events & Dynamic Replanning Contracts
// ==========================================

export type OperationalEventType =
  | 'REQUEST_CREATED'
  | 'REQUEST_FLAGGED_DUPLICATE'
  | 'REQUEST_CANCELLED'
  | 'RESOURCE_OFFLINE'
  | 'RESOURCE_AVAILABLE'
  | 'ROAD_BLOCKED'
  | 'ROAD_REOPENED';

export const VALID_OPERATIONAL_EVENT_TYPES: ReadonlySet<OperationalEventType> = new Set([
  'REQUEST_CREATED',
  'REQUEST_FLAGGED_DUPLICATE',
  'REQUEST_CANCELLED',
  'RESOURCE_OFFLINE',
  'RESOURCE_AVAILABLE',
  'ROAD_BLOCKED',
  'ROAD_REOPENED',
]);

export type EventEntityType = 'REQUEST' | 'RESOURCE' | 'ROAD_ZONE' | 'ASSIGNMENT';
export const VALID_EVENT_ENTITY_TYPES: ReadonlySet<EventEntityType> = new Set([
  'REQUEST',
  'RESOURCE',
  'ROAD_ZONE',
  'ASSIGNMENT',
]);

export type EventActorType = 'CITIZEN' | 'OPERATOR' | 'SYSTEM';
export const VALID_EVENT_ACTOR_TYPES: ReadonlySet<EventActorType> = new Set([
  'CITIZEN',
  'OPERATOR',
  'SYSTEM',
]);

export type EventProcessingStatus = 'RECORDED' | 'SCOPE_IDENTIFIED' | 'AWAITING_REPAIR' | 'FAILED';

export const VALID_EVENT_PROCESSING_STATUSES: ReadonlySet<EventProcessingStatus> = new Set([
  'RECORDED',
  'SCOPE_IDENTIFIED',
  'AWAITING_REPAIR',
  'FAILED',
]);

export interface OperationalEvent<TPayload = Record<string, unknown>> {
  id: string;
  type: OperationalEventType;
  entityType: EventEntityType;
  entityId: string;
  actorId: string | null;
  actorType: EventActorType;
  occurredAt: string;
  recordedAt: string;
  correlationId?: string | null;
  idempotencyKey?: string | null;
  entityVersion?: number;
  processingStatus?: EventProcessingStatus;
  processingAttempts?: number;
  lastErrorCode?: string | null;
  processedAt?: string | null;
  payload: TPayload;
}

export function validateOperationalEvent(input: unknown): ValidationResult {
  const errors: string[] = [];
  if (!input || typeof input !== 'object') {
    return { valid: false, errors: ['Operational event must be a non-null object'] };
  }

  const evt = input as Partial<OperationalEvent>;
  if (typeof evt.id !== 'string' || evt.id.trim() === '') {
    errors.push('Event id must be a non-empty string');
  }

  if (!evt.type || !VALID_OPERATIONAL_EVENT_TYPES.has(evt.type)) {
    errors.push(`Invalid operational event type: "${evt.type}"`);
  }

  if (!evt.entityType || !VALID_EVENT_ENTITY_TYPES.has(evt.entityType)) {
    errors.push(`Invalid event entity type: "${evt.entityType}"`);
  }

  if (typeof evt.entityId !== 'string' || evt.entityId.trim() === '') {
    errors.push('Event entityId must be a non-empty string');
  }

  if (!evt.actorType || !VALID_EVENT_ACTOR_TYPES.has(evt.actorType)) {
    errors.push(`Invalid event actor type: "${evt.actorType}"`);
  }

  if (typeof evt.occurredAt !== 'string' || Number.isNaN(Date.parse(evt.occurredAt))) {
    errors.push('Event occurredAt must be a valid ISO-8601 date string');
  }

  if (typeof evt.recordedAt !== 'string' || Number.isNaN(Date.parse(evt.recordedAt))) {
    errors.push('Event recordedAt must be a valid ISO-8601 date string');
  }

  if (evt.processingStatus && !VALID_EVENT_PROCESSING_STATUSES.has(evt.processingStatus)) {
    errors.push(`Invalid event processing status: "${evt.processingStatus}"`);
  }

  if (!evt.payload || typeof evt.payload !== 'object' || Array.isArray(evt.payload)) {
    errors.push('Event payload must be a non-null object');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

// ==========================================
// Affected-Scope & Solver Repair Contracts
// ==========================================

export interface AffectedScopeResult {
  eventId: string;
  affectedRequestIds: string[];
  affectedResourceIds: string[];
  affectedProposedAssignmentIds: string[];
  committedAssignmentsRequiringReview: string[];
  reason: string;
  repairEligible: boolean;
}

export interface FrozenStopReference {
  assignmentId: string;
  resourceId: string;
  stopNumber: number;
  targetId: string;
  type: StopType;
  lat: number;
  lng: number;
}

export interface RepairInput {
  eventId: string;
  baselineAssignmentId: string | null;
  scenarioSnapshot: Scenario;
  frozenStops: ReadonlyArray<FrozenStopReference>;
  affectedRequestIds: string[];
  affectedResourceIds: string[];
  expectedVersion?: number;
}

export interface RepairResult {
  status: 'PROPOSED' | 'NO_FEASIBLE_REPAIR';
  proposalId?: string;
  proposedPlan?: SolverPlan;
  unservedRequestIds: string[];
  warnings: string[];
  baselineVersion?: number;
  churn?: unknown;
}

// ==========================================
// Flood Forecast Context Types (Phase 6)
// ==========================================

export type ForecastRiskLevel =
  'NORMAL' | 'ELEVATED' | 'HIGH' | 'EXTREME' | 'UNKNOWN' | 'UNAVAILABLE';
export type ForecastFreshness = 'FRESH' | 'CACHED' | 'STALE' | 'OFFLINE_FIXTURE' | 'UNAVAILABLE';

export interface DailyDischargeForecast {
  date: string;
  dischargeM3S: number;
  dischargeMeanM3S: number;
  dischargeMaxM3S: number;
  dischargeMinM3S: number;
}

export interface FloodForecastContext {
  provider: string;
  source: string;
  attribution: string;
  license: string;
  region: {
    name: string;
    targetLat: number;
    targetLng: number;
    stationLat: number;
    stationLng: number;
    elevationMeters?: number;
  };
  issuedAt: string;
  retrievedAt: string;
  validFrom: string;
  validTo: string;
  forecastHorizonDays: number;
  variable: {
    name: string;
    unit: string;
    description: string;
  };
  daily: DailyDischargeForecast[];
  currentDischargeM3S: number;
  peakForecastM3S: number;
  riskCategory: ForecastRiskLevel;
  isExperimentalIndicator: boolean;
  confidenceScore?: number;
  freshness: ForecastFreshness;
  disclaimer: string;
}
