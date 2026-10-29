-- Migration 002: Add idempotency request body hash for strict duplicate payload detection
ALTER TABLE requests
ADD COLUMN IF NOT EXISTS idempotency_request_hash VARCHAR(64);

-- Remove default 'REAL' from resources.source and shelters.source so every insert must state SIMULATED or REAL
ALTER TABLE resources ALTER COLUMN source DROP DEFAULT;
ALTER TABLE shelters ALTER COLUMN source DROP DEFAULT;
