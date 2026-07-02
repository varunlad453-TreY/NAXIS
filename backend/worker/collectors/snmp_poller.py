"""
SNMP Polling Collector

Polls network devices via SNMP v2c to collect:
  1. Interface counters  (ifTable / ifXTable)  → performance events + topology ports
  2. LLDP neighbours     (LLDP-MIB)            → physical topology discovery
  3. CDP neighbours      (CISCO-CDP-MIB)        → physical topology on Cisco devices
  4. System info         (sysDescr, sysName)    → device enrichment

Why SNMP?
  Every production network device — switches, routers, firewalls — exposes SNMP.
  Unlike vendor REST APIs, SNMP works across brands with a single protocol.
  LLDP/CDP neighbour tables give us ground-truth physical topology that no
  vendor API provides: which switch port an AP uplinks to, how cores interconnect.

MIBs used:
  RFC 2863  ifTable          → ifIndex, ifDescr, ifOperStatus, ifAdminStatus
  RFC 2863  ifXTable         → ifName, ifHighSpeed, ifHCIn/OutOctets (64-bit counters)
  RFC 2922  LLDP-MIB         → lldpRemChassisId, lldpRemPortId, lldpRemSysName
  Cisco     CISCO-CDP-MIB    → cdpCacheDeviceId, cdpCacheAddress, cdpCacheDevicePort

Implementation:
  Uses pysnmp (pure-Python, asyncio-compatible) — no native C snmpwalk binary needed.
  Collects interface states and writes LINK_DOWN / LINK_UP events to the event pipeline.
  Writes discovered LLDP/CDP neighbours to the topology tables directly.
"""

import asyncio
import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple
from uuid import uuid4

from config.settings import get_settings
from shared.database.client import db
from shared.models.event import (
    DeviceInfo,
    EventCategory,
    EventSeverity,
    EventSource,
    EventType,
    InterfaceInfo,
    UnifiedEvent,
)

logger = logging.getLogger(__name__)

# OID prefixes
_OID_SYS_NAME = "1.3.6.1.2.1.1.5.0"
_OID_SYS_DESCR = "1.3.6.1.2.1.1.1.0"
_OID_IF_DESCR = "1.3.6.1.2.1.2.2.1.2"       # ifDescr table
_OID_IF_OPER_STATUS = "1.3.6.1.2.1.2.2.1.8"  # ifOperStatus  (1=up, 2=down)
_OID_IF_ADMIN_STATUS = "1.3.6.1.2.1.2.2.1.7" # ifAdminStatus
_OID_IF_NAME = "1.3.6.1.2.1.31.1.1.1.1"      # ifXTable ifName
_OID_IF_HIGH_SPEED = "1.3.6.1.2.1.31.1.1.1.15"  # ifHighSpeed Mbps
_OID_IF_IN_OCTETS = "1.3.6.1.2.1.31.1.1.1.6"    # ifHCInOctets  64-bit
_OID_IF_OUT_OCTETS = "1.3.6.1.2.1.31.1.1.1.10"  # ifHCOutOctets 64-bit

_OID_LLDP_REM_CHASSIS = "1.0.8802.1.1.2.1.4.1.1.5"  # lldpRemChassisId
_OID_LLDP_REM_PORT    = "1.0.8802.1.1.2.1.4.1.1.7"  # lldpRemPortId
_OID_LLDP_REM_SYSNAME = "1.0.8802.1.1.2.1.4.1.1.9"  # lldpRemSysName

_OID_CDP_DEVICE_ID   = "1.3.6.1.4.1.9.9.23.1.2.1.1.6"  # cdpCacheDeviceId
_OID_CDP_DEVICE_PORT = "1.3.6.1.4.1.9.9.23.1.2.1.1.7"  # cdpCacheDevicePort
_OID_CDP_ADDRESS     = "1.3.6.1.4.1.9.9.23.1.2.1.1.4"  # cdpCacheAddress


class SnmpPoller:
    """
    SNMP v2c bulk-walk poller for interface monitoring and topology discovery.

    One instance polls all configured SNMP_TARGETS per collection cycle.
    Results feed both the event pipeline (interface state changes) and the
    topology tables (LLDP/CDP neighbour relationships).
    """

    def __init__(self):
        settings = get_settings()
        self._enabled = settings.snmp_enabled
        self._community = settings.snmp_community
        self._port = settings.snmp_port
        self._timeout = settings.snmp_timeout
        self._retries = settings.snmp_retries
        self._targets = settings.snmp_targets_list
        # Track previous interface states to generate UP/DOWN events only on change
        self._prev_if_states: Dict[str, Dict[int, int]] = {}

    async def collect(self) -> List[UnifiedEvent]:
        """Poll all configured targets. Returns interface state-change events."""
        if not self._enabled or not self._targets:
            return []

        try:
            from pysnmp.hlapi.asyncio import (
                CommunityData,
                ContextData,
                ObjectIdentity,
                ObjectType,
                SnmpEngine,
                UdpTransportTarget,
                bulkCmd,
                getCmd,
            )
        except ImportError:
            logger.error(
                "pysnmp not installed — SNMP polling disabled. "
                "Add 'pysnmp>=6.0.0' to worker/requirements.txt"
            )
            return []

        all_events: List[UnifiedEvent] = []
        tasks = [self._poll_target(ip) for ip in self._targets]
        results = await asyncio.gather(*tasks, return_exceptions=True)
        for ip, result in zip(self._targets, results):
            if isinstance(result, Exception):
                logger.warning("SNMP poll failed for %s: %s", ip, result)
            elif result:
                all_events.extend(result)

        return all_events

    async def _poll_target(self, ip: str) -> List[UnifiedEvent]:
        try:
            from pysnmp.hlapi.asyncio import (
                CommunityData,
                ContextData,
                ObjectIdentity,
                ObjectType,
                SnmpEngine,
                UdpTransportTarget,
                bulkCmd,
                getCmd,
            )
        except ImportError:
            return []

        engine = SnmpEngine()
        auth = CommunityData(self._community, mpModel=1)  # v2c
        transport = UdpTransportTarget(
            (ip, self._port),
            timeout=self._timeout,
            retries=self._retries,
        )
        ctx = ContextData()

        sys_name, sys_descr = await self._get_system_info(engine, auth, transport, ctx)
        if_data = await self._walk_interfaces(engine, auth, transport, ctx)
        lldp_neighbours = await self._walk_lldp(engine, auth, transport, ctx)
        cdp_neighbours = await self._walk_cdp(engine, auth, transport, ctx)

        # Persist topology data
        if if_data:
            await self._upsert_topology_node(ip, sys_name, sys_descr, if_data)
        neighbours = lldp_neighbours or cdp_neighbours
        if neighbours:
            await self._upsert_topology_edges(ip, sys_name, neighbours)

        # Generate events for interface state changes
        events = self._generate_if_events(ip, sys_name, if_data)
        logger.info(
            "SNMP %s: %d interfaces, %d neighbours, %d state-change events",
            ip, len(if_data), len(neighbours), len(events),
        )
        return events

    # ── System info ───────────────────────────────────────────────────────────

    async def _get_system_info(self, engine, auth, transport, ctx) -> Tuple[str, str]:
        try:
            from pysnmp.hlapi.asyncio import ObjectIdentity, ObjectType, getCmd
            error_indication, error_status, _, var_binds = await getCmd(
                engine, auth, transport, ctx,
                ObjectType(ObjectIdentity(_OID_SYS_NAME)),
                ObjectType(ObjectIdentity(_OID_SYS_DESCR)),
            )
            if error_indication or error_status:
                return "", ""
            sys_name = str(var_binds[0][1]) if var_binds else ""
            sys_descr = str(var_binds[1][1]) if len(var_binds) > 1 else ""
            return sys_name, sys_descr
        except Exception:
            return "", ""

    # ── Interface walk ────────────────────────────────────────────────────────

    async def _walk_interfaces(self, engine, auth, transport, ctx) -> Dict[int, Dict]:
        """Returns {ifIndex: {name, oper_status, admin_status, speed_mbps}}."""
        from pysnmp.hlapi.asyncio import ObjectIdentity, ObjectType, bulkCmd
        result: Dict[int, Dict] = {}

        for oid_prefix, field in [
            (_OID_IF_NAME, "name"),
            (_OID_IF_DESCR, "descr"),
            (_OID_IF_OPER_STATUS, "oper_status"),
            (_OID_IF_ADMIN_STATUS, "admin_status"),
            (_OID_IF_HIGH_SPEED, "speed_mbps"),
        ]:
            try:
                async for err_ind, err_st, _, var_binds in bulkCmd(
                    engine, auth, transport, ctx,
                    0, 50,
                    ObjectType(ObjectIdentity(oid_prefix)),
                    lexicographicMode=False,
                ):
                    if err_ind or err_st:
                        break
                    for oid, val in var_binds:
                        oid_str = str(oid)
                        if not oid_str.startswith(oid_prefix):
                            break
                        idx = int(oid_str.split(".")[-1])
                        result.setdefault(idx, {})[field] = str(val)
            except Exception as exc:
                logger.debug("SNMP walk %s failed: %s", oid_prefix, exc)

        return result

    # ── LLDP walk ─────────────────────────────────────────────────────────────

    async def _walk_lldp(self, engine, auth, transport, ctx) -> List[Dict]:
        """Returns list of {local_port_idx, remote_chassis, remote_port, remote_sysname}."""
        from pysnmp.hlapi.asyncio import ObjectIdentity, ObjectType, bulkCmd
        chassis_map: Dict[Tuple, str] = {}
        port_map: Dict[Tuple, str] = {}
        sysname_map: Dict[Tuple, str] = {}

        for oid_prefix, store in [
            (_OID_LLDP_REM_CHASSIS, chassis_map),
            (_OID_LLDP_REM_PORT, port_map),
            (_OID_LLDP_REM_SYSNAME, sysname_map),
        ]:
            try:
                async for err_ind, err_st, _, var_binds in bulkCmd(
                    engine, auth, transport, ctx,
                    0, 50,
                    ObjectType(ObjectIdentity(oid_prefix)),
                    lexicographicMode=False,
                ):
                    if err_ind or err_st:
                        break
                    for oid, val in var_binds:
                        oid_str = str(oid)
                        if not oid_str.startswith(oid_prefix):
                            break
                        # OID suffix: timeMark.localPortNum.remoteIndex
                        parts = oid_str[len(oid_prefix):].lstrip(".").split(".")
                        if len(parts) >= 3:
                            key = (parts[0], parts[1], parts[2])
                            store[key] = str(val)
            except Exception as exc:
                logger.debug("LLDP walk failed: %s", exc)

        neighbours = []
        for key in set(chassis_map) | set(sysname_map):
            neighbours.append({
                "protocol": "lldp",
                "local_port_idx": key[1] if len(key) > 1 else "",
                "remote_chassis": chassis_map.get(key, ""),
                "remote_port": port_map.get(key, ""),
                "remote_sysname": sysname_map.get(key, ""),
            })
        return neighbours

    # ── CDP walk ──────────────────────────────────────────────────────────────

    async def _walk_cdp(self, engine, auth, transport, ctx) -> List[Dict]:
        """Returns list of {local_port_idx, remote_device_id, remote_port, remote_ip}."""
        from pysnmp.hlapi.asyncio import ObjectIdentity, ObjectType, bulkCmd
        device_map: Dict[Tuple, str] = {}
        port_map: Dict[Tuple, str] = {}
        addr_map: Dict[Tuple, str] = {}

        for oid_prefix, store in [
            (_OID_CDP_DEVICE_ID, device_map),
            (_OID_CDP_DEVICE_PORT, port_map),
            (_OID_CDP_ADDRESS, addr_map),
        ]:
            try:
                async for err_ind, err_st, _, var_binds in bulkCmd(
                    engine, auth, transport, ctx,
                    0, 50,
                    ObjectType(ObjectIdentity(oid_prefix)),
                    lexicographicMode=False,
                ):
                    if err_ind or err_st:
                        break
                    for oid, val in var_binds:
                        oid_str = str(oid)
                        if not oid_str.startswith(oid_prefix):
                            break
                        parts = oid_str[len(oid_prefix):].lstrip(".").split(".")
                        if len(parts) >= 2:
                            key = (parts[0], parts[1])
                            store[key] = str(val)
            except Exception as exc:
                logger.debug("CDP walk failed: %s", exc)

        neighbours = []
        for key in set(device_map):
            neighbours.append({
                "protocol": "cdp",
                "local_port_idx": key[0],
                "remote_device_id": device_map.get(key, ""),
                "remote_port": port_map.get(key, ""),
                "remote_ip": addr_map.get(key, ""),
            })
        return neighbours

    # ── Event generation ──────────────────────────────────────────────────────

    def _generate_if_events(
        self, ip: str, sys_name: str, if_data: Dict[int, Dict]
    ) -> List[UnifiedEvent]:
        events: List[UnifiedEvent] = []
        prev = self._prev_if_states.get(ip, {})
        new_states: Dict[int, int] = {}

        for idx, info in if_data.items():
            try:
                oper = int(info.get("oper_status", 1))
                admin = int(info.get("admin_status", 1))
            except (ValueError, TypeError):
                continue

            new_states[idx] = oper
            prev_oper = prev.get(idx)

            # Only emit events on transitions (skip first poll — no baseline yet)
            if prev_oper is None or prev_oper == oper:
                continue
            # Skip interfaces that are administratively down
            if admin == 2:
                continue

            if_name = info.get("name") or info.get("descr") or f"ifIndex.{idx}"
            device_id = f"snmp-{ip.replace('.', '-')}"
            went_down = (prev_oper == 1 and oper == 2)

            events.append(UnifiedEvent(
                event_id=f"snmp-{uuid4().hex[:12]}",
                timestamp=datetime.now(timezone.utc).replace(tzinfo=None),
                source=EventSource.SNMP,
                source_event_id=f"snmp-{ip}-{idx}-{oper}",
                severity=EventSeverity.MAJOR if went_down else EventSeverity.INFO,
                category=EventCategory.CONNECTIVITY,
                event_type=EventType.INTERFACE_DOWN if went_down else EventType.INTERFACE_UP,
                title=f"Interface {'Down' if went_down else 'Up'}: {if_name}",
                description=(
                    f"Interface {if_name} on {sys_name or ip} transitioned to "
                    f"{'down' if went_down else 'up'}. "
                    f"Speed: {info.get('speed_mbps', '?')} Mbps"
                ),
                device=DeviceInfo(
                    device_id=device_id,
                    device_name=sys_name or ip,
                    device_ip=ip,
                    device_type="switch",
                ),
                interface=InterfaceInfo(
                    interface_name=if_name,
                    interface_status="down" if went_down else "up",
                    speed=f"{info.get('speed_mbps', '')} Mbps",
                ),
                tags=["snmp", "interface", "down" if went_down else "up"],
                metadata={"snmp_target": ip, "if_index": idx},
            ))

        self._prev_if_states[ip] = new_states
        return events

    # ── Topology persistence ──────────────────────────────────────────────────

    async def _upsert_topology_node(
        self, ip: str, sys_name: str, sys_descr: str, if_data: Dict[int, Dict]
    ) -> None:
        import json
        node_id = f"snmp-{ip.replace('.', '-')}"
        props = {
            "sys_descr": sys_descr,
            "interfaces": {
                str(idx): {
                    "name": info.get("name") or info.get("descr", ""),
                    "oper_status": info.get("oper_status", ""),
                    "speed_mbps": info.get("speed_mbps", ""),
                }
                for idx, info in if_data.items()
            },
        }
        await db.execute(
            """
            INSERT INTO topology_nodes (node_id, node_type, name, ip_address, vendor, props, updated_at)
            VALUES ($1, 'switch', $2, $3, 'snmp', $4::jsonb, NOW())
            ON CONFLICT (node_id) DO UPDATE SET
                name       = EXCLUDED.name,
                ip_address = EXCLUDED.ip_address,
                props      = EXCLUDED.props,
                updated_at = NOW()
            """,
            node_id, sys_name or ip, ip, json.dumps(props),
        )

    async def _upsert_topology_edges(
        self, local_ip: str, local_sys_name: str, neighbours: List[Dict]
    ) -> None:
        import json
        local_node_id = f"snmp-{local_ip.replace('.', '-')}"
        for nbr in neighbours:
            protocol = nbr.get("protocol", "lldp")
            if protocol == "lldp":
                remote_id = nbr.get("remote_chassis") or nbr.get("remote_sysname", "")
            else:
                remote_id = nbr.get("remote_device_id", "")
            if not remote_id:
                continue

            # Ensure remote node exists (may not have been polled yet)
            remote_node_id = f"snmp-{remote_id.replace('.', '-').replace(':', '-')}"
            await db.execute(
                """
                INSERT INTO topology_nodes (node_id, node_type, name, props, updated_at)
                VALUES ($1, 'switch', $2, '{}'::jsonb, NOW())
                ON CONFLICT (node_id) DO NOTHING
                """,
                remote_node_id, nbr.get("remote_sysname") or remote_id,
            )

            edge_props = json.dumps({
                "protocol": protocol,
                "local_port": nbr.get("local_port_idx", ""),
                "remote_port": nbr.get("remote_port") or nbr.get("remote_port", ""),
                "remote_ip": nbr.get("remote_ip", ""),
                "discovered_by": f"snmp_{protocol}",
            })
            # Use LEAST/GREATEST to avoid duplicate edges (A→B and B→A)
            await db.execute(
                """
                INSERT INTO topology_edges (src_id, dst_id, edge_type, props, updated_at)
                VALUES ($1, $2, 'physical_link', $3::jsonb, NOW())
                ON CONFLICT (LEAST(src_id,dst_id), GREATEST(src_id,dst_id), edge_type)
                DO UPDATE SET props = EXCLUDED.props, updated_at = NOW()
                """,
                local_node_id, remote_node_id, edge_props,
            )
