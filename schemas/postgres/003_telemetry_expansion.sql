-- Migration 003: Telemetry Expansion
-- Adds support for SNMP polling, SNMP traps, syslog, VeloCloud events,
-- and enriches the topology schema for multi-vendor physical topology.

-- ── Topology node: add missing columns ───────────────────────────────────────

ALTER TABLE topology_nodes ADD COLUMN IF NOT EXISTS model       TEXT;
ALTER TABLE topology_nodes ADD COLUMN IF NOT EXISTS vendor      TEXT;

-- Extend node_type vocabulary (documented, not enforced — keeps schema flexible)
-- Valid values: device, site, interface, circuit, ap, edge, switch, wan_gateway

-- ── Topology edge: add state + link metrics ───────────────────────────────────

ALTER TABLE topology_edges ADD COLUMN IF NOT EXISTS state       TEXT DEFAULT 'unknown';
ALTER TABLE topology_edges ADD COLUMN IF NOT EXISTS discovered_by TEXT DEFAULT 'rest_api';

-- ── Event source index: covers new sources syslog / snmp / snmp_trap / velocloud

CREATE INDEX IF NOT EXISTS idx_events_source_ts
    ON events (source, timestamp DESC);

-- ── Topology query helpers ────────────────────────────────────────────────────

-- Fast lookup: all edges for a given node (either direction)
CREATE INDEX IF NOT EXISTS idx_topology_edges_any_node
    ON topology_edges (src_id, dst_id);

-- Fast lookup: edges by type + state for topology filtering
CREATE INDEX IF NOT EXISTS idx_topology_edges_type_state
    ON topology_edges (edge_type, state);

-- Fast lookup: nodes by vendor (useful for per-platform topology views)
CREATE INDEX IF NOT EXISTS idx_topology_nodes_vendor
    ON topology_nodes (vendor) WHERE vendor IS NOT NULL;
