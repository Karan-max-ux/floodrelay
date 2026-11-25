-- Up migration: 006_resource_fleet_management.sql
-- Adds vehicle model catalog reference, operational notes, version counter for optimistic locking,
-- verification status, and audit provenance metadata to the resources table.

ALTER TABLE resources
  ADD COLUMN IF NOT EXISTS model_id VARCHAR(64),
  ADD COLUMN IF NOT EXISTS notes TEXT,
  ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS verification_status VARCHAR(24) NOT NULL DEFAULT 'VERIFIED',
  ADD COLUMN IF NOT EXISTS verified_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS verified_by VARCHAR(64),
  ADD COLUMN IF NOT EXISTS created_by VARCHAR(64),
  ADD COLUMN IF NOT EXISTS updated_by VARCHAR(64);

CREATE INDEX IF NOT EXISTS idx_resources_model_id ON resources (model_id);
CREATE INDEX IF NOT EXISTS idx_resources_source ON resources (source);
CREATE INDEX IF NOT EXISTS idx_resources_verification_status ON resources (verification_status);
