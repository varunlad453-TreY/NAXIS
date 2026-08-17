-- Migration 010: Incident Evidence Persistence (WP-2.6)
-- Stores compact forensic telemetry snapshots of contributing events directly inside the incident record.
-- Persists permanently so operator timelines remain intact after raw events are pruned by the 48h retention policy (WP-2.4).

ALTER TABLE incidents ADD COLUMN IF NOT EXISTS evidence JSONB NOT NULL DEFAULT '[]'::jsonb;
CREATE INDEX IF NOT EXISTS idx_incidents_evidence ON incidents USING GIN (evidence);
