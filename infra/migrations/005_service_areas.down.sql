-- Revert Migration 005: Drop service_areas table
DROP INDEX IF EXISTS idx_service_areas_active;
DROP INDEX IF EXISTS idx_service_areas_geometry;
DROP TABLE IF EXISTS service_areas;
