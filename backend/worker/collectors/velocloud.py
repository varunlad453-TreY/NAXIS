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

    def __init__(self, client: httpx.AsyncClient, base_url: str):
        self._client = client
        self._base = base_url

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
                json={"with": ["site"]},
            )
            _raise_for_status(resp)
            edges_raw = resp.json()
            if not isinstance(edges_raw, list):
                edges_raw = edges_raw.get("data", [])

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

    ponytail: No known POST endpoint for per-edge links. Returns empty.
    Add when VCO exposes a working link metrics endpoint.
    """

    COLLECTOR_ID = "velocloud-links"
    SOURCE_SYSTEM = "velocloud"

    def __init__(self, client: httpx.AsyncClient, base_url: str, enterprise_id: int):
        self._client = client
        self._base = base_url
        self._enterprise_id = enterprise_id

    async def collect(self) -> CollectorOutcome:
        outcome = CollectorOutcome(
            collector_id=self.COLLECTOR_ID,
            source_system=self.SOURCE_SYSTEM,
        )
        outcome.mark_skipped("No working API endpoint for per-edge links")
        return outcome


class VeloCloudTunnelsCollector:
    """Fetches tunnel health and encryption status from VeloCloud.

    ponytail: No known POST endpoint for per-edge tunnels. Returns empty.
    Add when VCO exposes a working tunnel endpoint.
    """

    COLLECTOR_ID = "velocloud-tunnels"
    SOURCE_SYSTEM = "velocloud"

    def __init__(self, client: httpx.AsyncClient, base_url: str, enterprise_id: int):
        self._client = client
        self._base = base_url
        self._enterprise_id = enterprise_id

    async def collect(self) -> CollectorOutcome:
        outcome = CollectorOutcome(
            collector_id=self.COLLECTOR_ID,
            source_system=self.SOURCE_SYSTEM,
        )
        outcome.mark_skipped("No working API endpoint for per-edge tunnels")
        return outcome


class VeloCloudEventsCollector:
    """Fetches enterprise events and alarms from VeloCloud."""

    COLLECTOR_ID = "velocloud-events"
    SOURCE_SYSTEM = "velocloud"

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
                device_id=edge_id or "unknown",
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

    ponytail: No known POST endpoint for per-edge apps. Returns empty.
    Add when VCO exposes a working app visibility endpoint.
    """

    COLLECTOR_ID = "velocloud-apps"
    SOURCE_SYSTEM = "velocloud"

    def __init__(self, client: httpx.AsyncClient, base_url: str, enterprise_id: int):
        self._client = client
        self._base = base_url
        self._enterprise_id = enterprise_id

    async def collect(self) -> CollectorOutcome:
        outcome = CollectorOutcome(
            collector_id=self.COLLECTOR_ID,
            source_system=self.SOURCE_SYSTEM,
        )
        outcome.mark_skipped("No working API endpoint for per-edge app metrics")
        return outcome


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
            timeout=httpx.Timeout(60.0),
            follow_redirects=True,
        ) as client:
            # Get enterprise ID
            enterprise_id = await self._get_enterprise_id(client)
            if not enterprise_id:
                err = CollectorOutcome(collector_id="velocloud-auth", source_system="velocloud")
                err.mark_error("Could not fetch VeloCloud enterprise ID")
                return [err]

            # Create sub-collectors with the shared client
            edges_collector = VeloCloudEdgesCollector(client, self._base_url)
            events_collector = VeloCloudEventsCollector(client, self._base_url, enterprise_id)

            # Run edges collector
            outcomes.append(await edges_collector.collect())

            # Run remaining sub-collectors
            outcomes.append(await events_collector.collect())
            outcomes.append(await VeloCloudLinksCollector(client, self._base_url, enterprise_id).collect())
            outcomes.append(await VeloCloudTunnelsCollector(client, self._base_url, enterprise_id).collect())
            outcomes.append(await VeloCloudAppsCollector(client, self._base_url, enterprise_id).collect())

        return outcomes

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
