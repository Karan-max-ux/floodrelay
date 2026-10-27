import type {
  GeoPoint,
  RescueRequest,
  RescueResource,
  Shelter,
  RouteStop,
  UrgencyLevel,
  RequestSource,
  RequestStatus,
  ResourceType,
  ResourceStatus,
  StopType,
  SolverMetrics,
  UnservedRequest,
} from '@floodrelay/shared';

// Verification status for citizen requests
export type VerificationStatus = 'UNVERIFIED' | 'VERIFIED' | 'REJECTED';

// Database row representations
export interface DbRequest {
  id: string;
  location: string; // ST_AsText / WKT: 'POINT(lng lat)'
  people_count: number;
  urgency: UrgencyLevel;
  source: RequestSource;
  status: RequestStatus;
  verification_status: VerificationStatus;
  medical_needs: boolean;
  notes: string | null;
  idempotency_key: string | null;
  duplicate_of_id: string | null;
  is_flagged_duplicate: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface DbResource {
  id: string;
  name: string;
  type: ResourceType;
  capacity: number;
  speed_km_h: number;
  location: string; // WKT: 'POINT(lng lat)'
  status: ResourceStatus;
  depot_id: string | null;
  shift_max_duration_min: number | null;
  source: 'SIMULATED' | 'REAL';
  created_at: Date;
  updated_at: Date;
}

export interface DbShelter {
  id: string;
  name: string;
  location: string; // WKT: 'POINT(lng lat)'
  capacity: number;
  current_occupancy: number;
  is_active: boolean;
  source: 'SIMULATED' | 'REAL';
  created_at: Date;
  updated_at: Date;
}

export type AssignmentStatus = 'PROPOSED' | 'COMMITTED' | 'DISPATCHED' | 'COMPLETED' | 'CANCELLED';

export interface DbAssignment {
  id: string;
  scenario_id: string | null;
  status: AssignmentStatus;
  metrics: SolverMetrics | null;
  unserved: UnservedRequest[] | null;
  committed_at: Date | null;
  committed_by: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface DbAssignmentStop {
  id: string;
  assignment_id: string;
  resource_id: string;
  stop_number: number;
  type: StopType;
  target_id: string;
  location: string; // WKT: 'POINT(lng lat)'
  passengers_picked_up: number;
  passengers_dropped_off: number;
  estimated_arrival_minutes: number;
  is_frozen: boolean;
  created_at: Date;
}

export interface DbAuditEvent {
  id: string; // BIGINT as string
  entity_type: string;
  entity_id: string;
  event_type: string;
  actor: string;
  payload: Record<string, unknown>;
  created_at: Date;
}

// Spatial helper functions
export function toPointWkt(geo: GeoPoint): string {
  return `POINT(${geo.lng} ${geo.lat})`;
}

export function parsePointWkt(wkt: string): GeoPoint {
  const match = /POINT\s*\(\s*([-\d.]+)\s+([-\d.]+)\s*\)/i.exec(wkt);
  if (!match || !match[1] || !match[2]) {
    throw new Error(`Invalid WKT Point format: "${wkt}"`);
  }
  const lng = parseFloat(match[1]);
  const lat = parseFloat(match[2]);
  return { lat, lng };
}

// Type mappers between packages/shared and database rows
export function rescueRequestToDb(
  req: RescueRequest,
  options?: {
    verificationStatus?: VerificationStatus;
    idempotencyKey?: string | null;
    duplicateOfId?: string | null;
    isFlaggedDuplicate?: boolean;
  },
): Omit<DbRequest, 'created_at' | 'updated_at'> {
  return {
    id: req.id,
    location: toPointWkt({ lat: req.lat, lng: req.lng }),
    people_count: req.peopleCount,
    urgency: req.urgency,
    source: req.source,
    status: req.status ?? 'PENDING',
    verification_status: options?.verificationStatus ?? 'UNVERIFIED',
    medical_needs: req.medicalNeeds ?? false,
    notes: req.notes ?? null,
    idempotency_key: options?.idempotencyKey ?? null,
    duplicate_of_id: options?.duplicateOfId ?? null,
    is_flagged_duplicate: options?.isFlaggedDuplicate ?? false,
  };
}

export function dbToRescueRequest(row: DbRequest): RescueRequest {
  const geo = parsePointWkt(row.location);
  return {
    id: row.id,
    lat: geo.lat,
    lng: geo.lng,
    peopleCount: row.people_count,
    urgency: row.urgency,
    createdAt:
      row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    source: row.source,
    status: row.status,
    medicalNeeds: row.medical_needs,
    notes: row.notes ?? undefined,
  };
}

export function rescueResourceToDb(
  res: RescueResource,
  source: 'SIMULATED' | 'REAL' = 'REAL',
  shiftMaxDurationMin = 480,
): Omit<DbResource, 'created_at' | 'updated_at'> {
  return {
    id: res.id,
    name: res.name,
    type: res.type,
    capacity: res.capacity,
    speed_km_h: res.speedKmH,
    location: toPointWkt({ lat: res.lat, lng: res.lng }),
    status: res.status,
    depot_id: res.depotId ?? null,
    shift_max_duration_min: shiftMaxDurationMin,
    source,
  };
}

export function dbToRescueResource(row: DbResource): RescueResource {
  const geo = parsePointWkt(row.location);
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    capacity: row.capacity,
    speedKmH: row.speed_km_h,
    lat: geo.lat,
    lng: geo.lng,
    status: row.status,
    depotId: row.depot_id ?? undefined,
  };
}

export function shelterToDb(
  sh: Shelter,
  source: 'SIMULATED' | 'REAL' = 'REAL',
): Omit<DbShelter, 'created_at' | 'updated_at'> {
  return {
    id: sh.id,
    name: sh.name,
    location: toPointWkt({ lat: sh.lat, lng: sh.lng }),
    capacity: sh.capacity,
    current_occupancy: sh.currentOccupancy ?? 0,
    is_active: true,
    source,
  };
}

export function dbToShelter(row: DbShelter): Shelter {
  const geo = parsePointWkt(row.location);
  return {
    id: row.id,
    name: row.name,
    lat: geo.lat,
    lng: geo.lng,
    capacity: row.capacity,
    currentOccupancy: row.current_occupancy,
  };
}

export function routeStopToDb(
  stop: RouteStop,
  assignmentId: string,
  resourceId: string,
): Omit<DbAssignmentStop, 'created_at'> {
  return {
    id: `${assignmentId}_${resourceId}_${stop.stopNumber}`,
    assignment_id: assignmentId,
    resource_id: resourceId,
    stop_number: stop.stopNumber,
    type: stop.type,
    target_id: stop.targetId,
    location: toPointWkt({ lat: stop.lat, lng: stop.lng }),
    passengers_picked_up: stop.passengersPickedUp,
    passengers_dropped_off: stop.passengersDroppedOff,
    estimated_arrival_minutes: stop.estimatedArrivalMinutes,
    is_frozen: stop.isFrozen ?? false,
  };
}

export function dbToRouteStop(row: DbAssignmentStop): RouteStop {
  const geo = parsePointWkt(row.location);
  return {
    stopNumber: row.stop_number,
    type: row.type,
    targetId: row.target_id,
    lat: geo.lat,
    lng: geo.lng,
    passengersPickedUp: row.passengers_picked_up,
    passengersDroppedOff: row.passengers_dropped_off,
    estimatedArrivalMinutes: row.estimated_arrival_minutes,
    isFrozen: row.is_frozen,
  };
}
