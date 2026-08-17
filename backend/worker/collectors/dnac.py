"""
Cisco DNA Center (Catalyst Center) Collector

Polls the DNAC Intent API for:
  - Network device inventory    (/dna/intent/api/v1/network-device)
  - Assurance events/alarms     (/dna/intent/api/v1/event/event-series)
  - Physical + L3 topology      (/dna/intent/api/v1/topology/physical-topology, l3-topology)
  - Client health overview      (/dna/intent/api/v1/client-health)
  - Interface status per device (/dna/intent/api/v1/interface/network-device/{id})

Auth: Basic auth → token via POST /dna/system/api/v1/auth/token.
All responses are normalized to UnifiedEvent via the same contract as Mist.
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

_MAX_DEVICES = 500  # cap device fetch to avoid huge responses


class DnacApiError(Exception):
    """Raised when the DNAC API returns a non-2xx response."""
    def __init__(self, status_code: int, detail: str):
        super().__init__(f"DNAC API {status_code}: {detail}")
        self.status_code = status_code


# ---------------------------------------------------------------------------
# Sub-collectors — each returns a CollectorOutcome
# ---------------------------------------------------------------------------

class DnacDevicesCollector:
    """Fetches network device inventory from DNAC."""

    COLLECTOR_ID = "dnac-devices"
    SOURCE_SYSTEM = "dnac"

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
            resp = await self._client.get(
                f"{self._base}/dna/intent/api/v1/network-device",
                params={"limit": _MAX_DEVICES},
            )
            _raise_for_status(resp)
            devices_raw = resp.json().get("response", [])

            events: List[UnifiedEvent] = []
            for dev in devices_raw:
                events.append(await self._normalize_device(dev))

            outcome.events = events
            outcome.mark_success(rows_written=len(events))
            outcome.metadata["raw_count"] = len(devices_raw)
            logger.info("DNAC devices: %d devices collected", len(events))
        except Exception as exc:
            outcome.mark_error(str(exc))
            logger.exception("DNAC devices collection failed")
        return outcome

    async def _normalize_device(self, raw: Dict[str, Any]) -> UnifiedEvent:
        hostname = raw.get("hostname", "unknown")
        dnac_id = raw.get("id", f"dnac-{uuid4().hex[:8]}")
        mgmt_ip = raw.get("managementIpAddress", "")
        reachability = raw.get("reachabilityStatus", "unknown")
        platform = raw.get("platformId", "")
        sw_version = raw.get("softwareVersion", "")
        family = raw.get("family", "")
        serial = raw.get("serialNumber", "")

        # Derive severity from reachability
        if reachability.lower() == "unreachable":
            severity = EventSeverity.CRITICAL
            event_type = EventType.DEVICE_UNREACHABLE
        elif reachability.lower() == "reachable":
            severity = EventSeverity.INFO
            event_type = EventType.DEVICE_REACHABLE
        else:
            severity = EventSeverity.WARNING
            event_type = EventType.OTHER

        description = (
            f"Device {hostname} ({mgmt_ip}) — reachability: {reachability}"
        )
        if platform:
            description += f", platform: {platform}"
        if sw_version:
            description += f", SW: {sw_version}"

        device_id = dnac_id
        if self._resolver and dnac_id:
            resolved = await self._resolver.resolve_device(
                "dnac",
                dnac_id,
                display_name=hostname,
                device_type=family or "router",
                model=platform,
                serial=serial,
                ip_address=mgmt_ip,
            )
            if resolved:
                device_id = resolved

        return UnifiedEvent(
            event_id=f"dnac-device-{uuid4().hex[:12]}",
            timestamp=datetime.now(timezone.utc).replace(tzinfo=None),
            source=EventSource.DNAC,
            source_event_id=dnac_id,
            severity=severity,
            category=EventCategory.SYSTEM,
            event_type=event_type,
            title=f"Device: {hostname}",
            description=description,
            device=DeviceInfo(
                device_id=device_id,
                device_name=hostname,
                device_type=family or "router",
                device_ip=mgmt_ip,
                device_model=platform,
                site_id=raw.get("locationName", ""),
                site_name=raw.get("locationName", ""),
            ),
            tags=["wired", "dnac", "inventory"],
            metadata={
                "dnac_reachability": reachability,
                "dnac_family": family,
                "dnac_platform": platform,
                "dnac_sw_version": sw_version,
                "dnac_serial": serial,
            },
            raw_event=raw,
        )


class DnacAlarmsCollector:
    """Fetches assurance events/alarms from DNAC."""

    COLLECTOR_ID = "dnac-alarms"
    SOURCE_SYSTEM = "dnac"

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
            resp = await self._client.get(
                f"{self._base}/dna/intent/api/v1/event/event-series",
                params={"limit": 200},
            )
            _raise_for_status(resp)
            events_raw = resp.json().get("response", [])

            events: List[UnifiedEvent] = []
            for raw in events_raw:
                try:
                    events.append(await self._normalize_alarm(raw))
                except Exception:
                    logger.exception("Failed to normalize DNAC alarm")

            outcome.events = events
            outcome.mark_success(rows_written=len(events))
            outcome.metadata["raw_count"] = len(events_raw)
            logger.info("DNAC alarms: %d events collected", len(events))
        except Exception as exc:
            outcome.mark_error(str(exc))
            logger.exception("DNAC alarms collection failed")
        return outcome

    async def _normalize_alarm(self, raw: Dict[str, Any]) -> UnifiedEvent:
        ts_raw = raw.get("timestamp")
        if ts_raw:
            # DNAC timestamps are in milliseconds
            timestamp = datetime.fromtimestamp(
                float(ts_raw) / 1000, tz=timezone.utc
            ).replace(tzinfo=None)
        else:
            timestamp = datetime.now(timezone.utc).replace(tzinfo=None)

        # DNAC severity: 1=critical, 3=major, 5=minor
        dnac_sev = raw.get("severity", 5)
        if isinstance(dnac_sev, str):
            dnac_sev = int(dnac_sev) if dnac_sev.isdigit() else 5
        severity = _map_dnac_severity(dnac_sev)

        name = raw.get("name", "DNAC Event")
        domain = raw.get("domain", "")
        sub_domain = raw.get("subDomain", "")
        details = raw.get("details", {})

        event_type, category = _map_dnac_event_type(name, domain, sub_domain)

        device_name = details.get("deviceName", "")
        dnac_device_id = details.get("deviceId", "")
        site_name = details.get("siteName", "")

        description = raw.get("description", "") or name
        if device_name:
            description = f"{device_name}: {description}"

        device_id = dnac_device_id
        if self._resolver and dnac_device_id:
            resolved = await self._resolver.find_device("dnac", dnac_device_id)
            if resolved:
                device_id = resolved

        return UnifiedEvent(
            event_id=f"dnac-event-{uuid4().hex[:12]}",
            timestamp=timestamp,
            source=EventSource.DNAC,
            source_event_id=raw.get("eventId", f"dnac-{uuid4().hex[:8]}"),
            severity=severity,
            category=category,
            event_type=event_type,
            title=name.replace("_", " ").title(),
            description=description,
            device=DeviceInfo(
                device_id=device_id or "unknown",
                device_name=device_name or "unknown",
                device_type="router",
                site_id=site_name,
                site_name=site_name,
            ),
            tags=["wired", "dnac", "alarm"],
            metadata={
                "dnac_domain": domain,
                "dnac_sub_domain": sub_domain,
                "dnac_priority": raw.get("priority", ""),
            },
            raw_event=raw,
        )


class DnacTopologyCollector:
    """Fetches physical and L3 topology from DNAC."""

    COLLECTOR_ID = "dnac-topology"
    SOURCE_SYSTEM = "dnac"

    def __init__(self, client: httpx.AsyncClient, base_url: str):
        self._client = client
        self._base = base_url

    async def collect(self) -> CollectorOutcome:
        outcome = CollectorOutcome(
            collector_id=self.COLLECTOR_ID,
            source_system=self.SOURCE_SYSTEM,
        )
        try:
            # Physical topology
            phys_resp = await self._client.get(
                f"{self._base}/dna/intent/api/v1/topology/physical-topology"
            )
            _raise_for_status(phys_resp)
            phys = phys_resp.json().get("response", {})

            # L3 topology
            l3_resp = await self._client.get(
                f"{self._base}/dna/intent/api/v1/topology/l3-topology"
            )
            _raise_for_status(l3_resp)
            l3 = l3_resp.json().get("response", {})

            events: List[UnifiedEvent] = []

            # Physical topology nodes
            phys_nodes = phys.get("nodes", [])
            phys_links = phys.get("links", [])

            # L3 topology nodes
            l3_nodes = l3.get("nodes", [])
            l3_links = l3.get("links", [])

            # One event per topology snapshot
            if phys_nodes or l3_nodes:
                events.append(self._normalize_topology(
                    phys_nodes, phys_links, l3_nodes, l3_links
                ))

            outcome.events = events
            outcome.mark_success(rows_written=len(events))
            outcome.metadata["phys_nodes"] = len(phys_nodes)
            outcome.metadata["phys_links"] = len(phys_links)
            outcome.metadata["l3_nodes"] = len(l3_nodes)
            outcome.metadata["l3_links"] = len(l3_links)
            logger.info(
                "DNAC topology: phys %d/%d, l3 %d/%d",
                len(phys_nodes), len(phys_links), len(l3_nodes), len(l3_links),
            )
        except Exception as exc:
            outcome.mark_error(str(exc))
            logger.exception("DNAC topology collection failed")
        return outcome

    def _normalize_topology(
        self,
        phys_nodes: List, phys_links: List,
        l3_nodes: List, l3_links: List,
    ) -> UnifiedEvent:
        total_nodes = len(phys_nodes) + len(l3_nodes)
        total_links = len(phys_links) + len(l3_links)

        return UnifiedEvent(
            event_id=f"dnac-topo-{uuid4().hex[:12]}",
            timestamp=datetime.now(timezone.utc).replace(tzinfo=None),
            source=EventSource.DNAC,
            source_event_id=f"dnac-topology-snapshot-{uuid4().hex[:8]}",
            severity=EventSeverity.INFO,
            category=EventCategory.SYSTEM,
            event_type=EventType.OTHER,
            title="DNAC Topology Snapshot",
            description=(
                f"Physical: {len(phys_nodes)} nodes, {len(phys_links)} links. "
                f"L3: {len(l3_nodes)} nodes, {len(l3_links)} links."
            ),
            tags=["wired", "dnac", "topology"],
            metadata={
                "dnac_phys_nodes": len(phys_nodes),
                "dnac_phys_links": len(phys_links),
                "dnac_l3_nodes": len(l3_nodes),
                "dnac_l3_links": len(l3_links),
                "dnac_total_nodes": total_nodes,
                "dnac_total_links": total_links,
            },
            raw_event={
                "phys_nodes_sample": phys_nodes[:5],
                "phys_links_sample": phys_links[:5],
                "l3_nodes_sample": l3_nodes[:5],
                "l3_links_sample": l3_links[:5],
            },
        )


class DnacClientHealthCollector:
    """Fetches client health overview from DNAC."""

    COLLECTOR_ID = "dnac-clients"
    SOURCE_SYSTEM = "dnac"

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
            resp = await self._client.get(
                f"{self._base}/dna/intent/api/v1/client-health"
            )
            _raise_for_status(resp)
            health_raw = resp.json().get("response", [])

            events: List[UnifiedEvent] = []
            for entry in health_raw:
                try:
                    events.append(self._normalize_client_health(entry))
                except Exception:
                    logger.exception("Failed to normalize DNAC client health")

            outcome.events = events
            outcome.mark_success(rows_written=len(events))
            outcome.metadata["raw_count"] = len(health_raw)
            logger.info("DNAC clients: %d health entries collected", len(events))
        except Exception as exc:
            outcome.mark_error(str(exc))
            logger.exception("DNAC client health collection failed")
        return outcome

    def _normalize_client_health(self, raw: Dict[str, Any]) -> UnifiedEvent:
        client_type = raw.get("clientType", "unknown")
        health_score = raw.get("healthScore", [{}])
        poor = raw.get("poorClientCount", 0)
        fair = raw.get("fairClientCount", 0)
        good = raw.get("goodClientCount", 0)
        idle = raw.get("idleClientCount", 0)
        total = poor + fair + good + idle

        # Derive severity from poor client ratio
        if total > 0 and poor / total > 0.3:
            severity = EventSeverity.MAJOR
        elif total > 0 and poor / total > 0.1:
            severity = EventSeverity.WARNING
        else:
            severity = EventSeverity.INFO

        return UnifiedEvent(
            event_id=f"dnac-client-health-{uuid4().hex[:12]}",
            timestamp=datetime.now(timezone.utc).replace(tzinfo=None),
            source=EventSource.DNAC,
            source_event_id=f"dnac-ch-{client_type}-{uuid4().hex[:8]}",
            severity=severity,
            category=EventCategory.PERFORMANCE,
            event_type=EventType.OTHER,
            title=f"Client Health: {client_type}",
            description=(
                f"{client_type} clients — total: {total}, "
                f"good: {good}, fair: {fair}, poor: {poor}, idle: {idle}"
            ),
            tags=["wired", "dnac", "clients", client_type.lower()],
            metadata={
                "dnac_client_type": client_type,
                "dnac_total": total,
                "dnac_good": good,
                "dnac_fair": fair,
                "dnac_poor": poor,
                "dnac_idle": idle,
            },
            raw_event=raw,
        )


class DnacInterfaceCollector:
    """Fetches interface status from DNAC for discovered devices."""

    COLLECTOR_ID = "dnac-interfaces"
    SOURCE_SYSTEM = "dnac"

    def __init__(
        self,
        client: httpx.AsyncClient,
        base_url: str,
        resolver: Optional[IdentityResolver] = None,
    ):
        self._client = client
        self._base = base_url
        self._resolver = resolver

    async def collect(self, device_ids: Optional[List[str]] = None) -> CollectorOutcome:
        outcome = CollectorOutcome(
            collector_id=self.COLLECTOR_ID,
            source_system=self.SOURCE_SYSTEM,
        )
        if not device_ids:
            # Fetch devices first to get IDs
            try:
                dev_resp = await self._client.get(
                    f"{self._base}/dna/intent/api/v1/network-device",
                    params={"limit": 50},
                )
                _raise_for_status(dev_resp)
                devices = dev_resp.json().get("response", [])
                device_ids = [d["id"] for d in devices if d.get("id")][:20]
            except Exception:
                device_ids = []

        if not device_ids:
            outcome.mark_skipped("No devices found to fetch interfaces for")
            return outcome

        try:
            all_events: List[UnifiedEvent] = []
            for dev_id in device_ids:
                try:
                    resp = await self._client.get(
                        f"{self._base}/dna/intent/api/v1/interface/network-device/{dev_id}"
                    )
                    _raise_for_status(resp)
                    interfaces = resp.json().get("response", [])
                    for iface in interfaces:
                        all_events.append(await self._normalize_interface(dev_id, iface))
                except Exception:
                    logger.debug("Failed to fetch interfaces for device %s", dev_id)

            outcome.events = all_events
            outcome.mark_success(rows_written=len(all_events))
            outcome.metadata["devices_scanned"] = len(device_ids)
            logger.info("DNAC interfaces: %d interfaces from %d devices",
                        len(all_events), len(device_ids))
        except Exception as exc:
            outcome.mark_error(str(exc))
            logger.exception("DNAC interface collection failed")
        return outcome

    async def _normalize_interface(self, device_id: str, raw: Dict[str, Any]) -> UnifiedEvent:
        name = raw.get("interfaceName", "unknown")
        status = raw.get("status", "unknown")
        speed = raw.get("speed", "")
        vlan = raw.get("vlanId", "")
        mac = raw.get("macAddress", "")

        if status.lower() == "up":
            severity = EventSeverity.INFO
            event_type = EventType.INTERFACE_UP
        else:
            severity = EventSeverity.WARNING
            event_type = EventType.INTERFACE_DOWN

        canonical_device_id = device_id
        if self._resolver and device_id:
            resolved = await self._resolver.find_device("dnac", device_id)
            if resolved:
                canonical_device_id = resolved

        return UnifiedEvent(
            event_id=f"dnac-iface-{uuid4().hex[:12]}",
            timestamp=datetime.now(timezone.utc).replace(tzinfo=None),
            source=EventSource.DNAC,
            source_event_id=f"dnac-iface-{device_id}-{name}",
            severity=severity,
            category=EventCategory.CONNECTIVITY,
            event_type=event_type,
            title=f"Interface: {name} ({status})",
            description=f"Interface {name} on device {device_id} — status: {status}, speed: {speed}",
            device=DeviceInfo(
                device_id=canonical_device_id,
                device_name=device_id,
                device_type="switch",
            ),
            tags=["wired", "dnac", "interface"],
            metadata={
                "dnac_device_id": device_id,
                "dnac_interface_name": name,
                "dnac_interface_status": status,
                "dnac_speed": speed,
                "dnac_vlan": vlan,
                "dnac_mac": mac,
            },
            raw_event=raw,
        )


# ---------------------------------------------------------------------------
# Main DNAC Collector — orchestrates sub-collectors
# ---------------------------------------------------------------------------

class DNACCollector:
    """
    Orchestrates all DNAC sub-collectors.

    Authenticates once per run, then fans out to each sub-collector.
    Each sub-collector returns a CollectorOutcome independently.
    """

    def __init__(self):
        settings = get_settings()
        self._host = settings.dnac_host.rstrip("/")
        self._username = settings.dnac_username
        self._password = settings.dnac_password
        self._enabled = settings.dnac_enabled
        self._verify_ssl = settings.dnac_verify_ssl

        self._token: Optional[str] = None

    @property
    def is_configured(self) -> bool:
        return bool(self._host and self._username and self._password and self._enabled)

    async def _authenticate(self, client: httpx.AsyncClient) -> bool:
        """Obtain a session token from DNAC."""
        try:
            resp = await client.post(
                f"{self._host}/dna/system/api/v1/auth/token",
                auth=(self._username, self._password),
                headers={"Content-Type": "application/json"},
            )
            _raise_for_status(resp)
            self._token = resp.json().get("Token")
            return bool(self._token)
        except Exception:
            logger.exception("DNAC authentication failed")
            return False

    def _auth_headers(self) -> Dict[str, str]:
        return {
            "X-Auth-Token": self._token or "",
            "Content-Type": "application/json",
        }

    async def collect_all(self) -> List[CollectorOutcome]:
        """
        Run all DNAC sub-collectors.

        Returns a list of CollectorOutcome — one per sub-collector.
        The worker records each independently in the telemetry ledger.
        """
        if not self._enabled:
            return [self._skipped_outcome("DNAC collector disabled")]
        if not self._host or not self._username or not self._password:
            return [self._skipped_outcome("DNAC credentials not configured")]

        outcomes: List[CollectorOutcome] = []

        async with httpx.AsyncClient(
            verify=self._verify_ssl,
            timeout=httpx.Timeout(30.0),
            follow_redirects=True,
        ) as client:
            # Authenticate first
            if not await self._authenticate(client):
                err_outcome = CollectorOutcome(
                    collector_id="dnac-auth",
                    source_system="dnac",
                )
                err_outcome.mark_error("DNAC authentication failed — check credentials")
                return [err_outcome]

            # Create sub-collectors with the authenticated client and identity resolver
            resolver = IdentityResolver()
            devices_collector = DnacDevicesCollector(client, self._host, resolver)
            alarms_collector = DnacAlarmsCollector(client, self._host, resolver)
            topology_collector = DnacTopologyCollector(client, self._host)
            client_health_collector = DnacClientHealthCollector(client, self._host)
            interface_collector = DnacInterfaceCollector(client, self._host, resolver)

            # Run each sub-collector
            outcomes.append(await devices_collector.collect())
            outcomes.append(await alarms_collector.collect())
            outcomes.append(await topology_collector.collect())
            outcomes.append(await client_health_collector.collect())
            outcomes.append(await interface_collector.collect())

        return outcomes

    def _skipped_outcome(self, reason: str) -> CollectorOutcome:
        outcome = CollectorOutcome(
            collector_id="dnac-devices",
            source_system="dnac",
        )
        outcome.mark_skipped(reason)
        return outcome

    async def connect(self) -> bool:
        """Validate DNAC credentials."""
        if not self.is_configured:
            return False
        try:
            async with httpx.AsyncClient(
                verify=self._verify_ssl,
                timeout=httpx.Timeout(15.0),
            ) as client:
                return await self._authenticate(client)
        except Exception:
            logger.exception("DNAC connect failed")
            return False


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _raise_for_status(resp: httpx.Response) -> None:
    if resp.status_code >= 400:
        try:
            detail = resp.json()
        except Exception:
            detail = resp.text
        raise DnacApiError(resp.status_code, str(detail))


def _map_dnac_severity(dnac_value: int) -> EventSeverity:
    """Map DNAC severity (1=critical … 5=minor) to EventSeverity."""
    if dnac_value <= 1:
        return EventSeverity.CRITICAL
    if dnac_value <= 2:
        return EventSeverity.MAJOR
    if dnac_value <= 3:
        return EventSeverity.WARNING
    return EventSeverity.INFO


def _map_dnac_event_type(name: str, domain: str, sub_domain: str) -> tuple:
    """Map DNAC event name/domain to (EventType, EventCategory)."""
    n = name.lower()
    d = domain.lower()
    sd = sub_domain.lower()

    if "unreachable" in n or "reachability" in n:
        return EventType.DEVICE_DOWN, EventCategory.CONNECTIVITY
    if "latency" in n or "performance" in n:
        return EventType.HIGH_LATENCY, EventCategory.PERFORMANCE
    if "cpu" in n:
        return EventType.HIGH_CPU, EventCategory.PERFORMANCE
    if "memory" in n:
        return EventType.HIGH_MEMORY, EventCategory.PERFORMANCE
    if "interface" in n or "link" in n:
        return EventType.INTERFACE_STATUS, EventCategory.CONNECTIVITY
    if "config" in n or "compliance" in n:
        return EventType.CONFIG_CHANGE, EventCategory.CONFIGURATION
    if "auth" in n or "aaa" in n or "security" in n:
        return EventType.CLIENT_AUTH_FAILED, EventCategory.SECURITY
    if "rogue" in n:
        return EventType.ROGUE_AP, EventCategory.SECURITY
    if "poison" in n or "arp" in n:
        return EventType.ROGUE_AP, EventCategory.SECURITY

    return EventType.OTHER, EventCategory.SYSTEM
