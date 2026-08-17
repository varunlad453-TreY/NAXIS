-- Migration 008: Canonical identity layer
--
-- Introduces cross-vendor canonical identity for devices and sites so that
-- a Mist AP (UUID + MAC), a VeloCloud edge (numeric id), a DNAC switch
-- (UUID), and an SNMP-discovered switch can all resolve to the same
-- physical device when the data supports it.
--
-- The design:
--   - `sites` owns the facility/site registry (one canonical key per site).
--   - `devices` owns the canonical device record (one canonical key per
--     physical device).
--   - `device_identities` maps vendor-native identifiers to canonical keys.
--   - `topology_nodes.canonical_key` links graph nodes to canonical devices
--     so the resolver can go from vendor id -> canonical key -> node_id
--     without prefix guessing.

-- ---------------------------------------------------------------------------
-- Sites
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sites (
    site_key      TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
    name          TEXT        NOT NULL DEFAULT '',
    parent_key    TEXT        REFERENCES sites(site_key) ON DELETE SET NULL,
    vendor_ids    JSONB       NOT NULL DEFAULT '{}',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sites_name        ON sites (name);
CREATE INDEX IF NOT EXISTS idx_sites_vendor_ids  ON sites USING GIN (vendor_ids);

COMMENT ON TABLE sites IS 'Canonical site/facility registry. vendor_ids is {vendor: vendor_site_id}.';

-- ---------------------------------------------------------------------------
-- Devices
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS devices (
    device_key    TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
    display_name  TEXT        NOT NULL DEFAULT '',
    device_type   TEXT        NOT NULL DEFAULT 'unknown',
    role          TEXT        NOT NULL DEFAULT '',
    model         TEXT        NOT NULL DEFAULT '',
    vendor        TEXT        NOT NULL DEFAULT '',
    site_key      TEXT        REFERENCES sites(site_key) ON DELETE SET NULL,
    serial        TEXT        NOT NULL DEFAULT '',
    mac           TEXT        NOT NULL DEFAULT '',
    ip_address    TEXT        NOT NULL DEFAULT '',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_devices_site_key  ON devices (site_key);
CREATE INDEX IF NOT EXISTS idx_devices_serial    ON devices (serial) WHERE serial <> '';
CREATE INDEX IF NOT EXISTS idx_devices_mac       ON devices (mac) WHERE mac <> '';

COMMENT ON TABLE devices IS 'Canonical device record. One row per physical device.';

-- ---------------------------------------------------------------------------
-- Vendor identities
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS device_identities (
    id                BIGSERIAL   PRIMARY KEY,
    device_key        TEXT        NOT NULL REFERENCES devices(device_key) ON DELETE CASCADE,
    vendor            TEXT        NOT NULL,
    vendor_device_id  TEXT        NOT NULL,
    vendor_display_name TEXT      NOT NULL DEFAULT '',
    metadata          JSONB       NOT NULL DEFAULT '{}',
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_device_identities_vendor_id UNIQUE (vendor, vendor_device_id)
);

CREATE INDEX IF NOT EXISTS idx_device_identities_device_key ON device_identities (device_key);
CREATE INDEX IF NOT EXISTS idx_device_identities_lookup     ON device_identities (vendor, vendor_device_id);

COMMENT ON TABLE device_identities IS 'Maps (vendor, vendor_device_id) to a canonical device_key.';

-- ---------------------------------------------------------------------------
-- Topology canonical-key bridge
-- ---------------------------------------------------------------------------
ALTER TABLE topology_nodes
    ADD COLUMN IF NOT EXISTS canonical_key TEXT REFERENCES devices(device_key) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_topology_nodes_canonical_key
    ON topology_nodes (canonical_key) WHERE canonical_key IS NOT NULL;

COMMENT ON COLUMN topology_nodes.canonical_key IS 'Canonical device key; enables vendor-id -> device_key -> node_id resolution.';

-- ---------------------------------------------------------------------------
-- Helper: normalize MAC addresses to lowercase, colon-free hex
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION normalize_mac(input TEXT)
RETURNS TEXT AS $$
DECLARE
    cleaned TEXT;
BEGIN
    IF input IS NULL OR input = '' THEN
        RETURN '';
    END IF;
    cleaned := lower(regexp_replace(input, '[^0-9a-fA-F]', '', 'g'));
    IF length(cleaned) = 12 THEN
        RETURN cleaned;
    END IF;
    RETURN cleaned;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- ---------------------------------------------------------------------------
-- Trigger: keep `updated_at` current
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION _identity_touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sites_updated_at ON sites;
CREATE TRIGGER trg_sites_updated_at
    BEFORE UPDATE ON sites
    FOR EACH ROW EXECUTE FUNCTION _identity_touch_updated_at();

DROP TRIGGER IF EXISTS trg_devices_updated_at ON devices;
CREATE TRIGGER trg_devices_updated_at
    BEFORE UPDATE ON devices
    FOR EACH ROW EXECUTE FUNCTION _identity_touch_updated_at();

DROP TRIGGER IF EXISTS trg_device_identities_updated_at ON device_identities;
CREATE TRIGGER trg_device_identities_updated_at
    BEFORE UPDATE ON device_identities
    FOR EACH ROW EXECUTE FUNCTION _identity_touch_updated_at();
