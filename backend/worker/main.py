#!/usr/bin/env python3
"""
Naxis Worker

Background daemon that runs the collection, normalization, and correlation
pipeline. Designed to run as a separate process from the same Docker image
as the API service.

Every collector run is recorded in the ``collector_run_ledger`` table so the
UI can show live freshness, staleness, and failure counts.  A worker heartbeat
is written every cycle.

Entry point:
    python -m worker.main
"""

import asyncio
import logging
import os
import signal
import sys
import uuid
from datetime import datetime, timedelta, timezone

from config.settings import get_settings
from shared.database.client import db
from shared.database.collector_telemetry import (
    ensure_collector_telemetry_schema,
    record_collector_run,
    record_worker_heartbeat,
)
from shared.database.events import insert_events
from shared.models.collector_outcome import CollectorOutcome
from worker.collectors.mist import MistCollector
from worker.collectors.mist_inventory import MistInventoryCollector
from worker.collectors.dnac import DNACCollector
from worker.collectors.mist_topology import MistTopologyCollector
from worker.collectors.velocloud import VeloCloudCollector
from worker.collectors.arista_wlc import AristaWlcCollector

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

    Each collection cycle:
      1. Writes a worker heartbeat (so the UI can show liveness)
      2. Runs each enabled collector and records the outcome in the ledger
      3. Persists normalised events to Postgres
      4. (TODO) Runs correlation → incidents
      5. (TODO) Syncs topology
    """

    def __init__(self):
        self._running = False
        self._worker_id = f"worker-{uuid.uuid4().hex[:8]}"
        self._mist = MistCollector()
        self._mist_inventory = MistInventoryCollector()
        self._dnac = DNACCollector()
        self._mist_topology = MistTopologyCollector()
        self._velocloud = VeloCloudCollector()
        self._arista_wlc = AristaWlcCollector()
        self._last_collected: datetime = datetime.now(timezone.utc) - timedelta(hours=24)

    # ------------------------------------------------------------------
    # Pipeline
    # ------------------------------------------------------------------

    async def run_once(self) -> None:
        """Execute one full pipeline pass."""
        logger.debug("Worker pass started")

        # Collectors
        outcomes = await self._collect_all()

        # Record heartbeat after collection
        total_events = sum(o.event_count for o in outcomes)
        failures = [o for o in outcomes if o.status == "error"]
        cycle_status = "error" if failures else "success"
        message = f"{len(outcomes)} collectors, {total_events} events"
        if failures:
            message += f", {len(failures)} failed"

        await record_worker_heartbeat(self._worker_id, cycle_status, message)

        # Persist events
        all_events = []
        for outcome in outcomes:
            if outcome.events:
                all_events.extend(outcome.events)

        if all_events:
            await insert_events(all_events)
            logger.info("Persisted %d events to Postgres", len(all_events))

        # TODO: correlate + create incidents
        # TODO: sync topology

        logger.debug("Worker pass complete")

    async def _collect_all(self) -> list[CollectorOutcome]:
        """Run each collector and record outcomes to the telemetry ledger."""
        since = self._last_collected
        now = datetime.now(timezone.utc)
        outcomes: list[CollectorOutcome] = []

        # Mist events
        mist_outcome = await self._run_collector(self._mist, since)
        outcomes.append(mist_outcome)

        # Mist inventory
        inv_outcome = await self._run_collector_inventory(self._mist_inventory)
        outcomes.append(inv_outcome)

        # DNAC sub-collectors (devices, alarms, topology, clients, interfaces)
        if self._dnac.is_configured:
            try:
                dnac_outcomes = await self._dnac.collect_all()
                for o in dnac_outcomes:
                    try:
                        await record_collector_run(o)
                    except Exception:
                        logger.exception("Failed to record DNAC run for %s", o.collector_id)
                outcomes.extend(dnac_outcomes)
            except Exception:
                logger.exception("DNAC collection failed")

        # Mist topology sub-collectors (AP history, RF, client topology, wired uplinks, radio neighbors)
        if self._mist_topology.is_configured:
            try:
                topo_outcomes = await self._mist_topology.collect_all()
                for o in topo_outcomes:
                    try:
                        await record_collector_run(o)
                    except Exception:
                        logger.exception("Failed to record Mist topology run for %s", o.collector_id)
                outcomes.extend(topo_outcomes)
            except Exception:
                logger.exception("Mist topology collection failed")

        # VeloCloud SD-WAN sub-collectors (edges, links, tunnels, events, apps)
        if self._velocloud.is_configured:
            try:
                vc_outcomes = await self._velocloud.collect_all()
                for o in vc_outcomes:
                    try:
                        await record_collector_run(o)
                    except Exception:
                        logger.exception("Failed to record VeloCloud run for %s", o.collector_id)
                outcomes.extend(vc_outcomes)
            except Exception:
                logger.exception("VeloCloud collection failed")

        # Arista WLC sub-collectors (clients, APs, radios, events)
        if self._arista_wlc.is_configured:
            try:
                awlc_outcomes = await self._arista_wlc.collect_all()
                for o in awlc_outcomes:
                    try:
                        await record_collector_run(o)
                    except Exception:
                        logger.exception("Failed to record Arista WLC run for %s", o.collector_id)
                outcomes.extend(awlc_outcomes)
            except Exception:
                logger.exception("Arista WLC collection failed")

        self._last_collected = now
        return outcomes

    async def _run_collector(self, collector, since) -> CollectorOutcome:
        """Run a single collector, record its outcome, and return it."""
        outcome = await collector.collect(since=since)
        try:
            await record_collector_run(outcome)
        except Exception:
            logger.exception("Failed to record collector run for %s", outcome.collector_id)
        return outcome

    async def _run_collector_inventory(self, collector) -> CollectorOutcome:
        """Run the inventory collector (different signature — no `since`)."""
        outcome = await collector.collect()
        try:
            await record_collector_run(outcome)
        except Exception:
            logger.exception("Failed to record collector run for %s", outcome.collector_id)
        return outcome

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    async def start(self) -> None:
        self._running = True
        logger.info("=" * 60)
        logger.info("Naxis Worker starting")
        logger.info("  Worker ID:          %s", self._worker_id)
        logger.info("  Collector interval: %ds", COLLECTOR_INTERVAL)
        logger.info("  Mist enabled:       %s", _settings.mist_enabled)
        logger.info("  DNAC enabled:       %s", _settings.dnac_enabled)
        logger.info("  Mist topology:      %s", self._mist_topology.is_configured)
        logger.info("  VeloCloud enabled:  %s", self._velocloud.is_configured)
        logger.info("  Arista WLC enabled: %s", self._arista_wlc.is_configured)
        logger.info("=" * 60)

        await db.connect()
        try:
            await ensure_collector_telemetry_schema()
            logger.info("Telemetry schema ensured")

            while self._running:
                try:
                    await self.run_once()
                except Exception:
                    logger.exception("Worker pass failed — will retry next interval")
                    try:
                        await record_worker_heartbeat(
                            self._worker_id, "error", "Worker pass exception"
                        )
                    except Exception:
                        logger.exception("Failed to record error heartbeat")

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
