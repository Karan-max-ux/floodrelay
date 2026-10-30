-- Down migration: 001_initial_schema.down.sql
-- Drops all tables created in 001_initial_schema.sql.

DROP TABLE IF EXISTS audit_events;
DROP TABLE IF EXISTS assignment_stops;
DROP TABLE IF EXISTS assignments;
DROP TABLE IF EXISTS shelters;
DROP TABLE IF EXISTS resources;
DROP TABLE IF EXISTS requests;
DELETE FROM schema_migrations WHERE version = '001_initial_schema';
