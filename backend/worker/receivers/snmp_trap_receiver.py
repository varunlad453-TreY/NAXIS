"""
SNMP Trap Receiver

Listens on UDP port 162 (configurable) for SNMP v1/v2c trap PDUs from any
network device and normalizes them to UnifiedEvent for immediate persistence.

Why traps over polling?
  REST polling runs on a 60-second cycle — a brief link flap or device reboot
  that recovers within that window is completely invisible. SNMP traps are
  push-based: the device sends a trap the instant something happens, giving
  sub-second fault detection regardless of the polling interval.

  Traps complement polling:
    - Polling  → current state (what is true right now)
    - Traps    → state change events (what happened and when)

Supported trap types (v2c / v1 well-known):
  - linkDown (OID 1.3.6.1.6.3.1.1.5.3)
  - linkUp   (OID 1.3.6.1.6.3.1.1.5.4)
  - coldStart / warmStart
  - authenticationFailure
  - Any vendor-specific enterprise trap (stored as raw for future parsing)

Architecture:
  Runs as an asyncio DatagramProtocol alongside the main worker event loop.
  Decoded traps are queued into an asyncio.Queue; a consumer coroutine
  drains the queue and batch-inserts events to Postgres.
"""

import asyncio
import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
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

# Well-known SNMP trap OIDs (SNMPv2-MIB)
_TRAP_OID_MAP: Dict[str, tuple] = {
    "1.3.6.1.6.3.1.1.5.1": (EventType.DEVICE_REACHABLE,  EventSeverity.INFO,     "coldStart"),
    "1.3.6.1.6.3.1.1.5.2": (EventType.DEVICE_REACHABLE,  EventSeverity.WARNING,  "warmStart"),
    "1.3.6.1.6.3.1.1.5.3": (EventType.INTERFACE_DOWN,    EventSeverity.MAJOR,    "linkDown"),
    "1.3.6.1.6.3.1.1.5.4": (EventType.INTERFACE_UP,      EventSeverity.INFO,     "linkUp"),
    "1.3.6.1.6.3.1.1.5.5": (EventType.AUTH_FAILURE,      EventSeverity.WARNING,  "authenticationFailure"),
    "1.3.6.1.6.3.1.1.5.6": (EventType.DEVICE_UNREACHABLE, EventSeverity.MAJOR,   "egpNeighborLoss"),
}


class SnmpTrapReceiver:
    """
    Asyncio-based SNMP trap receiver.

    Usage (called by worker daemon):
        receiver = SnmpTrapReceiver()
        await receiver.start()     # non-blocking, starts background tasks
        ...
        await receiver.stop()
    """

    def __init__(self):
        settings = get_settings()
        self._enabled = settings.snmp_trap_enabled
        self._host = settings.snmp_trap_host
        self._port = settings.snmp_trap_port
        self._community = settings.snmp_community
        self._queue: asyncio.Queue = asyncio.Queue(maxsize=10_000)
        self._transport: Optional[asyncio.DatagramTransport] = None
        self._consumer_task: Optional[asyncio.Task] = None

    async def start(self) -> None:
        if not self._enabled:
            logger.info("SNMP trap receiver disabled")
            return

        try:
            from pysnmp.carrier.asyncio.dgram import udp
            from pysnmp.entity import engine, config
            from pysnmp.entity.rfc3413 import ntfrcv
        except ImportError:
            logger.error(
                "pysnmp not installed — SNMP trap receiver disabled. "
                "Add 'pysnmp>=6.0.0' to worker/requirements.txt"
            )
            return

        loop = asyncio.get_event_loop()

        # Use raw asyncio UDP for simplicity and reliability
        try:
            _, self._transport = await loop.create_datagram_endpoint(
                lambda: _TrapProtocol(self._queue, self._community),
                local_addr=(self._host, self._port),
            )
            logger.info(
                "SNMP trap receiver listening on %s:%d", self._host, self._port
            )
        except PermissionError:
            logger.error(
                "Cannot bind SNMP trap receiver to port %d — permission denied. "
                "Run as root or use SNMP_TRAP_PORT > 1024 and forward with iptables.",
                self._port,
            )
            return
        except OSError as exc:
            logger.error("SNMP trap receiver failed to bind: %s", exc)
            return

        self._consumer_task = asyncio.create_task(
            self._consume_queue(), name="snmp-trap-consumer"
        )

    async def stop(self) -> None:
        if self._transport:
            self._transport.close()
        if self._consumer_task:
            self._consumer_task.cancel()
            try:
                await self._consumer_task
            except asyncio.CancelledError:
                pass

    async def _consume_queue(self) -> None:
        """Drain the trap queue and persist events in small batches."""
        batch: List[UnifiedEvent] = []
        while True:
            try:
                # Collect up to 20 traps or wait up to 2s before flushing
                try:
                    event = await asyncio.wait_for(self._queue.get(), timeout=2.0)
                    batch.append(event)
                    while not self._queue.empty() and len(batch) < 20:
                        batch.append(self._queue.get_nowait())
                except asyncio.TimeoutError:
                    pass

                if batch:
                    try:
                        await insert_events(batch)
                        logger.info("SNMP trap receiver: persisted %d trap events", len(batch))
                    except Exception:
                        logger.exception("Failed to persist SNMP trap events")
                    batch.clear()

            except asyncio.CancelledError:
                # Flush remaining on shutdown
                if batch:
                    try:
                        await insert_events(batch)
                    except Exception:
                        pass
                raise


class _TrapProtocol(asyncio.DatagramProtocol):
    """
    Raw UDP datagram handler for SNMP trap packets.

    Decodes v1 / v2c trap PDUs using pysnmp's codec and places
    normalized UnifiedEvent objects onto the shared queue.
    """

    def __init__(self, queue: asyncio.Queue, community: str):
        self._queue = queue
        self._community = community

    def datagram_received(self, data: bytes, addr: tuple) -> None:
        src_ip = addr[0]
        try:
            event = _decode_trap(data, src_ip)
            if event:
                try:
                    self._queue.put_nowait(event)
                except asyncio.QueueFull:
                    logger.warning("SNMP trap queue full — dropping trap from %s", src_ip)
        except Exception:
            logger.exception("Failed to decode SNMP trap from %s", src_ip)

    def error_received(self, exc: Exception) -> None:
        logger.warning("SNMP trap UDP error: %s", exc)


def _decode_trap(data: bytes, src_ip: str) -> Optional[UnifiedEvent]:
    """
    Decode a raw SNMP PDU into a UnifiedEvent.

    Handles v1 Trap-PDU and v2c SNMPv2-Trap-PDU. Falls back to a
    generic event if the specific trap OID is not in the known map.
    """
    try:
        from pysnmp.proto import api as snmp_api
        msg_ver = int(snmp_api.decodeMessageVersion(data))
        if msg_ver == snmp_api.protoVersion1:
            pmod = snmp_api.protoModules[snmp_api.protoVersion1]
        elif msg_ver == snmp_api.protoVersion2c:
            pmod = snmp_api.protoModules[snmp_api.protoVersion2c]
        else:
            return None

        msg, _ = pmod.Message().clone().setComponentByPosition(0, msg_ver), None
        msg, _ = pmod.apiMessage.decodeMessageVersion(data, msg_ver)
        pdu = pmod.apiMessage.getPDU(msg)

        var_binds: Dict[str, Any] = {}
        trap_oid = ""

        if msg_ver == snmp_api.protoVersion1:
            # v1 trap: enterprise + specific OIDs
            enterprise = str(pmod.apiTrapPDU.getEnterprise(pdu))
            specific = int(pmod.apiTrapPDU.getSpecificTrap(pdu))
            trap_oid = f"{enterprise}.{specific}"
            for oid, val in pmod.apiTrapPDU.getVarBinds(pdu):
                var_binds[str(oid)] = str(val)
        else:
            # v2c trap: snmpTrapOID.0 is always the second varbind
            for oid, val in pmod.apiPDU.getVarBinds(pdu):
                oid_str = str(oid)
                var_binds[oid_str] = str(val)
                if oid_str == "1.3.6.1.6.3.1.1.4.1.0":
                    trap_oid = str(val)

    except Exception:
        # If pysnmp can't parse it, emit a raw event anyway so we don't lose the signal
        return UnifiedEvent(
            event_id=f"trap-{uuid4().hex[:12]}",
            timestamp=datetime.now(timezone.utc).replace(tzinfo=None),
            source=EventSource.SNMP_TRAP,
            source_event_id=f"raw-trap-{src_ip}",
            severity=EventSeverity.WARNING,
            category=EventCategory.SYSTEM,
            event_type=EventType.OTHER,
            title="SNMP Trap (unparsed)",
            description=f"Received unparsed SNMP trap from {src_ip}",
            device=DeviceInfo(device_id=f"snmp-{src_ip.replace('.', '-')}", device_ip=src_ip),
            tags=["snmp_trap", "unparsed"],
            metadata={"src_ip": src_ip},
        )

    # Look up known trap type
    mapped = _TRAP_OID_MAP.get(trap_oid)
    if mapped:
        event_type, severity, trap_name = mapped
        category = (
            EventCategory.CONNECTIVITY if event_type in (EventType.INTERFACE_DOWN, EventType.INTERFACE_UP)
            else EventCategory.SECURITY if event_type == EventType.AUTH_FAILURE
            else EventCategory.SYSTEM
        )
        title = f"SNMP Trap: {trap_name}"
        desc = f"{trap_name} received from {src_ip}"
    else:
        event_type = EventType.OTHER
        severity = EventSeverity.INFO
        category = EventCategory.SYSTEM
        title = f"SNMP Trap: {trap_oid}"
        desc = f"Enterprise trap {trap_oid} from {src_ip}"

    if_name = (
        var_binds.get("1.3.6.1.2.1.2.2.1.2") or  # ifDescr
        var_binds.get("1.3.6.1.2.1.31.1.1.1.1") or  # ifName
        ""
    )

    return UnifiedEvent(
        event_id=f"trap-{uuid4().hex[:12]}",
        timestamp=datetime.now(timezone.utc).replace(tzinfo=None),
        source=EventSource.SNMP_TRAP,
        source_event_id=f"trap-{src_ip}-{trap_oid}",
        severity=severity,
        category=category,
        event_type=event_type,
        title=title,
        description=desc,
        device=DeviceInfo(
            device_id=f"snmp-{src_ip.replace('.', '-')}",
            device_ip=src_ip,
        ),
        tags=["snmp_trap"],
        metadata={
            "trap_oid": trap_oid,
            "src_ip": src_ip,
            "var_binds": var_binds,
            "if_name": if_name,
        },
        raw_event={"raw_var_binds": var_binds},
    )
