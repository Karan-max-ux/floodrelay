-- Migration 002 down: Drop idempotency request body hash
ALTER TABLE requests
DROP COLUMN IF EXISTS idempotency_request_hash;
