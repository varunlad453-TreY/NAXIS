"""
Juniper Mist Collector

Polls the Mist REST API for:
  - Org-level network events  (/api/v1/orgs/{org_id}/events)
  - Org-level alarms          (/api/v1/orgs/{org_id}/alarms)
  - Per-site device stats     (/api/v1/sites/{site_id}/stats/devices)

Auth: Bearer token in Authorization header (MIST_API_KEY).
All responses are normalized to UnifiedEvent via the same logic used by
MistMockGenerator so the rest of the pipeline stays vendor-agnostic.
"""

import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional
from uuid import uuid4

import httpx
from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_exception_type

from config.settings import get_settings
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

# Mist API paginates with a `next` cursor; cap to avoid runaway loops
_MAX_PAGES = 10
_PAGE_LIMIT = 100  # events per page


class MistApiError(Exception):
    """Raised when the Mist API returns a non-2xx response."""
    def __init__(self, status_code: int, detail: str):
        super().__init__(f"Mist API {status_code}: {detail}")
        self.status_code = status_code


class MistCollector:
    """
    Pulls telemetry from Juniper Mist and normalizes it to UnifiedEvent.

    Usage (called by the worker daemon each collection cycle):
        collector = MistCollector()
        events = await collector.collect(since=datetime.utcnow() - timedelta(minutes=5))
        # events is a list of UnifiedEvent ready to be written to Postgres
    """

    def __init__(self):
        settings = get_settings()
        self._api_key = settings.mist_api_key
        self._org_id = settings.mist_org_id
        self._base_url = settings.mist_base_url.rstrip("/")
        self._enabled = settings.mist_enabled

        self._headers = {
            "Authorization": f"Token {self._api_key}",
            "Content-Type": "application/json",
        }

    # ------------------------------------------------------------------
    # Public interface
    # ------------------------------------------------------------------

    async def collect(self, since: Optional[datetime] = None) -> List[UnifiedEvent]:
        """
        Collect and normalize all available events since `since`.

        Args:
            since: Lower bound timestamp (UTC). Defaults to last 5 minutes.

        Returns:
            List of normalized UnifiedEvent objects.
        """
        if not self._enabled:
            logger.debug("Mist collector disabled — skipping")
            return []

        if not self._api_key or not self._org_id:
            logger.warning("Mist collector enabled but MIST_API_KEY / MIST_ORG_ID not set")
            return []

        if since is None:
            since = datetime.now(timezone.utc) - timedelta(minutes=5)

        since_ts = int(since.timestamp())

        async with httpx.AsyncClient(
            headers=self._headers,
            timeout=httpx.Timeout(30.0),
            follow_redirects=True,
        ) as client:
            raw_events = await self._fetch_events(client, since_ts)
            raw_alarms = await self._fetch_alarms(client, since_ts)

        all_raw = raw_events + raw_alarms
        events: List[UnifiedEvent] = []
        for raw in all_raw:
            try:
                events.append(self._normalize(raw))
            except Exception:
                logger.exception("Failed to normalize Mist event: %s", raw.get("id", "?"))

        logger.info("Mist collector: %d events collected (%d raw)", len(events), len(all_raw))
        return events

    # ------------------------------------------------------------------
    # Fetch helpers
    # ------------------------------------------------------------------

    @retry(
        retry=retry_if_exception_type(httpx.TransportError),
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=2, max=10),
        reraise=True,
    )
    async def _fetch_events(self, client: httpx.AsyncClient, since_ts: int) -> List[Dict]:
        """GET /api/v1/orgs/{org_id}/alarms/search — network alarms with cursor pagination."""
        url = f"{self._base_url}/api/v1/orgs/{self._org_id}/alarms/search"
        params: Dict[str, Any] = {"start": since_ts, "limit": _PAGE_LIMIT}
        return await self._paginate(client, url, params, result_key="results")

    @retry(
        retry=retry_if_exception_type(httpx.TransportError),
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=2, max=10),
        reraise=True,
    )
    async def _fetch_alarms(self, client: httpx.AsyncClient, since_ts: int) -> List[Dict]:
        """GET /api/v1/orgs/{org_id}/logs — admin audit log (config change events)."""
        url = f"{self._base_url}/api/v1/orgs/{self._org_id}/logs"
        params: Dict[str, Any] = {"start": since_ts, "limit": _PAGE_LIMIT}
        try:
            resp = await client.get(url, params=params)
            _raise_for_status(resp)
            body = resp.json()
            return body.get("results", body) if isinstance(body, dict) else body
        except MistApiError as exc:
            logger.error("Mist logs fetch failed: %s", exc)
            return []

    async def _paginate(
        self,
        client: httpx.AsyncClient,
        url: str,
        params: Dict[str, Any],
        result_key: str = "results",
    ) -> List[Dict]:
        """Follow Mist cursor pagination, collecting up to _MAX_PAGES pages.

        Mist returns a `next` field that is a full URL path (e.g.
        /api/v1/orgs/.../alarms/search?search_after=[...]&start=...).
        We reconstruct the absolute URL from base_url + next path.
        """
        results: List[Dict] = []
        page = 0
        current_url = url
        current_params: Optional[Dict[str, Any]] = params

        while page < _MAX_PAGES:
            try:
                if current_params is not None:
                    resp = await client.get(current_url, params=current_params)
                else:
                    resp = await client.get(current_url)
                _raise_for_status(resp)
            except MistApiError as exc:
                logger.error("Mist fetch failed on page %d: %s", page + 1, exc)
                break

            body = resp.json()
            page_items = body.get(result_key, []) if isinstance(body, dict) else body
            results.extend(page_items)
            page += 1

            # Mist `next` is a full path — reconstruct absolute URL
            next_path = body.get("next") if isinstance(body, dict) else None
            if not next_path or len(page_items) < _PAGE_LIMIT:
                break

            current_url = f"{self._base_url}{next_path}"
            current_params = None  # all params are embedded in the next URL

        return results

    # ------------------------------------------------------------------
    # Normalization
    # ------------------------------------------------------------------

    def _normalize(self, raw: Dict[str, Any]) -> UnifiedEvent:
        """
        Normalize a raw Mist event/alarm dict to UnifiedEvent.

        Handles both org-level events (from /events) and alarms (/alarms).
        """
        # Timestamp — Mist uses epoch seconds
        ts_raw = raw.get("timestamp") or raw.get("last_seen") or raw.get("created_time")
        if ts_raw:
            timestamp = datetime.fromtimestamp(float(ts_raw), tz=timezone.utc).replace(tzinfo=None)
        else:
            timestamp = datetime.utcnow()

        # Severity — alarms have severity/group; logs are config changes (info)
        severity = _map_severity(raw.get("severity") or raw.get("group", "info"))

        # Device — alarms have aps list; logs are admin actions with no device
        ap_list = raw.get("aps") or []
        ap_id = (ap_list[0] if ap_list else None) or raw.get("ap") or raw.get("ap_id") or raw.get("device_id") or "unknown"
        hostnames = raw.get("hostnames") or []
        ap_name = (hostnames[0] if hostnames else None) or raw.get("ap_name") or raw.get("device_name") or ap_id
        site_id = raw.get("site_id") or self._org_id
        site_name = raw.get("site_name") or f"site-{site_id[:8]}"

        device = DeviceInfo(
            device_id=ap_id,
            device_name=ap_name,
            device_type=raw.get("device_type", "ap"),
            site_id=site_id,
            site_name=site_name,
        )

        # Client (optional — present on client events)
        client: Optional[ClientInfo] = None
        client_mac = raw.get("client_mac") or raw.get("mac")
        if client_mac:
            client = ClientInfo(
                client_id=client_mac,
                client_mac=client_mac,
                ssid=raw.get("ssid"),
                ip_address=raw.get("ip"),
            )

        # Event type mapping
        event_type_str = (
            raw.get("type")
            or raw.get("event_type")
            or raw.get("group", "unknown")
        )
        event_type, category = _map_event_type(event_type_str, raw)

        # Human-readable title / description
        title = event_type_str.replace("_", " ").title()
        description = raw.get("text") or raw.get("message") or title
        if raw.get("retry_pct"):
            description += f" (retry: {raw['retry_pct']}%)"
        if raw.get("health_score") is not None:
            description += f" (health: {raw['health_score']})"
        if raw.get("rssi") is not None:
            description += f" (RSSI: {raw['rssi']} dBm)"

        return UnifiedEvent(
            event_id=f"mist-{uuid4().hex[:12]}",
            timestamp=timestamp,
            source=EventSource.MIST,
            source_event_id=str(raw.get("id") or f"mist-{event_type_str}-{int(timestamp.timestamp())}"),
            severity=severity,
            category=category,
            event_type=event_type,
            title=title,
            description=description,
            device=device,
            client=client,
            tags=["wireless", "mist"] + list(raw.get("tags") or []),
            metadata={
                "mist_org_id": raw.get("org_id") or self._org_id,
                "mist_site_id": site_id,
                "mist_topic": raw.get("topic"),
            },
            raw_event=raw,
        )


# ------------------------------------------------------------------
# Pure helpers (module-level so tests can call them directly)
# ------------------------------------------------------------------

def _raise_for_status(resp: httpx.Response) -> None:
    if resp.status_code >= 400:
        try:
            detail = resp.json()
        except Exception:
            detail = resp.text
        raise MistApiError(resp.status_code, str(detail))


def _map_severity(value: str) -> EventSeverity:
    mapping = {
        "critical": EventSeverity.CRITICAL,
        "major": EventSeverity.MAJOR,
        "minor": EventSeverity.MINOR,
        "warn": EventSeverity.WARNING,
        "warning": EventSeverity.WARNING,
        "info": EventSeverity.INFO,
        # Mist alarm group names
        "infrastructure": EventSeverity.MAJOR,
        "marvis": EventSeverity.INFO,
        "security": EventSeverity.MAJOR,
    }
    return mapping.get(str(value).lower(), EventSeverity.INFO)


def _map_event_type(event_type_str: str, raw: Dict[str, Any]) -> tuple:
    t = event_type_str.lower()
    text = (raw.get("text") or "").lower()

    if "client" in t and "retry" in t:
        return EventType.PACKET_LOSS, EventCategory.PERFORMANCE
    if "client" in t and ("auth" in t or "eap" in t):
        return EventType.CLIENT_AUTH_FAILED, EventCategory.SECURITY
    if "client" in t and "disconnect" in t:
        return EventType.CLIENT_DISCONNECTED, EventCategory.CLIENT
    if "client" in t and "roam" in t:
        return EventType.CLIENT_ROAM, EventCategory.CLIENT
    if "rogue" in t:
        return EventType.ROGUE_AP, EventCategory.SECURITY
    if "ap_health" in t or "degraded" in t or "health" in t:
        return EventType.HARDWARE_ERROR, EventCategory.HARDWARE
    if "device_down" in t or "ap_disconnected" in t:
        return EventType.LINK_DOWN, EventCategory.CONNECTIVITY
    if "device_reconnected" in t or "device_up" in t or "ap_connect" in t:
        return EventType.LINK_UP, EventCategory.CONNECTIVITY
    if "gateway" in t and "unreachable" in t:
        return EventType.LINK_DOWN, EventCategory.CONNECTIVITY
    if "tunnel" in t:
        return EventType.TUNNEL_DOWN if "down" in t or "disconnect" in t else EventType.TUNNEL_UP, EventCategory.CONNECTIVITY
    if "config" in t or "firmware" in t:
        return EventType.CONFIG_CHANGE, EventCategory.CONFIGURATION
    if "marvis" in t:
        if "retry" in text or "loss" in text:
            return EventType.PACKET_LOSS, EventCategory.PERFORMANCE
        return EventType.OTHER, EventCategory.APPLICATION
    if "cpu" in t:
        return EventType.HIGH_CPU, EventCategory.PERFORMANCE
    if "memory" in t or "mem" in t:
        return EventType.HIGH_MEMORY, EventCategory.PERFORMANCE

    return EventType.OTHER, EventCategory.SYSTEM
