-- Migration 018: mark incidents whose root cause was deduced, not reported.
--
-- The topology cascade previously required the root device to emit an event of
-- its own. The common real failure — a switch dies and takes its APs with it —
-- produces no switch event at all, either because the switch is down or because
-- it is LLDP-discovered with no telemetry source (measured: 962 of 1,109
-- switch->AP links have such a parent). Those cascades therefore never fired and
-- the failure surfaced as N unrelated AP incidents.
--
-- The cascade can now root an incident at the common topology parent of several
-- symptoms. That is a deduction rather than an observation, so it must be
-- visible as one: an operator has to be able to tell "the switch told us it
-- failed" from "we concluded the switch failed".

ALTER TABLE incidents
    ADD COLUMN IF NOT EXISTS inferred_root BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN incidents.inferred_root IS
    'True when root_device_ids was derived from shared topology parentage rather than from an event on that device.';

-- Partial index: inferred incidents are the ones an operator may want to filter
-- or review separately, and they are the minority.
CREATE INDEX IF NOT EXISTS idx_incidents_inferred_root
    ON incidents (inferred_root) WHERE inferred_root;
