-- Migration 009: Explicit parent-child links table
--
-- Replaces the ambiguous src/dst direction in topology_edges for cascade-
-- relevant relationships.  The old physical_link edges in topology_edges
-- stored src=child, dst=parent, but different consumers interpreted the
-- direction differently — this is why the cascade produced zero incidents.
--
-- The links table is unambiguous:
--   parent_node_id → the upstream infrastructure device
--   child_node_id  → the downstream device that depends on it
--
-- Only physical / cascade parent-child edges live here.
-- site_membership, wan_link, and other graph edges stay in topology_edges.

-- ---------------------------------------------------------------------------
-- Links table
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS links (
    id             BIGSERIAL   PRIMARY KEY,
    parent_node_id TEXT        NOT NULL REFERENCES topology_nodes(node_id) ON DELETE CASCADE,
    child_node_id  TEXT        NOT NULL REFERENCES topology_nodes(node_id) ON DELETE CASCADE,
    link_type      TEXT        NOT NULL DEFAULT 'physical',  -- physical, wan, logical
    props          JSONB       NOT NULL DEFAULT '{}',
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_links_pair UNIQUE (parent_node_id, child_node_id, link_type)
);

CREATE INDEX IF NOT EXISTS idx_links_parent ON links (parent_node_id);
CREATE INDEX IF NOT EXISTS idx_links_child  ON links (child_node_id);
CREATE INDEX IF NOT EXISTS idx_links_type   ON links (link_type);

COMMENT ON TABLE links IS
    'Explicit parent-child edges for topology cascade. parent=upstream infra, child=downstream leaf.';

-- ---------------------------------------------------------------------------
-- Trigger: keep updated_at current
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION _links_touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_links_updated_at ON links;
CREATE TRIGGER trg_links_updated_at
    BEFORE UPDATE ON links
    FOR EACH ROW EXECUTE FUNCTION _links_touch_updated_at();

-- ---------------------------------------------------------------------------
-- Migration: move physical_link edges from topology_edges → links
--
-- In topology_edges physical_link semantics: src_id = child, dst_id = parent
-- In links semantics: parent_node_id = parent (dst), child_node_id = child (src)
-- ---------------------------------------------------------------------------
INSERT INTO links (parent_node_id, child_node_id, link_type, props, updated_at)
SELECT
    e.dst_id        AS parent_node_id,   -- dst was the parent
    e.src_id        AS child_node_id,    -- src was the child
    'physical'      AS link_type,
    COALESCE(e.props, '{}')::jsonb,
    COALESCE(e.updated_at, NOW())
FROM topology_edges e
WHERE e.edge_type = 'physical_link'
ON CONFLICT (parent_node_id, child_node_id, link_type) DO UPDATE SET
    props       = EXCLUDED.props,
    updated_at  = NOW();

-- ---------------------------------------------------------------------------
-- Clean up: remove migrated physical_link rows from topology_edges so
-- consumers don't see duplicate / inverted edges.
-- ---------------------------------------------------------------------------
DELETE FROM topology_edges WHERE edge_type = 'physical_link';
