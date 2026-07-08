"""
Topology query layer — reads topology_nodes / topology_edges for the
correlation engine and other platform components.

The topology graph is built by topology_sync.py from Mist, VeloCloud, and
SNMP data.  This module provides:
  - get_parents() / get_children()  — walk up/down the graph
  - get_devices_under_node()        — full subtree
  - get_root_cause_candidates()     — find which device is upstream of others
  - resolve_node_id()               — map event device_id → topology node_id
  - DatabaseTopologyProvider        — adapter for the correlation engine's
                                     TopologyProvider protocol (Stage 2)
"""

import logging
from typing import Any, Dict, List, Optional, Set, Tuple

from ..correlation.rules import TopologyProvider
from .client import db

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Node ID resolution
# ---------------------------------------------------------------------------

def _known_node_id_patterns(device_id: str) -> List[str]:
    """
    Return candidate node_id patterns to try when looking up a device_id
    in the topology graph.
    """
    candidates = [
        # Exact device_id first (some collectors write it directly)
        device_id,
    ]

    # If it looks like a MAC, it may be a Mist AP node
    if _looks_like_mac(device_id):
        candidates.append(f"mist-ap-{device_id}")

    # If it looks like an edge ID, try VeloCloud
    if "edge" in device_id.lower():
        candidates.append(f"velo-edge-{device_id}")

    return candidates


def _looks_like_mac(value: str) -> bool:
    """Heuristic: MAC addresses are 12 hex chars or 17 chars with colons."""
    cleaned = value.replace(":", "").replace("-", "").replace(".", "")
    return len(cleaned) == 12 and all(c in "0123456789abcdefABCDEF" for c in cleaned)


async def resolve_node_id(device_id: str) -> Optional[str]:
    """
    Map a canonical device_id (from UnifiedEvent) to the corresponding
    topology_nodes.node_id.  Returns None if no match found.
    """
    if not device_id:
        return None

    if not db.pool:
        return None

    candidates = _known_node_id_patterns(device_id)

    for node_id in candidates:
        row = await db.fetchrow(
            "SELECT node_id FROM topology_nodes WHERE node_id = $1", node_id
        )
        if row:
            return row["node_id"]

    return None


# ---------------------------------------------------------------------------
# Graph traversal
# ---------------------------------------------------------------------------

async def get_parents(node_id: str) -> List[Dict[str, Any]]:
    """
    Return direct parent nodes via topology_edges.

    Edge direction: src → dst means src is a child of dst.
    So parents of node_id are found where node_id is src.
    """
    if not node_id or not db.pool:
        return []

    rows = await db.fetch(
        """
        SELECT n.node_id, n.node_type, n.name, n.vendor, e.edge_type, e.props
        FROM topology_edges e
        JOIN topology_nodes n ON n.node_id = e.dst_id
        WHERE e.src_id = $1
        """,
        node_id,
    )
    return [dict(r) for r in rows]


async def get_children(node_id: str) -> List[Dict[str, Any]]:
    """
    Return direct child nodes via topology_edges.

    Children of node_id are found where node_id is dst (parent).
    """
    if not node_id or not db.pool:
        return []

    rows = await db.fetch(
        """
        SELECT n.node_id, n.node_type, n.name, n.vendor, e.edge_type, e.props
        FROM topology_edges e
        JOIN topology_nodes n ON n.node_id = e.src_id
        WHERE e.dst_id = $1
        """,
        node_id,
    )
    return [dict(r) for r in rows]


async def get_devices_under_node(node_id: str, max_depth: int = 3) -> List[str]:
    """
    Recursively find all device node_ids that are descendants of node_id
    (useful for blast radius: "all devices affected by this switch going down").
    """
    if not node_id or not db.pool or max_depth <= 0:
        return []

    children = await get_children(node_id)
    result: List[str] = []
    for child in children:
        child_id = child["node_id"]
        result.append(child_id)
        deeper = await get_devices_under_node(child_id, max_depth - 1)
        result.extend(deeper)
    return result


# ---------------------------------------------------------------------------
# Root-cause identification
# ---------------------------------------------------------------------------

async def get_root_cause_candidates(
    device_ids: List[str],
) -> List[Dict[str, Any]]:
    """
    Given a list of device_ids (from events in the same time window),
    determine which ones are potential root causes.

    A device is a root cause candidate if:
      1. It has children in the topology (other devices depend on it)
      2. It does NOT have a parent that is also in the list (it's the
         most upstream failed device)

    Returns a sorted list of candidate dicts with:
      - device_id: the event device_id
      - node_id: the resolved topology node_id
      - children: list of device_ids that depend on this device
    """
    if not device_ids or not db.pool:
        return []

    # Resolve all device_ids to node_ids
    resolved: List[Tuple[str, str]] = []  # (device_id, node_id)
    for did in device_ids:
        nid = await resolve_node_id(did)
        if nid:
            resolved.append((did, nid))

    if not resolved:
        return []

    # Build a set of all known node_ids for fast parent lookup
    node_id_set = {nid for _, nid in resolved}

    # For each device, find parents that are ALSO in the list
    candidates: List[Dict[str, Any]] = []
    for device_id, node_id in resolved:
        parents = await get_parents(node_id)
        has_parent_in_set = any(p["node_id"] in node_id_set for p in parents)
        children = await get_children(node_id)

        # It's a root cause candidate if:
        # - It has children in the topology (it's upstream)
        # - No parent in the set (it's the most upstream)
        if children and not has_parent_in_set:
            child_ids = [
                c["node_id"] for c in children if c["node_id"] in node_id_set
            ]
            # Map child node_ids back to device_ids
            child_device_ids = []
            for cid in child_ids:
                for d_id, n_id in resolved:
                    if n_id == cid:
                        child_device_ids.append(d_id)
                        break

            candidates.append({
                "device_id": device_id,
                "node_id": node_id,
                "children": child_device_ids,
            })

    # Also find any device that has no parent in set but has children
    # outside the set — this means it may be a root cause even if its
    # children aren't all in the event window
    for device_id, node_id in resolved:
        if any(c["device_id"] == device_id for c in candidates):
            continue
        parents = await get_parents(node_id)
        has_parent_in_set = any(p["node_id"] in node_id_set for p in parents)
        if not has_parent_in_set:
            children = await get_children(node_id)
            if children:
                child_device_ids = [
                    c["node_id"] for c in children
                ]
                candidates.append({
                    "device_id": device_id,
                    "node_id": node_id,
                    "children": child_device_ids,
                })

    # Sort by most children first (most likely root cause)
    candidates.sort(key=lambda c: len(c["children"]), reverse=True)
    return candidates


# ---------------------------------------------------------------------------
# Topology summary (for health / status endpoints)
# ---------------------------------------------------------------------------

async def get_topology_summary() -> Dict[str, Any]:
    """Return a summary of the current topology graph."""
    if not db.pool:
        return {"error": "No database connection"}

    node_count = await db.fetchrow("SELECT COUNT(*) AS cnt FROM topology_nodes")
    edge_count = await db.fetchrow("SELECT COUNT(*) AS cnt FROM topology_edges")

    by_type = await db.fetch(
        "SELECT node_type, COUNT(*) AS cnt FROM topology_nodes GROUP BY node_type"
    )

    return {
        "nodes": int(node_count["cnt"]) if node_count else 0,
        "edges": int(edge_count["cnt"]) if edge_count else 0,
        "by_type": {r["node_type"]: int(r["cnt"]) for r in by_type},
    }


# ---------------------------------------------------------------------------
# DatabaseTopologyProvider — adapter for the correlation engine
# ---------------------------------------------------------------------------

class DatabaseTopologyProvider:
    """
    Production TopologyProvider backed by PostgreSQL.

    Implements the TopologyProvider protocol used by TopologyCascadeRule
    to query parent-child relationships from topology_edges.

    This is the bridge between the correlation engine's abstract topology
    queries and the real topology_nodes / topology_edges tables populated
    by topology_sync.py.
    """

    async def get_parent_child_map(
        self, device_ids: Set[str]
    ) -> Dict[str, List[str]]:
        """
        For each device_id in the set, find direct children via topology_edges.

        A device is a parent if it has outgoing edges (src_id) where the
        destination (dst_id) is also in the topology graph.

        Returns a dict: { parent_device_id: [child_device_id, ...] }
        """
        if not device_ids or not db.pool:
            return {}

        result: Dict[str, List[str]] = {}

        for device_id in device_ids:
            node_id = await resolve_node_id(device_id)
            if not node_id:
                continue

            children = await get_children(node_id)
            if not children:
                continue

            child_ids = [c["node_id"] for c in children]
            result[device_id] = child_ids

        return result

    async def get_all_descendants(
        self, device_id: str, max_depth: int = 5
    ) -> List[str]:
        """Recursively find all descendants of device_id."""
        node_id = await resolve_node_id(device_id)
        if not node_id:
            return []
        return await get_devices_under_node(node_id, max_depth=max_depth)
