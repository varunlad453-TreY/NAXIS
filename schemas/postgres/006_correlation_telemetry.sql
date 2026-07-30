-- Correlation engine telemetry
-- Written by the worker after each correlation cycle.
-- The API reads the latest row to expose engine stats without needing
-- in-process access to the WorkerDaemon.
CREATE TABLE IF NOT EXISTS correlation_telemetry (
    id                      BIGSERIAL   PRIMARY KEY,

    -- Cumulative counters (since engine start or last reset)
    cycle_count             INTEGER     NOT NULL,
    total_events_processed  INTEGER     NOT NULL,
    total_incidents_created INTEGER     NOT NULL,
    cascade_incidents       INTEGER     NOT NULL,
    residual_incidents      INTEGER     NOT NULL,

    -- Snapshot of the processed-event tracker size
    processed_set_size      INTEGER     NOT NULL,

    -- Per-cycle values (the most recent cycle)
    last_duration_ms        REAL        NOT NULL DEFAULT 0,
    last_cycle_events       INTEGER     NOT NULL DEFAULT 0,
    last_cycle_incidents    INTEGER     NOT NULL DEFAULT 0,

    -- Whether topology cascade was enabled for this cycle
    cascade_enabled         BOOLEAN     NOT NULL DEFAULT FALSE,

    -- Worker identity
    worker_id               TEXT,

    recorded_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_correlation_telemetry_recorded
    ON correlation_telemetry (recorded_at DESC);

-- Retention: clean up rows older than 7 days
-- DELETE FROM correlation_telemetry WHERE recorded_at < NOW() - INTERVAL '7 days';
