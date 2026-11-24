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
  BlockedZone,
  HazardLevel,
  OperationalEvent,
  OperationalEventType,
  EventEntityType,
  EventActorType,
  EventProcessingStatus,
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
  idempotency_request_hash: string | null;
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
  model_id?: string | null;
  notes?: string | null;
  version?: number;
  created_by?: string | null;
  updated_by?: string | null;
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

export interface DbOperationalEvent {
  id: string;
  event_type: OperationalEventType;
  entity_type: EventEntityType;
  entity_id: string;
  actor_id: string | null;
  actor_type: EventActorType;
  payload: Record<string, unknown>;
  correlation_id: string | null;
  idempotency_key: string | null;
  entity_version: number;
  processing_status: EventProcessingStatus;
  processing_attempts: number;
  last_error_code: string | null;
  occurred_at: Date;
  created_at: Date;
  processed_at: Date | null;
}

export interface DbBlockedZone {
  id: string;
  name: string | null;
  severity: HazardLevel;
  geometry: string; // WKT: 'POLYGON((lng lat, ...))'
  is_active: boolean;
  created_by: string;
  created_at: Date;
  updated_at: Date;
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

export function toPolygonWkt(polygon: GeoPoint[]): string {
  if (!polygon || polygon.length < 3) {
    throw new Error('A polygon requires at least 3 distinct vertices');
  }
  const points = [...polygon];
  const first = points[0];
  const last = points[points.length - 1];
  if (!first || !last) {
    throw new Error('Invalid polygon vertices');
  }
  if (first.lat !== last.lat || first.lng !== last.lng) {
    points.push({ lat: first.lat, lng: first.lng });
  }
  const coords = points.map((p) => `${p.lng} ${p.lat}`).join(', ');
  return `POLYGON((${coords}))`;
}

export function parsePolygonWkt(wkt: string): GeoPoint[] {
  const match = /POLYGON\s*\(\s*\(\s*(.+?)\s*\)\s*\)/i.exec(wkt);
  if (!match || !match[1]) {
    throw new Error(`Invalid WKT Polygon format: "${wkt}"`);
  }
  const pairs = match[1].split(',').map((s) => s.trim());
  const points: GeoPoint[] = pairs.map((pair) => {
    const parts = pair.split(/\s+/);
    const p0 = parts[0];
    const p1 = parts[1];
    if (!p0 || !p1) {
      throw new Error(`Invalid coordinate pair in WKT: "${pair}"`);
    }
    const lng = parseFloat(p0);
    const lat = parseFloat(p1);
    return { lat, lng };
  });
  return points;
}

export function dbToOperationalEvent(row: DbOperationalEvent): OperationalEvent {
  return {
    id: row.id,
    type: row.event_type,
    entityType: row.entity_type,
    entityId: row.entity_id,
    actorId: row.actor_id,
    actorType: row.actor_type,
    occurredAt:
      row.occurred_at instanceof Date ? row.occurred_at.toISOString() : String(row.occurred_at),
    recordedAt:
      row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    correlationId: row.correlation_id,
    idempotencyKey: row.idempotency_key,
    entityVersion: row.entity_version,
    processingStatus: row.processing_status,
    processingAttempts: row.processing_attempts,
    lastErrorCode: row.last_error_code,
    processedAt:
      row.processed_at instanceof Date
        ? row.processed_at.toISOString()
        : row.processed_at
          ? String(row.processed_at)
          : null,
    payload: row.payload ?? {},
  };
}

export function dbToBlockedZone(
  row: DbBlockedZone,
): BlockedZone & { isActive: boolean; createdBy: string } {
  return {
    id: row.id,
    name: row.name ?? undefined,
    severity: row.severity,
    polygon: parsePolygonWkt(row.geometry),
    isActive: row.is_active,
    createdBy: row.created_by,
  };
}

// Type mappers between packages/shared and database rows
export function rescueRequestToDb(
  req: RescueRequest,
  options?: {
    verificationStatus?: VerificationStatus;
    idempotencyKey?: string | null;
    idempotencyRequestHash?: string | null;
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
    idempotency_request_hash: options?.idempotencyRequestHash ?? null,
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
    verificationStatus: row.verification_status,
    medicalNeeds: row.medical_needs,
    notes: row.notes ?? undefined,
    idempotencyKey: row.idempotency_key ?? null,
    isFlaggedDuplicate: row.is_flagged_duplicate ?? false,
    duplicateOfId: row.duplicate_of_id ?? null,
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
    source: (row.source as 'SIMULATED' | 'REAL') ?? undefined,
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
    source: (row.source as 'SIMULATED' | 'REAL') ?? undefined,
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

// ==========================================
// Operator Identity & Authentication Types
// ==========================================

export type OperatorRole = 'OPERATOR' | 'ADMIN' | 'DISPATCHER';

export interface DbOperator {
  id: string;
  username: string;
  password_hash: string;
  salt: string;
  name: string;
  role: OperatorRole;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface OperatorProfile {
  id: string;
  username: string;
  name: string;
  role: OperatorRole;
}

export interface DbOperatorSession {
  token: string;
  operator_id: string;
  expires_at: Date;
  created_at: Date;
}
