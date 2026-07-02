"""
VeloCloud SD-WAN Events Collector

Pulls edge-level fault and state-change events from VeloCloud Orchestrator
via the REST API and normalizes them to UnifiedEvent.

Endpoints used:
  POST /portal/rest/event/getEnterpriseEvents
      → All org-level events with severity, type, and edge association.

Auth: JWT Bearer token (VELOCLOUD_API_KEY).
Runs every collector cycle; deduplication is handled by the DB primary key.
"""

import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional
from uuid import uuid4

import httpx
from tenacity import retry, retry_if_exception_type, stop_after_attempt, wait_exponential

from config.settings import get_settings
from shared.models.event import (
    DeviceInfo,
    EventCategory,
    EventSeverity,
    EventSource,
    EventType,
    UnifiedEvent,
)

logger = logging.getLogger(__name__)

_PAGE_LIMIT = 100
_MAX_PAGES = 20


class VelocloudEventsCollector:
    """
    Collects fault/state events from VeloCloud and normalizes to UnifiedEvent.

    VeloCloud exposes events via a POST endpoint that accepts a time range and
    enterprise ID. Events include edge state changes (CONNECTED/OFFLINE/DEGRADED),
    HA failovers, configuration changes, and link quality alerts.
    """

    def __init__(self):
        settings = get_settings()
        self._base_url = settings.velocloud_url.rstrip("/")
        self._api_key = settings.velocloud_api_key
        self._enabled = settings.velocloud_enabled
        self._headers = {
            "Authorization": f"Token {self._api_key}",
            "Content-Type": "application/json",
        }

    async def collect(self, since: Optional[datetime] = None) -> List[UnifiedEvent]:
        if not self._enabled or not self._api_key or not self._base_url:
            return []

        if since is None:
            since = datetime.now(timezone.utc) - timedelta(minutes=5)

        async with httpx.AsyncClient(
            headers=self._headers,
            timeout=httpx.Timeout(30.0),
            follow_redirects=True,
            verify=False,
        ) as client:
            enterprise_id = await self._fetch_enterprise_id(client)
            if not enterprise_id:
                return []
            raw_events = await self._fetch_events(client, enterprise_id, since)

        events: List[UnifiedEvent] = []
        for raw in raw_events:
            try:
                events.append(self._normalize(raw))
            except Exception:
                logger.exception("Failed to normalize VeloCloud event: %s", raw.get("id"))

        logger.info("VeloCloud events collector: %d events collected", len(events))
        return events

    async def _fetch_enterprise_id(self, client: httpx.AsyncClient) -> Optional[int]:
        try:
            r = await client.post(
                f"{self._base_url}/portal/rest/enterprise/getEnterprise", json={}
            )
            r.raise_for_status()
            return r.json().get("id")
        except Exception as exc:
            logger.error("VeloCloud events: failed to get enterprise ID: %s", exc)
            return None

    @retry(
        retry=retry_if_exception_type(httpx.TransportError),
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=2, max=10),
        reraise=True,
    )
    async def _fetch_events(
        self,
        client: httpx.AsyncClient,
        enterprise_id: int,
        since: datetime,
    ) -> List[Dict]:
        """Paginate through /event/getEnterpriseEvents."""
        results: List[Dict] = []
        start_ms = int(since.timestamp() * 1000)
        import time
        end_ms = int(time.time() * 1000)

        next_page_start = None
        for page in range(_MAX_PAGES):
            payload: Dict[str, Any] = {
                "enterpriseId": enterprise_id,
                "interval": {"start": start_ms, "end": end_ms},
                "limit": _PAGE_LIMIT,
            }
            if next_page_start is not None:
                payload["nextPageStart"] = next_page_start

            try:
                r = await client.post(
                    f"{self._base_url}/portal/rest/event/getEnterpriseEvents",
                    json=payload,
                )
                r.raise_for_status()
                body = r.json()
            except Exception as exc:
                logger.error("VeloCloud events fetch failed page %d: %s", page + 1, exc)
                break

            # VCO wraps results in {"data": [...], "metaData": {"more": bool, "nextPageStart": ...}}
            if isinstance(body, dict):
                page_items = body.get("data", body) if "data" in body else body
                meta = body.get("metaData", {})
            else:
                page_items = body
                meta = {}

            if isinstance(page_items, list):
                results.extend(page_items)

            if not meta.get("more", False) or len(page_items) < _PAGE_LIMIT:
                break
            next_page_start = meta.get("nextPageStart")

        return results

    def _normalize(self, raw: Dict[str, Any]) -> UnifiedEvent:
        ts_raw = raw.get("eventTime") or raw.get("createdWhen") or ""
        try:
            timestamp = datetime.fromisoformat(ts_raw.replace("Z", "+00:00")).replace(tzinfo=None)
        except Exception:
            timestamp = datetime.utcnow()

        severity = _map_severity(raw.get("severity", "INFO"))
        event_type_str = raw.get("event", raw.get("type", "UNKNOWN"))
        event_type, category = _map_event_type(event_type_str)

        edge_name = raw.get("edgeName", "") or raw.get("enterpriseName", "") or "unknown"
        edge_id = str(raw.get("edgeId", "")) or raw.get("edgeLogicalId", "") or "unknown"
        site_name = raw.get("siteName", "") or ""

        device = DeviceInfo(
            device_id=edge_id,
            device_name=edge_name,
            device_type="edge",
            site_id=str(raw.get("siteId", "")) or edge_id,
            site_name=site_name,
        )

        detail = raw.get("detail", "") or raw.get("message", "") or event_type_str
        title = event_type_str.replace("_", " ").title()

        return UnifiedEvent(
            event_id=f"velo-{uuid4().hex[:12]}",
            timestamp=timestamp,
            source=EventSource.VELOCLOUD,
            source_event_id=str(raw.get("id", "")),
            severity=severity,
            category=category,
            event_type=event_type,
            title=title,
            description=detail,
            device=device,
            tags=["sdwan", "velocloud"],
            metadata={
                "vco_enterprise_id": raw.get("enterpriseId"),
                "vco_edge_id": raw.get("edgeId"),
                "vco_event_type": event_type_str,
            },
            raw_event=raw,
        )


def _map_severity(value: str) -> EventSeverity:
    mapping = {
        "CRITICAL": EventSeverity.CRITICAL,
        "ERROR": EventSeverity.MAJOR,
        "WARNING": EventSeverity.WARNING,
        "NOTICE": EventSeverity.INFO,
        "INFO": EventSeverity.INFO,
        "DEBUG": EventSeverity.DEBUG,
        "ALERT": EventSeverity.CRITICAL,
    }
    return mapping.get(str(value).upper(), EventSeverity.INFO)


def _map_event_type(event_str: str):
    t = event_str.upper()
    if "EDGE_DOWN" in t or "OFFLINE" in t:
        return EventType.LINK_DOWN, EventCategory.CONNECTIVITY
    if "EDGE_UP" in t or "CONNECTED" in t:
        return EventType.LINK_UP, EventCategory.CONNECTIVITY
    if "EDGE_DEGRADED" in t or "DEGRADED" in t:
        return EventType.LINK_DOWN, EventCategory.CONNECTIVITY
    if "LINK_DEAD" in t or "LINK_ALIVE" in t:
        return (EventType.LINK_DOWN if "DEAD" in t else EventType.LINK_UP), EventCategory.CONNECTIVITY
    if "BGP" in t and "DOWN" in t:
        return EventType.BGP_DOWN, EventCategory.CONNECTIVITY
    if "BGP" in t and "UP" in t:
        return EventType.BGP_UP, EventCategory.CONNECTIVITY
    if "TUNNEL" in t and ("DOWN" in t or "DEAD" in t):
        return EventType.TUNNEL_DOWN, EventCategory.CONNECTIVITY
    if "TUNNEL" in t:
        return EventType.TUNNEL_UP, EventCategory.CONNECTIVITY
    if "HA_FAILOVER" in t or "FAILOVER" in t:
        return EventType.LINK_DOWN, EventCategory.CONNECTIVITY
    if "CONFIG" in t:
        return EventType.CONFIG_CHANGE, EventCategory.CONFIGURATION
    if "FIRMWARE" in t or "SOFTWARE" in t:
        return EventType.FIRMWARE_UPGRADE, EventCategory.CONFIGURATION
    if "CPU" in t:
        return EventType.HIGH_CPU, EventCategory.PERFORMANCE
    if "MEMORY" in t or "MEM" in t:
        return EventType.HIGH_MEMORY, EventCategory.PERFORMANCE
    if "AUTH" in t:
        return EventType.AUTH_FAILURE, EventCategory.SECURITY
    if "REBOOT" in t:
        return EventType.DEVICE_REBOOT, EventCategory.SYSTEM
    return EventType.OTHER, EventCategory.SYSTEM
