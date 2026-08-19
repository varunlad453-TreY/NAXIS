"""
Integration management service.

Status is derived from the live telemetry ledger rather than
maintained in memory. Each integration maps to one or more collector IDs
in the collector_run_ledger table.
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from typing import Any, Dict, List, Optional

from fastapi import HTTPException

try:
    from backend.config.settings import get_settings
    from backend.worker.collectors.mist import MistCollector
    from backend.worker.collectors.dnac import DNACCollector
    from backend.worker.collectors.velocloud import VeloCloudCollector
    from backend.worker.collectors.arista_wlc import AristaWlcCollector
except ImportError:
    from config.settings import get_settings
    from worker.collectors.mist import MistCollector
    from worker.collectors.dnac import DNACCollector
    from worker.collectors.velocloud import VeloCloudCollector
    from worker.collectors.arista_wlc import AristaWlcCollector

from api.models.integration_models import (
    IntegrationActionResponse,
    IntegrationCollectorSummary,
    IntegrationConfigGroup,
    IntegrationConfigItem,
    IntegrationConfigResponse,
    IntegrationDetailResponse,
    IntegrationListResponse,
    IntegrationStatus,
    IntegrationSummary,
)
from shared.database.collector_telemetry import list_collector_telemetry

logger = logging.getLogger(__name__)

_STALE_THRESHOLD = 600
_CRITICAL_THRESHOLD = 1800
_MAX_FAILURES = 3


def _mask(value: str) -> str:
    return "********" if value else "Not set"


@dataclass(frozen=True)
class IntegrationDefinition:
    id: str
    name: str
    vendor: str
    description: str
    icon: str
    coming_soon: bool = False


_INTEGRATIONS: Dict[str, IntegrationDefinition] = {
    "mist": IntegrationDefinition(
        id="mist", name="Juniper Mist", vendor="Juniper Networks",
        description="Wireless APs, sites, clients, and alarms via the Mist REST API.",
        icon="wifi",
    ),
    "dnac": IntegrationDefinition(
        id="dnac", name="Cisco DNA Center", vendor="Cisco",
        description="Wired infrastructure, topology, and assurance events from DNAC.",
        icon="router",
    ),
    "velocloud": IntegrationDefinition(
        id="velocloud", name="VeloCloud SD-WAN", vendor="Arista / VMware",
        description="Edge status, link metrics, and tunnel health from VeloCloud Orchestrator.",
        icon="cloud",
    ),
    "arista-wlc": IntegrationDefinition(
        id="arista-wlc", name="Arista Wireless Controller", vendor="Arista",
        description="Controller-based wireless telemetry and client events.",
        icon="radio",
    ),
}

# Static collector definitions per integration
_COLLECTOR_DEFS: Dict[str, List[Dict[str, Any]]] = {
    "mist": [
        {
            "id": "mist-events", "label": "Mist events collector",
            "collects": ["Alarms", "logs", "event payloads", "severity", "device/site context"],
            "purpose": "Normalizes Mist alarms and audit logs into the unified event stream.",
            "output": "Event ingestion and incident correlation",
            "why_it_matters": "Operational signal telling the platform what changed and when.",
        },
        {
            "id": "mist-inventory", "label": "Mist inventory collector",
            "collects": ["AP inventory", "site mapping", "live AP stats", "client counts", "uptime", "firmware"],
            "purpose": "Builds the canonical AP inventory and live stats table.",
            "output": "Inventory table, AP node base layer, lifecycle snapshots",
            "why_it_matters": "Gives the graph the base physical objects for wireless topology.",
        },
        {
            "id": "mist-locations", "label": "Mist locations & floorplans",
            "collects": ["Sites", "postal addresses", "floorplan images", "map pixel dimensions", "AP x/y positions"],
            "purpose": "Builds the region → site → floor hierarchy and places each AP on its floorplan.",
            "output": "Location tree, vendor location mappings, AP floorplan placements",
            "why_it_matters": "Drives the NOC floorplan view — without it no AP has a physical position.",
        },
        {
            "id": "mist-ap-history", "label": "AP lifecycle history",
            "collects": ["Firmware versions", "uptime trends", "reboots", "site moves", "device connectivity"],
            "purpose": "Tracks AP lifecycle events for change detection and trend analysis.",
            "output": "Lifecycle events, firmware change tracking, device health trends",
            "why_it_matters": "Shows when firmware changed, how long devices have been up, and historical reachability.",
        },
        {
            "id": "mist-ap-rf", "label": "AP wireless RF stats",
            "collects": ["Channel", "TX power", "utilization", "client density", "BSSID", "band"],
            "purpose": "Captures per-radio wireless performance metrics for RF analysis.",
            "output": "RF performance events, channel utilization, wireless quality metrics",
            "why_it_matters": "Identifies congested channels and underperforming radios.",
        },
        {
            "id": "mist-client-topology", "label": "Client connectivity mapping",
            "collects": ["Client MAC", "IP", "SSID", "band", "RSSI", "hostname", "OS", "connection events"],
            "purpose": "Maps client-to-AP connectivity for topology and client experience tracking.",
            "output": "Client-to-AP edges, client health scores, connectivity graph layer",
            "why_it_matters": "Shows which clients are connected where and how good their signal is.",
        },
        {
            "id": "mist-wired-uplink", "label": "Wired uplink topology",
            "collects": ["AP-to-switch links", "switch MAC", "port ID", "link speed", "duplex", "LLDP info"],
            "purpose": "Maps physical AP-to-switch connectivity via wired uplinks.",
            "output": "Topology graph edges, physical adjacency data",
            "why_it_matters": "Maps the wired path from APs through switches for root cause analysis.",
        },
        {
            "id": "mist-radio-neighbors", "label": "RF neighbor environment",
            "collects": ["Neighbor BSSIDs", "channels", "RSSI", "interference type", "co-channel contention"],
            "purpose": "Identifies RF interference and co-channel contention in the wireless environment.",
            "output": "Interference events, RF health scores, channel conflict data",
            "why_it_matters": "Reveals hidden RF problems that degrade wireless performance.",
        },
    ],
    "dnac": [
        {
            "id": "dnac-devices", "label": "DNAC device inventory",
            "collects": ["Network devices", "hostname", "management IP", "platform", "SW version", "reachability", "serial number"],
            "purpose": "Builds the canonical network device inventory from DNAC.",
            "output": "Device inventory, inventory table, device node base layer",
            "why_it_matters": "Gives the graph the base physical objects for wired topology.",
        },
        {
            "id": "dnac-alarms", "label": "DNAC assurance alarms",
            "collects": ["Assurance events", "alerts", "severity", "domain", "sub-domain", "device context"],
            "purpose": "Normalizes DNAC assurance events into the unified event stream.",
            "output": "Event ingestion and incident correlation",
            "why_it_matters": "Operational signal telling the platform what changed and when.",
        },
        {
            "id": "dnac-topology", "label": "DNAC topology collector",
            "collects": ["Physical topology nodes/links", "L3 topology nodes/links"],
            "purpose": "Captures the physical and logical network topology graph.",
            "output": "Topology graph edges, link adjacency data",
            "why_it_matters": "Maps device-to-device connectivity for root cause analysis.",
        },
        {
            "id": "dnac-clients", "label": "DNAC client health",
            "collects": ["Client health overview", "poor/fair/good/idle counts", "client type breakdown"],
            "purpose": "Tracks overall client health and quality of experience.",
            "output": "Client health scores, quality metrics",
            "why_it_matters": "Shows the operator whether end users are impacted.",
        },
        {
            "id": "dnac-interfaces", "label": "DNAC interface status",
            "collects": ["Interface name", "status", "speed", "VLAN", "MAC address"],
            "purpose": "Captures per-device interface operational status.",
            "output": "Interface status table, link adjacency data",
            "why_it_matters": "Shows which ports are up/down and at what speed.",
        },
    ],
    "velocloud": [
        {
            "id": "velocloud-edges", "label": "VeloCloud edge inventory",
            "collects": ["Edge appliances", "edge state", "model", "software version", "enterprise ID", "site mapping"],
            "purpose": "Builds the canonical SD-WAN edge appliance inventory.",
            "output": "Edge inventory, edge node base layer, lifecycle status",
            "why_it_matters": "Gives the graph the base SD-WAN objects for overlay topology.",
        },
        {
            "id": "velocloud-links", "label": "VeloCloud link metrics",
            "collects": ["Link latency", "jitter", "packet loss", "MOS score", "link state", "link type"],
            "purpose": "Captures WAN link performance metrics for health analysis.",
            "output": "Link performance events, WAN quality metrics",
            "why_it_matters": "Shows which WAN links are degraded and affecting application performance.",
        },
        {
            "id": "velocloud-tunnels", "label": "VeloCloud tunnel health",
            "collects": ["Tunnel type", "tunnel state", "remote IP", "encryption status", "latency", "loss"],
            "purpose": "Tracks IPSec/GRE tunnel health and encryption status.",
            "output": "Tunnel health events, overlay connectivity status",
            "why_it_matters": "Reveals overlay tunnel failures that break SD-WAN connectivity.",
        },
        {
            "id": "velocloud-events", "label": "VeloCloud enterprise events",
            "collects": ["Enterprise alarms", "edge events", "severity", "event type", "timestamps"],
            "purpose": "Normalizes VeloCloud enterprise events into the unified event stream.",
            "output": "Event ingestion and incident correlation",
            "why_it_matters": "Operational signal telling the platform what changed and when.",
        },
        {
            "id": "velocloud-apps", "label": "VeloCloud application visibility",
            "collects": ["Application name", "bytes RX/TX", "packets RX/TX", "loss", "latency", "jitter"],
            "purpose": "Captures per-application traffic metrics and QoS performance.",
            "output": "Application performance events, QoS metrics",
            "why_it_matters": "Shows which applications are degraded and where bandwidth is consumed.",
        },
    ],
    "arista-wlc": [
        {
            "id": "arista-wlc-clients", "label": "Arista WLC client inventory",
            "collects": ["Client MAC", "IP address", "hostname", "SSID", "VLAN", "AP name", "auth method", "state"],
            "purpose": "Builds the wireless client inventory from the Arista WLC.",
            "output": "Client inventory, client-to-AP mapping, connection state",
            "why_it_matters": "Shows which clients are connected and their wireless experience.",
        },
        {
            "id": "arista-wlc-aps", "label": "Arista WLC AP inventory",
            "collects": ["AP name", "AP MAC", "IP address", "model", "serial", "status", "site", "uptime"],
            "purpose": "Builds the canonical AP inventory from the Arista WLC.",
            "output": "AP inventory, AP node base layer, lifecycle status",
            "why_it_matters": "Gives the graph the base physical objects for wireless topology.",
        },
        {
            "id": "arista-wlc-radios", "label": "Arista WLC radio status",
            "collects": ["Band", "channel", "TX power", "utilization", "client count", "noise level"],
            "purpose": "Captures per-radio wireless performance metrics for RF analysis.",
            "output": "RF performance events, channel utilization, wireless quality metrics",
            "why_it_matters": "Identifies congested channels and underperforming radios.",
        },
        {
            "id": "arista-wlc-events", "label": "Arista WLC controller events",
            "collects": ["Controller logs", "severity", "event messages", "timestamps"],
            "purpose": "Normalizes Arista WLC controller events into the unified event stream.",
            "output": "Event ingestion and incident correlation",
            "why_it_matters": "Operational signal telling the platform what changed and when.",
        },
    ],
}


# ---------------------------------------------------------------------------
# Telemetry derivation helpers
# ---------------------------------------------------------------------------

def _derive_status(configured: bool, entries: List[Dict[str, Any]]) -> IntegrationStatus:
    if not configured or not entries:
        return "not_configured"
    error_count = sum(1 for e in entries if e.get("last_status") == "error")
    total = len(entries)
    stale = sum(
        1 for e in entries
        if e.get("current_age_seconds") is not None
        and e["current_age_seconds"] > _CRITICAL_THRESHOLD
        and e.get("last_status") != "skipped"
    )
    healthy = sum(1 for e in entries if e.get("last_status") == "success")
    if stale == total or error_count == total:
        return "error"
    if healthy > 0:
        return "connected"
    if error_count > 0:
        return "disconnected"
    return "not_configured"


def _compute_health(entries: List[Dict[str, Any]]) -> Optional[int]:
    if not entries:
        return None
    scores: List[int] = []
    for e in entries:
        if e.get("last_status") == "skipped":
            continue
        age = e.get("current_age_seconds")
        failures = e.get("failure_count", 0)
        s = e.get("last_status", "")
        if s == "error":
            scores.append(max(0, 100 - failures * 20))
        elif age is not None and age > _CRITICAL_THRESHOLD:
            scores.append(20)
        elif age is not None and age > _STALE_THRESHOLD:
            scores.append(60)
        elif s == "success":
            scores.append(100)
        else:
            scores.append(50)
    return int(sum(scores) / len(scores)) if scores else None


def _map_op_status(entry: Dict[str, Any]) -> str:
    s = entry.get("last_status", "")
    age = entry.get("current_age_seconds")
    f = entry.get("failure_count", 0)
    if s == "skipped":
        return "inactive"
    if s == "error" and f >= _MAX_FAILURES:
        return "inactive"
    if age is not None and age > _CRITICAL_THRESHOLD:
        return "inactive"
    if s == "success" and age is not None and age <= _STALE_THRESHOLD:
        return "active"
    if s == "success":
        return "working"
    return "not_configured"


def _derive_single_status(entry: Dict[str, Any]) -> IntegrationStatus:
    st = entry.get("last_status", "")
    age = entry.get("current_age_seconds")
    f = entry.get("failure_count", 0)
    if st == "skipped":
        return "not_configured"
    if st == "error" and f >= _MAX_FAILURES:
        return "error"
    if age is not None and age > _CRITICAL_THRESHOLD:
        return "disconnected"
    if st == "success":
        return "connected"
    if st == "error":
        return "disconnected"
    return "not_configured"


def _single_health(entry: Dict[str, Any]) -> Optional[int]:
    st = entry.get("last_status", "")
    age = entry.get("current_age_seconds")
    f = entry.get("failure_count", 0)
    if st == "skipped":
        return None
    if st == "error":
        return max(0, 100 - f * 20)
    if age is not None and age > _CRITICAL_THRESHOLD:
        return 20
    if age is not None and age > _STALE_THRESHOLD:
        return 60
    if st == "success":
        return 100
    return 50


def _build_collector_summaries(
    iid: str, by_collector: Dict[str, Dict[str, Any]],
) -> List[IntegrationCollectorSummary]:
    defs = _COLLECTOR_DEFS.get(iid, [])
    if not defs:
        return []
    out: List[IntegrationCollectorSummary] = []
    for meta in defs:
        t = by_collector.get(meta["id"])
        if t:
            ds = _derive_single_status(t)
            op = _map_op_status(t)
            ls = t.get("last_success") or t.get("last_run")
            h = _single_health(t)
            msg = t.get("last_error") if t.get("last_status") == "error" else None
            age = t.get("current_age_seconds")
            rows = t.get("rows_written", 0)
            dur = t.get("duration_ms")
        else:
            ds = "not_configured"
            op = "not_configured"
            ls = None
            h = None
            msg = None
            age = None
            rows = 0
            dur = None
        out.append(IntegrationCollectorSummary(
            id=meta["id"], label=meta["label"], status=ds,
            operational_status=op, last_sync=ls, health_score=h,
            message=msg, collects=meta["collects"], purpose=meta["purpose"],
            output=meta["output"], why_it_matters=meta["why_it_matters"],
        ))
    return out


# ---------------------------------------------------------------------------
# IntegrationService
# ---------------------------------------------------------------------------

class IntegrationService:
    def __init__(self) -> None:
        self._lock = asyncio.Lock()
        self._mist = MistCollector()
        self._dnac = DNACCollector()
        self._velocloud = VeloCloudCollector()
        self._arista_wlc = AristaWlcCollector()

    def _definition(self, iid: str) -> IntegrationDefinition:
        d = _INTEGRATIONS.get(iid)
        if d is None:
            raise HTTPException(status_code=404, detail=f"Unknown integration: {iid}")
        return d

    def _configured(self, iid: str) -> bool:
        s = get_settings()
        if iid == "mist":
            return bool(s.mist_enabled and s.mist_api_key and s.mist_org_id)
        if iid == "dnac":
            return bool(s.dnac_enabled and s.dnac_host and s.dnac_username and s.dnac_password)
        if iid == "velocloud":
            return bool(s.velocloud_enabled and s.velocloud_url and s.velocloud_api_key)
        if iid == "arista-wlc":
            return bool(s.arista_wlc_enabled and s.arista_wlc_host and s.arista_wlc_username and s.arista_wlc_password)
        return False

    async def _get_telemetry(self) -> List[Dict[str, Any]]:
        try:
            return await list_collector_telemetry()
        except Exception:
            logger.debug("Could not read telemetry ledger (Postgres may be unavailable)")
            return []

    def _telemetry_for(self, iid: str, all_t: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        prefix = "arista" if iid == "arista-wlc" else iid.replace("-", "_")
        return [
            t for t in all_t
            if t.get("collector_id", "").startswith(prefix)
            or t.get("source_system", "") == iid
            or t.get("source_system", "") == prefix
        ]

    async def list_integrations(self) -> IntegrationListResponse:
        all_t = await self._get_telemetry()
        items: List[IntegrationSummary] = []
        for iid, defn in _INTEGRATIONS.items():
            cfg = self._configured(iid)
            telem = self._telemetry_for(iid, all_t)
            status = _derive_status(cfg, telem)
            health = _compute_health(telem)
            rows = sum(t.get("rows_written", 0) for t in telem)
            err = next((t.get("last_error") for t in telem if t.get("last_status") == "error"), None)
            sync = next((t.get("last_success") for t in telem if t.get("last_success")), None)
            collectors = _build_collector_summaries(iid, {t["collector_id"]: t for t in telem})
            items.append(IntegrationSummary(
                id=defn.id, name=defn.name, vendor=defn.vendor,
                description=defn.description, icon=defn.icon,
                status=status, configured=cfg, coming_soon=defn.coming_soon,
                last_sync=sync, health_score=health, events_collected=rows,
                errors=[err] if err else [], collectors=collectors,
            ))
        hs = [i.health_score for i in items if i.health_score is not None]
        return IntegrationListResponse(
            integrations=items, total=len(items),
            connected=sum(1 for i in items if i.status == "connected"),
            disconnected=sum(1 for i in items if i.status == "disconnected"),
            not_configured=sum(1 for i in items if i.status == "not_configured"),
            average_health=(sum(hs) / len(hs)) if hs else None,
            total_events_collected=sum(i.events_collected for i in items),
        )

    async def get_integration(self, iid: str) -> IntegrationDetailResponse:
        s = await self._build_summary(iid)
        c = await self._build_config(iid)
        return IntegrationDetailResponse(**s.model_dump(), config=c)

    async def get_config(self, iid: str) -> IntegrationConfigResponse:
        self._definition(iid)
        return await self._build_config(iid)

    async def test_connection(self, iid: str) -> IntegrationActionResponse:
        defn = self._definition(iid)
        if iid == "mist":
            try:
                connected = await self._mist.connect()
                s = await self._build_summary(iid)
                if connected:
                    return IntegrationActionResponse(success=True, message="Mist credentials validated successfully.", integration=s)
                return IntegrationActionResponse(success=False, message="Mist connection failed", integration=s)
            except Exception as exc:
                s = await self._build_summary(iid)
                return IntegrationActionResponse(success=False, message=f"Mist test failed: {exc}", integration=s)
        if iid == "dnac":
            try:
                connected = await self._dnac.connect()
                s = await self._build_summary(iid)
                if connected:
                    return IntegrationActionResponse(success=True, message="DNAC credentials validated successfully.", integration=s)
                return IntegrationActionResponse(success=False, message="DNAC connection failed — check host and credentials", integration=s)
            except Exception as exc:
                s = await self._build_summary(iid)
                return IntegrationActionResponse(success=False, message=f"DNAC test failed: {exc}", integration=s)
        if iid == "velocloud":
            try:
                connected = await self._velocloud.connect()
                s = await self._build_summary(iid)
                if connected:
                    return IntegrationActionResponse(success=True, message="VeloCloud credentials validated successfully.", integration=s)
                return IntegrationActionResponse(success=False, message="VeloCloud connection failed — check URL and API key", integration=s)
            except Exception as exc:
                s = await self._build_summary(iid)
                return IntegrationActionResponse(success=False, message=f"VeloCloud test failed: {exc}", integration=s)
        if iid == "arista-wlc":
            try:
                connected = await self._arista_wlc.connect()
                s = await self._build_summary(iid)
                if connected:
                    return IntegrationActionResponse(success=True, message="Arista WLC credentials validated successfully.", integration=s)
                return IntegrationActionResponse(success=False, message="Arista WLC connection failed — check host and credentials", integration=s)
            except Exception as exc:
                s = await self._build_summary(iid)
                return IntegrationActionResponse(success=False, message=f"Arista WLC test failed: {exc}", integration=s)
        if not self._configured(iid):
            s = await self._build_summary(iid)
            return IntegrationActionResponse(success=False, message=f"{defn.name} is not configured", integration=s)
        s = await self._build_summary(iid)
        return IntegrationActionResponse(success=False, message=f"{defn.name} collector not implemented yet.", integration=s)

    async def trigger_sync(self, iid: str) -> IntegrationActionResponse:
        self._definition(iid)
        if iid == "mist":
            if not self._configured(iid):
                s = await self._build_summary(iid)
                return IntegrationActionResponse(success=False, message="Mist is not configured", integration=s)
            try:
                outcome = await self._mist.collect()
                s = await self._build_summary(iid)
                return IntegrationActionResponse(success=outcome.status == "success", message=f"Synced {outcome.event_count} Mist events", integration=s)
            except Exception as exc:
                s = await self._build_summary(iid)
                return IntegrationActionResponse(success=False, message=f"Mist sync failed: {exc}", integration=s)
        if iid == "dnac":
            if not self._configured(iid):
                s = await self._build_summary(iid)
                return IntegrationActionResponse(success=False, message="DNAC is not configured", integration=s)
            try:
                outcomes = await self._dnac.collect_all()
                total = sum(o.event_count for o in outcomes)
                ok = all(o.status != "error" for o in outcomes)
                s = await self._build_summary(iid)
                return IntegrationActionResponse(
                    success=ok,
                    message=f"Synced {total} events from {len(outcomes)} DNAC collectors",
                    integration=s,
                )
            except Exception as exc:
                s = await self._build_summary(iid)
                return IntegrationActionResponse(success=False, message=f"DNAC sync failed: {exc}", integration=s)
        if iid == "velocloud":
            if not self._configured(iid):
                s = await self._build_summary(iid)
                return IntegrationActionResponse(success=False, message="VeloCloud is not configured", integration=s)
            try:
                outcomes = await self._velocloud.collect_all()
                total = sum(o.event_count for o in outcomes)
                ok = all(o.status != "error" for o in outcomes)
                s = await self._build_summary(iid)
                return IntegrationActionResponse(
                    success=ok,
                    message=f"Synced {total} events from {len(outcomes)} VeloCloud collectors",
                    integration=s,
                )
            except Exception as exc:
                s = await self._build_summary(iid)
                return IntegrationActionResponse(success=False, message=f"VeloCloud sync failed: {exc}", integration=s)
        if iid == "arista-wlc":
            if not self._configured(iid):
                s = await self._build_summary(iid)
                return IntegrationActionResponse(success=False, message="Arista WLC is not configured", integration=s)
            try:
                outcomes = await self._arista_wlc.collect_all()
                total = sum(o.event_count for o in outcomes)
                ok = all(o.status != "error" for o in outcomes)
                s = await self._build_summary(iid)
                return IntegrationActionResponse(
                    success=ok,
                    message=f"Synced {total} events from {len(outcomes)} Arista WLC collectors",
                    integration=s,
                )
            except Exception as exc:
                s = await self._build_summary(iid)
                return IntegrationActionResponse(success=False, message=f"Arista WLC sync failed: {exc}", integration=s)
        s = await self._build_summary(iid)
        return IntegrationActionResponse(success=False, message="Sync not available yet for this integration", integration=s)

    async def _build_summary(self, iid: str) -> IntegrationSummary:
        defn = self._definition(iid)
        cfg = self._configured(iid)
        all_t = await self._get_telemetry()
        telem = self._telemetry_for(iid, all_t)
        status = _derive_status(cfg, telem)
        health = _compute_health(telem)
        rows = sum(t.get("rows_written", 0) for t in telem)
        errors = [t["last_error"] for t in telem if t.get("last_error")]
        sync = next((t.get("last_success") for t in telem if t.get("last_success")), None)
        collectors = _build_collector_summaries(iid, {t["collector_id"]: t for t in telem})
        return IntegrationSummary(
            id=defn.id, name=defn.name, vendor=defn.vendor,
            description=defn.description, icon=defn.icon,
            status=status, configured=cfg, coming_soon=defn.coming_soon,
            last_sync=sync, health_score=health, events_collected=rows,
            errors=errors, collectors=collectors,
        )

    async def _build_config(self, iid: str) -> IntegrationConfigResponse:
        defn = self._definition(iid)
        s = get_settings()
        cfg = self._configured(iid)
        summary = await self._build_summary(iid)
        all_t = await self._get_telemetry()
        telem = self._telemetry_for(iid, all_t)
        last_err = next((t.get("last_error") for t in telem if t.get("last_status") == "error"), None)

        if iid == "mist":
            groups = [
                IntegrationConfigGroup(title="Credentials", items=[
                    IntegrationConfigItem(label="API key", value=_mask(s.mist_api_key), masked=True),
                    IntegrationConfigItem(label="Org ID", value=_mask(s.mist_org_id), masked=True),
                ]),
                IntegrationConfigGroup(title="Collector settings", items=[
                    IntegrationConfigItem(label="Base URL", value=s.mist_base_url or "Not set"),
                    IntegrationConfigItem(label="Enabled", value="Yes" if s.mist_enabled else "No"),
                ]),
            ]
        elif iid == "dnac":
            groups = [
                IntegrationConfigGroup(title="Credentials", items=[
                    IntegrationConfigItem(label="Host", value=s.dnac_host or "Not set"),
                    IntegrationConfigItem(label="Username", value=_mask(s.dnac_username), masked=True),
                    IntegrationConfigItem(label="Password", value=_mask(s.dnac_password), masked=True),
                ]),
                IntegrationConfigGroup(title="Collector settings", items=[
                    IntegrationConfigItem(label="Enabled", value="Yes" if s.dnac_enabled else "No"),
                    IntegrationConfigItem(label="Verify SSL", value="Yes" if s.dnac_verify_ssl else "No"),
                ]),
            ]
        elif iid == "velocloud":
            groups = [
                IntegrationConfigGroup(title="Credentials", items=[
                    IntegrationConfigItem(label="Base URL", value=s.velocloud_url or "Not set"),
                    IntegrationConfigItem(label="API key", value=_mask(s.velocloud_api_key), masked=True),
                ]),
                IntegrationConfigGroup(title="Collector settings", items=[
                    IntegrationConfigItem(label="Enabled", value="Yes" if s.velocloud_enabled else "No"),
                ]),
            ]
        else:
            groups = [
                IntegrationConfigGroup(title="Credentials", items=[
                    IntegrationConfigItem(label="Host", value=s.arista_wlc_host or "Not set"),
                    IntegrationConfigItem(label="Username", value=_mask(s.arista_wlc_username), masked=True),
                    IntegrationConfigItem(label="Password", value=_mask(s.arista_wlc_password), masked=True),
                ]),
                IntegrationConfigGroup(title="Collector settings", items=[
                    IntegrationConfigItem(label="Enabled", value="Yes" if s.arista_wlc_enabled else "No"),
                    IntegrationConfigItem(label="Verify SSL", value="Yes" if s.arista_wlc_verify_ssl else "No"),
                ]),
            ]

        return IntegrationConfigResponse(
            integration_id=defn.id, status=summary.status,
            configured=cfg, coming_soon=defn.coming_soon,
            validation_message=last_err, last_tested_at=None,
            recent_errors=[last_err] if last_err else [],
            groups=groups, collectors=summary.collectors,
        )


integration_service = IntegrationService()
