import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import type { RescueRequest, RescueResource, Shelter, RouteStop } from '@floodrelay/shared';
import {
  toPointWkt,
  parsePointWkt,
  rescueRequestToDb,
  dbToRescueRequest,
  rescueResourceToDb,
  dbToRescueResource,
  shelterToDb,
  dbToShelter,
  routeStopToDb,
  dbToRouteStop,
  type DbRequest,
  type DbResource,
  type DbShelter,
  type DbAssignmentStop,
} from './schema.js';
import { getMigrationsDir } from './migrator.js';

describe('Database Schema & Migration Integrity', () => {
  const migrationsDir = getMigrationsDir();
  const upFile = path.join(migrationsDir, '001_initial_schema.sql');
  const downFile = path.join(migrationsDir, '001_initial_schema.down.sql');

  it('provides up and down migration files', () => {
    expect(fs.existsSync(upFile)).toBe(true);
    expect(fs.existsSync(downFile)).toBe(true);

    const upSql = fs.readFileSync(upFile, 'utf-8');
    const downSql = fs.readFileSync(downFile, 'utf-8');

    expect(upSql.length).toBeGreaterThan(100);
    expect(downSql.length).toBeGreaterThan(50);

    const upFile002 = path.join(migrationsDir, '002_idempotency_request_hash.sql');
    const downFile002 = path.join(migrationsDir, '002_idempotency_request_hash.down.sql');
    expect(fs.existsSync(upFile002)).toBe(true);
    expect(fs.existsSync(downFile002)).toBe(true);
    expect(fs.readFileSync(upFile002, 'utf-8')).toMatch(/ALTER TABLE requests[\s\S]*ADD COLUMN[\s\S]*idempotency_request_hash/i);
    expect(fs.readFileSync(downFile002, 'utf-8')).toMatch(/ALTER TABLE requests[\s\S]*DROP COLUMN[\s\S]*idempotency_request_hash/i);
  });

  it('includes PostGIS extension and all required core tables in initial schema', () => {
    const upSql = fs.readFileSync(upFile, 'utf-8');

    // PostGIS extension
    expect(upSql).toMatch(/CREATE EXTENSION IF NOT EXISTS postgis;/i);

    // Core tables
    expect(upSql).toMatch(/CREATE TABLE IF NOT EXISTS requests\b/i);
    expect(upSql).toMatch(/CREATE TABLE IF NOT EXISTS resources\b/i);
    expect(upSql).toMatch(/CREATE TABLE IF NOT EXISTS shelters\b/i);
    expect(upSql).toMatch(/CREATE TABLE IF NOT EXISTS assignments\b/i);
    expect(upSql).toMatch(/CREATE TABLE IF NOT EXISTS assignment_stops\b/i);
    expect(upSql).toMatch(/CREATE TABLE IF NOT EXISTS audit_events\b/i);
  });

  it('defines spatial GiST indexes for all location geography columns', () => {
    const upSql = fs.readFileSync(upFile, 'utf-8');

    expect(upSql).toMatch(
      /CREATE INDEX IF NOT EXISTS idx_requests_location ON requests USING GIST \(location\);/i,
    );
    expect(upSql).toMatch(
      /CREATE INDEX IF NOT EXISTS idx_resources_location ON resources USING GIST \(location\);/i,
    );
    expect(upSql).toMatch(
      /CREATE INDEX IF NOT EXISTS idx_shelters_location ON shelters USING GIST \(location\);/i,
    );
    expect(upSql).toMatch(
      /CREATE INDEX IF NOT EXISTS idx_assignment_stops_location ON assignment_stops USING GIST \(location\);/i,
    );
  });

  it('defines idempotency and deduplication columns and constraints', () => {
    const upSql = fs.readFileSync(upFile, 'utf-8');

    expect(upSql).toMatch(/idempotency_key VARCHAR\(128\) UNIQUE/i);
    expect(upSql).toMatch(/duplicate_of_id VARCHAR\(64\) REFERENCES requests\(id\)/i);
    expect(upSql).toMatch(/is_flagged_duplicate BOOLEAN NOT NULL DEFAULT FALSE/i);
    expect(upSql).toMatch(/verification_status VARCHAR\(24\) NOT NULL DEFAULT 'UNVERIFIED'/i);
  });

  it('defines frozen stop capability on assignment stops', () => {
    const upSql = fs.readFileSync(upFile, 'utf-8');
    expect(upSql).toMatch(/is_frozen BOOLEAN NOT NULL DEFAULT FALSE/i);
  });

  it('includes complete rollback instructions in down migration', () => {
    const downSql = fs.readFileSync(downFile, 'utf-8');

    expect(downSql).toMatch(/DROP TABLE IF EXISTS audit_events;/i);
    expect(downSql).toMatch(/DROP TABLE IF EXISTS assignment_stops;/i);
    expect(downSql).toMatch(/DROP TABLE IF EXISTS assignments;/i);
    expect(downSql).toMatch(/DROP TABLE IF EXISTS shelters;/i);
    expect(downSql).toMatch(/DROP TABLE IF EXISTS resources;/i);
    expect(downSql).toMatch(/DROP TABLE IF EXISTS requests;/i);
  });
});

describe('PostGIS WKT Coordinate Serialization', () => {
  it('converts GeoPoint to WKT POINT format with longitude first', () => {
    const point = { lat: 28.6139, lng: 77.209 };
    const wkt = toPointWkt(point);
    expect(wkt).toBe('POINT(77.209 28.6139)');
  });

  it('parses WKT POINT format back to GeoPoint', () => {
    const parsed = parsePointWkt('POINT(77.209 28.6139)');
    expect(parsed.lat).toBeCloseTo(28.6139);
    expect(parsed.lng).toBeCloseTo(77.209);
  });

  it('throws an error when parsing malformed WKT string', () => {
    expect(() => parsePointWkt('POLYGON((0 0, 1 1, 0 1))')).toThrowError(
      /Invalid WKT Point format/,
    );
    expect(() => parsePointWkt('INVALID_POINT')).toThrowError(/Invalid WKT Point format/);
  });
});

describe('Model Mappings Aligned with @floodrelay/shared', () => {
  it('maps RescueRequest to DbRequest and back without data loss', () => {
    const request: RescueRequest = {
      id: 'req_101',
      lat: 28.65,
      lng: 77.23,
      peopleCount: 4,
      urgency: 'HIGH',
      createdAt: '2026-10-27T12:00:00.000Z',
      source: 'REPORTED',
      status: 'PENDING',
      medicalNeeds: true,
      notes: 'Water rising rapidly',
    };

    const dbObj = rescueRequestToDb(request, {
      verificationStatus: 'VERIFIED',
      idempotencyKey: 'idem_key_abc',
      duplicateOfId: null,
      isFlaggedDuplicate: false,
    });

    expect(dbObj.id).toBe('req_101');
    expect(dbObj.location).toBe('POINT(77.23 28.65)');
    expect(dbObj.people_count).toBe(4);
    expect(dbObj.urgency).toBe('HIGH');
    expect(dbObj.medical_needs).toBe(true);
    expect(dbObj.verification_status).toBe('VERIFIED');
    expect(dbObj.idempotency_key).toBe('idem_key_abc');

    const fakeRow: DbRequest = {
      ...dbObj,
      created_at: new Date(request.createdAt),
      updated_at: new Date(request.createdAt),
    };

    const restored = dbToRescueRequest(fakeRow);
    expect(restored.id).toBe(request.id);
    expect(restored.lat).toBeCloseTo(request.lat);
    expect(restored.lng).toBeCloseTo(request.lng);
    expect(restored.peopleCount).toBe(request.peopleCount);
    expect(restored.urgency).toBe(request.urgency);
    expect(restored.source).toBe(request.source);
    expect(restored.medicalNeeds).toBe(request.medicalNeeds);
    expect(restored.notes).toBe(request.notes);
  });

  it('maps RescueResource to DbResource and back', () => {
    const resource: RescueResource = {
      id: 'res_boat_1',
      name: 'Yamuna Rescue Boat 1',
      type: 'BOAT',
      capacity: 10,
      speedKmH: 25,
      lat: 28.66,
      lng: 77.24,
      status: 'AVAILABLE',
      depotId: 'depot_north',
    };

    const dbObj = rescueResourceToDb(resource, 'REAL', 360);
    expect(dbObj.id).toBe('res_boat_1');
    expect(dbObj.location).toBe('POINT(77.24 28.66)');
    expect(dbObj.capacity).toBe(10);
    expect(dbObj.speed_km_h).toBe(25);
    expect(dbObj.shift_max_duration_min).toBe(360);

    const fakeRow: DbResource = {
      ...dbObj,
      created_at: new Date(),
      updated_at: new Date(),
    };

    const restored = dbToRescueResource(fakeRow);
    expect(restored.id).toBe(resource.id);
    expect(restored.name).toBe(resource.name);
    expect(restored.type).toBe(resource.type);
    expect(restored.capacity).toBe(resource.capacity);
    expect(restored.speedKmH).toBe(resource.speedKmH);
    expect(restored.lat).toBeCloseTo(resource.lat);
    expect(restored.lng).toBeCloseTo(resource.lng);
    expect(restored.depotId).toBe(resource.depotId);
  });

  it('maps Shelter to DbShelter and back', () => {
    const shelter: Shelter = {
      id: 'shelter_bridge',
      name: 'Bridge Relief Center',
      lat: 28.68,
      lng: 77.25,
      capacity: 150,
      currentOccupancy: 30,
    };

    const dbObj = shelterToDb(shelter, 'REAL');
    expect(dbObj.id).toBe('shelter_bridge');
    expect(dbObj.location).toBe('POINT(77.25 28.68)');
    expect(dbObj.capacity).toBe(150);
    expect(dbObj.current_occupancy).toBe(30);

    const fakeRow: DbShelter = {
      ...dbObj,
      created_at: new Date(),
      updated_at: new Date(),
    };

    const restored = dbToShelter(fakeRow);
    expect(restored.id).toBe(shelter.id);
    expect(restored.name).toBe(shelter.name);
    expect(restored.capacity).toBe(shelter.capacity);
    expect(restored.currentOccupancy).toBe(shelter.currentOccupancy);
    expect(restored.lat).toBeCloseTo(shelter.lat);
    expect(restored.lng).toBeCloseTo(shelter.lng);
  });

  it('maps RouteStop to DbAssignmentStop with frozen stop preservation', () => {
    const stop: RouteStop = {
      stopNumber: 2,
      type: 'PICKUP',
      targetId: 'req_101',
      lat: 28.65,
      lng: 77.23,
      passengersPickedUp: 4,
      passengersDroppedOff: 0,
      estimatedArrivalMinutes: 18.5,
      isFrozen: true,
    };

    const dbObj = routeStopToDb(stop, 'assignment_run_1', 'res_boat_1');
    expect(dbObj.id).toBe('assignment_run_1_res_boat_1_2');
    expect(dbObj.assignment_id).toBe('assignment_run_1');
    expect(dbObj.resource_id).toBe('res_boat_1');
    expect(dbObj.stop_number).toBe(2);
    expect(dbObj.type).toBe('PICKUP');
    expect(dbObj.is_frozen).toBe(true);

    const fakeRow: DbAssignmentStop = {
      ...dbObj,
      created_at: new Date(),
    };

    const restored = dbToRouteStop(fakeRow);
    expect(restored.stopNumber).toBe(stop.stopNumber);
    expect(restored.type).toBe(stop.type);
    expect(restored.targetId).toBe(stop.targetId);
    expect(restored.passengersPickedUp).toBe(stop.passengersPickedUp);
    expect(restored.passengersDroppedOff).toBe(stop.passengersDroppedOff);
    expect(restored.estimatedArrivalMinutes).toBeCloseTo(stop.estimatedArrivalMinutes);
    expect(restored.isFrozen).toBe(true);
  });
});
