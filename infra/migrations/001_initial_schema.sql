-- Up migration: 001_initial_schema.sql
-- Enables PostGIS and creates core tables for the Flood Rescue Resource Allocation Platform.

CREATE EXTENSION IF NOT EXISTS postgis;

-- 1. Requests Table
CREATE TABLE IF NOT EXISTS requests (
  id VARCHAR(64) PRIMARY KEY,
  location GEOGRAPHY(Point, 4326) NOT NULL,
  people_count INTEGER NOT NULL CHECK (people_count > 0),
  urgency VARCHAR(16) NOT NULL CHECK (urgency IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  source VARCHAR(24) NOT NULL DEFAULT 'REPORTED' CHECK (source IN ('SIMULATED', 'REPORTED')),
  status VARCHAR(24) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'ASSIGNED', 'IN_TRANSIT', 'RESCUED', 'CANCELLED')),
  verification_status VARCHAR(24) NOT NULL DEFAULT 'UNVERIFIED' CHECK (verification_status IN ('UNVERIFIED', 'VERIFIED', 'REJECTED')),
  medical_needs BOOLEAN NOT NULL DEFAULT FALSE,
  notes TEXT,
  idempotency_key VARCHAR(128) UNIQUE,
  duplicate_of_id VARCHAR(64) REFERENCES requests(id) ON DELETE SET NULL,
  is_flagged_duplicate BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_requests_location ON requests USING GIST (location);
CREATE INDEX IF NOT EXISTS idx_requests_status ON requests (status);
CREATE INDEX IF NOT EXISTS idx_requests_urgency ON requests (urgency);
CREATE INDEX IF NOT EXISTS idx_requests_source ON requests (source);
CREATE INDEX IF NOT EXISTS idx_requests_created_at ON requests (created_at);
CREATE INDEX IF NOT EXISTS idx_requests_duplicate_of ON requests (duplicate_of_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_requests_idempotency_key ON requests (idempotency_key) WHERE idempotency_key IS NOT NULL;

-- 2. Resources Table
CREATE TABLE IF NOT EXISTS resources (
  id VARCHAR(64) PRIMARY KEY,
  name VARCHAR(128) NOT NULL,
  type VARCHAR(32) NOT NULL CHECK (type IN ('BOAT', 'HIGH_WATER_VEHICLE', 'AMBULANCE', 'HELICOPTER')),
  capacity INTEGER NOT NULL CHECK (capacity > 0),
  speed_km_h DOUBLE PRECISION NOT NULL CHECK (speed_km_h > 0),
  location GEOGRAPHY(Point, 4326) NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'AVAILABLE' CHECK (status IN ('AVAILABLE', 'ASSIGNED', 'EN_ROUTE', 'MAINTENANCE', 'OFFLINE')),
  depot_id VARCHAR(64),
  shift_max_duration_min INTEGER DEFAULT 480,
  source VARCHAR(24) NOT NULL DEFAULT 'REAL' CHECK (source IN ('SIMULATED', 'REAL')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_resources_location ON resources USING GIST (location);
CREATE INDEX IF NOT EXISTS idx_resources_status ON resources (status);
CREATE INDEX IF NOT EXISTS idx_resources_type ON resources (type);

-- 3. Shelters Table
CREATE TABLE IF NOT EXISTS shelters (
  id VARCHAR(64) PRIMARY KEY,
  name VARCHAR(128) NOT NULL,
  location GEOGRAPHY(Point, 4326) NOT NULL,
  capacity INTEGER NOT NULL CHECK (capacity > 0),
  current_occupancy INTEGER NOT NULL DEFAULT 0 CHECK (current_occupancy >= 0),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  source VARCHAR(24) NOT NULL DEFAULT 'REAL' CHECK (source IN ('SIMULATED', 'REAL')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_shelters_location ON shelters USING GIST (location);
CREATE INDEX IF NOT EXISTS idx_shelters_is_active ON shelters (is_active);

-- 4. Assignments Table (Proposed and Committed Plans)
CREATE TABLE IF NOT EXISTS assignments (
  id VARCHAR(64) PRIMARY KEY,
  scenario_id VARCHAR(64),
  status VARCHAR(24) NOT NULL DEFAULT 'PROPOSED' CHECK (status IN ('PROPOSED', 'COMMITTED', 'DISPATCHED', 'COMPLETED', 'CANCELLED')),
  metrics JSONB,
  unserved JSONB,
  committed_at TIMESTAMPTZ,
  committed_by VARCHAR(64),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_assignments_status ON assignments (status);
CREATE INDEX IF NOT EXISTS idx_assignments_created_at ON assignments (created_at);

-- 5. Assignment Stops Table (Route details with freezing)
CREATE TABLE IF NOT EXISTS assignment_stops (
  id VARCHAR(64) PRIMARY KEY,
  assignment_id VARCHAR(64) NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
  resource_id VARCHAR(64) NOT NULL REFERENCES resources(id) ON DELETE RESTRICT,
  stop_number INTEGER NOT NULL CHECK (stop_number >= 0),
  type VARCHAR(24) NOT NULL CHECK (type IN ('PICKUP', 'DROPOFF', 'DEPOT')),
  target_id VARCHAR(64) NOT NULL,
  location GEOGRAPHY(Point, 4326) NOT NULL,
  passengers_picked_up INTEGER NOT NULL DEFAULT 0 CHECK (passengers_picked_up >= 0),
  passengers_dropped_off INTEGER NOT NULL DEFAULT 0 CHECK (passengers_dropped_off >= 0),
  estimated_arrival_minutes DOUBLE PRECISION NOT NULL DEFAULT 0.0 CHECK (estimated_arrival_minutes >= 0),
  is_frozen BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (assignment_id, resource_id, stop_number)
);

CREATE INDEX IF NOT EXISTS idx_assignment_stops_location ON assignment_stops USING GIST (location);
CREATE INDEX IF NOT EXISTS idx_assignment_stops_assignment_id ON assignment_stops (assignment_id);
CREATE INDEX IF NOT EXISTS idx_assignment_stops_resource_id ON assignment_stops (resource_id);
CREATE INDEX IF NOT EXISTS idx_assignment_stops_target_id ON assignment_stops (target_id);

-- 6. Audit Events Table
CREATE TABLE IF NOT EXISTS audit_events (
  id BIGSERIAL PRIMARY KEY,
  entity_type VARCHAR(32) NOT NULL,
  entity_id VARCHAR(64) NOT NULL,
  event_type VARCHAR(64) NOT NULL,
  actor VARCHAR(64) NOT NULL DEFAULT 'SYSTEM',
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_events_entity ON audit_events (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_events_event_type ON audit_events (event_type);
CREATE INDEX IF NOT EXISTS idx_audit_events_created_at ON audit_events (created_at);

-- 7. Schema Migrations Table
CREATE TABLE IF NOT EXISTS schema_migrations (
  version VARCHAR(64) PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
