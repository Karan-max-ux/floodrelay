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

export interface ResourceRoute {
  resourceId: string;
  stops: RouteStop[];
  totalTravelDistanceKm: number;
  totalDurationMinutes: number;
  servedRequestIds: string[];
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
