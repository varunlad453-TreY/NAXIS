-- Incidents Table
-- Primary operational business entity of the Naxis platform.
-- Produced by the deterministic correlation engine from naxis.events,
-- and enriched by the AI RCA pipeline (probable_cause, confidence_score).

CREATE DATABASE IF NOT EXISTS naxis;

CREATE TABLE IF NOT EXISTS naxis.incidents
(
    -- Identity
    incident_id String,

    -- Content
    title String,

    -- Classification
    severity LowCardinality(String),  -- critical, major, minor, warning, info
    status   LowCardinality(String),  -- open, investigating, mitigated, resolved, closed, suppressed

    -- Blast radius
    affected_sites    Array(String),
    affected_devices  Array(String),
    affected_clients  Array(String),

    -- Correlation
    related_event_ids Array(String),
    event_count       UInt32 DEFAULT length(related_event_ids),

    -- RCA enrichment
    probable_cause    String,
    confidence_score  Float32 DEFAULT 0.0,

    -- Temporal (created_at is the partition key)
    created_at DateTime64(3),
    updated_at DateTime64(3)
)
ENGINE = ReplacingMergeTree(updated_at)
PARTITION BY toYYYYMMDD(created_at)
ORDER BY (severity, status, created_at, incident_id)
TTL toDateTime(created_at) + INTERVAL 180 DAY  -- Retain incidents for 180 days
SETTINGS index_granularity = 8192;

-- Skip indexes for the most common dashboard filters.
ALTER TABLE naxis.incidents ADD INDEX idx_severity severity TYPE set(0) GRANULARITY 1;
ALTER TABLE naxis.incidents ADD INDEX idx_status   status   TYPE set(0) GRANULARITY 1;
ALTER TABLE naxis.incidents ADD INDEX idx_incident_id incident_id TYPE bloom_filter GRANULARITY 1;
ALTER TABLE naxis.incidents ADD INDEX idx_sites    affected_sites    TYPE bloom_filter GRANULARITY 1;
ALTER TABLE naxis.incidents ADD INDEX idx_devices  affected_devices  TYPE bloom_filter GRANULARITY 1;
ALTER TABLE naxis.incidents ADD INDEX idx_events   related_event_ids TYPE bloom_filter GRANULARITY 1;

-- Hourly rollup of incident volume by severity/status for dashboards.
CREATE MATERIALIZED VIEW IF NOT EXISTS naxis.incidents_summary_by_hour
ENGINE = SummingMergeTree()
PARTITION BY toYYYYMM(hour)
ORDER BY (hour, severity, status)
POPULATE
AS SELECT
    toStartOfHour(created_at) AS hour,
    severity,
    status,
    count() AS incident_count
FROM naxis.incidents
GROUP BY hour, severity, status;

-- Comments
COMMENT ON TABLE  naxis.incidents IS 'Correlated incidents — output of the correlation engine, input to RCA';
COMMENT ON COLUMN naxis.incidents.incident_id      IS 'Unique incident ID (inc-<hex>)';
COMMENT ON COLUMN naxis.incidents.related_event_ids IS 'naxis.events.event_id values grouped into this incident';
COMMENT ON COLUMN naxis.incidents.probable_cause   IS 'AI RCA hypothesis (empty until enrichment runs)';
COMMENT ON COLUMN naxis.incidents.confidence_score IS 'RCA confidence in [0.0, 1.0]; 0.0 means not yet enriched';
COMMENT ON COLUMN naxis.incidents.status           IS 'Lifecycle: open, investigating, mitigated, resolved, closed, suppressed';
