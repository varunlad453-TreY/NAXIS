CREATE TABLE IF NOT EXISTS mist_ap_history (
    id            BIGSERIAL   PRIMARY KEY,
    observed_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    mist_ap_id    TEXT        NOT NULL,
    serial        TEXT        NOT NULL,
    mac           TEXT        NOT NULL DEFAULT '',
    hostname      TEXT        NOT NULL DEFAULT '',
    model         TEXT        NOT NULL DEFAULT '',
    site_id       TEXT        NOT NULL DEFAULT '',
    site_name     TEXT        NOT NULL DEFAULT '',
    firmware      TEXT        NOT NULL DEFAULT '',
    reachability  TEXT        NOT NULL DEFAULT 'unknown',
    uptime_s      BIGINT      NOT NULL DEFAULT 0,
    raw           JSONB       NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_mist_ap_history_serial_time  ON mist_ap_history (serial, observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_mist_ap_history_ap_id_time   ON mist_ap_history (mist_ap_id, observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_mist_ap_history_site_time    ON mist_ap_history (site_id, observed_at DESC);
