-- Migration 014: Diagnostic Runs Audit Ledger (WP-6)
-- Tracks all live network diagnostic test executions (ping, traceroute, port_stats).

CREATE TABLE IF NOT EXISTS diagnostic_runs (
    run_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    actor_id TEXT NOT NULL,
    actor_name TEXT NOT NULL,
    actor_role TEXT NOT NULL,
    target_device_id TEXT NOT NULL,
    target_device_name TEXT,
    test_type TEXT NOT NULL,
    status TEXT NOT NULL,
    results_json JSONB DEFAULT '{}'::jsonb,
    duration_ms DOUBLE PRECISION DEFAULT 0.0
);

CREATE INDEX IF NOT EXISTS idx_diag_runs_created_at ON diagnostic_runs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_diag_runs_actor ON diagnostic_runs(actor_id);
CREATE INDEX IF NOT EXISTS idx_diag_runs_target ON diagnostic_runs(target_device_id);
