-- Migration 007: Add root/symptom device split and confidence breakdown
-- to the incidents table.
--
-- These columns capture the correlation engine's cascade reasoning
-- at incident-creation time so the data is frozen (not recomputed
-- from potentially-changed topology on every API read).

ALTER TABLE incidents
    ADD COLUMN IF NOT EXISTS root_device_ids      TEXT[]  NOT NULL DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS symptom_device_ids   TEXT[]  NOT NULL DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS confidence_breakdown JSONB   DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_incidents_root_device_ids    ON incidents USING GIN (root_device_ids);
CREATE INDEX IF NOT EXISTS idx_incidents_symptom_device_ids ON incidents USING GIN (symptom_device_ids);
