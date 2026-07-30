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
    HealthSnapshot,
    NodeHealthHistoryResponse,
    SiteDeviceTypeBreakdown,
    SiteHealthCounts,
    SiteSummaryResponse,
    TopologyBackboneNode,
    TopologyBackboneResponse,
    TopologyEdge,
    TopologyGraphResponse,
    TopologyNode,
    TopologyNodeDetail,
    TopologySummaryResponse,
)
from shared.database.client import db
from shared.database.health_history import get_health_history, get_health_summary
from shared.database.topology import DatabaseTopologyProvider
from shared.health import (
    compute_node_health,
    extract_event_device_id,
    is_infrastructure_type,
)

logger = logging.getLogger(__name__)

_topology_provider = DatabaseTopologyProvider()

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

_SITE_NODES_QUERY = """
    SELECT node_id, node_type, name, ip_address, vendor, model, site_id, props, updated_at
    FROM topology_nodes
    WHERE node_type = 'site'
    ORDER BY name ASC
"""

_SITE_DEVICE_COUNTS_QUERY = """
    SELECT site_id, COUNT(*) AS device_count
    FROM topology_nodes
    WHERE node_type != 'site' AND site_id IS NOT NULL AND site_id != ''
    GROUP BY site_id
"""

_CHILD_NODES_BY_SITE = """
    SELECT node_id, site_id, node_type, name, ip_address, vendor, model, props, updated_at
    FROM topology_nodes
    WHERE node_type != 'site' AND site_id IS NOT NULL AND site_id != ''
    ORDER BY site_id
"""

_INTER_SITE_EDGES_QUERY = """
    SELECT DISTINCT e.src_id, e.dst_id, e.edge_type, e.props, e.updated_at
    FROM topology_edges e
    JOIN topology_nodes n1 ON e.src_id = n1.node_id
    JOIN topology_nodes n2 ON e.dst_id = n2.node_id
    WHERE n1.site_id IS NOT NULL AND n1.site_id != ''
      AND n2.site_id IS NOT NULL AND n2.site_id != ''
      AND n1.site_id != n2.site_id
      AND e.edge_type != 'site_membership'
    ORDER BY e.src_id ASC, e.dst_id ASC
"""

_NODES_BY_SITE_QUERY = """
    SELECT node_id, node_type, name, ip_address, vendor, model, site_id, props, updated_at
    FROM topology_nodes
    WHERE site_id = $1
    ORDER BY node_type ASC, name ASC
"""

_EDGES_FOR_SITE_IDS = """
    SELECT e.src_id, e.dst_id, e.edge_type, e.props, e.updated_at
    FROM topology_edges e
    JOIN topology_nodes n1 ON e.src_id = n1.node_id
    JOIN topology_nodes n2 ON e.dst_id = n2.node_id
    WHERE (n1.site_id = $1 OR n2.site_id = $1)
    ORDER BY e.src_id ASC, e.dst_id ASC
"""

_SITE_DEVICE_TYPE_BREAKDOWN = """
    SELECT node_type, COUNT(*) AS cnt
    FROM topology_nodes
    WHERE site_id = $1 AND node_type != 'site'
    GROUP BY node_type
    ORDER BY cnt DESC
"""

_SITE_DEVICE_VENDOR_BREAKDOWN = """
    SELECT COALESCE(NULLIF(vendor, ''), 'unknown') AS vendor, COUNT(*) AS cnt
    FROM topology_nodes
    WHERE site_id = $1 AND node_type != 'site'
    GROUP BY vendor
    ORDER BY cnt DESC
"""



async def _enrich_health(nodes: List[TopologyNode]) -> None:
    """Derive live health status for each node from recent events and inventory."""
    if not nodes or not db.pool:
        return

    device_map = {n.node_id: extract_event_device_id(n.node_id) for n in nodes}
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
        props_reachability: dict = {}
        props_connected: dict = {}
        for row in props_rows:
            props_reachability[row["node_id"]] = row["reachability"]
            props_connected[row["node_id"]] = row["connected"]

        # Compute health for each node using shared module
        for node in nodes:
            dev_id = device_map.get(node.node_id, node.node_id)
            status, label, _ = compute_node_health(
                node_id=node.node_id,
                device_id=dev_id,
                worst_event_severity=worst_severity.get(dev_id),
                inventory_reachability=inv_reachability.get(dev_id),
                props_reachability=props_reachability.get(node.node_id),
                props_connected=props_connected.get(node.node_id),
            )
            node.health_status = status
            node.health_label = label
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
                conditions.append(f"site_id = ${len(params)}")
            if node_type:
                params.append(node_type)
                conditions.append(f"node_type = ${len(params)}")
            where = "WHERE " + " AND ".join(conditions)
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

        if site_id or node_type:
            edges_rows = await db.fetch(_EDGES_FROM_SRC_IDS, list(node_ids))
            edges_rows_b = await db.fetch(_EDGES_TO_DST_IDS, list(node_ids))
            seen = set()
            edges = []
            for e in edges_rows + edges_rows_b:
                pair = (e["src_id"], e["dst_id"])
                if pair not in seen:
                    seen.add(pair)
                    edges.append(_row_to_edge(e))
        else:
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


@router.get(
    "/backbone",
    response_model=TopologyBackboneResponse,
    summary="Get backbone topology — site nodes + inter-site edges only",
)
async def get_topology_backbone() -> TopologyBackboneResponse:
    """Return only site nodes and the edges that connect different sites.

    This is the default landing view for the topology page. Instead of loading
    all 2000+ devices, the UI shows 100-200 sites with inter-site links. Users
    click a site to drill into its internal topology.
    """
    try:
        if not db.pool:
            return TopologyBackboneResponse()

        site_rows = await db.fetch(_SITE_NODES_QUERY)
        if not site_rows:
            return TopologyBackboneResponse()

        site_ids_list = [r["site_id"] for r in site_rows if r["site_id"]]
        count_rows = await db.fetch(_SITE_DEVICE_COUNTS_QUERY) if site_ids_list else []
        device_counts = {r["site_id"]: int(r["device_count"]) for r in count_rows}

        child_rows = await db.fetch(_CHILD_NODES_BY_SITE) if site_ids_list else []
        child_nodes_by_site: dict = {}
        for cr in child_rows:
            sid = cr["site_id"] or ""
            if sid not in child_nodes_by_site:
                child_nodes_by_site[sid] = []
            child_nodes_by_site[sid].append(_row_to_node(cr))

        # Compute health for child devices once, then count per site
        all_child_nodes = []
        for sid in child_nodes_by_site:
            all_child_nodes.extend(child_nodes_by_site[sid])
        await _enrich_health(all_child_nodes)

        health_counts: dict = {}
        for node in all_child_nodes:
            sid = node.site_id
            if sid not in health_counts:
                health_counts[sid] = {"critical_count": 0, "warning_count": 0}
            if node.health_status == "critical":
                health_counts[sid]["critical_count"] += 1
            elif node.health_status == "warning":
                health_counts[sid]["warning_count"] += 1

        nodes = []
        for r in site_rows:
            sid = r["site_id"] or ""
            hc = health_counts.get(sid, {"critical_count": 0, "warning_count": 0})
            bn = TopologyBackboneNode(
                node_id=r["node_id"],
                node_type=r["node_type"],
                name=r["name"] or "",
                ip_address=r["ip_address"] or "",
                vendor=r["vendor"] or "",
                model=r["model"] or "",
                site_id=sid,
                site_name=None,
                device_count=device_counts.get(sid, 0),
                critical_count=hc["critical_count"],
                warning_count=hc["warning_count"],
            )
            nodes.append(bn)

        await _enrich_site_names(nodes)
        await _enrich_health(nodes)

        edges_rows = await db.fetch(_INTER_SITE_EDGES_QUERY)
        edges = [_row_to_edge(e) for e in edges_rows]

        return TopologyBackboneResponse(
            nodes=nodes,
            edges=edges,
            total_nodes=len(nodes),
            total_edges=len(edges),
        )
    except Exception as exc:
        logger.error("Error fetching backbone topology: %s", exc, exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")


@router.get(
    "/sites/{site_id}/internal",
    response_model=TopologyGraphResponse,
    summary="Get internal topology for a single site",
)
async def get_site_internal_topology(site_id: str) -> TopologyGraphResponse:
    """Return all nodes and edges inside a single site.

    Called when the user clicks a site node in the backbone view, or when
    navigating directly to /topology?site_id=<id>.
    """
    try:
        if not db.pool:
            return TopologyGraphResponse()

        node_rows = await db.fetch(_NODES_BY_SITE_QUERY, site_id)
        if not node_rows:
            return TopologyGraphResponse()

        nodes = [_row_to_node(r) for r in node_rows]
        await _enrich_site_names(nodes)
        await _enrich_health(nodes)

        node_ids_set = {n.node_id for n in nodes}
        # Include the site node itself if it exists in topology_nodes
        site_node_rows = await db.fetch(_NODE_BY_ID_QUERY, site_id)
        if site_node_rows:
            sn = _row_to_node(site_node_rows[0])
            if sn.node_id not in node_ids_set:
                await _enrich_site_names([sn])
                await _enrich_health([sn])
                nodes.append(sn)
                node_ids_set.add(sn.node_id)
        # Also try the mist-site- prefixed variant
        mist_site_id = f"mist-site-{site_id}"
        if mist_site_id not in node_ids_set:
            mist_rows = await db.fetch(_NODE_BY_ID_QUERY, mist_site_id)
            if mist_rows:
                sn = _row_to_node(mist_rows[0])
                await _enrich_site_names([sn])
                await _enrich_health([sn])
                nodes.append(sn)
                node_ids_set.add(sn.node_id)

        edges_rows = await db.fetch(_EDGES_FOR_SITE_IDS, site_id)
        edges = [_row_to_edge(e) for e in edges_rows]

        return TopologyGraphResponse(
            nodes=nodes,
            edges=edges,
            total_nodes=len(nodes),
            total_edges=len(edges),
        )
    except Exception as exc:
        logger.error("Error fetching site internal topology for %s: %s", site_id, exc, exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")


@router.get(
    "/sites/{site_id}/summary",
    response_model=SiteSummaryResponse,
    summary="Get summary for a single site — device counts by type, vendor, and health",
)
async def get_site_summary(site_id: str) -> SiteSummaryResponse:
    """Return a summary of devices within a site: type breakdown, vendor breakdown, health breakdown."""
    try:
        if not db.pool:
            return SiteSummaryResponse(site_id=site_id)

        type_rows = await db.fetch(_SITE_DEVICE_TYPE_BREAKDOWN, site_id)
        vendor_rows = await db.fetch(_SITE_DEVICE_VENDOR_BREAKDOWN, site_id)

        # Fetch child nodes and compute health in Python (health_status is not a DB column)
        child_node_rows = await db.fetch(_NODES_BY_SITE_QUERY, site_id)
        child_nodes = [_row_to_node(r) for r in child_node_rows if r["node_type"] != "site"]
        await _enrich_health(child_nodes)

        # Resolve site name
        site_name = None
        try:
            name_rows = await db.fetch(_SITE_NAME_QUERY, [site_id])
            if name_rows:
                site_name = name_rows[0]["site_name"] or site_id
        except Exception:
            pass

        by_type = [
            SiteDeviceTypeBreakdown(type=r["node_type"], count=int(r["cnt"]))
            for r in type_rows
        ]
        by_vendor = [
            SiteDeviceTypeBreakdown(type=r["vendor"], count=int(r["cnt"]))
            for r in vendor_rows
        ]

        health_map: dict = {"healthy": 0, "warning": 0, "critical": 0, "unknown": 0}
        for node in child_nodes:
            status = node.health_status or "unknown"
            health_map[status] = health_map.get(status, 0) + 1
        total_devices = sum(health_map.values())

        return SiteSummaryResponse(
            site_id=site_id,
            site_name=site_name,
            total_devices=total_devices,
            health=SiteHealthCounts(
                healthy_count=health_map.get("healthy", 0),
                warning_count=health_map.get("warning", 0),
                critical_count=health_map.get("critical", 0),
                unknown_count=health_map.get("unknown", 0),
            ),
            by_type=by_type,
            by_vendor=by_vendor,
        )
    except Exception as exc:
        logger.error("Error fetching site summary for %s: %s", site_id, exc, exc_info=True)
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
    "/nodes/{node_id}/health-history",
    response_model=NodeHealthHistoryResponse,
    summary="Get health history timeline for a topology node",
)
async def get_node_health_history(
    node_id: str,
    hours_back: int = Query(24, ge=1, le=168, description="Hours of history to return"),
    limit: int = Query(500, ge=1, le=2000, description="Max snapshots to return"),
) -> NodeHealthHistoryResponse:
    try:
        if not db.pool:
            raise HTTPException(status_code=503, detail="Database not connected")

        # Verify node exists
        row = await db.fetchrow("SELECT node_id FROM topology_nodes WHERE node_id = $1", node_id)
        if not row:
            raise HTTPException(status_code=404, detail=f"Node not found: {node_id}")

        history = await get_health_history(node_id, hours_back=hours_back, limit=limit)
        summary = await get_health_summary(node_id, hours_back=hours_back)

        return NodeHealthHistoryResponse(
            node_id=node_id,
            history=[
                HealthSnapshot(
                    snapshot_at=h["snapshot_at"],
                    health_status=h["health_status"],
                    health_label=h["health_label"],
                    derived_from=h["derived_from"],
                )
                for h in history
            ],
            summary=summary,
        )
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("Error fetching health history for %s: %s", node_id, exc, exc_info=True)
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

        resolved_map = await _topology_provider.batch_resolve_node_ids(
            set(affected_device_ids)
        )
        # Preserve incident device order; dedupe while keeping first occurrence.
        resolved_node_ids: List[str] = []
        _seen_nids: Set[str] = set()
        for did in affected_device_ids:
            nid = resolved_map.get(did)
            if nid and nid not in _seen_nids:
                _seen_nids.add(nid)
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
            if is_infrastructure_type(node_type):
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
            incident_id=incident.incident_id,
            incident_title=incident.title,
            incident_severity=incident.severity.value,
            incident_status=incident.status.value,
            incident_confidence=incident.confidence_score,
            incident_created_at=incident.created_at,
            incident_updated_at=incident.updated_at,
        )
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("Error fetching blast radius for %s: %s", incident_id, exc, exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")
