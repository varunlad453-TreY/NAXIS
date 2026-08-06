-- Migration 011: Device & Link State History (WP-2.5)
-- Provides an indefinite, diff-on-write state transition ledger for devices and links.
-- Records state changes ONLY when new_state != previous_state (zero database bloat).

CREATE TABLE IF NOT EXISTS device_state_history (
    history_id BIGSERIAL PRIMARY KEY,
    device_key VARCHAR(255) NOT NULL,
    site_key VARCHAR(255),
    previous_state VARCHAR(50),
    new_state VARCHAR(50) NOT NULL,
    duration_seconds DOUBLE PRECISION,
    transition_reason VARCHAR(255),
    event_id VARCHAR(255),
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_device_state_history_key_time 
    ON device_state_history (device_key, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_device_state_history_site_time 
    ON device_state_history (site_key, recorded_at DESC);

CREATE TABLE IF NOT EXISTS link_state_history (
    history_id BIGSERIAL PRIMARY KEY,
    link_key VARCHAR(255) NOT NULL,
    parent_node_id VARCHAR(255) NOT NULL,
    child_node_id VARCHAR(255) NOT NULL,
    previous_state VARCHAR(50),
    new_state VARCHAR(50) NOT NULL,
    duration_seconds DOUBLE PRECISION,
    transition_reason VARCHAR(255),
    event_id VARCHAR(255),
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_link_state_history_key_time 
    ON link_state_history (link_key, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_link_state_history_nodes 
    ON link_state_history (parent_node_id, child_node_id);
