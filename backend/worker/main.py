#!/usr/bin/env python3
"""
Naxis Worker

Background daemon that runs the collection, normalization, and correlation
pipeline. Designed to run as a separate process from the same Docker image
as the API service.

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

    Responsibilities (to be filled in as each phase is implemented):
      Phase 3 — Collect from DNAC → normalize → write events to Postgres
      Phase 6 — Run correlation engine → write incidents to Postgres
      Phase 7 — Sync topology → write nodes/edges to Postgres
    """

    def __init__(self):
        self._running = False
        self._mist = MistCollector()
        self._mist_inventory = MistInventoryCollector()
        self._velo_inventory = VelocloudInventoryCollector()
        self._velo_metrics = VelocloudMetricsCollector()
        self._last_collected: datetime = datetime.utcnow() - timedelta(hours=24)

    async def run_once(self) -> None:
        """Execute one full pipeline pass."""
        logger.debug("Worker pass started")

        # Phase 3: collect + normalize
        await self._collect_and_normalize()

        # Phase 6: correlate + create incidents
        await self._correlate()

        # Phase 7: topology sync
        await self._sync_topology()

        logger.debug("Worker pass complete")

    async def _collect_and_normalize(self) -> None:
        """Collect telemetry from all enabled vendors and write normalized events to DB."""
        since = self._last_collected
        now = datetime.utcnow()

        events = await self._mist.collect(since=since)
        if events:
            await insert_events(events)
            logger.info("Persisted %d new events to Postgres", len(events))

        await self._mist_inventory.collect()
        await self._velo_inventory.collect()
        await self._velo_metrics.collect()

        self._last_collected = now

    async def _correlate(self) -> None:
        """Read recent unprocessed events, run correlation, write incidents."""
        # TODO Phase 6: implement correlation against Postgres
        pass

    async def _sync_topology(self) -> None:
        """Pull topology from vendors, upsert topology_nodes / topology_edges."""
        # TODO Phase 7: implement topology sync
        pass

    async def start(self) -> None:
        self._running = True
        logger.info("=" * 60)
        logger.info("Naxis Worker starting")
        logger.info("  Collector interval: %ds", COLLECTOR_INTERVAL)
        logger.info("  Mist enabled:       %s", _settings.mist_enabled)
        logger.info("  VeloCloud enabled:  %s", _settings.velocloud_enabled)
        logger.info("=" * 60)

        await db.connect()
        try:
            while self._running:
                try:
                    await self.run_once()
                except Exception:
                    logger.exception("Worker pass failed — will retry next interval")

                await asyncio.sleep(COLLECTOR_INTERVAL)
        finally:
            await db.disconnect()
            logger.info("Worker DB pool closed")

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
