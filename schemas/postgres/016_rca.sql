-- Migration 016: Falsifiable AI Root Cause Analysis (RCA) Ledger (WP-7)
-- Stores generated AI RCA reports, confidence scores, evidence packs, and citations.

CREATE TABLE IF NOT EXISTS incident_rca (
    incident_id TEXT PRIMARY KEY,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    confidence_score DOUBLE PRECISION NOT NULL DEFAULT 0.85,
    summary TEXT NOT NULL,
    root_cause_hypothesis TEXT NOT NULL,
    mitigation_steps JSONB DEFAULT '[]'::jsonb,
    citations_json JSONB DEFAULT '[]'::jsonb,
    evidence_pack_json JSONB DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_incident_rca_created_at ON incident_rca(created_at DESC);
