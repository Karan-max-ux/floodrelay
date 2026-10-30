-- Migration 002 down: Drop idempotency request body hash
ALTER TABLE requests
DROP COLUMN IF EXISTS idempotency_request_hash;

ALTER TABLE resources ALTER COLUMN source SET DEFAULT 'REAL';
ALTER TABLE shelters ALTER COLUMN source SET DEFAULT 'REAL';
