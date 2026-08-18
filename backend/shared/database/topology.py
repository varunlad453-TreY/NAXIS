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

import hashlib

from ..correlation.rules import TopologyProvider
from .client import db

try:
    from backend.shared.database.identity import IdentityResolver
except ImportError:  # pragma: no cover
    from shared.database.identity import IdentityResolver

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Node ID resolution
# ---------------------------------------------------------------------------

def _known_node_id_patterns(device_id: str) -> List[str]:
    """
    Return candidate node_id patterns to try when looking up a device_id
    in the topology graph.

    Tries all known prefixes for every device_id so we never miss a match
    due to format heuristics.  Exact device_id match comes first, followed
    by prefixed variants.
    """
    candidates = [device_id]

    cleaned = device_id.replace(":", "").replace("-", "").replace(".", "")
    is_mac = (
        len(cleaned) == 12
        and all(c in "0123456789abcdefABCDEF" for c in cleaned)
    )

    if is_mac:
        candidates.append(f"mist-ap-{cleaned}")
        candidates.append(f"switch-{cleaned}")
        candidates.append(f"snmp-{cleaned}")

    # Try every known prefix — the DB cost of a few extra ANY($1) entries
    # is negligible, and the heuristic-gated approach misses real matches.
    for prefix in _NODE_PREFIXES:
        candidates.append(f"{prefix}{device_id}")

    # Deduplicate while preserving order
    seen: Set[str] = set()
    unique: List[str] = []
    for c in candidates:
        if c not in seen:
            seen.add(c)
            unique.append(c)
    return unique


def _looks_like_mac(value: str) -> bool:
    """Heuristic: MAC addresses are 12 hex chars or 17 chars with colons."""
    cleaned = value.replace(":", "").replace("-", "").replace(".", "")
    return len(cleaned) == 12 and all(c in "0123456789abcdefABCDEF" for c in cleaned)


# Known node_id prefix → device_type mapping used by topology_sync.
# The prefix indicates the device type and source vendor.
_NODE_PREFIXES = [
    "mist-ap-", "mist-site-",
    "switch-",
    "velo-edge-", "velo-site-",
    "wan-gw-",
    "snmp-",
]


def node_id_to_device_id(node_id: str) -> str:
    """
    Reverse-resolution: given a topology node_id, extract the original
    device_id by stripping the known prefix.

    Example:
        node_id_to_device_id("mist-ap-abc123")  → "abc123"
        node_id_to_device_id("velo-edge-42")     → "42"
        node_id_to_device_id("switch-001122aabbcc") → "001122aabbcc"
    """
    for prefix in _NODE_PREFIXES:
        if node_id.startswith(prefix):
            return node_id[len(prefix):]
    return node_id


async def resolve_node_id(device_id: str) -> Optional[str]:
    """
    Map a canonical device_id (from UnifiedEvent) to the corresponding
    topology_nodes.node_id.  Returns None if no match found.

    Resolution order:
      1. Direct canonical_key match (new identity-aware events).
      2. Identity lookup: vendor_device_id -> canonical_key -> node_id.
      3. Legacy prefix heuristic fallback.
    """
    if not device_id or not db.pool:
        return None

    # 1. Direct canonical key match
    row = await db.fetchrow(
        "SELECT node_id FROM topology_nodes WHERE canonical_key = $1",
        device_id,
    )
    if row:
        return row["node_id"]

    # 2. Identity-aware lookup
    identity_match = await _resolve_node_id_via_identity([device_id])
    if identity_match.get(device_id):
        return identity_match[device_id]

    # 3. Legacy prefix heuristic fallback
    candidates = _known_node_id_patterns(device_id)
    for node_id in candidates:
        row = await db.fetchrow(
            "SELECT node_id FROM topology_nodes WHERE node_id = $1", node_id
        )
        if row:
            return row["node_id"]

    return None


async def _resolve_node_id_via_identity(device_ids: List[str]) -> Dict[str, str]:
    """
    Bulk resolve device_ids to topology node_ids via the identity tables.

    Queries device_identities for vendor_device_id matches and joins to
    topology_nodes on canonical_key.  Returns {device_id: node_id} for
    matches found.  Vendor collisions are resolved by first match.
    """
    if not device_ids or not db.pool:
        return {}

    rows = await db.fetch(
        """
        SELECT di.vendor_device_id, tn.node_id
        FROM device_identities di
        JOIN topology_nodes tn ON tn.canonical_key = di.device_key
        WHERE di.vendor_device_id = ANY($1::text[])
        """,
        device_ids,
    )
    # Keep first node_id per vendor_device_id
    result: Dict[str, str] = {}
    for row in rows:
        vid = row["vendor_device_id"]
        if vid not in result:
            result[vid] = row["node_id"]
    return result


# ---------------------------------------------------------------------------
# Graph traversal
# ---------------------------------------------------------------------------

async def get_parents(node_id: str) -> List[Dict[str, Any]]:
    """
    Return direct parent nodes via both links (physical) and topology_edges
    (site_membership, wan_link, logical_link).

    links semantics: parent_node_id = upstream, child_node_id = downstream.
    topology_edges semantics: src = child, dst = parent (preserved for
    non-physical edge types).
    """
    if not node_id or not db.pool:
        return []

    rows = await db.fetch(
        """
        SELECT n.node_id, n.node_type, n.name, n.vendor, 'physical' AS edge_type, l.props
        FROM links l
        JOIN topology_nodes n ON n.node_id = l.parent_node_id
        WHERE l.child_node_id = $1
        UNION ALL
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
    Return direct child nodes via both links (physical) and topology_edges
    (site_membership, wan_link, logical_link).
    """
    if not node_id or not db.pool:
        return []

    rows = await db.fetch(
        """
        SELECT n.node_id, n.node_type, n.name, n.vendor, 'physical' AS edge_type, l.props
        FROM links l
        JOIN topology_nodes n ON n.node_id = l.child_node_id
        WHERE l.parent_node_id = $1
        UNION ALL
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
    via the explicit parent-child links table.

    Uses a recursive CTE for efficiency instead of N+1 Python recursion.
    """
    if not node_id or not db.pool or max_depth <= 0:
        return []

    try:
        rows = await db.fetch(
            """
            WITH RECURSIVE downstream AS (
                SELECT child_node_id AS node_id, ARRAY[parent_node_id] AS path, 1 AS depth
                FROM links
                WHERE parent_node_id = $1
                UNION
                SELECT l.child_node_id, d.path || l.parent_node_id, d.depth + 1
                FROM links l
                JOIN downstream d ON l.parent_node_id = d.node_id
                WHERE d.depth < $2
                  AND NOT (l.child_node_id = ANY(d.path))
            )
            SELECT DISTINCT node_id FROM downstream
            """,
            node_id,
            max_depth,
        )
        return [r["node_id"] for r in rows]
    except Exception:
        logger.warning("get_devices_under_node query failed", exc_info=True)
        return []


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

    Uses batch queries instead of N+1 per device_id.
    """

    async def batch_resolve_node_ids(
        self, device_ids: Set[str]
    ) -> Dict[str, Optional[str]]:
        """
        Resolve multiple event device_ids to topology node_ids in a single
        DB query.  Returns {device_id: node_id_or_None, ...}.

        Resolution order:
          1. Direct canonical_key match on topology_nodes.
          2. Identity lookup: vendor_device_id -> canonical_key -> node_id.
          3. Legacy prefix heuristic fallback.
        """
        if not device_ids or not db.pool:
            return {}

        device_list = list(device_ids)
        result: Dict[str, Optional[str]] = {d: None for d in device_ids}
        unresolved: Set[str] = set(device_ids)

        try:
            # 1. Direct canonical key match
            rows = await db.fetch(
                "SELECT node_id, canonical_key FROM topology_nodes WHERE canonical_key = ANY($1::text[])",
                device_list,
            )
            for row in rows:
                for did in unresolved:
                    if did == row["canonical_key"]:
                        result[did] = row["node_id"]

            unresolved = {d for d, nid in result.items() if nid is None}

            # 2. Identity-aware lookup
            if unresolved:
                identity_matches = await _resolve_node_id_via_identity(list(unresolved))
                for did, node_id in identity_matches.items():
                    if did in unresolved:
                        result[did] = node_id
                        unresolved.discard(did)

            # 3. Legacy prefix heuristic fallback
            if unresolved:
                all_candidates: List[str] = []
                pattern_to_device: Dict[str, str] = {}
                for did in unresolved:
                    for pattern in _known_node_id_patterns(did):
                        all_candidates.append(pattern)
                        pattern_to_device[pattern] = did

                if all_candidates:
                    rows = await db.fetch(
                        "SELECT node_id FROM topology_nodes WHERE node_id = ANY($1)",
                        all_candidates,
                    )
                    existing = {r["node_id"] for r in rows}
                    for did in unresolved:
                        resolved = None
                        for pattern in _known_node_id_patterns(did):
                            if pattern in existing:
                                resolved = pattern
                                break
                        result[did] = resolved

        except Exception:
            logger.warning("batch_resolve_node_ids query failed", exc_info=True)

        return result

    async def get_parent_child_map(
        self, device_ids: Set[str]
    ) -> Dict[str, List[str]]:
        """
        For each device_id in the set, find direct children via the explicit
        parent-child links table.

        Uses exactly 2 DB queries (batch resolve + single link query)
        instead of N+1.

        Returns a dict: { parent_device_id: [child_device_id, ...] }
        """
        if not device_ids or not db.pool:
            return {}

        # Batch 1: resolve all device_ids to topology node_ids
        resolved = await self.batch_resolve_node_ids(device_ids)
        node_ids = [nid for nid in resolved.values() if nid]
        if not node_ids:
            return {}

        # Batch 2: single query against the explicit links table
        try:
            rows = await db.fetch(
                """
                SELECT parent_node_id, child_node_id
                FROM links
                WHERE parent_node_id = ANY($1)
                """,
                node_ids,
            )
        except Exception:
            logger.warning("get_parent_child_map link query failed", exc_info=True)
            return {}

        if not rows:
            return {}

        # Build parent → children map from link rows
        parent_to_children: Dict[str, List[str]] = {}
        for row in rows:
            parent_id = row["parent_node_id"]
            child_id = row["child_node_id"]
            parent_to_children.setdefault(parent_id, []).append(child_id)

        # Build reverse index: node_id → device_id for all resolved devices
        node_to_device: Dict[str, str] = {}
        for dev_id, nid in resolved.items():
            if nid:
                node_to_device[nid] = dev_id

        # Map back from event device_ids, translating children from node_id
        # space into device_id space.  Children not in the input set are
        # resolved via node_id_to_device_id() (strips known prefixes).
        result: Dict[str, List[str]] = {}
        for device_id, node_id in resolved.items():
            if node_id and node_id in parent_to_children:
                child_device_ids = []
                for cid in parent_to_children[node_id]:
                    if cid in node_to_device:
                        child_device_ids.append(node_to_device[cid])
                    else:
                        child_device_ids.append(node_id_to_device_id(cid))
                result[device_id] = child_device_ids

        return result

    async def get_parent_map(self, device_ids: Set[str]) -> Dict[str, str]:
        """
        For each device_id, find its direct parent in the links table.

        Returns { child_device_id: parent_device_id }, using the caller's own
        device_id spelling as the key so the cascade rule can match events
        without re-resolving. Parents are returned in device_id space.

        This is what lets a cascade be rooted at a device that never emitted an
        event — an LLDP-discovered switch has no telemetry of its own, so it can
        only ever be identified as the shared parent of its children.
        """
        if not device_ids or not db.pool:
            return {}

        resolved = await self.batch_resolve_node_ids(device_ids)
        node_ids = [nid for nid in resolved.values() if nid]
        if not node_ids:
            return {}

        try:
            rows = await db.fetch(
                """
                SELECT parent_node_id, child_node_id
                FROM links
                WHERE child_node_id = ANY($1)
                """,
                node_ids,
            )
        except Exception:
            logger.warning("get_parent_map link query failed", exc_info=True)
            return {}

        if not rows:
            return {}

        parent_of_node: Dict[str, str] = {
            row["child_node_id"]: row["parent_node_id"] for row in rows
        }
        node_to_device: Dict[str, str] = {
            nid: dev_id for dev_id, nid in resolved.items() if nid
        }

        result: Dict[str, str] = {}
        for device_id, node_id in resolved.items():
            parent_node = parent_of_node.get(node_id) if node_id else None
            if not parent_node:
                continue
            result[device_id] = node_to_device.get(
                parent_node, node_id_to_device_id(parent_node)
            )
        return result

    async def get_all_descendants(
        self, device_id: str, max_depth: int = 5
    ) -> List[str]:
        """
        Recursively find all descendants of device_id.

        Returns event device_ids (not topology node_ids) so the result
        can be used directly by the cascade rule's event-matching logic.
        """
        node_id = await resolve_node_id(device_id)
        if not node_id:
            return []
        child_node_ids = await get_devices_under_node(node_id, max_depth=max_depth)
        return [node_id_to_device_id(cid) for cid in child_node_ids]

    async def get_all_descendants_bulk(
        self, device_ids: Set[str], max_depth: int = 10
    ) -> Dict[str, List[str]]:
        """
        Batch recursive CTE: find all multi-hop descendants for a set of device_ids
        in a single SQL query with loop-protection.
        """
        if not device_ids or not db.pool:
            return {}

        resolved = await self.batch_resolve_node_ids(device_ids)
        node_ids = [nid for nid in resolved.values() if nid]
        if not node_ids:
            return {}

        try:
            rows = await db.fetch(
                """
                WITH RECURSIVE downstream AS (
                    SELECT parent_node_id AS root_id, child_node_id AS node_id, ARRAY[parent_node_id] AS path, 1 AS depth
                    FROM links
                    WHERE parent_node_id = ANY($1::text[])
                    UNION
                    SELECT d.root_id, l.child_node_id, d.path || l.parent_node_id, d.depth + 1
                    FROM links l
                    JOIN downstream d ON l.parent_node_id = d.node_id
                    WHERE d.depth < $2
                      AND NOT (l.child_node_id = ANY(d.path))
                )
                SELECT DISTINCT root_id, node_id FROM downstream
                """,
                node_ids,
                max_depth,
            )
        except Exception:
            logger.warning("get_all_descendants_bulk query failed", exc_info=True)
            return {}

        root_to_children: Dict[str, List[str]] = {}
        for r in rows:
            root_to_children.setdefault(r["root_id"], []).append(r["node_id"])

        result: Dict[str, List[str]] = {}
        for dev_id, nid in resolved.items():
            if nid and nid in root_to_children:
                result[dev_id] = [node_id_to_device_id(c) for c in root_to_children[nid]]

        return result
