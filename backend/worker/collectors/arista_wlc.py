"""
Arista Wireless LAN Controller (WLC) Collector

Polls the Arista WLC REST API for:
  - Wireless client inventory       (/command-api/show clients)
  - AP inventory, radio status      (/command-api/show aps)
  - Channel utilization, interference  (/command-api/show radios)
  - Controller events, alarms       (/command-api/show logging)

Auth: Basic auth → session token via POST /command-api/authenticate.
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


class AristaWlcApiError(Exception):
    """Raised when the Arista WLC API returns a non-2xx response."""
    def __init__(self, status_code: int, detail: str):
        super().__init__(f"Arista WLC API {status_code}: {detail}")
        self.status_code = status_code


# ---------------------------------------------------------------------------
# Sub-collectors — each returns a CollectorOutcome
# ---------------------------------------------------------------------------

class AristaWlcClientsCollector:
    """Fetches wireless client inventory from Arista WLC."""

    COLLECTOR_ID = "arista-wlc-clients"
    SOURCE_SYSTEM = "arista_wlc"

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
                f"{self._base}/command-api",
                json={"version": 1, "cmds": ["show clients"]},
            )
            _raise_for_status(resp)
            output = resp.json()
            clients_raw = _extract_json_output(output, "show clients")

            events: List[UnifiedEvent] = []
            for client_raw in clients_raw:
                try:
                    event = self._normalize_client(client_raw)
                    if event is not None:
                        events.append(event)
                except Exception:
                    logger.exception("Failed to normalize Arista WLC client")

            outcome.events = events
            outcome.mark_success(rows_written=len(events))
            outcome.metadata["raw_count"] = len(clients_raw)
            logger.info("Arista WLC clients: %d clients collected", len(events))
        except Exception as exc:
            outcome.mark_error(str(exc))
            logger.exception("Arista WLC clients collection failed")
        return outcome

    def _normalize_client(self, raw: Dict[str, Any]) -> Optional[UnifiedEvent]:
        mac = raw.get("clientMac", raw.get("mac", ""))
        if not mac:
            return None

        ip = raw.get("ipAddress", raw.get("ip", ""))
        hostname = raw.get("hostname", "")
        ssid = raw.get("ssid", "")
        vlan = raw.get("vlan", "")
        ap_name = raw.get("apName", raw.get("ap", ""))
        radio = raw.get("radio", "")
        auth_method = raw.get("authMethod", "")
        username = raw.get("userName", raw.get("username", ""))
        state = raw.get("state", "unknown")

        # Severity from state
        if state.lower() in ("authenticated", "associated", "connected"):
            severity = EventSeverity.INFO
            event_type = EventType.CLIENT_CONNECTED
        elif state.lower() in ("disconnected", "disassociating"):
            severity = EventSeverity.WARNING
            event_type = EventType.CLIENT_DISCONNECTED
        else:
            severity = EventSeverity.INFO
            event_type = EventType.CLIENT_CONNECTED

        description = f"Client {mac}"
        if hostname:
            description += f" ({hostname})"
        description += f" — SSID: {ssid or 'N/A'}, state: {state}"
        if ap_name:
            description += f", AP: {ap_name}"

        client_info = ClientInfo(
            client_id=mac,
            client_mac=mac,
            client_ip=ip or None,
            client_hostname=hostname or None,
            username=username or None,
            ssid=ssid or None,
            vlan=int(vlan) if vlan and str(vlan).isdigit() else None,
        )

        return UnifiedEvent(
            event_id=f"awlc-client-{uuid4().hex[:12]}",
            timestamp=datetime.now(timezone.utc).replace(tzinfo=None),
            source=EventSource.ARISTA_WLC,
            source_event_id=f"awlc-client-{mac}-{uuid4().hex[:8]}",
            severity=severity,
            category=EventCategory.CLIENT,
            event_type=event_type,
            title=f"Client: {hostname or mac}",
            description=description,
            client=client_info,
            device=DeviceInfo(
                device_id=ap_name or "unknown",
                device_name=ap_name or "unknown",
                device_type="ap",
            ) if ap_name else None,
            tags=["wireless", "arista", "wlc", "client"],
            metadata={
                "awlc_client_mac": mac,
                "awlc_client_ip": ip,
                "awlc_hostname": hostname,
                "awlc_ssid": ssid,
                "awlc_vlan": str(vlan),
                "awlc_ap_name": ap_name,
                "awlc_radio": radio,
                "awlc_auth_method": auth_method,
                "awlc_state": state,
            },
            raw_event=raw,
        )


class AristaWlcApsCollector:
    """Fetches AP inventory and radio status from Arista WLC."""

    COLLECTOR_ID = "arista-wlc-aps"
    SOURCE_SYSTEM = "arista_wlc"

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
    async def collect(self) -> CollectorOutcome:
        outcome = CollectorOutcome(
            collector_id=self.COLLECTOR_ID,
            source_system=self.SOURCE_SYSTEM,
        )
        try:
            resp = await self._client.post(
                f"{self._base}/command-api",
                json={"version": 1, "cmds": ["show aps"]},
            )
            _raise_for_status(resp)
            output = resp.json()
            aps_raw = _extract_json_output(output, "show aps")

            events: List[UnifiedEvent] = []
            for ap in aps_raw:
                try:
                    events.append(await self._normalize_ap(ap))
                except Exception:
                    logger.exception("Failed to normalize Arista WLC AP")

            outcome.events = events
            outcome.mark_success(rows_written=len(events))
            outcome.metadata["raw_count"] = len(aps_raw)
            logger.info("Arista WLC APs: %d APs collected", len(events))
        except Exception as exc:
            outcome.mark_error(str(exc))
            logger.exception("Arista WLC APs collection failed")
        return outcome

    async def _normalize_ap(self, raw: Dict[str, Any]) -> UnifiedEvent:
        ap_name = raw.get("apName", raw.get("name", "unknown"))
        ap_mac = raw.get("apMac", raw.get("mac", f"awlc-{uuid4().hex[:8]}"))
        ip = raw.get("ipAddress", raw.get("ip", ""))
        model = raw.get("model", "")
        serial = raw.get("serialNumber", raw.get("serial", ""))
        status = raw.get("status", "unknown")
        site = raw.get("site", "")
        uptime = raw.get("uptime", "")

        if status.lower() in ("up", "online", "connected", "associated"):
            severity = EventSeverity.INFO
            event_type = EventType.DEVICE_REACHABLE
        elif status.lower() in ("down", "offline", "disconnected"):
            severity = EventSeverity.CRITICAL
            event_type = EventType.DEVICE_UNREACHABLE
        else:
            severity = EventSeverity.WARNING
            event_type = EventType.OTHER

        description = f"AP {ap_name} ({ap_mac}) — status: {status}"
        if model:
            description += f", model: {model}"
        if uptime:
            description += f", uptime: {uptime}"

        device_id = ap_mac
        if self._resolver and ap_mac:
            resolved = await self._resolver.resolve_device(
                "arista_wlc",
                ap_mac,
                display_name=ap_name,
                device_type="ap",
                model=model,
                serial=serial,
                ip_address=ip,
            )
            if resolved:
                device_id = resolved

        return UnifiedEvent(
            event_id=f"awlc-ap-{uuid4().hex[:12]}",
            timestamp=datetime.now(timezone.utc).replace(tzinfo=None),
            source=EventSource.ARISTA_WLC,
            source_event_id=f"awlc-ap-{ap_mac}",
            severity=severity,
            category=EventCategory.SYSTEM,
            event_type=event_type,
            title=f"AP: {ap_name}",
            description=description,
            device=DeviceInfo(
                device_id=device_id,
                device_name=ap_name,
                device_type="ap",
                device_model=model,
                site_id=site or None,
                site_name=site or None,
            ),
            tags=["wireless", "arista", "wlc", "ap", "inventory"],
            metadata={
                "awlc_ap_mac": ap_mac,
                "awlc_ap_name": ap_name,
                "awlc_ip": ip,
                "awlc_model": model,
                "awlc_serial": serial,
                "awlc_status": status,
                "awlc_site": site,
                "awlc_uptime": uptime,
            },
            raw_event=raw,
        )


class AristaWlcRadiosCollector:
    """Fetches channel utilization and interference data from Arista WLC."""

    COLLECTOR_ID = "arista-wlc-radios"
    SOURCE_SYSTEM = "arista_wlc"

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
    async def collect(self) -> CollectorOutcome:
        outcome = CollectorOutcome(
            collector_id=self.COLLECTOR_ID,
            source_system=self.SOURCE_SYSTEM,
        )
        try:
            resp = await self._client.post(
                f"{self._base}/command-api",
                json={"version": 1, "cmds": ["show radios"]},
            )
            _raise_for_status(resp)
            output = resp.json()
            radios_raw = _extract_json_output(output, "show radios")

            events: List[UnifiedEvent] = []
            for radio in radios_raw:
                try:
                    radio_events = await self._normalize_radio(radio)
                    events.extend(radio_events)
                except Exception:
                    logger.exception("Failed to normalize Arista WLC radio")

            outcome.events = events
            outcome.mark_success(rows_written=len(events))
            outcome.metadata["raw_count"] = len(radios_raw)
            logger.info("Arista WLC radios: %d radio entries from %d radios",
                        len(events), len(radios_raw))
        except Exception as exc:
            outcome.mark_error(str(exc))
            logger.exception("Arista WLC radios collection failed")
        return outcome

    async def _normalize_radio(self, raw: Dict[str, Any]) -> List[UnifiedEvent]:
        ap_name = raw.get("apName", raw.get("ap", "unknown"))
        ap_mac = raw.get("apMac", raw.get("mac", ""))
        band = raw.get("band", "")
        channel = raw.get("channel", 0)
        tx_power = raw.get("txPower", raw.get("tx_power", 0))
        utilization = raw.get("utilization", raw.get("channelUtilization", 0))
        client_count = raw.get("clientCount", raw.get("numClients", 0))
        noise = raw.get("noise", 0)

        if not ap_mac:
            ap_mac = f"awlc-{uuid4().hex[:8]}"

        band_label = f"{band} GHz" if band and "GHz" not in str(band) else str(band)

        device_id = ap_mac
        if self._resolver:
            resolved = await self._resolver.find_device("arista_wlc", ap_mac)
            if resolved:
                device_id = resolved

        events: List[UnifiedEvent] = []

        # Utilization event
        if isinstance(utilization, (int, float)) and utilization > 80:
            severity = EventSeverity.WARNING
            event_type = EventType.HIGH_BANDWIDTH
        elif isinstance(utilization, (int, float)) and utilization > 60:
            severity = EventSeverity.INFO
            event_type = EventType.OTHER
        else:
            severity = EventSeverity.INFO
            event_type = EventType.OTHER

        description = (
            f"Radio {ap_name} — {band_label}, channel {channel}, "
            f"utilization {utilization}%, {client_count} clients"
        )
        if noise:
            description += f", noise: {noise}dBm"

        events.append(UnifiedEvent(
            event_id=f"awlc-radio-{uuid4().hex[:12]}",
            timestamp=datetime.now(timezone.utc).replace(tzinfo=None),
            source=EventSource.ARISTA_WLC,
            source_event_id=f"awlc-radio-{ap_mac}-{band}-{uuid4().hex[:8]}",
            severity=severity,
            category=EventCategory.PERFORMANCE,
            event_type=event_type,
            title=f"Radio: {ap_name} ({band_label})",
            description=description,
            device=DeviceInfo(
                device_id=device_id,
                device_name=ap_name,
                device_type="ap",
            ),
            tags=["wireless", "arista", "wlc", "radio", "rf"],
            metadata={
                "awlc_ap_mac": ap_mac,
                "awlc_ap_name": ap_name,
                "awlc_band": band_label,
                "awlc_channel": channel,
                "awlc_tx_power": tx_power,
                "awlc_utilization": utilization,
                "awlc_client_count": client_count,
                "awlc_noise": noise,
            },
            raw_event=raw,
        ))

        return events


class AristaWlcEventsCollector:
    """Fetches controller events and alarms from Arista WLC."""

    COLLECTOR_ID = "arista-wlc-events"
    SOURCE_SYSTEM = "arista_wlc"

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
                f"{self._base}/command-api",
                json={"version": 1, "cmds": ["show logging"]},
            )
            _raise_for_status(resp)
            output = resp.json()
            logs_raw = _extract_json_output(output, "show logging")

            events: List[UnifiedEvent] = []
            for log_entry in logs_raw:
                try:
                    event = self._normalize_log(log_entry)
                    if event is not None:
                        events.append(event)
                except Exception:
                    logger.exception("Failed to normalize Arista WLC log entry")

            outcome.events = events
            outcome.mark_success(rows_written=len(events))
            outcome.metadata["raw_count"] = len(logs_raw)
            logger.info("Arista WLC events: %d log entries collected", len(events))
        except Exception as exc:
            outcome.mark_error(str(exc))
            logger.exception("Arista WLC events collection failed")
        return outcome

    def _normalize_log(self, raw: Dict[str, Any]) -> Optional[UnifiedEvent]:
        message = raw.get("message", raw.get("msg", ""))
        if not message:
            return None

        severity_str = raw.get("severity", raw.get("level", "info")).lower()
        timestamp_str = raw.get("timestamp", raw.get("time", ""))

        # ponytail: Arista logs use "MMM DD HH:MM:SS" format, no year
        if timestamp_str:
            try:
                ts = datetime.strptime(timestamp_str, "%b %d %H:%M:%S")
                timestamp = ts.replace(year=datetime.now(timezone.utc).year, tzinfo=None)
            except Exception:
                timestamp = datetime.now(timezone.utc).replace(tzinfo=None)
        else:
            timestamp = datetime.now(timezone.utc).replace(tzinfo=None)

        severity = _map_arista_severity(severity_str)
        event_type, category = _map_arista_event_type(message)

        return UnifiedEvent(
            event_id=f"awlc-event-{uuid4().hex[:12]}",
            timestamp=timestamp,
            source=EventSource.ARISTA_WLC,
            source_event_id=f"awlc-log-{uuid4().hex[:12]}",
            severity=severity,
            category=category,
            event_type=event_type,
            title=f"Arista WLC: {message[:80]}",
            description=message,
            tags=["wireless", "arista", "wlc", "event"],
            metadata={
                "awlc_severity": severity_str,
                "awlc_timestamp_raw": timestamp_str,
            },
            raw_event=raw,
        )


# ---------------------------------------------------------------------------
# Main Arista WLC Collector — orchestrates sub-collectors
# ---------------------------------------------------------------------------

class AristaWlcCollector:
    """
    Orchestrates all Arista WLC sub-collectors.

    Authenticates once via Basic auth, then fans out to each
    sub-collector. Each returns a CollectorOutcome independently.
    """

    def __init__(self):
        settings = get_settings()
        self._host = settings.arista_wlc_host.rstrip("/")
        self._username = settings.arista_wlc_username
        self._password = settings.arista_wlc_password
        self._enabled = settings.arista_wlc_enabled
        self._verify_ssl = settings.arista_wlc_verify_ssl

        self._token: Optional[str] = None

    @property
    def is_configured(self) -> bool:
        return bool(self._host and self._username and self._password and self._enabled)

    async def _authenticate(self, client: httpx.AsyncClient) -> bool:
        """Obtain a session token from Arista WLC."""
        try:
            resp = await client.post(
                f"{self._host}/command-api/authenticate",
                json={
                    "version": 1,
                    "cmds": [f"configure terminal"],
                    "format": "json",
                },
                auth=(self._username, self._password),
            )
            if resp.status_code == 200:
                data = resp.json()
                self._token = data.get("sessionToken", "")
                return bool(self._token)
            return False
        except Exception:
            logger.exception("Arista WLC authentication failed")
            return False

    async def collect_all(self) -> List[CollectorOutcome]:
        """
        Run all Arista WLC sub-collectors.

        Returns a list of CollectorOutcome — one per sub-collector.
        The worker records each independently in the telemetry ledger.
        """
        if not self._enabled:
            return [self._skipped_outcome("Arista WLC collector disabled")]
        if not self._host or not self._username or not self._password:
            return [self._skipped_outcome("Arista WLC credentials not configured")]

        outcomes: List[CollectorOutcome] = []

        async with httpx.AsyncClient(
            verify=self._verify_ssl,
            timeout=httpx.Timeout(30.0),
            follow_redirects=True,
        ) as client:
            # Authenticate first
            if not await self._authenticate(client):
                err = CollectorOutcome(collector_id="arista-wlc-auth", source_system="arista_wlc")
                err.mark_error("Arista WLC authentication failed — check credentials")
                return [err]

            # Create sub-collectors with the authenticated client and identity resolver
            resolver = IdentityResolver()
            clients = AristaWlcClientsCollector(client, self._host)
            aps = AristaWlcApsCollector(client, self._host, resolver)
            radios = AristaWlcRadiosCollector(client, self._host, resolver)
            events = AristaWlcEventsCollector(client, self._host)

            # Run each sub-collector
            outcomes.append(await clients.collect())
            outcomes.append(await aps.collect())
            outcomes.append(await radios.collect())
            outcomes.append(await events.collect())

        return outcomes

    async def connect(self) -> bool:
        """Validate Arista WLC credentials."""
        if not self.is_configured:
            return False
        try:
            async with httpx.AsyncClient(
                verify=self._verify_ssl,
                timeout=httpx.Timeout(15.0),
            ) as client:
                return await self._authenticate(client)
        except Exception:
            logger.exception("Arista WLC connect failed")
            return False

    def _skipped_outcome(self, reason: str) -> CollectorOutcome:
        outcome = CollectorOutcome(
            collector_id="arista-wlc-clients",
            source_system="arista_wlc",
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
        raise AristaWlcApiError(resp.status_code, str(detail))


def _extract_json_output(output: Dict[str, Any], cmd: str) -> List[Dict]:
    """Extract JSON output from Arista command API response."""
    # Arista returns {"output": {"json": [...]}} or {"output": [...]}
    if isinstance(output, dict):
        output_data = output.get("output", output)
        if isinstance(output_data, dict):
            return output_data.get("json", output_data.get("result", []))
        if isinstance(output_data, list):
            return output_data
    return []


def _map_arista_severity(level: str) -> EventSeverity:
    """Map Arista log severity to EventSeverity."""
    level = level.lower()
    if level in ("emergency", "alert", "critical"):
        return EventSeverity.CRITICAL
    if level in ("error", "err"):
        return EventSeverity.MAJOR
    if level in ("warning", "warn"):
        return EventSeverity.WARNING
    return EventSeverity.INFO


def _map_arista_event_type(message: str) -> tuple:
    """Map Arista log message to (EventType, EventCategory)."""
    msg = message.lower()

    if "client" in msg and ("connect" in msg or "assoc" in msg):
        return EventType.CLIENT_CONNECTED, EventCategory.CLIENT
    if "client" in msg and ("disconnect" in msg or "deauth" in msg):
        return EventType.CLIENT_DISCONNECTED, EventCategory.CLIENT
    if "ap" in msg and ("down" in msg or "offline" in msg):
        return EventType.DEVICE_UNREACHABLE, EventCategory.CONNECTIVITY
    if "ap" in msg and ("up" in msg or "online" in msg):
        return EventType.DEVICE_REACHABLE, EventCategory.CONNECTIVITY
    if "radio" in msg and ("channel" in msg or "interference" in msg):
        return EventType.HIGH_BANDWIDTH, EventCategory.PERFORMANCE
    if "config" in msg or "change" in msg:
        return EventType.CONFIG_CHANGE, EventCategory.CONFIGURATION
    if "auth" in msg or "security" in msg:
        return EventType.AUTH_FAILURE, EventCategory.SECURITY

    return EventType.OTHER, EventCategory.SYSTEM
