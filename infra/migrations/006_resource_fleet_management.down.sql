-- Down migration: 006_resource_fleet_management.down.sql

DROP INDEX IF EXISTS idx_resources_source;
DROP INDEX IF EXISTS idx_resources_model_id;

ALTER TABLE resources
  DROP COLUMN IF EXISTS updated_by,
  DROP COLUMN IF EXISTS created_by,
  DROP COLUMN IF EXISTS version,
  DROP COLUMN IF EXISTS notes,
  DROP COLUMN IF EXISTS model_id;
