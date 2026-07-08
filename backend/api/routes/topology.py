"""
Topology API Routes

REST endpoints for querying the network topology graph.
Serves nodes and edges from the `topology_nodes` and `topology_edges` tables
(populated by topology_sync.py and SNMP pollers).
"""

import logging
from typing import List, Optional, Set

from fastapi import APIRouter, HTTPException, Query, status

from api.models.topology_models import (
    BlastRadiusResponse,
    TopologyEdge,
    TopologyGraphResponse,
    TopologyNode,
    TopologyNodeDetail,
    TopologySummaryResponse,
)
from shared.database.client import db
from shared.database.topology import resolve_node_id as resolve_topology_node_id

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/topology",
    tags=["topology"],
    responses={
        404: {"description": "Node not found"},
        500: {"description": "Internal server error"},
    },
)

_NODES_QUERY = """
    SELECT node_id, node_type, name, ip_address, vendor, model, site_id, props, updated_at
    FROM topology_nodes
    ORDER BY node_type ASC, name ASC
"""

_EDGES_QUERY = """
    SELECT src_id, dst_id, edge_type, props, updated_at
    FROM topology_edges
    ORDER BY src_id ASC, dst_id ASC
"""

_NODE_BY_ID_QUERY = """
    SELECT node_id, node_type, name, ip_address, vendor, model, site_id, props, updated_at
    FROM topology_nodes
    WHERE node_id = $1
"""

_NODES_BY_IDS_QUERY = """
    SELECT node_id, node_type, name, ip_address, vendor, model, site_id, props, updated_at
    FROM topology_nodes
    WHERE node_id = ANY($1::text[])
"""

_SUMMARY_QUERY = """
    SELECT
        COUNT(*) AS total_nodes,
        (SELECT COUNT(*) FROM topology_edges) AS total_edges,
        MAX(updated_at) AS last_updated
    FROM topology_nodes
"""

_NODE_COUNT_BY_TYPE = """
    SELECT node_type, COUNT(*) AS cnt
    FROM topology_nodes
    GROUP BY node_type
    ORDER BY cnt DESC
"""

_NODE_COUNT_BY_VENDOR = """
    SELECT COALESCE(NULLIF(vendor, ''), 'unknown') AS vendor, COUNT(*) AS cnt
    FROM topology_nodes
    GROUP BY vendor
    ORDER BY cnt DESC
"""

_SITE_NAME_QUERY = """
    SELECT DISTINCT site_id, site_name
    FROM inventory
    WHERE site_id = ANY($1::text[])
"""

_HEALTH_EVENTS_QUERY = """
    SELECT device_id, severity, MAX(timestamp) AS latest_at
    FROM events
    WHERE device_id = ANY($1::text[])
      AND timestamp > NOW() - INTERVAL '15 minutes'
      AND severity IN ('critical', 'major')
    GROUP BY device_id, severity
    ORDER BY device_id, severity DESC
"""

_HEALTH_INVENTORY_QUERY = """
    SELECT device_id, reachability
    FROM inventory
    WHERE device_id = ANY($1::text[])
"""

_HEALTH_NODE_PROPS_QUERY = """
    SELECT node_id, props->>'reachability' AS reachability,
           (props->>'connected')::boolean AS connected
    FROM topology_nodes
    WHERE node_id = ANY($1::text[])
      AND props IS NOT NULL
      AND props != '{}'::jsonb
"""

# Infrastructure device types (potential root causes)
_INFRASTRUCTURE_TYPES = {
    "switch", "core_switch", "distribution_switch", "access_switch",
    "router", "wan_edge", "gateway", "firewall", "controller",
}

_EDGES_FROM_SRC_IDS = """
    SELECT src_id, dst_id, edge_type, props, updated_at
    FROM topology_edges
    WHERE src_id = ANY($1::text[])
"""

_EDGES_TO_DST_IDS = """
    SELECT src_id, dst_id, edge_type, props, updated_at
    FROM topology_edges
    WHERE dst_id = ANY($1::text[])
"""

_HEALTH_META = {
    "healthy": {"status": "healthy", "label": "Healthy"},
    "warning": {"status": "warning", "label": "Warning"},
    "critical": {"status": "critical", "label": "Critical"},
    "unknown": {"status": "unknown", "label": "Unknown"},
}


def _extract_event_device_id(node_id: str) -> str:
    """Map a topology node_id back to the raw device_id used in events."""
    for prefix in ("mist-ap-", "velo-edge-", "mist-site-", "velo-site-", "switch-"):
        if node_id.startswith(prefix):
            return node_id[len(prefix):]
    return node_id


async def _enrich_health(nodes: List[TopologyNode]) -> None:
    """Derive live health status for each node from recent events and inventory."""
    if not nodes or not db.pool:
        return

    device_map = {n.node_id: _extract_event_device_id(n.node_id) for n in nodes}
    unique_device_ids = list(set(device_map.values()))
    if not unique_device_ids:
        return

    try:
        # Query recent events
        event_rows = await db.fetch(_HEALTH_EVENTS_QUERY, unique_device_ids)
        worst_severity: dict = {}
        for row in event_rows:
            dev_id = row["device_id"]
            sev = row["severity"]
            existing = worst_severity.get(dev_id)
            if existing is None or (sev == "critical" and existing != "critical"):
                worst_severity[dev_id] = sev

        # Query inventory reachability
        inventory_rows = await db.fetch(_HEALTH_INVENTORY_QUERY, unique_device_ids)
        inv_reachability: dict = {}
        for row in inventory_rows:
            inv_reachability[row["device_id"]] = row["reachability"]

        # Query topology node props for reachability/connected
        props_rows = await db.fetch(_HEALTH_NODE_PROPS_QUERY, list(device_map.keys()))
        props_health: dict = {}
        for row in props_rows:
            reachable = row["reachability"]
            connected = row["connected"]
            if reachable == "unreachable":
                props_health[row["node_id"]] = "critical"
            elif connected is False:
                props_health[row["node_id"]] = "critical"
            elif reachable == "reachable" or connected is True:
                props_health[row["node_id"]] = "healthy"

        # Compute health for each node
        for node in nodes:
            dev_id = device_map.get(node.node_id, node.node_id)

            if dev_id in worst_severity and worst_severity[dev_id] == "critical":
                node.health_status = "critical"
                node.health_label = "Critical"
                continue

            if node.node_id in props_health:
                if props_health[node.node_id] == "critical":
                    node.health_status = "critical"
                    node.health_label = "Critical"
                    continue
                if props_health[node.node_id] == "healthy":
                    node.health_status = "healthy"
                    node.health_label = "Healthy"
                    continue

            if dev_id in inv_reachability and inv_reachability[dev_id] == "unreachable":
                node.health_status = "critical"
                node.health_label = "Critical"
                continue

            if dev_id in worst_severity and worst_severity[dev_id] == "major":
                node.health_status = "warning"
                node.health_label = "Warning"
                continue

            if dev_id in inv_reachability and inv_reachability[dev_id] == "reachable":
                node.health_status = "healthy"
                node.health_label = "Healthy"
                continue

            node.health_status = "unknown"
            node.health_label = "Unknown"
    except Exception:
        logger.warning("Failed to enrich node health", exc_info=True)


def _row_to_node(row) -> TopologyNode:
    return TopologyNode(
        node_id=row["node_id"],
        node_type=row["node_type"],
        name=row["name"] or "",
        ip_address=row["ip_address"] or "",
        vendor=row["vendor"] or "",
        model=row["model"] or "",
        site_id=row["site_id"] or "",
        site_name=None,
    )


def _row_to_edge(row) -> TopologyEdge:
    return TopologyEdge(
        src_id=row["src_id"],
        dst_id=row["dst_id"],
        edge_type=row["edge_type"] or "wired",
    )


async def _enrich_site_names(nodes: list[TopologyNode]) -> None:
    """Fill in site_name from inventory for nodes that have a site_id."""
    site_ids = list({n.site_id for n in nodes if n.site_id})
    if not site_ids:
        return
    try:
        rows = await db.fetch(_SITE_NAME_QUERY, site_ids)
        site_map = {r["site_id"]: r["site_name"] for r in rows}
        for node in nodes:
            if node.site_id in site_map:
                node.site_name = site_map[node.site_id] or node.site_id
    except Exception:
        logger.warning("Failed to enrich site names from inventory", exc_info=True)


@router.get("", response_model=TopologyGraphResponse, summary="Get full topology graph")
async def get_topology(
    site_id: Optional[str] = Query(None, description="Filter nodes by site ID"),
    node_type: Optional[str] = Query(None, description="Filter nodes by type"),
) -> TopologyGraphResponse:
    try:
        if not db.pool:
            return TopologyGraphResponse()

        if site_id or node_type:
            conditions = []
            params = []
            if site_id:
                params.append(site_id)
                conditions.append(f"AND site_id = ${len(params)}")
            if node_type:
                params.append(node_type)
                conditions.append(f"AND node_type = ${len(params)}")
            where = " ".join(conditions)
            nodes_query = _NODES_QUERY.replace("ORDER BY", f"{where} ORDER BY")
            rows = await db.fetch(nodes_query, *params)
        else:
            rows = await db.fetch(_NODES_QUERY)

        nodes = [_row_to_node(r) for r in rows]
        await _enrich_site_names(nodes)
        await _enrich_health(nodes)

        if not nodes:
            return TopologyGraphResponse()

        node_ids = {n.node_id for n in nodes}

        edges_rows = await db.fetch(_EDGES_QUERY)
        edges = [
            _row_to_edge(e)
            for e in edges_rows
            if e["src_id"] in node_ids or e["dst_id"] in node_ids
        ]

        return TopologyGraphResponse(
            nodes=nodes,
            edges=edges,
            total_nodes=len(nodes),
            total_edges=len(edges),
        )
    except Exception as exc:
        logger.error("Error fetching topology: %s", exc, exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")


@router.get("/summary", response_model=TopologySummaryResponse, summary="Get topology summary")
async def get_topology_summary() -> TopologySummaryResponse:
    try:
        if not db.pool:
            return TopologySummaryResponse()

        summary_row = await db.fetchrow(_SUMMARY_QUERY)
        if not summary_row:
            return TopologySummaryResponse()

        type_rows = await db.fetch(_NODE_COUNT_BY_TYPE)
        vendor_rows = await db.fetch(_NODE_COUNT_BY_VENDOR)

        return TopologySummaryResponse(
            node_count=int(summary_row["total_nodes"]) if summary_row["total_nodes"] else 0,
            edge_count=int(summary_row["total_edges"]) if summary_row["total_edges"] else 0,
            by_type={r["node_type"]: int(r["cnt"]) for r in type_rows},
            by_vendor={r["vendor"]: int(r["cnt"]) for r in vendor_rows},
            last_updated=summary_row["last_updated"],
        )
    except Exception as exc:
        logger.error("Error fetching topology summary: %s", exc, exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")


@router.get(
    "/nodes/{node_id}",
    response_model=TopologyNodeDetail,
    summary="Get a single topology node with its neighbours",
)
async def get_topology_node(node_id: str) -> TopologyNodeDetail:
    try:
        if not db.pool:
            raise HTTPException(status_code=503, detail="Database not connected")

        row = await db.fetchrow(_NODE_BY_ID_QUERY, node_id)
        if not row:
            raise HTTPException(status_code=404, detail=f"Node not found: {node_id}")

        node = _row_to_node(row)
        parents_rows = await db.fetch(
            """
            SELECT n.node_id, n.node_type, n.name, n.ip_address,
                   n.vendor, n.model, n.site_id, n.props, n.updated_at
            FROM topology_edges e
            JOIN topology_nodes n ON n.node_id = e.dst_id
            WHERE e.src_id = $1
            """,
            node_id,
        )
        children_rows = await db.fetch(
            """
            SELECT n.node_id, n.node_type, n.name, n.ip_address,
                   n.vendor, n.model, n.site_id, n.props, n.updated_at
            FROM topology_edges e
            JOIN topology_nodes n ON n.node_id = e.src_id
            WHERE e.dst_id = $1
            """,
            node_id,
        )

        parents = [_row_to_node(r) for r in parents_rows]
        children = [_row_to_node(r) for r in children_rows]

        all_nodes = [node] + parents + children
        await _enrich_site_names(all_nodes)
        await _enrich_health(all_nodes)

        return TopologyNodeDetail(
            node=node,
            parents=parents,
            children=children,
        )
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("Error fetching node %s: %s", node_id, exc, exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")


@router.get(
    "/blast-radius/{incident_id}",
    response_model=BlastRadiusResponse,
    summary="Get blast radius subgraph for an incident",
)
async def get_blast_radius(incident_id: str) -> BlastRadiusResponse:
    """
    Build a topology subgraph for an incident's blast radius.

    Takes the affected device IDs from the incident, resolves them to topology
    node IDs, fetches the subgraph (nodes + edges), and identifies which nodes
    are root causes vs symptoms.
    """
    try:
        if not db.pool:
            raise HTTPException(status_code=503, detail="Database not connected")

        from api.services.incident_service import incident_service

        incident = await incident_service.get_incident(incident_id)
        if not incident:
            raise HTTPException(status_code=404, detail=f"Incident not found: {incident_id}")

        affected_device_ids = list(incident.affected_devices)
        if not affected_device_ids:
            return BlastRadiusResponse()

        resolved_node_ids: List[str] = []
        for did in affected_device_ids:
            nid = await resolve_topology_node_id(did)
            if nid:
                resolved_node_ids.append(nid)

        if not resolved_node_ids:
            # Fallback: treat device_ids as direct node_ids
            resolved_node_ids = affected_device_ids

        # Fetch resolved nodes
        node_rows = await db.fetch(_NODES_BY_IDS_QUERY, resolved_node_ids)
        nodes = {r["node_id"]: _row_to_node(r) for r in node_rows}

        if not nodes:
            return BlastRadiusResponse()

        # Fetch edges where resolved nodes are src or dst
        src_edges = await db.fetch(_EDGES_FROM_SRC_IDS, resolved_node_ids)
        dst_edges = await db.fetch(_EDGES_TO_DST_IDS, resolved_node_ids)

        # Also fetch parent nodes (upstream) for context
        parent_node_ids: Set[str] = set()
        for e in src_edges:
            if e["dst_id"] not in nodes:
                parent_node_ids.add(e["dst_id"])
        for e in dst_edges:
            if e["src_id"] not in nodes:
                parent_node_ids.add(e["src_id"])

        if parent_node_ids:
            parent_rows = await db.fetch(_NODES_BY_IDS_QUERY, list(parent_node_ids))
            for r in parent_rows:
                nodes[r["node_id"]] = _row_to_node(r)

        # Fetch edges connecting the full set
        all_node_ids = list(nodes.keys())
        all_src_edges = await db.fetch(_EDGES_FROM_SRC_IDS, all_node_ids)
        all_dst_edges = await db.fetch(_EDGES_TO_DST_IDS, all_node_ids)

        seen_pairs: set = set()
        edges: list = []
        for e in all_src_edges + all_dst_edges:
            pair = (e["src_id"], e["dst_id"])
            if pair not in seen_pairs:
                seen_pairs.add(pair)
                edges.append(_row_to_edge(e))

        node_list = list(nodes.values())
        await _enrich_site_names(node_list)
        await _enrich_health(node_list)

        # Determine root cause vs symptom nodes
        resolved_set = set(resolved_node_ids)
        root_cause_ids: List[str] = []
        symptom_ids: List[str] = []

        for nid in resolved_set:
            if nid not in nodes:
                continue
            node_type = nodes[nid].node_type.lower()
            if node_type in _INFRASTRUCTURE_TYPES:
                has_children = any(
                    e.dst_id == nid and e.src_id in resolved_set
                    for e in edges
                )
                if has_children:
                    root_cause_ids.append(nid)
                    continue
            symptom_ids.append(nid)

        return BlastRadiusResponse(
            nodes=node_list,
            edges=edges,
            total_nodes=len(node_list),
            total_edges=len(edges),
            root_cause_node_ids=root_cause_ids,
            symptom_node_ids=symptom_ids,
        )
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("Error fetching blast radius for %s: %s", incident_id, exc, exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")
