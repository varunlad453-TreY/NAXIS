-- Schema: 012_path_segment_telemetry.sql
-- Ingests high-throughput path segment telemetry for Cloudflare, Netskope, and SASE transit.
-- Keeps physical topology graph clean while enabling Phase 4 path trace diagnostics.

CREATE TABLE IF NOT EXISTS path_segment_telemetry (
    segment_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider VARCHAR(64) NOT NULL,            -- 'cloudflare', 'netskope', etc.
    segment_name VARCHAR(128) NOT NULL,        -- e.g. 'netskope-npa-mumbai', 'cloudflare-warp-primary'
    segment_type VARCHAR(64) NOT NULL,        -- 'sase_tunnel', 'zero_trust_access', 'magic_transit'
    site_key TEXT REFERENCES sites(site_key) ON DELETE SET NULL,
    pop_region VARCHAR(64),                   -- e.g. 'ap-south-1', 'mumbai-pop-01'
    status VARCHAR(32) NOT NULL DEFAULT 'healthy', -- 'healthy', 'degraded', 'down'
    latency_ms FLOAT DEFAULT 0.0,
    packet_loss_pct FLOAT DEFAULT 0.0,
    jitter_ms FLOAT DEFAULT 0.0,
    active_tunnels INT DEFAULT 0,
    metadata JSONB DEFAULT '{}'::jsonb,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Fast lookup index for Path Trace API
CREATE INDEX IF NOT EXISTS idx_path_segment_lookup 
    ON path_segment_telemetry (provider, segment_type, recorded_at DESC);

-- Site-level lookup index
CREATE INDEX IF NOT EXISTS idx_path_segment_site
    ON path_segment_telemetry (site_key, recorded_at DESC)
    WHERE site_key IS NOT NULL;
