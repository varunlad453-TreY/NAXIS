"""
Juniper Mist Topology Collectors

Five sub-collectors that feed the topology graph and provide in-depth
wireless telemetry:

  1. MistApHistoryCollector   — device lifecycle tracking
  2. MistApRfCollector        — wireless performance analysis
  3. MistClientTopologyCollector — client connectivity mapping
  4. MistWiredUplinkCollector — physical topology edges (AP-to-switch)
  5. MistRadioNeighborsCollector — RF environment health

Each sub-collector returns a ``CollectorOutcome``.  The orchestrator
(``MistTopologyCollector``) authenticates once, fans out to all five,
and returns a list of outcomes — identical to the ``DNACCollector`` pattern.

Entry point: called by the worker daemon every collection cycle.
"""

import asyncio
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
try:
    from backend.worker.collectors.mist_ap_history import record_snapshots
except ImportError:  # pragma: no cover - supports both entry-point styles
    from worker.collectors.mist_ap_history import record_snapshots

logger = logging.getLogger(__name__)

_SOURCE_SYSTEM = "mist"
_MAX_PAGES = 10
_PAGE_LIMIT = 100


# ---------------------------------------------------------------------------
# Helper
# ---------------------------------------------------------------------------

def _raise_for_status(resp: httpx.Response) -> None:
    """Raise on 4xx / 5xx responses."""
    if resp.status_code >= 400:
        try:
            detail = resp.json()
        except Exception:
            detail = resp.text
        raise MistTopologyApiError(resp.status_code, str(detail))


class MistTopologyApiError(Exception):
    """Raised when the Mist API returns a non-2xx response."""
    def __init__(self, status_code: int, detail: str):
        super().__init__(f"Mist API {status_code}: {detail}")
        self.status_code = status_code


# ---------------------------------------------------------------------------
# 1. AP History — device lifecycle tracking
# ---------------------------------------------------------------------------

class MistApHistoryCollector:
    """
    Collects AP lifecycle history and emits reachability events only on
    state transitions.

    Polls ``/api/v1/sites/{site_id}/stats/devices`` and diffs each poll
    against the ``mist_ap_history`` ledger (diff-on-write). A CRITICAL
    ``device_unreachable`` event is emitted only when a device flips
    reachable -> unreachable, and an INFO ``device_reachable`` recovery
    event when it flips back. A device that stays down across many polls
    produces exactly one event, not one per poll.
    """

    COLLECTOR_ID = "mist-ap-history"
    SOURCE_SYSTEM = _SOURCE_SYSTEM

    def __init__(self, client: httpx.AsyncClient, base_url: str, org_id: str):
        self._client = client
        self._base_url = base_url
        self._org_id = org_id

    @retry(
        retry=retry_if_exception_type(httpx.TransportError),
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=2, max=10),
        reraise=True,
    )
    async def collect(
        self,
        site_ids: List[str],
        site_devices: Dict[str, List[Dict]],
        site_map: Optional[Dict[str, str]] = None,
    ) -> CollectorOutcome:
        outcome = CollectorOutcome(
            collector_id=self.COLLECTOR_ID,
            source_system=self.SOURCE_SYSTEM,
        )
        try:
            snapshots: List[Dict[str, Any]] = []
            for site_id in site_ids:
                devices = site_devices.get(site_id, [])
                for dev in devices:
                    try:
                        snapshot = self._to_snapshot(site_id, dev, site_map)
                        if snapshot is not None:
                            snapshots.append(snapshot)
                    except Exception:
                        logger.exception(
                            "Failed to snapshot AP history for %s",
                            dev.get("mac", "?"),
                        )

            transitions = await record_snapshots(snapshots)

            events: List[UnifiedEvent] = []
            for t in transitions:
                event = self._event_from_transition(t)
                if event is not None:
                    events.append(event)

            outcome.events = events
            outcome.mark_success(rows_written=len(events))
            outcome.metadata["sites_scanned"] = len(site_ids)
            outcome.metadata["devices_seen"] = len(snapshots)
            outcome.metadata["transitions"] = len(transitions)
            logger.info(
                "Mist AP history: %d transition event(s) from %d devices across %d sites",
                len(events),
                len(snapshots),
                len(site_ids),
            )
        except Exception as exc:
            outcome.mark_error(str(exc))
            logger.exception("Mist AP history collection failed")
        return outcome

    def _to_snapshot(
        self,
        site_id: str,
        raw: Dict[str, Any],
        site_map: Optional[Dict[str, str]] = None,
    ) -> Optional[Dict[str, Any]]:
        """Build a ledger snapshot row from a device stats entry."""
        mac = raw.get("mac", "")
        if not mac:
            return None

        connected = bool(raw.get("connected", False))
        site_name = site_map.get(site_id, "") if site_map else ""
        return {
            "device_id": mac,
            "serial": raw.get("serial", "") or mac,
            "mac": mac,
            "hostname": raw.get("name", "") or mac,
            "model": raw.get("model", "") or "",
            "site_id": site_id,
            "site_name": site_name or f"site-{site_id[:8]}",
            "firmware_version": raw.get("version", "") or "",
            "reachability": "reachable" if connected else "unreachable",
            "uptime_seconds": int(raw.get("uptime", 0) or 0),
        }

    def _event_from_transition(
        self, transition: Dict[str, Any]
    ) -> Optional[UnifiedEvent]:
        """Map a ledger reachability transition to a UnifiedEvent.

        Only first-sighting-down, reachable -> unreachable (outage), and
        unreachable -> reachable (recovery) produce events. First-sighting
        reachable and steady states produce nothing.
        """
        cur = transition.get("cur_reachability")
        prev = transition.get("prev_reachability")
        if prev is None:
            if cur != "unreachable":
                return None
            severity = EventSeverity.CRITICAL
            event_type = EventType.DEVICE_UNREACHABLE
        elif prev == "reachable" and cur == "unreachable":
            severity = EventSeverity.CRITICAL
            event_type = EventType.DEVICE_UNREACHABLE
        elif prev == "unreachable" and cur == "reachable":
            severity = EventSeverity.INFO
            event_type = EventType.DEVICE_REACHABLE
        else:
            return None

        snapshot = transition["snapshot"]
        mac = snapshot.get("mac", "")
        name = snapshot.get("hostname", mac or "unknown")
        model = snapshot.get("model", "")
        uptime = snapshot.get("uptime_s", 0)
        version = snapshot.get("firmware", "")
        site_id = snapshot.get("site_id", "")
        site_name = snapshot.get("site_name", "") or f"site-{site_id[:8]}"

        description = f"AP {name} ({mac}) — uptime: {uptime}s"
        if version:
            description += f", firmware: {version}"
        if model:
            description += f", model: {model}"

        return UnifiedEvent(
            event_id=f"mist-history-{uuid4().hex[:12]}",
            timestamp=datetime.now(timezone.utc).replace(tzinfo=None),
            source=EventSource.MIST,
            source_event_id=f"mist-history-{mac}-{uuid4().hex[:8]}",
            severity=severity,
            category=EventCategory.SYSTEM,
            event_type=event_type,
            title=f"AP History: {name}",
            description=description,
            device=DeviceInfo(
                device_id=mac,
                device_name=name,
                device_type="ap",
                device_model=model,
                site_id=site_id,
                site_name=site_name,
            ),
            tags=["wireless", "mist", "history", "topology"],
            metadata={
                "mist_mac": mac,
                "mist_model": model,
                "mist_uptime_seconds": uptime,
                "mist_firmware": version,
                "mist_connected": cur == "reachable",
                "mist_site_id": site_id,
                "reachability_transition": f"{prev} -> {cur}",
            },
            raw_event=snapshot,
        )


# ---------------------------------------------------------------------------
# 2. AP RF — wireless performance analysis
# ---------------------------------------------------------------------------

class MistApRfCollector:
    """
    Collects wireless RF stats per AP from
    ``/api/v1/sites/{site_id}/stats/devices``.

    Focuses on channel, RSSI, utilization, BSSID, and band information
    to build the wireless RF performance layer.
    """

    COLLECTOR_ID = "mist-ap-rf"
    SOURCE_SYSTEM = _SOURCE_SYSTEM

    def __init__(self, client: httpx.AsyncClient, base_url: str, org_id: str):
        self._client = client
        self._base_url = base_url
        self._org_id = org_id

    @retry(
        retry=retry_if_exception_type(httpx.TransportError),
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=2, max=10),
        reraise=True,
    )
    async def collect(
        self,
        site_ids: List[str],
        site_devices: Dict[str, List[Dict]],
    ) -> CollectorOutcome:
        outcome = CollectorOutcome(
            collector_id=self.COLLECTOR_ID,
            source_system=self.SOURCE_SYSTEM,
        )
        try:
            events: List[UnifiedEvent] = []
            for site_id in site_ids:
                devices = site_devices.get(site_id, [])
                for dev in devices:
                    try:
                        rf_events = self._normalize_rf(site_id, dev)
                        events.extend(rf_events)
                    except Exception:
                        logger.exception(
                            "Failed to normalize AP RF for %s",
                            dev.get("mac", "?"),
                        )

            outcome.events = events
            outcome.mark_success(rows_written=len(events))
            outcome.metadata["sites_scanned"] = len(site_ids)
            logger.info("Mist AP RF: %d RF entries from %d sites", len(events), len(site_ids))
        except Exception as exc:
            outcome.mark_error(str(exc))
            logger.exception("Mist AP RF collection failed")
        return outcome

    def _normalize_rf(self, site_id: str, raw: Dict[str, Any]) -> List[UnifiedEvent]:
        """
        Extract per-radio RF stats from a device entry.

        The Mist device stats object contains radio_stat with per-band data
        (band_24, band_5, band_6) including channel, tx_power, num_clients,
        and utilization.
        """
        mac = raw.get("mac", "")
        name = raw.get("name", mac or "unknown")
        model = raw.get("model", "")

        if not mac:
            return []

        radio_stat = raw.get("radio_stat", {})
        if not isinstance(radio_stat, dict):
            return []

        events: List[UnifiedEvent] = []
        band_map = {
            "band_24": "2.4 GHz",
            "band_5": "5 GHz",
            "band_6": "6 GHz",
        }

        for band_key, band_label in band_map.items():
            band_data = radio_stat.get(band_key)
            if not isinstance(band_data, dict):
                continue

            channel = band_data.get("channel", 0)
            tx_power = band_data.get("tx_power", 0)
            num_clients = band_data.get("num_clients", 0)
            utilization = band_data.get("utilization", 0)
            bssid = band_data.get("bssid", "")

            # High utilization indicates performance concern
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
                f"AP {name} — {band_label}, channel {channel}, "
                f"utilization {utilization}%, {num_clients} clients"
            )
            if bssid:
                description += f", BSSID: {bssid}"

            events.append(UnifiedEvent(
                event_id=f"mist-rf-{uuid4().hex[:12]}",
                timestamp=datetime.now(timezone.utc).replace(tzinfo=None),
                source=EventSource.MIST,
                source_event_id=f"mist-rf-{mac}-{band_key}-{uuid4().hex[:8]}",
                severity=severity,
                category=EventCategory.PERFORMANCE,
                event_type=event_type,
                title=f"RF Stats: {name} ({band_label})",
                description=description,
                device=DeviceInfo(
                    device_id=mac,
                    device_name=name,
                    device_type="ap",
                    device_model=model,
                    site_id=site_id,
                    site_name=f"site-{site_id[:8]}",
                ),
                tags=["wireless", "mist", "rf", "topology"],
                metadata={
                    "mist_mac": mac,
                    "mist_band": band_label,
                    "mist_band_key": band_key,
                    "mist_channel": channel,
                    "mist_tx_power": tx_power,
                    "mist_num_clients": num_clients,
                    "mist_utilization": utilization,
                    "mist_bssid": bssid,
                    "mist_site_id": site_id,
                },
                raw_event=raw,
            ))

        return events


# ---------------------------------------------------------------------------
# 3. Client Topology — client connectivity mapping
# ---------------------------------------------------------------------------

class MistClientTopologyCollector:
    """
    Collects client connectivity data from
    ``/api/v1/orgs/{org_id}/clients``.

    Maps client MAC, IP, SSID, band, RSSI, and connection events to
    build the client-to-AP connectivity layer.
    """

    COLLECTOR_ID = "mist-client-topology"
    SOURCE_SYSTEM = _SOURCE_SYSTEM

    def __init__(self, client: httpx.AsyncClient, base_url: str, org_id: str):
        self._client = client
        self._base_url = base_url
        self._org_id = org_id

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
            clients = await self._fetch_clients()

            events: List[UnifiedEvent] = []
            for client_raw in clients:
                try:
                    event = self._normalize(client_raw)
                    if event is not None:
                        events.append(event)
                except Exception:
                    logger.exception(
                        "Failed to normalize client: %s",
                        client_raw.get("mac", "?"),
                    )

            outcome.events = events
            outcome.mark_success(rows_written=len(events))
            outcome.metadata["raw_count"] = len(clients)
            logger.info("Mist client topology: %d clients collected", len(events))
        except Exception as exc:
            outcome.mark_error(str(exc))
            logger.exception("Mist client topology collection failed")
        return outcome

    async def _fetch_clients(self) -> List[Dict]:
        """Fetch all clients from the org endpoint with pagination."""
        url = f"{self._base_url}/api/v1/orgs/{self._org_id}/clients"
        params: Dict[str, Any] = {"limit": _PAGE_LIMIT}
        results: List[Dict] = []
        page = 0
        current_url = url
        current_params: Optional[Dict[str, Any]] = params

        while page < _MAX_PAGES:
            try:
                if current_params is not None:
                    resp = await self._client.get(current_url, params=current_params)
                else:
                    resp = await self._client.get(current_url)
                _raise_for_status(resp)
            except (MistTopologyApiError, httpx.TransportError) as exc:
                logger.error("Mist clients fetch failed on page %d: %s", page + 1, exc)
                break

            body = resp.json()
            page_items = body.get("results", body) if isinstance(body, dict) else body
            if isinstance(page_items, list):
                results.extend(page_items)
            page += 1

            next_path = body.get("next") if isinstance(body, dict) else None
            if not next_path or len(page_items or []) < _PAGE_LIMIT:
                break

            current_url = f"{self._base_url}{next_path}"
            current_params = None

        return results

    def _normalize(self, raw: Dict[str, Any]) -> Optional[UnifiedEvent]:
        """Normalize a Mist client entry into a client topology event."""
        mac = raw.get("mac", "")
        if not mac:
            return None

        ip = raw.get("ip", "")
        hostname = raw.get("hostname", "")
        ssid = raw.get("ssid", "")
        band = raw.get("band", "")
        rssi = raw.get("rssi")
        site_id = raw.get("site_id", "")
        ap_mac = raw.get("ap_mac", "") or raw.get("connected_by", "")
        username = raw.get("username", "")
        os = raw.get("os", "")

        # Derive severity from RSSI
        if rssi is not None:
            if rssi < -80:
                severity = EventSeverity.WARNING
                event_type = EventType.PACKET_LOSS
            elif rssi < -70:
                severity = EventSeverity.INFO
                event_type = EventType.CLIENT_CONNECTED
            else:
                severity = EventSeverity.INFO
                event_type = EventType.CLIENT_CONNECTED
        else:
            severity = EventSeverity.INFO
            event_type = EventType.CLIENT_CONNECTED

        description = f"Client {mac}"
        if hostname:
            description += f" ({hostname})"
        description += f" — SSID: {ssid or 'N/A'}, band: {band or 'N/A'}"
        if rssi is not None:
            description += f", RSSI: {rssi} dBm"

        client_info = ClientInfo(
            client_id=mac,
            client_mac=mac,
            client_ip=ip or None,
            client_hostname=hostname or None,
            username=username or None,
            ssid=ssid or None,
        )

        return UnifiedEvent(
            event_id=f"mist-client-{uuid4().hex[:12]}",
            timestamp=datetime.now(timezone.utc).replace(tzinfo=None),
            source=EventSource.MIST,
            source_event_id=f"mist-client-{mac}-{uuid4().hex[:8]}",
            severity=severity,
            category=EventCategory.CLIENT,
            event_type=event_type,
            title=f"Client: {hostname or mac}",
            description=description,
            client=client_info,
            device=DeviceInfo(
                device_id=ap_mac or mac,
                device_name=ap_mac or "unknown",
                device_type="ap",
                site_id=site_id,
                site_name=f"site-{site_id[:8]}" if site_id else None,
            ) if ap_mac else None,
            tags=["wireless", "mist", "client", "topology"],
            metadata={
                "mist_client_mac": mac,
                "mist_client_ip": ip,
                "mist_client_hostname": hostname,
                "mist_ssid": ssid,
                "mist_band": band,
                "mist_rssi": rssi,
                "mist_ap_mac": ap_mac,
                "mist_site_id": site_id,
                "mist_username": username,
                "mist_os": os,
            },
            raw_event=raw,
        )


# ---------------------------------------------------------------------------
# 4. Wired Uplink — physical topology edges (AP-to-switch)
# ---------------------------------------------------------------------------

class MistWiredUplinkCollector:
    """
    Collects wired uplink data mapping AP-to-switch physical connectivity.

    Extracts ``lldp_stat`` / ``lldp_stats`` from the per-site device stats
    endpoint (``/api/v1/sites/{site_id}/stats/devices``).  This works
    without a Wired Assurance licence because the LLDP neighbour info is
    included in the standard device stats response.
    """

    COLLECTOR_ID = "mist-wired-uplink"
    SOURCE_SYSTEM = _SOURCE_SYSTEM

    def __init__(self, client: httpx.AsyncClient, base_url: str, org_id: str):
        self._client = client
        self._base_url = base_url
        self._org_id = org_id

    @retry(
        retry=retry_if_exception_type(httpx.TransportError),
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=2, max=10),
        reraise=True,
    )
    async def collect(
        self,
        site_ids: List[str],
        site_devices: Dict[str, List[Dict]],
    ) -> CollectorOutcome:
        outcome = CollectorOutcome(
            collector_id=self.COLLECTOR_ID,
            source_system=self.SOURCE_SYSTEM,
        )
        try:
            uplinks = []
            for site_id in site_ids:
                devices = site_devices.get(site_id, [])
                uplinks.extend(self._extract_uplinks(site_id, devices))

            events: List[UnifiedEvent] = []
            for uplink in uplinks:
                try:
                    event = self._normalize(uplink)
                    if event is not None:
                        events.append(event)
                except Exception:
                    logger.exception(
                        "Failed to normalize wired uplink: %s",
                        uplink.get("uplink_mac", "?"),
                    )

            outcome.events = events
            outcome.mark_success(rows_written=len(events))
            outcome.metadata["raw_count"] = len(uplinks)
            logger.info("Mist wired uplinks: %d links collected", len(events))
        except Exception as exc:
            outcome.mark_error(str(exc))
            logger.exception("Mist wired uplink collection failed")
        return outcome

    @staticmethod
    def _extract_uplinks(site_id: str, devices: List[Dict]) -> List[Dict]:
        """Extract LLDP uplink entries from a list of device stats."""
        uplinks: List[Dict] = []
        for dev in devices:
            ap_mac = dev.get("mac", "")
            if not ap_mac:
                continue

            lldp_stats = dev.get("lldp_stats", {})
            has_lldp_stats = (
                isinstance(lldp_stats, dict) and len(lldp_stats) > 0
            )

            if has_lldp_stats:
                for port_name, lldp_entry in lldp_stats.items():
                    if not lldp_entry.get("system_name"):
                        continue
                    uplinks.append({
                        "uplink_mac": ap_mac,
                        "switch_mac": lldp_entry.get("chassis_id", ""),
                        "lldp_system_name": lldp_entry.get("system_name", ""),
                        "port_id": lldp_entry.get("port_id", port_name),
                        "port_desc": lldp_entry.get("port_desc", ""),
                        "site_id": site_id,
                        "up": dev.get("connected", True),
                        "speed": "",
                        "duplex": "",
                        "uplink_id": f"{ap_mac}-{port_name}",
                    })
            else:
                lldp = dev.get("lldp_stat")
                if lldp and lldp.get("system_name"):
                    uplinks.append({
                        "uplink_mac": ap_mac,
                        "switch_mac": lldp.get("chassis_id", ""),
                        "lldp_system_name": lldp.get("system_name", ""),
                        "port_id": lldp.get("port_id", ""),
                        "port_desc": lldp.get("port_desc", ""),
                        "site_id": site_id,
                        "up": dev.get("connected", True),
                        "speed": "",
                        "duplex": "",
                        "uplink_id": f"{ap_mac}-{lldp.get('port_id', 'uplink')}",
                    })
        return uplinks

    def _normalize(self, raw: Dict[str, Any]) -> Optional[UnifiedEvent]:
        """Normalize a wired uplink entry into a topology edge event."""
        ap_mac = raw.get("uplink_mac", "") or raw.get("mac", "")
        switch_mac = raw.get("switch_mac", "") or raw.get("lldp_system_name", "")
        port_id = raw.get("port_id", "") or raw.get("lldp_port_id", "")
        port_name = raw.get("port_desc", "") or raw.get("lldp_port_desc", "")
        speed = raw.get("speed", "")
        duplex = raw.get("duplex", "")
        uplink_id = raw.get("uplink_id", "")
        site_id = raw.get("site_id", "")

        if not ap_mac:
            return None

        # Determine link status
        is_active = raw.get("up", True)
        if is_active:
            severity = EventSeverity.INFO
            event_type = EventType.LINK_UP
        else:
            severity = EventSeverity.MAJOR
            event_type = EventType.LINK_DOWN

        description = (
            f"Uplink {ap_mac} → switch {switch_mac or 'unknown'}"
            f" on port {port_name or port_id or 'unknown'}"
        )
        if speed:
            description += f", speed: {speed}"
        if duplex:
            description += f", duplex: {duplex}"

        return UnifiedEvent(
            event_id=f"mist-uplink-{uuid4().hex[:12]}",
            timestamp=datetime.now(timezone.utc).replace(tzinfo=None),
            source=EventSource.MIST,
            source_event_id=f"mist-uplink-{ap_mac}-{switch_mac}-{uuid4().hex[:8]}",
            severity=severity,
            category=EventCategory.CONNECTIVITY,
            event_type=event_type,
            title=f"Uplink: {ap_mac} → {switch_mac or 'unknown'}",
            description=description,
            device=DeviceInfo(
                device_id=ap_mac,
                device_name=ap_mac,
                device_type="ap",
                site_id=site_id,
                site_name=f"site-{site_id[:8]}" if site_id else None,
            ),
            tags=["wireless", "mist", "wired", "uplink", "topology"],
            metadata={
                "mist_ap_mac": ap_mac,
                "mist_switch_mac": switch_mac,
                "mist_port_id": port_id,
                "mist_port_name": port_name,
                "mist_speed": speed,
                "mist_duplex": duplex,
                "mist_uplink_id": uplink_id,
                "mist_site_id": site_id,
                "mist_link_active": is_active,
            },
            raw_event=raw,
        )


# ---------------------------------------------------------------------------
# 5. Radio Neighbors — RF environment health
# ---------------------------------------------------------------------------

class MistRadioNeighborsCollector:
    """
    Collects radio neighbor data from
    ``/api/v1/sites/{site_id}/radio/neighbors``.

    Identifies interference sources, co-channel contention, and
    adjacent-channel interference for RF environment health.
    """

    COLLECTOR_ID = "mist-radio-neighbors"
    SOURCE_SYSTEM = _SOURCE_SYSTEM

    def __init__(self, client: httpx.AsyncClient, base_url: str, org_id: str):
        self._client = client
        self._base_url = base_url
        self._org_id = org_id

    @retry(
        retry=retry_if_exception_type(httpx.TransportError),
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=2, max=10),
        reraise=True,
    )
    async def collect(self, site_ids: List[str]) -> CollectorOutcome:
        outcome = CollectorOutcome(
            collector_id=self.COLLECTOR_ID,
            source_system=self.SOURCE_SYSTEM,
        )
        try:
            events: List[UnifiedEvent] = []
            for site_id in site_ids:
                neighbors = await self._fetch_neighbors(site_id)
                for neighbor in neighbors:
                    try:
                        event = self._normalize(site_id, neighbor)
                        if event is not None:
                            events.append(event)
                    except Exception:
                        logger.exception(
                            "Failed to normalize radio neighbor for site %s",
                            site_id,
                        )

            outcome.events = events
            outcome.mark_success(rows_written=len(events))
            outcome.metadata["sites_scanned"] = len(site_ids)
            logger.info(
                "Mist radio neighbors: %d neighbors from %d sites",
                len(events), len(site_ids),
            )
        except Exception as exc:
            outcome.mark_error(str(exc))
            logger.exception("Mist radio neighbors collection failed")
        return outcome

    async def _fetch_neighbors(self, site_id: str) -> List[Dict]:
        """Fetch radio neighbors for a site."""
        try:
            resp = await self._client.get(
                f"{self._base_url}/api/v1/sites/{site_id}/radio/neighbors",
                params={"limit": _PAGE_LIMIT},
            )
            if resp.status_code == 200:
                data = resp.json()
                return data if isinstance(data, list) else data.get("results", [])
        except Exception:
            logger.debug("Failed to fetch radio neighbors for site %s", site_id)
        return []

    def _normalize(self, site_id: str, raw: Dict[str, Any]) -> Optional[UnifiedEvent]:
        """Normalize a radio neighbor entry into an RF environment event."""
        bssid = raw.get("bssid", "")
        radio_mac = raw.get("radio_mac", "") or raw.get("ap_mac", "")
        channel = raw.get("channel", 0)
        band = raw.get("band", "")
        rssi = raw.get("rssi", 0)
        ssid = raw.get("ssid", "")
        neighbor_name = raw.get("name", "") or bssid

        if not bssid and not radio_mac:
            return None

        # Classify interference type.
        my_channel = raw.get("my_channel") or raw.get("channel_on_radio", 0)

        if my_channel and channel and my_channel == channel:
            interference_type = "co-channel"
            # Co-channel contention is more concerning
            severity = EventSeverity.WARNING
            event_type = EventType.HIGH_BANDWIDTH
        elif my_channel and channel and abs(my_channel - channel) <= 4:
            interference_type = "adjacent-channel"
            severity = EventSeverity.INFO
            event_type = EventType.OTHER
        else:
            interference_type = "non-overlapping"
            severity = EventSeverity.INFO
            event_type = EventType.OTHER

        description = (
            f"Neighbor {neighbor_name} ({bssid or radio_mac}) — "
            f"channel {channel}, {band}, RSSI: {rssi} dBm, "
            f"type: {interference_type}"
        )

        return UnifiedEvent(
            event_id=f"mist-neighbor-{uuid4().hex[:12]}",
            timestamp=datetime.now(timezone.utc).replace(tzinfo=None),
            source=EventSource.MIST,
            source_event_id=f"mist-neighbor-{bssid or radio_mac}-{uuid4().hex[:8]}",
            severity=severity,
            category=EventCategory.PERFORMANCE,
            event_type=event_type,
            title=f"Radio Neighbor: {neighbor_name}",
            description=description,
            device=DeviceInfo(
                device_id=radio_mac or bssid,
                device_name=neighbor_name,
                device_type="ap",
                site_id=site_id,
                site_name=f"site-{site_id[:8]}",
            ),
            tags=["wireless", "mist", "rf", "neighbor", "topology"],
            metadata={
                "mist_bssid": bssid,
                "mist_radio_mac": radio_mac,
                "mist_channel": channel,
                "mist_band": band,
                "mist_rssi": rssi,
                "mist_ssid": ssid,
                "mist_interference_type": interference_type,
                "mist_my_channel": my_channel,
                "mist_site_id": site_id,
            },
            raw_event=raw,
        )


# ---------------------------------------------------------------------------
# Orchestrator — runs all 5 sub-collectors
# ---------------------------------------------------------------------------

class MistTopologyCollector:
    """
    Orchestrates all five Mist topology sub-collectors.

    Authenticates once via Bearer token, then fans out to each
    sub-collector.  Each returns a ``CollectorOutcome`` independently —
    identical to the ``DNACCollector`` pattern.
    """

    def __init__(self):
        settings = get_settings()
        self._api_key = settings.mist_api_key
        self._org_id = settings.mist_org_id
        self._base_url = settings.mist_base_url.rstrip("/")
        self._enabled = settings.mist_enabled

        self._headers: Dict[str, str] = {
            "Authorization": f"Token {self._api_key}",
            "Content-Type": "application/json",
        }
        self._site_map: Dict[str, str] = {}

    @property
    def is_configured(self) -> bool:
        return bool(self._api_key and self._org_id and self._enabled)

    async def collect_all(self) -> List[CollectorOutcome]:
        """
        Run all Mist topology sub-collectors.

        Returns a list of ``CollectorOutcome`` — one per sub-collector.
        The worker records each independently in the telemetry ledger.
        """
        if not self._enabled:
            return self._skipped_outcomes("Mist topology collector disabled")
        if not self._api_key or not self._org_id:
            return self._skipped_outcomes("Mist credentials not configured")

        outcomes: List[CollectorOutcome] = []

        async with httpx.AsyncClient(
            headers=self._headers,
            timeout=httpx.Timeout(30.0),
            follow_redirects=True,
        ) as client:
            # Create sub-collectors with the shared client
            ap_history = MistApHistoryCollector(client, self._base_url, self._org_id)
            ap_rf = MistApRfCollector(client, self._base_url, self._org_id)
            client_topology = MistClientTopologyCollector(client, self._base_url, self._org_id)
            wired_uplink = MistWiredUplinkCollector(client, self._base_url, self._org_id)
            radio_neighbors = MistRadioNeighborsCollector(client, self._base_url, self._org_id)

            # Fetch site list once, share across site-scoped collectors
            site_ids = await self._fetch_site_ids(client)

            # Fetch device stats ONCE for all sites — shared by AP history,
            # AP RF, and wired uplink collectors (was 3 separate fetches).
            site_devices = await self._fetch_all_site_devices(client, site_ids)

            # Run each sub-collector, passing pre-fetched device stats
            outcomes.append(await ap_history.collect(site_ids, site_devices, self._site_map))
            outcomes.append(await ap_rf.collect(site_ids, site_devices))
            outcomes.append(await client_topology.collect())
            outcomes.append(await wired_uplink.collect(site_ids, site_devices))
            outcomes.append(await radio_neighbors.collect(site_ids))

        return outcomes

    async def _fetch_all_site_devices(
        self, client: httpx.AsyncClient, site_ids: List[str],
    ) -> Dict[str, List[Dict]]:
        """Fetch device stats for all sites in a single batch.

        Returns ``{site_id: [device_dict, ...]}`` so sub-collectors can
        iterate without re-calling the API.
        """
        result: Dict[str, List[Dict]] = {}
        for site_id in site_ids:
            try:
                resp = await client.get(
                    f"{self._base_url}/api/v1/sites/{site_id}/stats/devices",
                    params={"limit": _PAGE_LIMIT},
                )
                if resp.status_code == 200:
                    devices = resp.json()
                    if isinstance(devices, list):
                        result[site_id] = devices
            except Exception:
                logger.debug("Failed to fetch devices for site %s", site_id)
        return result

    async def _fetch_site_ids(self, client: httpx.AsyncClient) -> List[str]:
        """Fetch all site IDs (and names) for the org.

        Also populates ``self._site_map`` ({site_id: site_name}) which is
        shared with the AP history collector so events carry real site
        names instead of ``site-<uuid8>`` placeholders.
        """
        try:
            resp = await client.get(
                f"{self._base_url}/api/v1/orgs/{self._org_id}/sites"
            )
            if resp.status_code == 200:
                sites = resp.json()
                self._site_map = {
                    s["id"]: s.get("name", "")
                    for s in sites
                    if s.get("id")
                }
                return list(self._site_map.keys())
        except Exception:
            logger.exception("Failed to fetch Mist sites for topology")
        return []

    def _skipped_outcomes(self, reason: str) -> List[CollectorOutcome]:
        ids = ["mist-ap-history", "mist-ap-rf", "mist-client-topology", "mist-wired-uplink", "mist-radio-neighbors"]
        outcomes = []
        for cid in ids:
            o = CollectorOutcome(collector_id=cid, source_system="mist")
            o.mark_skipped(reason)
            outcomes.append(o)
        return outcomes
