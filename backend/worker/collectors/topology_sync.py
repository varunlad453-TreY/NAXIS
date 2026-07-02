"""
Topology Sync

Builds and maintains the topology graph (topology_nodes + topology_edges tables)
from all available vendor data sources.

Why topology matters:
  Raw inventory tells you what devices exist. Topology tells you how they
  connect — which edge uplinks to which gateway, which APs share a switch,
  which sites are reachable through which WAN links. Without topology:
    - You cannot do blast-radius analysis (which sites are affected if link X fails)
    - You cannot do root-cause analysis (is the fault upstream or on the device?)
    - You cannot visualize the network

Sources and what each provides:
  Juniper Mist  → AP nodes per site; site nodes; AP → Site membership edges
  VeloCloud     → Edge nodes; WAN link edges (overlay tunnels); site nodes
  SNMP          → Switch/router nodes; physical links via LLDP/CDP (already
                  written by SnmpPoller during its poll cycle)

Node types:
  site    → logical grouping (Mist site, VeloCloud site)
  ap      → Juniper Mist access point
  edge    → VeloCloud SD-WAN edge
  switch  → SNMP-polled switch or router

Edge types:
  site_membership  → device belongs to site
  wan_link         → VeloCloud overlay WAN link between edge and gateway/internet
  physical_link    → LLDP/CDP-discovered switch-to-switch or switch-to-AP connection
"""

import json
import logging
from datetime import datetime, timezone
from typing import Any, Dict, List

from config.settings import get_settings
from shared.database.client import db

logger = logging.getLogger(__name__)


class TopologySync:
    """
    Syncs topology_nodes and topology_edges from all vendor sources.

    Called once per collection cycle from the worker daemon.
    SNMP LLDP/CDP edges are written directly by SnmpPoller — this class
    handles Mist and VeloCloud topology.
    """

    def __init__(self):
        settings = get_settings()
        self._mist_enabled = settings.mist_enabled
        self._velo_enabled = settings.velocloud_enabled

    async def sync(self) -> None:
        if self._mist_enabled:
            await self._sync_mist_topology()
        if self._velo_enabled:
            await self._sync_velocloud_topology()
        logger.info("Topology sync complete")

    # ── Mist topology ─────────────────────────────────────────────────────────

    async def _sync_mist_topology(self) -> None:
        """
        Builds topology from the inventory table for platform='mist'.

        Creates:
          - One 'site' node per distinct site_id
          - One 'ap' node per AP device
          - 'site_membership' edge from each AP to its site
        """
        rows = await db.fetch(
            "SELECT device_id, hostname, ip_address, model, site_id, site_name, "
            "       connected, num_clients, firmware_version "
            "FROM inventory WHERE platform = 'mist'"
        )
        if not rows:
            return

        # Collect unique sites
        sites: Dict[str, str] = {}  # site_id → site_name
        for row in rows:
            if row["site_id"]:
                sites[row["site_id"]] = row["site_name"] or row["site_id"]

        # Upsert site nodes
        for site_id, site_name in sites.items():
            await _upsert_node(
                node_id=f"mist-site-{site_id}",
                node_type="site",
                name=site_name,
                vendor="mist",
                site_id=site_id,
                props={"platform": "mist"},
            )

        # Upsert AP nodes + site_membership edges
        for row in rows:
            ap_node_id = f"mist-ap-{row['device_id']}"
            await _upsert_node(
                node_id=ap_node_id,
                node_type="ap",
                name=row["hostname"] or row["device_id"],
                ip_address=row["ip_address"] or "",
                vendor="mist",
                model=row["model"] or "",
                site_id=row["site_id"] or "",
                props={
                    "connected": bool(row["connected"]),
                    "num_clients": row["num_clients"] or 0,
                    "firmware": row["firmware_version"] or "",
                    "platform": "mist",
                },
            )

            if row["site_id"]:
                site_node_id = f"mist-site-{row['site_id']}"
                await _upsert_edge(
                    src_id=ap_node_id,
                    dst_id=site_node_id,
                    edge_type="site_membership",
                    props={"platform": "mist"},
                )

        logger.info(
            "Mist topology: %d APs, %d sites upserted", len(rows), len(sites)
        )

    # ── VeloCloud topology ────────────────────────────────────────────────────

    async def _sync_velocloud_topology(self) -> None:
        """
        Builds topology from the inventory table for platform='velocloud'.

        Creates:
          - One 'site' node per distinct site_id
          - One 'edge' node per SD-WAN edge
          - 'site_membership' edge from each edge to its site
          - 'wan_link' edges from inventory.props.links for each WAN interface
        """
        rows = await db.fetch(
            "SELECT device_id, hostname, ip_address, model, site_id, site_name, "
            "       connected, reachability, firmware_version, props "
            "FROM inventory WHERE platform = 'velocloud'"
        )
        if not rows:
            return

        sites: Dict[str, str] = {}
        for row in rows:
            if row["site_id"]:
                sites[row["site_id"]] = row["site_name"] or row["site_id"]

        for site_id, site_name in sites.items():
            await _upsert_node(
                node_id=f"velo-site-{site_id}",
                node_type="site",
                name=site_name,
                vendor="velocloud",
                site_id=site_id,
                props={"platform": "velocloud"},
            )

        for row in rows:
            edge_node_id = f"velo-edge-{row['device_id']}"
            props_raw = row["props"] or {}
            if isinstance(props_raw, str):
                try:
                    props_raw = json.loads(props_raw)
                except Exception:
                    props_raw = {}

            links: List[Dict[str, Any]] = props_raw.get("links", [])
            velobrain_score: float = props_raw.get("velobrain_score", 0.0)

            await _upsert_node(
                node_id=edge_node_id,
                node_type="edge",
                name=row["hostname"] or row["device_id"],
                ip_address=row["ip_address"] or "",
                vendor="velocloud",
                model=row["model"] or "",
                site_id=row["site_id"] or "",
                props={
                    "connected": bool(row["connected"]),
                    "reachability": row["reachability"],
                    "firmware": row["firmware_version"] or "",
                    "velobrain_score": velobrain_score,
                    "wan_links": len(links),
                    "platform": "velocloud",
                },
            )

            if row["site_id"]:
                await _upsert_edge(
                    src_id=edge_node_id,
                    dst_id=f"velo-site-{row['site_id']}",
                    edge_type="site_membership",
                    props={"platform": "velocloud"},
                )

            # WAN link edges: edge → internet gateway (represented as a virtual node per ISP)
            for link in links:
                isp = link.get("isp") or link.get("name") or "unknown-isp"
                public_ip = link.get("public_ip") or ""
                gateway_node_id = f"wan-gw-{isp.lower().replace(' ', '-')[:40]}"

                await _upsert_node(
                    node_id=gateway_node_id,
                    node_type="wan_gateway",
                    name=f"WAN: {isp}",
                    ip_address=public_ip,
                    vendor="internet",
                    props={"isp": isp, "platform": "velocloud"},
                )

                link_state = link.get("state", "")
                await _upsert_edge(
                    src_id=edge_node_id,
                    dst_id=gateway_node_id,
                    edge_type="wan_link",
                    props={
                        "interface": link.get("interface", ""),
                        "isp": isp,
                        "state": link_state,
                        "score_tx": link.get("score_tx"),
                        "score_rx": link.get("score_rx"),
                        "latency_ms_tx": link.get("latency_ms_tx"),
                        "latency_ms_rx": link.get("latency_ms_rx"),
                        "loss_pct_tx": link.get("loss_pct_tx"),
                        "upstream_mbps": link.get("upstream_mbps"),
                        "downstream_mbps": link.get("downstream_mbps"),
                        "public_ip": public_ip,
                        "platform": "velocloud",
                        "discovered_by": "rest_api",
                    },
                )

        logger.info(
            "VeloCloud topology: %d edges, %d sites upserted",
            len(rows), len(sites),
        )


# ── Shared DB helpers ─────────────────────────────────────────────────────────

async def _upsert_node(
    node_id: str,
    node_type: str,
    name: str,
    ip_address: str = "",
    vendor: str = "",
    model: str = "",
    site_id: str = "",
    props: Dict[str, Any] = None,
) -> None:
    await db.execute(
        """
        INSERT INTO topology_nodes
            (node_id, node_type, name, ip_address, vendor, model, site_id, props, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, NOW())
        ON CONFLICT (node_id) DO UPDATE SET
            name       = EXCLUDED.name,
            ip_address = COALESCE(NULLIF(EXCLUDED.ip_address,''), topology_nodes.ip_address),
            vendor     = EXCLUDED.vendor,
            model      = COALESCE(NULLIF(EXCLUDED.model,''), topology_nodes.model),
            site_id    = COALESCE(NULLIF(EXCLUDED.site_id,''), topology_nodes.site_id),
            props      = EXCLUDED.props,
            updated_at = NOW()
        """,
        node_id, node_type, name, ip_address, vendor, model, site_id,
        json.dumps(props or {}),
    )


async def _upsert_edge(
    src_id: str,
    dst_id: str,
    edge_type: str,
    props: Dict[str, Any] = None,
) -> None:
    await db.execute(
        """
        INSERT INTO topology_edges (src_id, dst_id, edge_type, props, updated_at)
        VALUES ($1, $2, $3, $4::jsonb, NOW())
        ON CONFLICT (LEAST(src_id,dst_id), GREATEST(src_id,dst_id), edge_type)
        DO UPDATE SET props = EXCLUDED.props, updated_at = NOW()
        """,
        src_id, dst_id, edge_type, json.dumps(props or {}),
    )
