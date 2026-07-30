CREATE TABLE IF NOT EXISTS node_health_snapshots (
    id            BIGSERIAL   PRIMARY KEY,
    node_id       TEXT        NOT NULL,
    health_status TEXT        NOT NULL,
    health_label  TEXT        NOT NULL DEFAULT '',
    snapshot_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    derived_from  TEXT        NOT NULL DEFAULT 'events'
);

CREATE INDEX IF NOT EXISTS idx_health_snapshots_node_time
    ON node_health_snapshots (node_id, snapshot_at DESC);

CREATE INDEX IF NOT EXISTS idx_health_snapshots_time
    ON node_health_snapshots (snapshot_at DESC);

-- Retention: clean up snapshots older than 30 days
-- (run periodically via cron or pgAgent)
-- DELETE FROM node_health_snapshots WHERE snapshot_at < NOW() - INTERVAL '30 days';
