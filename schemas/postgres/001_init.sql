-- Naxis PostgreSQL Schema
-- Replaces ClickHouse (events + incidents) and Neo4j (topology)

-- Events table — normalized telemetry from all vendors
CREATE TABLE IF NOT EXISTS events (
    event_id          TEXT        PRIMARY KEY,
    timestamp         TIMESTAMPTZ NOT NULL,
    received_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    source            TEXT        NOT NULL,
    source_event_id   TEXT,

    severity          TEXT        NOT NULL,
    category          TEXT        NOT NULL,
    event_type        TEXT        NOT NULL,

    title             TEXT        NOT NULL,
    description       TEXT        NOT NULL DEFAULT '',

    -- Device fields (denormalized for query simplicity)
    device_id         TEXT,
    device_name       TEXT,
    device_ip         TEXT,
    device_type       TEXT,
    site_id           TEXT,
    site_name         TEXT,

    -- Client fields
    client_id         TEXT,
    client_mac        TEXT,
    client_ip         TEXT,

    -- Interface
    interface_name    TEXT,

    -- Tags stored as text array
    tags              TEXT[]      NOT NULL DEFAULT '{}',

    -- Correlation
    incident_id       TEXT,
    correlation_key   TEXT,

    -- Vendor-specific blobs
    metadata          JSONB       NOT NULL DEFAULT '{}',
    raw_event         JSONB
);

-- Partition-friendly index: most queries filter by time range
CREATE INDEX IF NOT EXISTS idx_events_timestamp     ON events (timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_events_device_id     ON events (device_id) WHERE device_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_events_site_id       ON events (site_id)   WHERE site_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_events_incident_id   ON events (incident_id) WHERE incident_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_events_severity      ON events (severity);
CREATE INDEX IF NOT EXISTS idx_events_source        ON events (source);
CREATE INDEX IF NOT EXISTS idx_events_tags          ON events USING GIN (tags);


-- Incidents table — correlated business entities
CREATE TABLE IF NOT EXISTS incidents (
    incident_id       TEXT        PRIMARY KEY,
    title             TEXT        NOT NULL,

    severity          TEXT        NOT NULL,
    status            TEXT        NOT NULL DEFAULT 'open',

    -- Blast radius (arrays of canonical IDs)
    affected_sites    TEXT[]      NOT NULL DEFAULT '{}',
    affected_devices  TEXT[]      NOT NULL DEFAULT '{}',
    affected_clients  TEXT[]      NOT NULL DEFAULT '{}',

    -- Correlated event IDs
    related_event_ids TEXT[]      NOT NULL DEFAULT '{}',

    -- RCA enrichment
    probable_cause    TEXT,
    confidence_score  REAL        NOT NULL DEFAULT 0.0,

    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_incidents_status       ON incidents (status);
CREATE INDEX IF NOT EXISTS idx_incidents_severity     ON incidents (severity);
CREATE INDEX IF NOT EXISTS idx_incidents_created_at   ON incidents (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_incidents_affected_sites   ON incidents USING GIN (affected_sites);
CREATE INDEX IF NOT EXISTS idx_incidents_affected_devices ON incidents USING GIN (affected_devices);


-- Topology: nodes (devices, sites, etc.)
CREATE TABLE IF NOT EXISTS topology_nodes (
    node_id       TEXT        PRIMARY KEY,
    node_type     TEXT        NOT NULL,  -- device, site, interface, circuit
    name          TEXT,
    ip_address    TEXT,
    vendor        TEXT,
    model         TEXT,
    site_id       TEXT,
    props         JSONB       NOT NULL DEFAULT '{}',
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_topology_nodes_type    ON topology_nodes (node_type);
CREATE INDEX IF NOT EXISTS idx_topology_nodes_site_id ON topology_nodes (site_id) WHERE site_id IS NOT NULL;


-- Topology: edges (links between nodes)
CREATE TABLE IF NOT EXISTS topology_edges (
    edge_id       TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
    src_id        TEXT        NOT NULL REFERENCES topology_nodes(node_id) ON DELETE CASCADE,
    dst_id        TEXT        NOT NULL REFERENCES topology_nodes(node_id) ON DELETE CASCADE,
    edge_type     TEXT        NOT NULL,  -- physical_link, logical_link, site_membership
    props         JSONB       NOT NULL DEFAULT '{}',
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_topology_edges_src    ON topology_edges (src_id);
CREATE INDEX IF NOT EXISTS idx_topology_edges_dst    ON topology_edges (dst_id);
CREATE INDEX IF NOT EXISTS idx_topology_edges_type   ON topology_edges (edge_type);
-- Bidirectional lookup in one index
CREATE UNIQUE INDEX IF NOT EXISTS idx_topology_edges_pair
    ON topology_edges (LEAST(src_id, dst_id), GREATEST(src_id, dst_id), edge_type);
