-- Migration 019: make the identity duplication unrepeatable.
--
-- Before this, `devices` had no uniqueness beyond its primary key, and the
-- resolver looked identities up by exact (vendor, vendor_device_id) only. Mist
-- references one AP by at least three ids depending on endpoint — the
-- '00000000-0000-0000-1000-<mac>' inventory form, a bare MAC from LLDP, and a
-- site-device UUID in events — so each form minted its own canonical device.
-- Measured before the fix: 4,021 device rows for 1,966 distinct MACs, and 0% of
-- current event device references resolving to any of them.
--
-- Apply AFTER the merge step. The index build fails loudly if duplicates remain,
-- which is the intended signal that the merge has not been run.

-- A MAC identifies exactly one physical device. Partial, because VeloCloud edges
-- legitimately carry no MAC.
CREATE UNIQUE INDEX IF NOT EXISTS uq_devices_mac
    ON devices (mac) WHERE mac <> '';

COMMENT ON INDEX uq_devices_mac IS
    'One canonical device per MAC. Additional vendor id forms belong in device_identities, not in a second devices row.';
