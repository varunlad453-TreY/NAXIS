"""
VeloCloud SD-WAN Collector

Polls the VeloCloud Orchestrator API for:
  - Edge appliance inventory       (POST /portal/rest/enterprise/getEnterpriseEdges)
  - Enterprise events, alarms      (POST /portal/rest/event/getEnterpriseEvents)

Auth: API key via Authorization: Token header.
All responses are normalized to UnifiedEvent via the same contract as Mist/DNAC.
"""

import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from uuid import uuid4

import httpx
from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_exception_type

try:
    from backend.config.settings import get_settings
except ImportError:  # pragma: no cover - supports both entry-point styles
    from config.settings import get_settings
try:
    from backend.shared.models.collector_outcome import CollectorOutcome
    from backend.shared.models.event import (
        ClientInfo,
        DeviceInfo,
        EventCategory,
        EventSeverity,
        EventSource,
        EventType,
        UnifiedEvent,
    )
    from backend.shared.database.identity import IdentityResolver
except ImportError:  # pragma: no cover - supports both entry-point styles
    from shared.models.collector_outcome import CollectorOutcome
    from shared.models.event import (
        ClientInfo,
        DeviceInfo,
        EventCategory,
        EventSeverity,
        EventSource,
        EventType,
        UnifiedEvent,
    )
    from shared.database.identity import IdentityResolver

logger = logging.getLogger(__name__)

_MAX_EDGES = 200  # cap edge fetch


class VeloCloudApiError(Exception):
    """Raised when the VeloCloud API returns a non-2xx response."""
    def __init__(self, status_code: int, detail: str):
        super().__init__(f"VeloCloud API {status_code}: {detail}")
        self.status_code = status_code


# ---------------------------------------------------------------------------
# Sub-collectors — each returns a CollectorOutcome
# ---------------------------------------------------------------------------

class VeloCloudEdgesCollector:
    """Fetches edge appliance inventory from VeloCloud."""

    COLLECTOR_ID = "velocloud-edges"
    SOURCE_SYSTEM = "velocloud"

    def __init__(
        self,
        client: httpx.AsyncClient,
        base_url: str,
        resolver: Optional[IdentityResolver] = None,
    ):
        self._client = client
        self._base = base_url
        self._resolver = resolver

    @retry(
        retry=retry_if_exception_type(httpx.TransportError),
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=2, max=10),
        reraise=True,
    )
    async def collect(self, edges_data: List[Dict] = None) -> CollectorOutcome:
        outcome = CollectorOutcome(
            collector_id=self.COLLECTOR_ID,
            source_system=self.SOURCE_SYSTEM,
        )
        try:
            if edges_data is None:
                resp = await self._client.post(
                    f"{self._base}/portal/rest/enterprise/getEnterpriseEdges",
                    json={"with": ["site"]},
                )
                _raise_for_status(resp)
                edges_raw = resp.json()
                if not isinstance(edges_raw, list):
                    edges_raw = edges_raw.get("data", [])
            else:
                edges_raw = edges_data

            events: List[UnifiedEvent] = []
            for edge in edges_raw:
                events.append(await self._normalize_edge(edge))

            outcome.events = events
            outcome.mark_success(rows_written=len(events))
            outcome.metadata["raw_count"] = len(edges_raw)
            logger.info("VeloCloud edges: %d edges collected", len(events))
        except Exception as exc:
            outcome.mark_error(str(exc))
            logger.exception("VeloCloud edges collection failed")
        return outcome

    async def _normalize_edge(self, raw: Dict[str, Any]) -> UnifiedEvent:
        edge_id = str(raw.get("id", f"vc-{uuid4().hex[:8]}"))
        name = raw.get("name", "unknown")
        enterprise_id = raw.get("enterpriseId", "")
        site = raw.get("site") or {}
        site_id = str(site.get("id", "")) or str(raw.get("siteId", ""))
        site_name = site.get("name", "") or raw.get("siteName", "")
        model_number = raw.get("modelNumber", "")
        software_version = raw.get("softwareVersion", "")

        edge_state = raw.get("edgeState", "unknown")
        if edge_state.lower() in ("connected", "online"):
            severity = EventSeverity.INFO
            event_type = EventType.DEVICE_REACHABLE
        elif edge_state.lower() in ("disconnected", "offline"):
            severity = EventSeverity.CRITICAL
            event_type = EventType.DEVICE_UNREACHABLE
        else:
            severity = EventSeverity.WARNING
            event_type = EventType.OTHER

        description = f"Edge {name} ({edge_id}) — state: {edge_state}"
        if model_number:
            description += f", model: {model_number}"
        if software_version:
            description += f", SW: {software_version}"

        device_id = edge_id
        if self._resolver and edge_id:
            resolved = await self._resolver.resolve_device(
                "velocloud",
                edge_id,
                display_name=name,
                device_type="edge",
                model=model_number,
                ip_address="",
            )
            if resolved:
                device_id = resolved

        return UnifiedEvent(
            event_id=f"vc-edge-{uuid4().hex[:12]}",
            timestamp=datetime.now(timezone.utc).replace(tzinfo=None),
            source=EventSource.VELOCLOUD,
            source_event_id=edge_id,
            severity=severity,
            category=EventCategory.SYSTEM,
            event_type=event_type,
            title=f"Edge: {name}",
            description=description,
            device=DeviceInfo(
                device_id=device_id,
                device_name=name,
                device_type="edge",
                device_model=model_number,
                site_id=site_id or None,
                site_name=site_name or None,
            ),
            tags=["sdwan", "velocloud", "edge", "inventory"],
            metadata={
                "vc_edge_id": edge_id,
                "vc_enterprise_id": str(enterprise_id),
                "vc_site_id": site_id,
                "vc_model": model_number,
                "vc_sw_version": software_version,
                "vc_edge_state": edge_state,
            },
            raw_event=raw,
        )


class VeloCloudLinksCollector:
    """Fetches link metrics (latency, jitter, loss) for VeloCloud edges.

    Extracts WAN link data embedded in each edge's ``links`` array from
    the getEnterpriseEdges response (fetched once by the orchestrator).
    """

    COLLECTOR_ID = "velocloud-links"
    SOURCE_SYSTEM = "velocloud"

    def __init__(
        self,
        edges_data: List[Dict],
        resolver: Optional[IdentityResolver] = None,
    ):
        self._edges_data = edges_data
        self._resolver = resolver

    async def collect(self) -> CollectorOutcome:
        outcome = CollectorOutcome(
            collector_id=self.COLLECTOR_ID,
            source_system=self.SOURCE_SYSTEM,
        )
        try:
            events: List[UnifiedEvent] = []
            for edge in self._edges_data:
                edge_id = str(edge.get("id", ""))
                edge_name = edge.get("name", "unknown")
                links = edge.get("links", [])
                if not isinstance(links, list):
                    continue
                site = edge.get("site") or {}
                edge_site_id = str(site.get("id", "")) or str(edge.get("siteId", ""))
                edge_site_name = site.get("name", "") or edge.get("siteName", "")
                for link in links:
                    try:
                        events.append(
                            await self._normalize_link(
                                link,
                                edge_id,
                                edge_name,
                                site_id=edge_site_id,
                                site_name=edge_site_name,
                            )
                        )
                    except Exception:
                        logger.exception("Failed to normalize VeloCloud link")

            outcome.events = events
            outcome.mark_success(rows_written=len(events))
            outcome.metadata["raw_count"] = len(events)
            logger.info("VeloCloud links: %d links from %d edges", len(events), len(self._edges_data))
        except Exception as exc:
            outcome.mark_error(str(exc))
            logger.exception("VeloCloud links collection failed")
        return outcome

    async def _normalize_link(self, raw: Dict[str, Any], edge_id: str = "", edge_name: str = "", site_id: str = "", site_name: str = "") -> UnifiedEvent:
        link_id = str(raw.get("id", f"vc-link-{uuid4().hex[:8]}"))
        edge_id = str(raw.get("edgeId", "")) or edge_id
        edge_name = raw.get("edgeName", raw.get("edge", "")) or edge_name
        display_name = raw.get("displayName", raw.get("name", f"Link {link_id}"))
        state = raw.get("state", raw.get("linkState", "unknown"))
        latency = raw.get("latency", raw.get("latencyMs", 0))
        jitter = raw.get("jitter", raw.get("jitterMs", 0))
        loss = raw.get("packetLoss", raw.get("lossPercent", 0))
        bandwidth = raw.get("bandwidth", {})

        if state.lower() in ("stable", "connected", "up"):
            severity = EventSeverity.INFO
            event_type = EventType.LINK_UP
        elif state.lower() in ("down", "disconnected", "error"):
            severity = EventSeverity.CRITICAL
            event_type = EventType.LINK_DOWN
        elif latency and isinstance(latency, (int, float)) and latency > 300:
            severity = EventSeverity.WARNING
            event_type = EventType.HIGH_LATENCY
        elif loss and isinstance(loss, (int, float)) and loss > 5:
            severity = EventSeverity.WARNING
            event_type = EventType.PACKET_LOSS
        else:
            severity = EventSeverity.INFO
            event_type = EventType.LINK_UP

        description = (
            f"Link {display_name} — state: {state}"
            f", latency: {latency}ms" if latency else ""
        ) + (
            f", jitter: {jitter}ms" if jitter else ""
        ) + (
            f", loss: {loss}%" if loss else ""
        )

        device_id = edge_id or link_id
        if self._resolver and edge_id:
            resolved = await self._resolver.find_device("velocloud", edge_id)
            if resolved:
                device_id = resolved

        return UnifiedEvent(
            event_id=f"vc-link-{uuid4().hex[:12]}",
            timestamp=datetime.now(timezone.utc).replace(tzinfo=None),
            source=EventSource.VELOCLOUD,
            source_event_id=link_id,
            severity=severity,
            category=EventCategory.CONNECTIVITY,
            event_type=event_type,
            title=f"Link: {display_name}",
            description=description,
            device=DeviceInfo(
                device_id=device_id,
                device_name=edge_name or display_name,
                device_type="edge",
                site_id=site_id or None,
                site_name=site_name or None,
            ),
            tags=["sdwan", "velocloud", "link"],
            metadata={
                "vc_link_id": link_id,
                "vc_edge_id": edge_id,
                "vc_link_state": state,
                "vc_latency_ms": latency,
                "vc_jitter_ms": jitter,
                "vc_loss_pct": loss,
                "vc_bandwidth": bandwidth,
            },
            raw_event=raw,
        )


class VeloCloudTunnelsCollector:
    """Fetches tunnel health and encryption status from VeloCloud.

    Extracts tunnel data embedded in each edge's ``tunnels`` array
    from the getEnterpriseEdges response (fetched once by the orchestrator).
    """

    COLLECTOR_ID = "velocloud-tunnels"
    SOURCE_SYSTEM = "velocloud"

    def __init__(
        self,
        edges_data: List[Dict],
        resolver: Optional[IdentityResolver] = None,
    ):
        self._edges_data = edges_data
        self._resolver = resolver

    async def collect(self) -> CollectorOutcome:
        outcome = CollectorOutcome(
            collector_id=self.COLLECTOR_ID,
            source_system=self.SOURCE_SYSTEM,
        )
        try:
            events: List[UnifiedEvent] = []
            for edge in self._edges_data:
                edge_id = str(edge.get("id", ""))
                edge_name = edge.get("name", "unknown")
                site = edge.get("site") or {}
                edge_site_id = str(site.get("id", "")) or str(edge.get("siteId", ""))
                edge_site_name = site.get("name", "") or edge.get("siteName", "")
                tunnels = edge.get("tunnels", edge.get("edgeTunnels", []))
                if not isinstance(tunnels, list):
                    continue
                for tunnel in tunnels:
                    try:
                        events.append(
                            await self._normalize_tunnel(
                                tunnel,
                                edge_id,
                                edge_name,
                                site_id=edge_site_id,
                                site_name=edge_site_name,
                            )
                        )
                    except Exception:
                        logger.exception("Failed to normalize VeloCloud tunnel")

            outcome.events = events
            outcome.mark_success(rows_written=len(events))
            outcome.metadata["raw_count"] = len(events)
            logger.info("VeloCloud tunnels: %d tunnels from %d edges", len(events), len(self._edges_data))
        except Exception as exc:
            outcome.mark_error(str(exc))
            logger.exception("VeloCloud tunnels collection failed")
        return outcome

    async def _normalize_tunnel(self, raw: Dict[str, Any], edge_id: str = "", edge_name: str = "", site_id: str = "", site_name: str = "") -> UnifiedEvent:
        tunnel_id = str(raw.get("id", f"vc-tunnel-{uuid4().hex[:8]}"))
        edge_id = str(raw.get("edgeId", "")) or edge_id
        edge_name = raw.get("edgeName", raw.get("edge", "")) or edge_name
        state = raw.get("state", raw.get("tunnelState", "unknown"))
        transport = raw.get("transportType", raw.get("transport", ""))
        encryption = raw.get("encryption", raw.get("encryptionProtocol", ""))
        local_ip = raw.get("localIp", "")
        remote_ip = raw.get("remoteIp", "")
        remote_name = raw.get("peerName", raw.get("gatewayName", ""))
        latency = raw.get("latency", 0)
        loss = raw.get("packetLoss", 0)

        if state.lower() in ("stable", "connected", "up"):
            severity = EventSeverity.INFO
            event_type = EventType.TUNNEL_UP
        elif state.lower() in ("down", "disconnected", "error", "degraded"):
            severity = EventSeverity.CRITICAL
            event_type = EventType.TUNNEL_DOWN
        else:
            severity = EventSeverity.WARNING
            event_type = EventType.OTHER

        desc_parts = [f"Tunnel to {remote_name or remote_ip or 'peer'} — state: {state}"]
        if transport: desc_parts.append(f"transport: {transport}")
        if encryption: desc_parts.append(f"encryption: {encryption}")
        if latency: desc_parts.append(f"latency: {latency}ms")
        if loss: desc_parts.append(f"loss: {loss}%")
        if local_ip: desc_parts.append(f"local: {local_ip}")
        if remote_ip: desc_parts.append(f"remote: {remote_ip}")

        device_id = edge_id or tunnel_id
        if self._resolver and edge_id:
            resolved = await self._resolver.find_device("velocloud", edge_id)
            if resolved:
                device_id = resolved

        return UnifiedEvent(
            event_id=f"vc-tunnel-{uuid4().hex[:12]}",
            timestamp=datetime.now(timezone.utc).replace(tzinfo=None),
            source=EventSource.VELOCLOUD,
            source_event_id=tunnel_id,
            severity=severity,
            category=EventCategory.CONNECTIVITY,
            event_type=event_type,
            title=f"Tunnel: {remote_name or remote_ip or tunnel_id}",
            description=" — ".join(desc_parts),
            device=DeviceInfo(
                device_id=device_id,
                device_name=edge_name or "unknown",
                device_type="edge",
                site_id=site_id or None,
                site_name=site_name or None,
            ),
            tags=["sdwan", "velocloud", "tunnel"],
            metadata={
                "vc_tunnel_id": tunnel_id,
                "vc_edge_id": edge_id,
                "vc_tunnel_state": state,
                "vc_transport_type": transport,
                "vc_encryption": encryption,
                "vc_local_ip": local_ip,
                "vc_remote_ip": remote_ip,
                "vc_peer_name": remote_name,
                "vc_latency": latency,
                "vc_loss": loss,
            },
            raw_event=raw,
        )


class VeloCloudEventsCollector:
    """Fetches enterprise events and alarms from VeloCloud."""

    COLLECTOR_ID = "velocloud-events"
    SOURCE_SYSTEM = "velocloud"

    def __init__(
        self,
        client: httpx.AsyncClient,
        base_url: str,
        enterprise_id: int,
        resolver: Optional[IdentityResolver] = None,
    ):
        self._client = client
        self._base = base_url
        self._enterprise_id = enterprise_id
        self._resolver = resolver or IdentityResolver()

    @retry(
        retry=retry_if_exception_type(httpx.TransportError),
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=2, max=10),
        reraise=True,
    )
    async def collect(self) -> CollectorOutcome:
        outcome = CollectorOutcome(
            collector_id=self.COLLECTOR_ID,
            source_system=self.SOURCE_SYSTEM,
        )
        try:
            now_ms = int(datetime.now(timezone.utc).timestamp() * 1000)
            payload = {
                "enterpriseId": self._enterprise_id,
                "interval": {"start": now_ms - 3600000, "end": now_ms},
                "limit": 200,
            }
            resp = await self._client.post(
                f"{self._base}/portal/rest/event/getEnterpriseEvents",
                json=payload,
            )
            _raise_for_status(resp)
            body = resp.json()
            events_raw = body.get("data", []) if isinstance(body, dict) else body
            if not isinstance(events_raw, list):
                events_raw = []

            events: List[UnifiedEvent] = []
            for raw in events_raw:
                try:
                    events.append(await self._normalize_event(raw))
                except Exception:
                    logger.exception("Failed to normalize VeloCloud event")

            outcome.events = events
            outcome.mark_success(rows_written=len(events))
            outcome.metadata["raw_count"] = len(events_raw)
            logger.info("VeloCloud events: %d events collected", len(events))
        except Exception as exc:
            outcome.mark_error(str(exc))
            logger.exception("VeloCloud events collection failed")
        return outcome

    async def _normalize_event(self, raw: Dict[str, Any]) -> UnifiedEvent:
        source_eid = str(raw.get("id", ""))
        ts_raw = raw.get("eventTime") or raw.get("createdWhen") or ""
        try:
            timestamp = datetime.fromisoformat(ts_raw.replace("Z", "+00:00")).replace(tzinfo=None)
        except Exception:
            timestamp = datetime.now(timezone.utc).replace(tzinfo=None)

        level = str(raw.get("severity", "INFO")).upper()
        severity = _map_vc_severity(level)

        event_type_str = raw.get("event", raw.get("type", "UNKNOWN"))
        event_type, category = _map_vc_event_type(event_type_str, "")

        edge_name = raw.get("edgeName", "") or raw.get("enterpriseName", "") or "unknown"
        edge_id = str(raw.get("edgeId", "")) or raw.get("edgeLogicalId", "") or ""
        site_name = raw.get("siteName", "") or ""
        detail = raw.get("detail", "") or raw.get("message", "") or event_type_str
        title = event_type_str.replace("_", " ").title()

        device_id = edge_id
        if self._resolver and edge_id:
            resolved = await self._resolver.find_device("velocloud", edge_id)
            if resolved:
                device_id = resolved

        return UnifiedEvent(
            event_id=f"vc-event-{uuid4().hex[:12]}",
            timestamp=timestamp,
            source=EventSource.VELOCLOUD,
            source_event_id=source_eid,
            severity=severity,
            category=category,
            event_type=event_type,
            title=title[:120],
            description=detail,
            device=DeviceInfo(
                device_id=device_id or "unknown",
                device_name=edge_name or "unknown",
                device_type="edge",
                site_id=str(raw.get("siteId", "")) or edge_id,
                site_name=site_name,
            ) if edge_id else None,
            tags=["sdwan", "velocloud", "event"],
            metadata={
                "vc_event_id": source_eid,
                "vc_level": level,
                "vc_edge_name": edge_name,
                "vc_edge_id": edge_id,
                "vc_event_type": event_type_str,
            },
            raw_event=raw,
        )


class VeloCloudAppsCollector:
    """Fetches application visibility and QoS metrics from VeloCloud.

    Tries POST /portal/rest/monitor/getEdgeAppSeries to fetch per-edge
    application traffic data.  Falls back to getEdgeMonitoring if the
    app-series endpoint isn't available on this VCO version.
    """

    COLLECTOR_ID = "velocloud-apps"
    SOURCE_SYSTEM = "velocloud"

    def __init__(
        self,
        client: httpx.AsyncClient,
        base_url: str,
        enterprise_id: int,
        edges_data: List[Dict],
        resolver: Optional[IdentityResolver] = None,
    ):
        self._client = client
        self._base = base_url
        self._enterprise_id = enterprise_id
        self._edges_data = edges_data
        self._resolver = resolver

    @retry(
        retry=retry_if_exception_type(httpx.TransportError),
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=2, max=10),
        reraise=True,
    )
    async def collect(self) -> CollectorOutcome:
        outcome = CollectorOutcome(
            collector_id=self.COLLECTOR_ID,
            source_system=self.SOURCE_SYSTEM,
        )
        try:
            now_ms = int(datetime.now(timezone.utc).timestamp() * 1000)
            events: List[UnifiedEvent] = []

            # Try each endpoint in order, use the first that returns 200
            # ponytail: VCO vco109 returns methodError on all monitor/*
            # endpoints.  Add VCO-version-specific app endpoint config
            # when targeting a VCO that supports them.
            _APP_ENDPOINTS = [
                ("POST", "/portal/rest/monitor/getEdgeAppSeries", {"enterpriseId": self._enterprise_id, "interval": {"start": now_ms - 3600000, "end": now_ms}, "limit": 20}),
                ("POST", "/portal/rest/monitor/getEnterpriseEdgeAppMetrics", {"enterpriseId": self._enterprise_id, "interval": {"start": now_ms - 3600000, "end": now_ms}}),
            ]
            for method, path, body in _APP_ENDPOINTS:
                resp = await self._client.post(f"{self._base}{path}", json=body)
                if resp.status_code != 200:
                    logger.debug("%s returned %d: %.200s", path, resp.status_code, resp.text[:200])
                    continue
                data = resp.json()
                apps_raw = data.get("data", []) if isinstance(data, dict) else data
                if isinstance(apps_raw, list):
                    for app in apps_raw:
                        try:
                            events.append(await self._normalize_app(app))
                        except Exception:
                            logger.exception("Failed to normalize VeloCloud app metric from %s", path)
                    logger.info("VeloCloud apps: %d from %s", len(events), path)
                    if events:
                        break

            outcome.events = events
            if not events:
                outcome.mark_skipped("No App/AppSeries/Monitoring endpoint available on this VCO")
                return outcome
            outcome.mark_success(rows_written=len(events))
            outcome.metadata["raw_count"] = len(events)
            logger.info("VeloCloud applications: %d app metrics collected", len(events))
        except Exception as exc:
            outcome.mark_error(str(exc))
            logger.exception("VeloCloud apps collection failed")
        return outcome

    async def _normalize_app(self, raw: Dict[str, Any]) -> UnifiedEvent:
        app_id = str(raw.get("id", raw.get("appId", f"vc-app-{uuid4().hex[:8]}")))
        app_name = raw.get("name", raw.get("appName", "Unknown"))
        edge_id = str(raw.get("edgeId", ""))
        edge_name = raw.get("edgeName", raw.get("edge", ""))
        bytes_sent = raw.get("bytesSent", raw.get("txBytes", 0))
        bytes_recv = raw.get("bytesReceived", raw.get("rxBytes", 0))
        total_bytes = (bytes_sent or 0) + (bytes_recv or 0)
        throughput = raw.get("throughputBps", raw.get("throughput", 0))
        dscp = raw.get("dscp", raw.get("qos", ""))

        severity = EventSeverity.INFO
        event_type = EventType.OTHER

        if total_bytes and isinstance(total_bytes, (int, float)) and total_bytes > 0:
            desc = f"App {app_name}: {_format_bytes(total_bytes)}"
            if throughput: desc += f", {_format_bps(throughput)}"
            if dscp: desc += f", DSCP: {dscp}"
        else:
            desc = f"App {app_name}: no traffic data"

        device_id = edge_id or "unknown"
        if self._resolver and edge_id:
            resolved = await self._resolver.find_device("velocloud", edge_id)
            if resolved:
                device_id = resolved

        return UnifiedEvent(
            event_id=f"vc-app-{uuid4().hex[:12]}",
            timestamp=datetime.now(timezone.utc).replace(tzinfo=None),
            source=EventSource.VELOCLOUD,
            source_event_id=app_id,
            severity=severity,
            category=EventCategory.PERFORMANCE,
            event_type=event_type,
            title=f"App: {app_name}",
            description=desc,
            device=DeviceInfo(
                device_id=device_id,
                device_name=edge_name or app_name,
                device_type="edge",
                site_id="",
                site_name="",
            ),
            tags=["sdwan", "velocloud", "application", "qos"],
            metadata={
                "vc_app_id": app_id,
                "vc_app_name": app_name,
                "vc_edge_id": edge_id,
                "vc_bytes_sent": bytes_sent,
                "vc_bytes_received": bytes_recv,
                "vc_total_bytes": total_bytes,
                "vc_throughput_bps": throughput,
                "vc_dscp": dscp,
            },
            raw_event=raw,
        )


def _format_bytes(b: int) -> str:
    """Format bytes to human-readable string."""
    for unit in ("B", "KB", "MB", "GB"):
        if b < 1024:
            return f"{b:.1f} {unit}"
        b /= 1024
    return f"{b:.1f} TB"


def _format_bps(bps: int) -> str:
    """Format bits per second to human-readable string."""
    for unit in ("bps", "Kbps", "Mbps", "Gbps"):
        if bps < 1000:
            return f"{bps:.1f} {unit}"
        bps /= 1000
    return f"{bps:.1f} Tbps"


# ---------------------------------------------------------------------------
# Main VeloCloud Collector — orchestrates sub-collectors
# ---------------------------------------------------------------------------

class VeloCloudCollector:
    """
    Orchestrates all VeloCloud SD-WAN sub-collectors.

    Authenticates once via API key header, then fans out to each
    sub-collector. Each returns a CollectorOutcome independently.
    """

    def __init__(self):
        settings = get_settings()
        self._base_url = settings.velocloud_url.rstrip("/")
        self._api_key = settings.velocloud_api_key
        self._enabled = settings.velocloud_enabled
        self._client: Optional[httpx.AsyncClient] = None

    @property
    def is_configured(self) -> bool:
        return bool(self._base_url and self._api_key and self._enabled)

    async def _get_enterprise_id(self, client: httpx.AsyncClient) -> Optional[str]:
        """Fetch the enterprise ID from the VeloCloud API."""
        try:
            resp = await client.post(
                f"{self._base_url}/portal/rest/enterprise/getEnterprise",
                json={},
            )
            _raise_for_status(resp)
            data = resp.json()
            if isinstance(data, dict):
                return str(data.get("id", ""))
        except Exception:
            logger.exception("Failed to fetch VeloCloud enterprise ID")
        return None

    async def _fetch_all_edges_data(self, client: httpx.AsyncClient) -> Optional[List[Dict]]:
        """Fetch all edges with links and tunnels embedded in a single call."""
        try:
            resp = await client.post(
                f"{self._base_url}/portal/rest/enterprise/getEnterpriseEdges",
                json={"with": ["site", "links", "tunnels"]},
            )
            _raise_for_status(resp)
            edges_raw = resp.json()
            if not isinstance(edges_raw, list):
                edges_raw = edges_raw.get("data", [])
            return edges_raw
        except Exception:
            logger.exception("Failed to fetch VeloCloud edges data")
            return None

    async def collect_all(self) -> List[CollectorOutcome]:
        """
        Run all VeloCloud sub-collectors.

        Fetches edges ONCE with links + tunnels embedded, then fans out
        to each sub-collector.  Each returns a CollectorOutcome independently.
        The worker records each independently in the telemetry ledger.
        """
        if not self._enabled:
            return self._skipped_outcomes("VeloCloud collector disabled")
        if not self._base_url or not self._api_key:
            return self._skipped_outcomes("VeloCloud credentials not configured")

        outcomes: List[CollectorOutcome] = []

        if self._client is None:
            self._client = httpx.AsyncClient(
                headers={"Authorization": f"Token {self._api_key}", "Content-Type": "application/json"},
                timeout=httpx.Timeout(60.0),
                follow_redirects=True,
            )

        client = self._client

        # Get enterprise ID
        enterprise_id = await self._get_enterprise_id(client)
        if not enterprise_id:
            for cid in ["velocloud-edges", "velocloud-links", "velocloud-tunnels", "velocloud-events", "velocloud-apps"]:
                o = CollectorOutcome(collector_id=cid, source_system="velocloud")
                o.mark_error("Could not fetch VeloCloud enterprise ID")
                outcomes.append(o)
            return outcomes

        # Fetch edges ONCE with links + tunnels embedded
        edges_data = await self._fetch_all_edges_data(client)

        # When edges_data is None, pass empty list so sub-collectors produce
        # empty outcomes (graceful degradation) instead of crashing
        if edges_data is None:
            edges_data = []

        # Share a single identity resolver across all sub-collectors
        resolver = IdentityResolver()

        # Run edges collector (uses pre-fetched data, no extra API call)
        outcomes.append(await VeloCloudEdgesCollector(client, self._base_url, resolver).collect(edges_data))

        # Links collector — extracts links embedded in each edge
        outcomes.append(await VeloCloudLinksCollector(edges_data, resolver).collect())

        # Tunnels collector — extracts tunnels embedded in each edge
        outcomes.append(await VeloCloudTunnelsCollector(edges_data, resolver).collect())

        # Events collector — separate API call, already working
        outcomes.append(await VeloCloudEventsCollector(client, self._base_url, enterprise_id, resolver).collect())

        # Apps collector — tries monitoring API
        outcomes.append(await VeloCloudAppsCollector(client, self._base_url, enterprise_id, edges_data, resolver).collect())

        return outcomes

    async def close(self) -> None:
        """Close the reusable HTTP client."""
        if self._client is not None:
            await self._client.aclose()
            self._client = None

    async def connect(self) -> bool:
        """Validate VeloCloud credentials."""
        if not self.is_configured:
            return False
        try:
            async with httpx.AsyncClient(
                headers={"Authorization": f"Token {self._api_key}", "Content-Type": "application/json"},
                timeout=httpx.Timeout(15.0),
                verify=False,
            ) as client:
                eid = await self._get_enterprise_id(client)
                return bool(eid)
        except Exception:
            logger.exception("VeloCloud connect failed")
            return False

    def _skipped_outcomes(self, reason: str) -> List[CollectorOutcome]:
        ids = ["velocloud-edges", "velocloud-links", "velocloud-tunnels", "velocloud-events", "velocloud-apps"]
        outcomes = []
        for cid in ids:
            o = CollectorOutcome(collector_id=cid, source_system="velocloud")
            o.mark_skipped(reason)
            outcomes.append(o)
        return outcomes


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _raise_for_status(resp: httpx.Response) -> None:
    if resp.status_code >= 400:
        try:
            detail = resp.json()
        except Exception:
            detail = resp.text
        raise VeloCloudApiError(resp.status_code, str(detail))


def _map_vc_severity(level: str) -> EventSeverity:
    """Map VeloCloud event level to EventSeverity."""
    level = level.upper()
    if level in ("CRITICAL", "ALERT", "EMERGENCY"):
        return EventSeverity.CRITICAL
    if level in ("ERROR", "MAJOR"):
        return EventSeverity.MAJOR
    if level in ("WARN", "WARNING"):
        return EventSeverity.WARNING
    return EventSeverity.INFO


def _map_vc_event_type(event_type_str: str, name: str) -> tuple:
    """Map VeloCloud event type to (EventType, EventCategory)."""
    et = event_type_str.lower()
    n = name.lower()

    if "link" in et or "link" in n:
        if "down" in et or "down" in n:
            return EventType.LINK_DOWN, EventCategory.CONNECTIVITY
        return EventType.LINK_UP, EventCategory.CONNECTIVITY
    if "tunnel" in et or "tunnel" in n:
        if "down" in et or "down" in n:
            return EventType.TUNNEL_DOWN, EventCategory.CONNECTIVITY
        return EventType.TUNNEL_UP, EventCategory.CONNECTIVITY
    if "edge" in et and ("offline" in et or "disconnected" in et):
        return EventType.DEVICE_UNREACHABLE, EventCategory.CONNECTIVITY
    if "latency" in et or "latency" in n:
        return EventType.HIGH_LATENCY, EventCategory.PERFORMANCE
    if "loss" in et or "loss" in n:
        return EventType.PACKET_LOSS, EventCategory.PERFORMANCE
    if "jitter" in et or "jitter" in n:
        return EventType.JITTER, EventCategory.PERFORMANCE
    if "cpu" in et or "memory" in et:
        return EventType.HIGH_CPU, EventCategory.PERFORMANCE

    return EventType.OTHER, EventCategory.SYSTEM
