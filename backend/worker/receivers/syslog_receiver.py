"""
Syslog Receiver

Listens for RFC 3164 / RFC 5424 syslog messages over UDP (port 514) and
TCP (port 1514 by default — non-privileged) from any network device.

Why syslog?
  Syslog is the most universal protocol in networking: every switch, router,
  firewall, VPN gateway, and controller sends it. Unlike REST APIs that only
  surface pre-classified alarms, syslog carries the raw operational messages
  the device generates — interface flaps, routing changes, authentication
  events, hardware errors, spanning tree topology changes, ACL hits.

  Syslog gives us:
    - Sub-second fault detection (device logs the moment something happens)
    - Events that vendor REST APIs never expose (OSPF state, STP changes, ACLs)
    - A single ingest path for all vendors without per-vendor API clients

  VeloCloud edges, Juniper switches (EX/QFX), and most enterprise network
  devices support syslog out of the box with a single configuration line.

RFC 3164 format:  <priority>Mmm DD HH:MM:SS hostname process: message
RFC 5424 format:  <priority>VERSION timestamp hostname appname procid msgid msg

Priority = (facility * 8) + severity
  Facility 0-23: kern, user, mail, daemon, auth, syslog, lpr, news...
  Severity 0-7:  emerg, alert, crit, err, warning, notice, info, debug

Architecture:
  - UDP listener: asyncio DatagramProtocol (fire-and-forget, best effort)
  - TCP listener: asyncio StreamServer (reliable, length-delimited or newline)
  - Both feed the same asyncio.Queue → consumer → batch DB insert
  - Configurable ports: UDP 514 requires root; use UDP_PORT=5514 + iptables
    REDIRECT rule, or run container as root (acceptable in private networks)
"""

import asyncio
import logging
import re
from datetime import datetime, timezone
from typing import Dict, List, Optional
from uuid import uuid4

from config.settings import get_settings
from shared.database.events import insert_events
from shared.models.event import (
    DeviceInfo,
    EventCategory,
    EventSeverity,
    EventSource,
    EventType,
    UnifiedEvent,
)

logger = logging.getLogger(__name__)

# Syslog severity → EventSeverity
_SYSLOG_SEVERITY: Dict = {
    0: EventSeverity.CRITICAL,   # emerg
    1: EventSeverity.CRITICAL,   # alert
    2: EventSeverity.CRITICAL,   # crit
    3: EventSeverity.MAJOR,      # err
    4: EventSeverity.WARNING,    # warning
    5: EventSeverity.INFO,       # notice
    6: EventSeverity.INFO,       # info
    7: EventSeverity.DEBUG,      # debug
}

# Keyword → (EventType, EventCategory) heuristics
# These cover the most common structured log patterns from Juniper, Cisco, VeloCloud
_KEYWORD_MAP = [
    (re.compile(r'\blink[_ ]?down\b|\binterface.*down\b|\bline protocol.*down\b', re.I),
        EventType.INTERFACE_DOWN, EventCategory.CONNECTIVITY),
    (re.compile(r'\blink[_ ]?up\b|\binterface.*up\b|\bline protocol.*up\b', re.I),
        EventType.INTERFACE_UP, EventCategory.CONNECTIVITY),
    (re.compile(r'\bbgp.*down\b|\bbgp.*state.*idle\b|\bbgp.*notification\b', re.I),
        EventType.BGP_DOWN, EventCategory.CONNECTIVITY),
    (re.compile(r'\bbgp.*established\b|\bbgp.*up\b', re.I),
        EventType.BGP_UP, EventCategory.CONNECTIVITY),
    (re.compile(r'\bospf.*down\b|\bospf.*neighbor.*dead\b', re.I),
        EventType.OSPF_NEIGHBOR_DOWN, EventCategory.CONNECTIVITY),
    (re.compile(r'\bospf.*full\b|\bospf.*neighbor.*up\b', re.I),
        EventType.OSPF_NEIGHBOR_UP, EventCategory.CONNECTIVITY),
    (re.compile(r'\btunnel.*down\b|\bvpn.*down\b|\bipsec.*down\b', re.I),
        EventType.TUNNEL_DOWN, EventCategory.CONNECTIVITY),
    (re.compile(r'\btunnel.*up\b|\bvpn.*up\b|\bipsec.*up\b', re.I),
        EventType.TUNNEL_UP, EventCategory.CONNECTIVITY),
    (re.compile(r'\bauth.*fail\b|\bauthentication.*fail\b|\blogin.*fail\b|\binvalid.*password\b', re.I),
        EventType.AUTH_FAILURE, EventCategory.SECURITY),
    (re.compile(r'\baccess.*denied\b|\bunauthorized\b|\bsecurity.*violation\b', re.I),
        EventType.UNAUTHORIZED_ACCESS, EventCategory.SECURITY),
    (re.compile(r'\bcpu.*high\b|\bhigh.*cpu\b|\bcpu.*utilization.*[89][0-9]\b', re.I),
        EventType.HIGH_CPU, EventCategory.PERFORMANCE),
    (re.compile(r'\bmemory.*low\b|\blow.*memory\b|\bmemory.*exhausted\b', re.I),
        EventType.HIGH_MEMORY, EventCategory.PERFORMANCE),
    (re.compile(r'\bconfiguration.*changed\b|\bconfig.*commit\b|\bconfig.*change\b', re.I),
        EventType.CONFIG_CHANGE, EventCategory.CONFIGURATION),
    (re.compile(r'\breboot\b|\bsystem.*restart\b|\breloading\b', re.I),
        EventType.DEVICE_REBOOT, EventCategory.SYSTEM),
    (re.compile(r'\bfan.*fail\b|\bfan.*fault\b', re.I),
        EventType.FAN_FAILURE, EventCategory.HARDWARE),
    (re.compile(r'\btemperature.*high\b|\bthermal.*alert\b', re.I),
        EventType.TEMPERATURE_HIGH, EventCategory.HARDWARE),
    (re.compile(r'\bpower.*fail\b|\bpsu.*fail\b|\bpower.*supply\b', re.I),
        EventType.POWER_SUPPLY_FAILURE, EventCategory.HARDWARE),
    (re.compile(r'\bspanning.tree\b|\bstp\b|\brstp\b|\btopology.*change\b', re.I),
        EventType.OTHER, EventCategory.CONNECTIVITY),
]

# RFC 3164: <PRI>Mmm DD HH:MM:SS hostname tag: msg
_RFC3164 = re.compile(
    r'^<(?P<pri>\d+)>'
    r'(?P<month>\w+)\s+(?P<day>\d+)\s+(?P<time>\d+:\d+:\d+)\s+'
    r'(?P<hostname>\S+)\s+'
    r'(?P<tag>[^:]+):\s*'
    r'(?P<msg>.*)',
    re.DOTALL,
)

# RFC 5424: <PRI>VERSION timestamp hostname appname procid msgid msg
_RFC5424 = re.compile(
    r'^<(?P<pri>\d+)>(?P<ver>\d+)\s+'
    r'(?P<ts>\S+)\s+'
    r'(?P<hostname>\S+)\s+'
    r'(?P<appname>\S+)\s+'
    r'(?P<procid>\S+)\s+'
    r'(?P<msgid>\S+)\s*'
    r'(?P<msg>.*)',
    re.DOTALL,
)


class SyslogReceiver:
    """
    Dual-transport (UDP + TCP) syslog receiver.

    Both transports share one asyncio.Queue. A consumer coroutine drains
    the queue and batch-inserts normalized events to Postgres.
    """

    def __init__(self):
        settings = get_settings()
        self._enabled = settings.syslog_enabled
        self._host = settings.syslog_host
        self._udp_port = settings.syslog_udp_port
        self._tcp_port = settings.syslog_tcp_port
        self._queue: asyncio.Queue = asyncio.Queue(maxsize=50_000)
        self._udp_transport: Optional[asyncio.DatagramTransport] = None
        self._tcp_server: Optional[asyncio.AbstractServer] = None
        self._consumer_task: Optional[asyncio.Task] = None

    async def start(self) -> None:
        if not self._enabled:
            logger.info("Syslog receiver disabled")
            return

        loop = asyncio.get_event_loop()

        # UDP listener
        try:
            _, self._udp_transport = await loop.create_datagram_endpoint(
                lambda: _SyslogUdpProtocol(self._queue),
                local_addr=(self._host, self._udp_port),
            )
            logger.info("Syslog UDP listener on %s:%d", self._host, self._udp_port)
        except (PermissionError, OSError) as exc:
            logger.warning("Syslog UDP bind failed (port %d): %s — try a port > 1024", self._udp_port, exc)

        # TCP listener
        try:
            self._tcp_server = await asyncio.start_server(
                lambda r, w: _handle_tcp_client(r, w, self._queue),
                host=self._host,
                port=self._tcp_port,
            )
            logger.info("Syslog TCP listener on %s:%d", self._host, self._tcp_port)
        except (PermissionError, OSError) as exc:
            logger.warning("Syslog TCP bind failed (port %d): %s", self._tcp_port, exc)

        self._consumer_task = asyncio.create_task(
            self._consume_queue(), name="syslog-consumer"
        )

    async def stop(self) -> None:
        if self._udp_transport:
            self._udp_transport.close()
        if self._tcp_server:
            self._tcp_server.close()
            await self._tcp_server.wait_closed()
        if self._consumer_task:
            self._consumer_task.cancel()
            try:
                await self._consumer_task
            except asyncio.CancelledError:
                pass

    async def _consume_queue(self) -> None:
        batch: List[UnifiedEvent] = []
        while True:
            try:
                try:
                    event = await asyncio.wait_for(self._queue.get(), timeout=2.0)
                    batch.append(event)
                    while not self._queue.empty() and len(batch) < 50:
                        batch.append(self._queue.get_nowait())
                except asyncio.TimeoutError:
                    pass

                if batch:
                    try:
                        await insert_events(batch)
                        logger.debug("Syslog receiver: persisted %d events", len(batch))
                    except Exception:
                        logger.exception("Failed to persist syslog events")
                    batch.clear()

            except asyncio.CancelledError:
                if batch:
                    try:
                        await insert_events(batch)
                    except Exception:
                        pass
                raise


class _SyslogUdpProtocol(asyncio.DatagramProtocol):
    def __init__(self, queue: asyncio.Queue):
        self._queue = queue

    def datagram_received(self, data: bytes, addr: tuple) -> None:
        try:
            raw = data.decode("utf-8", errors="replace").strip()
            event = parse_syslog(raw, addr[0])
            if event:
                try:
                    self._queue.put_nowait(event)
                except asyncio.QueueFull:
                    pass
        except Exception:
            pass

    def error_received(self, exc: Exception) -> None:
        logger.debug("Syslog UDP error: %s", exc)


async def _handle_tcp_client(
    reader: asyncio.StreamReader,
    writer: asyncio.StreamWriter,
    queue: asyncio.Queue,
) -> None:
    """Handle one syslog TCP client. Messages are newline-delimited."""
    peer = writer.get_extra_info("peername", ("unknown", 0))[0]
    try:
        while True:
            line = await asyncio.wait_for(reader.readline(), timeout=60.0)
            if not line:
                break
            raw = line.decode("utf-8", errors="replace").strip()
            if raw:
                event = parse_syslog(raw, peer)
                if event:
                    try:
                        queue.put_nowait(event)
                    except asyncio.QueueFull:
                        pass
    except (asyncio.TimeoutError, asyncio.IncompleteReadError, ConnectionResetError):
        pass
    finally:
        writer.close()


# ── Parser ────────────────────────────────────────────────────────────────────

def parse_syslog(raw: str, src_ip: str) -> Optional[UnifiedEvent]:
    """
    Parse a raw syslog line and return a normalized UnifiedEvent.

    Tries RFC 5424 first (versioned format), then RFC 3164 (classic BSD format).
    Falls back to a generic event so no message is silently dropped.
    """
    m = _RFC5424.match(raw) or _RFC3164.match(raw)

    if m:
        pri = int(m.group("pri"))
        facility = pri >> 3
        syslog_sev = pri & 0x07
        hostname = m.group("hostname") or src_ip
        msg = m.group("msg").strip()

        # RFC 5424 timestamp
        ts_str = m.groupdict().get("ts")
        if ts_str and ts_str != "-":
            try:
                timestamp = datetime.fromisoformat(ts_str.replace("Z", "+00:00")).replace(tzinfo=None)
            except ValueError:
                timestamp = datetime.utcnow()
        else:
            # RFC 3164 — no year, assume current
            timestamp = datetime.utcnow()
    else:
        # Totally unstructured — treat it as a raw info message
        hostname = src_ip
        msg = raw
        syslog_sev = 6
        facility = 16  # local0
        timestamp = datetime.utcnow()

    severity = _SYSLOG_SEVERITY.get(syslog_sev, EventSeverity.INFO)
    event_type, category = _classify_message(msg)

    return UnifiedEvent(
        event_id=f"syslog-{uuid4().hex[:12]}",
        timestamp=timestamp,
        source=EventSource.SYSLOG,
        source_event_id=f"syslog-{src_ip}-{int(timestamp.timestamp())}",
        severity=severity,
        category=category,
        event_type=event_type,
        title=_make_title(event_type, msg),
        description=msg[:2000],  # cap very long messages
        device=DeviceInfo(
            device_id=f"syslog-{src_ip.replace('.', '-')}",
            device_name=hostname if hostname != src_ip else "",
            device_ip=src_ip,
        ),
        tags=["syslog", f"facility-{facility}", f"sev-{syslog_sev}"],
        metadata={
            "syslog_facility": facility,
            "syslog_severity": syslog_sev,
            "src_ip": src_ip,
            "hostname": hostname,
        },
        raw_event={"raw": raw},
    )


def _classify_message(msg: str) -> tuple:
    for pattern, event_type, category in _KEYWORD_MAP:
        if pattern.search(msg):
            return event_type, category
    return EventType.OTHER, EventCategory.SYSTEM


def _make_title(event_type: EventType, msg: str) -> str:
    if event_type != EventType.OTHER:
        return event_type.value.replace("_", " ").title()
    # Use first 80 chars of message as title
    short = msg[:80].strip()
    return short if short else "Syslog Event"
