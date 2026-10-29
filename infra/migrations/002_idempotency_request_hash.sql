-- Migration 002: Add idempotency request body hash for strict duplicate payload detection
ALTER TABLE requests
ADD COLUMN IF NOT EXISTS idempotency_request_hash VARCHAR(64);
