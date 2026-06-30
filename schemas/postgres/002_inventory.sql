-- Inventory table — dedicated AP/device inventory from Mist (and future vendors)
-- Upserted every collection cycle; source of truth for the Devices page.

CREATE TABLE IF NOT EXISTS inventory (
    device_id         TEXT        PRIMARY KEY,   -- Mist AP ID (UUID format)
    platform          TEXT        NOT NULL,       -- 'mist', 'dnac', etc.
    hostname          TEXT        NOT NULL DEFAULT '',
    mac               TEXT        NOT NULL DEFAULT '',
    serial            TEXT        NOT NULL DEFAULT '',
    model             TEXT        NOT NULL DEFAULT '',
    device_type       TEXT        NOT NULL DEFAULT 'ap',
    ip_address        TEXT        NOT NULL DEFAULT '',
    site_id           TEXT        NOT NULL DEFAULT '',
    site_name         TEXT        NOT NULL DEFAULT '',
    connected         BOOLEAN     NOT NULL DEFAULT false,
    reachability      TEXT        NOT NULL DEFAULT 'unknown', -- reachable/unreachable/unknown
    num_clients       INT         NOT NULL DEFAULT 0,
    uptime_seconds    BIGINT      NOT NULL DEFAULT 0,
    firmware_version  TEXT        NOT NULL DEFAULT '',
    props             JSONB       NOT NULL DEFAULT '{}',
    last_seen         TIMESTAMPTZ,
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_inventory_platform   ON inventory (platform);
CREATE INDEX IF NOT EXISTS idx_inventory_site_id    ON inventory (site_id);
CREATE INDEX IF NOT EXISTS idx_inventory_connected  ON inventory (connected);
CREATE INDEX IF NOT EXISTS idx_inventory_model      ON inventory (model);
