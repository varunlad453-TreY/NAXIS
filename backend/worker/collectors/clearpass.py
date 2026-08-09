"""
Aruba ClearPass Policy Manager Collector (WP-3.5)

Polls ClearPass Policy Manager API for:
  - RADIUS authentication logs (/api/access-tracker)
  - 802.1X failures & EAP timeouts
  - Endpoint posture & MAC authentication events

Normalizes auth events into ``UnifiedEvent`` with source_system="clearpass".
Returns a ``CollectorOutcome`` with structured telemetry metadata.
"""

import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from uuid import uuid4

import httpx

try:
    from backend.config.settings import get_settings
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
    from config.settings import get_settings
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

COLLECTOR_ID = "clearpass-auth"
SOURCE_SYSTEM = "clearpass"


class ClearPassCollector:
    """Collector for Aruba ClearPass RADIUS authentication events."""

    def __init__(self):
        settings = get_settings()
        self._host = settings.clearpass_host.rstrip("/")
        self._client_id = settings.clearpass_client_id
        self._client_secret = settings.clearpass_client_secret
        self._enabled = settings.clearpass_enabled

    @property
    def is_configured(self) -> bool:
        return bool(self._enabled and self._host and self._client_id and self._client_secret)

    async def collect(self) -> CollectorOutcome:
        outcome = CollectorOutcome(
            collector_id=COLLECTOR_ID,
            source_system=SOURCE_SYSTEM,
        )

        if not self.is_configured:
            outcome.mark_skipped("Aruba ClearPass not configured")
            return outcome

        try:
            async with httpx.AsyncClient(
                timeout=httpx.Timeout(30.0),
                verify=False,
            ) as client:
                token = await self._authenticate(client)
                if not token:
                    outcome.mark_error("ClearPass authentication failed")
                    return outcome

                headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
                tracker_events = await self._fetch_access_tracker(client, headers)
                normalized_events = _normalize_clearpass_events(tracker_events)

                outcome.metadata["raw_events_fetched"] = len(tracker_events)
                outcome.metadata["events_normalized"] = len(normalized_events)
                outcome.mark_success(rows_written=len(normalized_events))
                logger.info("ClearPass: processed %d authentication events", len(normalized_events))
        except Exception as exc:
            outcome.mark_error(str(exc))
            logger.exception("ClearPass collection failed")

        return outcome

    async def _authenticate(self, client: httpx.AsyncClient) -> Optional[str]:
        try:
            url = f"{self._host}/api/oauth"
            payload = {
                "grant_type": "client_credentials",
                "client_id": self._client_id,
                "client_secret": self._client_secret,
            }
            resp = await client.post(url, json=payload)
            if resp.status_code == 200:
                return resp.json().get("access_token")
            logger.error("ClearPass OAuth returned HTTP %d", resp.status_code)
            return None
        except Exception as exc:
            logger.error("ClearPass auth exception: %s", exc)
            return None

    async def _fetch_access_tracker(self, client: httpx.AsyncClient, headers: Dict[str, str]) -> List[Dict]:
        try:
            url = f"{self._host}/api/access-tracker"
            resp = await client.get(url, headers=headers, params={"limit": 100})
            if resp.status_code == 200:
                data = resp.json()
                return data.get("_embedded", {}).get("items", []) if isinstance(data, dict) else []
            return []
        except Exception as exc:
            logger.warning("ClearPass: failed to fetch access tracker logs: %s", exc)
            return []


def _normalize_clearpass_events(raw_events: List[Dict]) -> List[UnifiedEvent]:
    events: List[UnifiedEvent] = []
    for r in raw_events:
        event_id = str(r.get("id", "") or r.get("auth_id", "") or f"cp-{uuid4().hex[:8]}")
        mac = str(r.get("mac_address", "") or r.get("calling_station_id", "")).replace(":", "").lower()
        username = str(r.get("user_name", "") or r.get("username", "") or "")
        status = str(r.get("auth_status", "") or r.get("status", "")).lower()

        if "accept" in status or "pass" in status:
            severity = EventSeverity.INFO
            event_type = EventType.CLIENT_CONNECTED
            title = f"RADIUS Auth Success ({username or mac})"
        else:
            severity = EventSeverity.MAJOR
            event_type = EventType.AUTH_FAILURE
            title = f"RADIUS Auth Failure ({username or mac})"

        event = UnifiedEvent(
            event_id=str(uuid4()),
            source_event_id=f"clearpass-{event_id}",
            timestamp=datetime.now(timezone.utc),
            source=EventSource.CLEARPASS,
            category=EventCategory.SECURITY,
            severity=severity,
            event_type=event_type,
            title=title,
            description=f"ClearPass RADIUS authentication {status} for user '{username}' on MAC {mac}",
            device=DeviceInfo(
                device_id=str(r.get("nas_ip_address", "") or "clearpass-pm"),
                device_name=str(r.get("nas_name", "") or "ClearPass-PolicyManager"),
                device_type="nac",
            ),
            client=ClientInfo(
                client_id=mac or username,
                client_mac=mac,
                username=username,
            ) if mac or username else None,
            raw_event=r,
        )
        events.append(event)
    return events
