"""
VeloCloud SD-WAN Collector

Polls the VeloCloud Orchestrator's JSON-RPC-style REST API (POST /portal/rest/<module>/<action>):
  - Edge appliance inventory       (enterprise/getEnterpriseEdges)
  - Link inventory + VPN/tunnel state (edge/getEdge, with=["links"])
  - Link metrics (latency, jitter, loss)  (metrics/getEdgeLinkMetrics)
  - Enterprise events, alarms      (event/getEnterpriseEvents)
  - Application visibility, QoS    (metrics/getEdgeAppMetrics)

Auth: API key via header `Authorization: Token <api_key>` (NOT X-API-KEY —
this Orchestrator generation rejects that header with a tokenError).
Tunnel health is not a separate endpoint on this API generation; VPN/tunnel
state is carried on each entry in the `links` array returned by edge/getEdge.
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

    def __init__(self, client: httpx.AsyncClient, base_url: str, enterprise_id: str):
        self._client = client
        self._base = base_url
        self._enterprise_id = enterprise_id

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
            resp = await self._client.post(
                f"{self._base}/portal/rest/enterprise/getEnterpriseEdges",
                json={"enterpriseId": self._enterprise_id},
            )
            _raise_for_status(resp)
            edges_raw = resp.json()
            if isinstance(edges_raw, dict):
                edges_raw = edges_raw.get("data", [])
            edges_raw = edges_raw[:_MAX_EDGES]

            events: List[UnifiedEvent] = []
            for edge in edges_raw:
                events.append(self._normalize_edge(edge))

            outcome.events = events
            outcome.mark_success(rows_written=len(events))
            outcome.metadata["raw_count"] = len(edges_raw)
            logger.info("VeloCloud edges: %d edges collected", len(events))
        except Exception as exc:
            outcome.mark_error(str(exc))
            logger.exception("VeloCloud edges collection failed")
        return outcome

    def _normalize_edge(self, raw: Dict[str, Any]) -> UnifiedEvent:
        edge_id = str(raw.get("id", f"vc-{uuid4().hex[:8]}"))
        name = raw.get("name", "unknown")
        edge_type = raw.get("edgeType", "")
        enterprise_id = raw.get("enterpriseId", "")
        site_id = raw.get("siteId", "")
        site_name = raw.get("siteName", "")
        model_number = raw.get("modelNumber", "")
        software_version = raw.get("softwareVersion", "")

        # Edge state: connected, disconnected, etc.
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
                device_id=edge_id,
                device_name=name,
                device_type="edge",
                device_model=model_number,
                site_id=str(site_id) if site_id else None,
                site_name=site_name or None,
            ),
            tags=["sdwan", "velocloud", "edge", "inventory"],
            metadata={
                "vc_edge_id": edge_id,
                "vc_edge_type": edge_type,
                "vc_enterprise_id": str(enterprise_id),
                "vc_site_id": str(site_id),
                "vc_model": model_number,
                "vc_sw_version": software_version,
                "vc_edge_state": edge_state,
            },
            raw_event=raw,
        )


class VeloCloudLinksCollector:
    """Fetches per-edge link inventory (state, ISP, VPN) plus latency/jitter/loss metrics."""

    COLLECTOR_ID = "velocloud-links"
    SOURCE_SYSTEM = "velocloud"
    _METRICS_WINDOW_HOURS = 24

    def __init__(self, client: httpx.AsyncClient, base_url: str, enterprise_id: int, edge_ids: Optional[List[tuple]] = None):
        self._client = client
        self._base = base_url
        self._enterprise_id = enterprise_id
        self._edge_ids = edge_ids

    async def collect(self) -> CollectorOutcome:
        outcome = CollectorOutcome(
            collector_id=self.COLLECTOR_ID,
            source_system=self.SOURCE_SYSTEM,
        )
        try:
            edges = self._edge_ids or await self._fetch_edge_ids()

            events: List[UnifiedEvent] = []
            for edge_id, edge_name in edges:
                links = await self._fetch_links(edge_id)
                metrics_by_link = await self._fetch_link_metrics(edge_id)
                for link in links:
                    try:
                        metrics = metrics_by_link.get(link.get("id"), {})
                        event = self._normalize_link(edge_id, edge_name, link, metrics)
                        if event is not None:
                            events.append(event)
                    except Exception:
                        logger.exception("Failed to normalize VeloCloud link for edge %s", edge_id)

            outcome.events = events
            outcome.mark_success(rows_written=len(events))
            outcome.metadata["edges_scanned"] = len(edges)
            logger.info("VeloCloud links: %d link metrics from %d edges", len(events), len(edges))
        except Exception as exc:
            outcome.mark_error(str(exc))
            logger.exception("VeloCloud links collection failed")
        return outcome

    async def _fetch_edge_ids(self) -> List[tuple]:
        """Returns list of (edge_id, edge_name)."""
        try:
            resp = await self._client.post(
                f"{self._base}/portal/rest/enterprise/getEnterpriseEdges",
                json={"enterpriseId": self._enterprise_id},
            )
            _raise_for_status(resp)
            edges = resp.json()
            if isinstance(edges, dict):
                edges = edges.get("data", [])
            return [(e["id"], e.get("name", "")) for e in edges if e.get("id")][:20]
        except Exception:
            logger.exception("Failed to fetch VeloCloud edges for links")
            return []

    async def _fetch_links(self, edge_id: int) -> List[Dict]:
        try:
            resp = await self._client.post(
                f"{self._base}/portal/rest/edge/getEdge",
                json={"enterpriseId": self._enterprise_id, "edgeId": edge_id, "with": ["links"]},
            )
            if resp.status_code == 200:
                return resp.json().get("links", [])
        except Exception:
            logger.debug("Failed to fetch links for edge %s", edge_id)
        return []

    async def _fetch_link_metrics(self, edge_id: int) -> Dict[int, Dict]:
        """Returns {linkId: metrics} for the trailing metrics window."""
        try:
            end = datetime.now(timezone.utc)
            start = end.replace(hour=0, minute=0, second=0, microsecond=0)
            resp = await self._client.post(
                f"{self._base}/portal/rest/metrics/getEdgeLinkMetrics",
                json={
                    "enterpriseId": self._enterprise_id,
                    "edgeId": edge_id,
                    "interval": {"start": start.isoformat(), "end": end.isoformat()},
                },
            )
            if resp.status_code != 200:
                return {}
            rows = resp.json()
            return {row["linkId"]: row for row in rows if row.get("linkId") is not None}
        except Exception:
            logger.debug("Failed to fetch link metrics for edge %s", edge_id)
            return {}

    def _normalize_link(
        self, edge_id: int, edge_name: str, raw: Dict[str, Any], metrics: Dict[str, Any]
    ) -> Optional[UnifiedEvent]:
        link_id = raw.get("id")
        if link_id is None:
            return None

        link_type = raw.get("networkType", "")
        isp = raw.get("isp", "")
        ip = raw.get("ipAddress", "")
        state = raw.get("state", "unknown")
        vpn_state = raw.get("vpnState", "unknown")

        latency = metrics.get("bestLatencyMsRx") or metrics.get("bestLatencyMsTx") or 0
        jitter = metrics.get("bestJitterMsRx") or metrics.get("bestJitterMsTx") or 0
        loss = metrics.get("bestLossPctRx") or metrics.get("bestLossPctTx") or 0

        if state.upper() in ("DISCONNECTED", "DOWN"):
            severity = EventSeverity.CRITICAL
            event_type = EventType.LINK_DOWN
        elif isinstance(loss, (int, float)) and loss > 5:
            severity = EventSeverity.CRITICAL
            event_type = EventType.PACKET_LOSS
        elif isinstance(latency, (int, float)) and latency > 100:
            severity = EventSeverity.WARNING
            event_type = EventType.HIGH_LATENCY
        else:
            severity = EventSeverity.INFO
            event_type = EventType.LINK_UP

        description = (
            f"Link {link_type} ({isp}) on edge {edge_name} — state: {state}, "
            f"latency: {latency:.1f}ms, jitter: {jitter:.2f}ms, loss: {loss:.2f}%"
        )

        return UnifiedEvent(
            event_id=f"vc-link-{uuid4().hex[:12]}",
            timestamp=datetime.now(timezone.utc).replace(tzinfo=None),
            source=EventSource.VELOCLOUD,
            source_event_id=f"vc-link-{edge_id}-{link_id}",
            severity=severity,
            category=EventCategory.PERFORMANCE,
            event_type=event_type,
            title=f"Link: {link_type} ({edge_name})",
            description=description,
            device=DeviceInfo(
                device_id=str(edge_id),
                device_name=edge_name,
                device_type="edge",
            ),
            tags=["sdwan", "velocloud", "link", "performance"],
            metadata={
                "vc_edge_id": str(edge_id),
                "vc_link_id": str(link_id),
                "vc_link_type": link_type,
                "vc_isp": isp,
                "vc_ip": ip,
                "vc_latency_ms": latency,
                "vc_jitter_ms": jitter,
                "vc_loss_percent": loss,
                "vc_link_state": state,
                "vc_vpn_state": vpn_state,
            },
            raw_event=raw,
        )


class VeloCloudTunnelsCollector:
    """Derives VPN/tunnel health from each edge's link inventory.

    This VCO API generation has no dedicated tunnel endpoint — overlay
    tunnel state is the `vpnState` field on each entry returned by
    edge/getEdge's `links` array (one overlay tunnel per WAN link).
    """

    COLLECTOR_ID = "velocloud-tunnels"
    SOURCE_SYSTEM = "velocloud"

    def __init__(self, client: httpx.AsyncClient, base_url: str, enterprise_id: int, edge_ids: Optional[List[tuple]] = None):
        self._client = client
        self._base = base_url
        self._enterprise_id = enterprise_id
        self._edge_ids = edge_ids

    async def collect(self) -> CollectorOutcome:
        outcome = CollectorOutcome(
            collector_id=self.COLLECTOR_ID,
            source_system=self.SOURCE_SYSTEM,
        )
        try:
            edges = self._edge_ids or await self._fetch_edge_ids()

            events: List[UnifiedEvent] = []
            for edge_id, edge_name in edges:
                links = await self._fetch_links(edge_id)
                for link in links:
                    try:
                        event = self._normalize_tunnel(edge_id, edge_name, link)
                        if event is not None:
                            events.append(event)
                    except Exception:
                        logger.exception("Failed to normalize VeloCloud tunnel for edge %s", edge_id)

            outcome.events = events
            outcome.mark_success(rows_written=len(events))
            outcome.metadata["edges_scanned"] = len(edges)
            logger.info("VeloCloud tunnels: %d tunnels from %d edges", len(events), len(edges))
        except Exception as exc:
            outcome.mark_error(str(exc))
            logger.exception("VeloCloud tunnels collection failed")
        return outcome

    async def _fetch_edge_ids(self) -> List[tuple]:
        try:
            resp = await self._client.post(
                f"{self._base}/portal/rest/enterprise/getEnterpriseEdges",
                json={"enterpriseId": self._enterprise_id},
            )
            _raise_for_status(resp)
            edges = resp.json()
            if isinstance(edges, dict):
                edges = edges.get("data", [])
            return [(e["id"], e.get("name", "")) for e in edges if e.get("id")][:20]
        except Exception:
            logger.exception("Failed to fetch VeloCloud edges for tunnels")
            return []

    async def _fetch_links(self, edge_id: int) -> List[Dict]:
        try:
            resp = await self._client.post(
                f"{self._base}/portal/rest/edge/getEdge",
                json={"enterpriseId": self._enterprise_id, "edgeId": edge_id, "with": ["links"]},
            )
            if resp.status_code == 200:
                return resp.json().get("links", [])
        except Exception:
            logger.debug("Failed to fetch links for tunnels on edge %s", edge_id)
        return []

    def _normalize_tunnel(self, edge_id: int, edge_name: str, raw: Dict[str, Any]) -> Optional[UnifiedEvent]:
        link_id = raw.get("id")
        if link_id is None:
            return None

        link_type = raw.get("networkType", "")
        remote_isp = raw.get("isp", "")
        vpn_state = str(raw.get("vpnState", "unknown"))
        link_state = str(raw.get("state", "unknown"))

        if vpn_state.upper() in ("STABLE",) and link_state.upper() not in ("DISCONNECTED", "DOWN"):
            severity = EventSeverity.INFO
            event_type = EventType.TUNNEL_UP
        elif link_state.upper() in ("DISCONNECTED", "DOWN"):
            severity = EventSeverity.CRITICAL
            event_type = EventType.TUNNEL_DOWN
        else:
            severity = EventSeverity.WARNING
            event_type = EventType.OTHER

        description = (
            f"Tunnel over {link_type} ({remote_isp}) on {edge_name} — "
            f"link state: {link_state}, VPN state: {vpn_state}"
        )

        return UnifiedEvent(
            event_id=f"vc-tunnel-{uuid4().hex[:12]}",
            timestamp=datetime.now(timezone.utc).replace(tzinfo=None),
            source=EventSource.VELOCLOUD,
            source_event_id=f"vc-tunnel-{edge_id}-{link_id}",
            severity=severity,
            category=EventCategory.CONNECTIVITY,
            event_type=event_type,
            title=f"Tunnel: {link_type} ({edge_name})",
            description=description,
            device=DeviceInfo(
                device_id=str(edge_id),
                device_name=edge_name,
                device_type="edge",
            ),
            tags=["sdwan", "velocloud", "tunnel"],
            metadata={
                "vc_edge_id": str(edge_id),
                "vc_link_id": str(link_id),
                "vc_link_type": link_type,
                "vc_isp": remote_isp,
                "vc_link_state": link_state,
                "vc_vpn_state": vpn_state,
            },
            raw_event=raw,
        )


class VeloCloudEventsCollector:
    """Fetches enterprise events and alarms from VeloCloud."""

    COLLECTOR_ID = "velocloud-events"
    SOURCE_SYSTEM = "velocloud"

    _WINDOW_HOURS = 24

    def __init__(self, client: httpx.AsyncClient, base_url: str, enterprise_id: int):
        self._client = client
        self._base = base_url
        self._enterprise_id = enterprise_id

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
            end = datetime.now(timezone.utc)
            start = end.replace(hour=0, minute=0, second=0, microsecond=0)
            resp = await self._client.post(
                f"{self._base}/portal/rest/event/getEnterpriseEvents",
                json={
                    "enterpriseId": self._enterprise_id,
                    "interval": {"start": start.isoformat(), "end": end.isoformat()},
                    "limit": 200,
                },
            )
            _raise_for_status(resp)
            body = resp.json()
            events_raw = body.get("data", []) if isinstance(body, dict) else body

            events: List[UnifiedEvent] = []
            for raw in events_raw:
                try:
                    events.append(self._normalize_event(raw))
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

    def _normalize_event(self, raw: Dict[str, Any]) -> UnifiedEvent:
        event_id = raw.get("id", f"vc-{uuid4().hex[:8]}")
        event_time = raw.get("eventTime")
        try:
            timestamp = datetime.fromisoformat(str(event_time).replace("Z", "+00:00")).replace(tzinfo=None)
        except (TypeError, ValueError):
            timestamp = datetime.now(timezone.utc).replace(tzinfo=None)

        level = str(raw.get("severity", "INFO")).upper()
        severity = _map_vc_severity(level)

        name = raw.get("message", "VeloCloud Event")
        edge_name = raw.get("edgeName", "")
        event_type_str = raw.get("event", "")

        event_type, category = _map_vc_event_type(event_type_str, name)

        description = name
        if edge_name:
            description = f"{edge_name}: {description}"

        return UnifiedEvent(
            event_id=f"vc-event-{uuid4().hex[:12]}",
            timestamp=timestamp,
            source=EventSource.VELOCLOUD,
            source_event_id=str(event_id),
            severity=severity,
            category=category,
            event_type=event_type,
            title=name[:120],
            description=description,
            device=DeviceInfo(
                device_id=edge_name,
                device_name=edge_name,
                device_type="edge",
            ) if edge_name else None,
            tags=["sdwan", "velocloud", "event"],
            metadata={
                "vc_event_id": str(event_id),
                "vc_level": level,
                "vc_edge_name": edge_name,
                "vc_event_type": event_type_str,
            },
            raw_event=raw,
        )


class VeloCloudAppsCollector:
    """Fetches application visibility and QoS metrics from VeloCloud."""

    COLLECTOR_ID = "velocloud-apps"
    SOURCE_SYSTEM = "velocloud"

    _WINDOW_HOURS = 24

    def __init__(self, client: httpx.AsyncClient, base_url: str, enterprise_id: int, edge_ids: Optional[List[tuple]] = None):
        self._client = client
        self._base = base_url
        self._enterprise_id = enterprise_id
        self._edge_ids = edge_ids

    async def collect(self) -> CollectorOutcome:
        outcome = CollectorOutcome(
            collector_id=self.COLLECTOR_ID,
            source_system=self.SOURCE_SYSTEM,
        )
        try:
            edges = self._edge_ids or await self._fetch_edge_ids()

            events: List[UnifiedEvent] = []
            for edge_id, edge_name in edges:
                apps = await self._fetch_apps(edge_id)
                for app in apps:
                    try:
                        event = self._normalize_app(edge_id, edge_name, app)
                        if event is not None:
                            events.append(event)
                    except Exception:
                        logger.exception("Failed to normalize VeloCloud app for edge %s", edge_id)

            outcome.events = events
            outcome.mark_success(rows_written=len(events))
            outcome.metadata["edges_scanned"] = len(edges)
            logger.info("VeloCloud apps: %d app entries from %d edges", len(events), len(edges))
        except Exception as exc:
            outcome.mark_error(str(exc))
            logger.exception("VeloCloud apps collection failed")
        return outcome

    async def _fetch_edge_ids(self) -> List[tuple]:
        try:
            resp = await self._client.post(
                f"{self._base}/portal/rest/enterprise/getEnterpriseEdges",
                json={"enterpriseId": self._enterprise_id},
            )
            _raise_for_status(resp)
            edges = resp.json()
            if isinstance(edges, dict):
                edges = edges.get("data", [])
            return [(e["id"], e.get("name", "")) for e in edges if e.get("id")][:20]
        except Exception:
            logger.exception("Failed to fetch VeloCloud edges for apps")
            return []

    async def _fetch_apps(self, edge_id: int) -> List[Dict]:
        try:
            end = datetime.now(timezone.utc)
            start = end.replace(hour=0, minute=0, second=0, microsecond=0)
            resp = await self._client.post(
                f"{self._base}/portal/rest/metrics/getEdgeAppMetrics",
                json={
                    "enterpriseId": self._enterprise_id,
                    "edgeId": edge_id,
                    "interval": {"start": start.isoformat(), "end": end.isoformat()},
                },
            )
            if resp.status_code == 200:
                data = resp.json()
                return data if isinstance(data, list) else []
        except Exception:
            logger.debug("Failed to fetch apps for edge %s", edge_id)
        return []

    def _normalize_app(self, edge_id: int, edge_name: str, raw: Dict[str, Any]) -> Optional[UnifiedEvent]:
        # This VCO tenant returns numeric application/category codes rather
        # than resolved names — no app-name lookup endpoint was available.
        app_id = raw.get("application")
        if app_id is None:
            return None

        bytes_rx = raw.get("bytesRx", 0)
        bytes_tx = raw.get("bytesTx", 0)
        packets_rx = raw.get("packetsRx", 0)
        packets_tx = raw.get("packetsTx", 0)
        flow_count = raw.get("flowCount", 0)
        app_label = f"app-{app_id}"

        description = (
            f"App {app_label} on {edge_name} — RX: {bytes_rx}B, TX: {bytes_tx}B, flows: {flow_count}"
        )

        return UnifiedEvent(
            event_id=f"vc-app-{uuid4().hex[:12]}",
            timestamp=datetime.now(timezone.utc).replace(tzinfo=None),
            source=EventSource.VELOCLOUD,
            source_event_id=f"vc-app-{edge_id}-{app_id}-{uuid4().hex[:8]}",
            severity=EventSeverity.INFO,
            category=EventCategory.APPLICATION,
            event_type=EventType.OTHER,
            title=f"App: {app_label} ({edge_name})",
            description=description,
            device=DeviceInfo(
                device_id=str(edge_id),
                device_name=edge_name,
                device_type="edge",
            ),
            tags=["sdwan", "velocloud", "application"],
            metadata={
                "vc_edge_id": str(edge_id),
                "vc_app_id": app_id,
                "vc_bytes_rx": bytes_rx,
                "vc_bytes_tx": bytes_tx,
                "vc_packets_rx": packets_rx,
                "vc_packets_tx": packets_tx,
                "vc_flow_count": flow_count,
            },
            raw_event=raw,
        )


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
        self._enterprise_id_override = (settings.velocloud_enterprise_id or "").strip()
        self._enabled = settings.velocloud_enabled

    @property
    def is_configured(self) -> bool:
        return bool(self._base_url and self._api_key and self._enabled)

    async def _get_enterprise_id(self, client: httpx.AsyncClient) -> Optional[int]:
        """Return the enterprise ID as an int: prefer the configured override, else discover.

        The Orchestrator's RPC methods reject a string enterpriseId with
        "invalid enterprise context" — it must be sent as a JSON integer.
        """
        if self._enterprise_id_override:
            try:
                return int(self._enterprise_id_override)
            except ValueError:
                logger.error("VELOCLOUD_ENTERPRISE_ID is not a valid integer: %r", self._enterprise_id_override)
                return None

        try:
            resp = await client.post(f"{self._base_url}/portal/rest/enterprise/getEnterprise", json={})
            _raise_for_status(resp)
            data = resp.json()
            eid = data.get("id") if isinstance(data, dict) else None
            if eid is not None:
                return int(eid)
        except Exception:
            logger.exception("VeloCloud enterprise discovery failed")
        return None

    async def collect_all(self) -> List[CollectorOutcome]:
        """
        Run all VeloCloud sub-collectors.

        Returns a list of CollectorOutcome — one per sub-collector.
        The worker records each independently in the telemetry ledger.
        """
        if not self._enabled:
            return [self._skipped_outcome("VeloCloud collector disabled")]
        if not self._base_url or not self._api_key:
            return [self._skipped_outcome("VeloCloud credentials not configured")]

        outcomes: List[CollectorOutcome] = []

        async with httpx.AsyncClient(
            headers={"Authorization": f"Token {self._api_key}", "Content-Type": "application/json"},
            timeout=httpx.Timeout(30.0),
            follow_redirects=True,
        ) as client:
            # Get enterprise ID
            enterprise_id = await self._get_enterprise_id(client)
            if not enterprise_id:
                auth_msg = (
                    "VeloCloud auth failed: could not discover enterprise ID. "
                    "Set VELOCLOUD_ENTERPRISE_ID in config/.env, or verify the API key has portal access."
                )
                for cid in ("velocloud-edges", "velocloud-events", "velocloud-links", "velocloud-tunnels", "velocloud-apps"):
                    o = CollectorOutcome(collector_id=cid, source_system="velocloud")
                    o.mark_error(auth_msg)
                    outcomes.append(o)
                return outcomes

            # Create sub-collectors with the shared client
            edges_collector = VeloCloudEdgesCollector(client, self._base_url, enterprise_id)
            events_collector = VeloCloudEventsCollector(client, self._base_url, enterprise_id)

            # Run edges collector first — reuse its edge list for downstream collectors
            edges_outcome = await edges_collector.collect()
            outcomes.append(edges_outcome)

            # Build edge_ids list from the edges collector's raw data
            edge_ids: Optional[List[tuple]] = None
            if edges_outcome.events:
                edge_ids = []
                for ev in edges_outcome.events:
                    eid = ev.metadata.get("vc_edge_id", "")
                    ename = ev.device.device_name if ev.device else ""
                    if eid:
                        edge_ids.append((int(eid), ename or ""))

            links = VeloCloudLinksCollector(client, self._base_url, enterprise_id, edge_ids=edge_ids)
            tunnels = VeloCloudTunnelsCollector(client, self._base_url, enterprise_id, edge_ids=edge_ids)
            apps = VeloCloudAppsCollector(client, self._base_url, enterprise_id, edge_ids=edge_ids)

            # Run remaining sub-collectors
            outcomes.append(await events_collector.collect())
            outcomes.append(await links.collect())
            outcomes.append(await tunnels.collect())
            outcomes.append(await apps.collect())

        return outcomes

    async def connect(self) -> bool:
        """Validate VeloCloud credentials."""
        if not self.is_configured:
            return False
        try:
            async with httpx.AsyncClient(
                headers={"Authorization": f"Token {self._api_key}"},
                timeout=httpx.Timeout(15.0),
            ) as client:
                eid = await self._get_enterprise_id(client)
                return bool(eid)
        except Exception:
            logger.exception("VeloCloud connect failed")
            return False

    def _skipped_outcome(self, reason: str) -> CollectorOutcome:
        outcome = CollectorOutcome(
            collector_id="velocloud-edges",
            source_system="velocloud",
        )
        outcome.mark_skipped(reason)
        return outcome


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
