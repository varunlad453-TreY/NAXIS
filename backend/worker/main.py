#!/usr/bin/env python3
"""
Naxis Worker

Background daemon that runs the full telemetry pipeline:
  - REST API polling  (Mist inventory + events, VeloCloud inventory + metrics + events)
  - SNMP polling      (interface counters + LLDP/CDP topology discovery)
  - SNMP trap receiver (push-based, always-on UDP listener)
  - Syslog receiver   (push-based, always-on UDP+TCP listener)
  - Topology sync     (builds topology_nodes + topology_edges from all sources)
  - Correlation       (TODO Phase 6)

Entry point:
    python -m worker.main
"""

import asyncio
import logging
import os
import signal
import sys
from datetime import datetime, timedelta

from config.settings import get_settings
from shared.database.client import db
from shared.database.events import insert_events
from worker.collectors.mist import MistCollector
from worker.collectors.mist_inventory import MistInventoryCollector
from worker.collectors.velocloud_inventory import VelocloudInventoryCollector
from worker.collectors.velocloud_metrics import VelocloudMetricsCollector
from worker.collectors.velocloud_events import VelocloudEventsCollector
from worker.collectors.snmp_poller import SnmpPoller
from worker.collectors.topology_sync import TopologySync
from worker.receivers.snmp_trap_receiver import SnmpTrapReceiver
from worker.receivers.syslog_receiver import SyslogReceiver

logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO").upper(),
    format="%(asctime)s | %(name)-30s | %(levelname)-8s | %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger(__name__)

_settings = get_settings()
COLLECTOR_INTERVAL = _settings.collector_interval


class WorkerDaemon:
    """
    Main worker daemon.

    Lifecycle:
      start()        → connect DB, start push receivers, run poll loop
      run_once()     → one full poll+normalize+topology pass
      stop()         → signal graceful shutdown
    """

    def __init__(self):
        self._running = False

        # REST API collectors
        self._mist = MistCollector()
        self._mist_inventory = MistInventoryCollector()
        self._velocloud_inventory = VelocloudInventoryCollector()
        self._velocloud_metrics = VelocloudMetricsCollector()
        self._velocloud_events = VelocloudEventsCollector()

        # SNMP poller (interface counters + LLDP/CDP topology)
        self._snmp_poller = SnmpPoller()

        # Topology sync (builds topology graph from all inventory sources)
        self._topology_sync = TopologySync()

        # Push receivers — started once, run permanently alongside the poll loop
        self._snmp_trap_receiver = SnmpTrapReceiver()
        self._syslog_receiver = SyslogReceiver()

        self._last_collected: datetime = datetime.utcnow() - timedelta(hours=24)

    async def run_once(self) -> None:
        """Execute one full pipeline pass."""
        await self._collect_and_normalize()
        await self._correlate()
        await self._sync_topology()

    async def _collect_and_normalize(self) -> None:
        """Collect telemetry from all enabled vendors and persist normalized events."""
        since = self._last_collected
        now = datetime.utcnow()

        # Mist events (alarms + audit logs)
        mist_events = await self._mist.collect(since=since)
        if mist_events:
            await insert_events(mist_events)
            logger.info("Mist events: persisted %d", len(mist_events))

        # Mist inventory (APs, sites, live stats)
        await self._mist_inventory.collect()

        # VeloCloud inventory (edges + site info)
        await self._velocloud_inventory.collect()

        # VeloCloud link metrics (latency, jitter, loss, VeloBrain score)
        await self._velocloud_metrics.collect()

        # VeloCloud events (edge state changes, HA failovers, config changes)
        velo_events = await self._velocloud_events.collect(since=since)
        if velo_events:
            await insert_events(velo_events)
            logger.info("VeloCloud events: persisted %d", len(velo_events))

        # SNMP interface polls (generates events only on state transitions)
        snmp_events = await self._snmp_poller.collect()
        if snmp_events:
            await insert_events(snmp_events)
            logger.info("SNMP poll events: persisted %d", len(snmp_events))

        self._last_collected = now

    async def _correlate(self) -> None:
        """Read recent unprocessed events, run correlation, write incidents."""
        # TODO Phase 6: implement correlation against Postgres
        pass

    async def _sync_topology(self) -> None:
        """Sync topology_nodes + topology_edges from all vendor data."""
        await self._topology_sync.sync()

    async def start(self) -> None:
        self._running = True

        logger.info("=" * 60)
        logger.info("Naxis Worker starting")
        logger.info("  Collector interval : %ds", COLLECTOR_INTERVAL)
        logger.info("  Mist enabled       : %s", _settings.mist_enabled)
        logger.info("  VeloCloud enabled  : %s", _settings.velocloud_enabled)
        logger.info("  SNMP polling       : %s (targets: %d)",
                    _settings.snmp_enabled, len(_settings.snmp_targets_list))
        logger.info("  SNMP trap receiver : %s (port %d)",
                    _settings.snmp_trap_enabled, _settings.snmp_trap_port)
        logger.info("  Syslog receiver    : %s (UDP %d / TCP %d)",
                    _settings.syslog_enabled, _settings.syslog_udp_port, _settings.syslog_tcp_port)
        logger.info("=" * 60)

        await db.connect()

        # Start push receivers (they run continuously in the background)
        await self._snmp_trap_receiver.start()
        await self._syslog_receiver.start()

        try:
            while self._running:
                try:
                    await self.run_once()
                except Exception:
                    logger.exception("Worker pass failed — will retry next interval")

                await asyncio.sleep(COLLECTOR_INTERVAL)
        finally:
            await self._snmp_trap_receiver.stop()
            await self._syslog_receiver.stop()
            await db.disconnect()
            logger.info("Worker shut down cleanly")

    def stop(self) -> None:
        logger.info("Worker shutting down...")
        self._running = False


def _install_signal_handlers(daemon: WorkerDaemon) -> None:
    loop = asyncio.get_event_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(sig, daemon.stop)


async def main() -> None:
    daemon = WorkerDaemon()
    _install_signal_handlers(daemon)
    await daemon.start()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        sys.exit(0)
