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
import time
import uuid
from datetime import datetime, timedelta, timezone

from config.settings import get_settings
from shared.correlation import CorrelationConfig, CorrelationEngine
from shared.database.client import db
from shared.database.collector_telemetry import (
    ensure_collector_telemetry_schema,
    record_collector_run,
    record_worker_heartbeat,
)
from shared.database.correlation_telemetry import (
    ensure_correlation_telemetry_schema,
    save_correlation_telemetry,
)
from shared.database.events import insert_events, link_events_to_incident
from shared.database.incidents import upsert_incident
from shared.database.redis import get_redis_client
from shared.database.topology import DatabaseTopologyProvider
from shared.models.collector_outcome import CollectorOutcome
from worker.collectors.mist import MistCollector
from worker.collectors.mist_inventory import MistInventoryCollector
from worker.collectors.dnac import DNACCollector
from worker.collectors.mist_topology import MistTopologyCollector
from worker.collectors.velocloud import VeloCloudCollector
from worker.collectors.velocloud_inventory import VelocloudInventoryCollector
from worker.collectors.arista_wlc import AristaWlcCollector
from worker.collectors.topology_sync import TopologySync
from worker.collectors.health_snapshot import collect_health_snapshots
from worker.collectors.snmp_poller import SnmpPoller
from shared.monitoring.collector_health import check_collector_health
from shared.monitoring.notifier import dispatch_alerts
from shared.database.retention import run_retention

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
      4. Syncs topology (populates topology_nodes/edges for cascade)
      5. Runs correlation engine → produces Incidents, persists to DB, links events
      6. Publishes new incidents to Redis (if enabled)
    """

    def __init__(self):
        self._running = False
        self._worker_id = f"worker-{uuid.uuid4().hex[:8]}"
        self._mist = MistCollector()
        self._mist_inventory = MistInventoryCollector()
        self._dnac = DNACCollector()
        self._mist_topology = MistTopologyCollector()
        self._velocloud = VeloCloudCollector()
        self._velocloud_inventory = VelocloudInventoryCollector()
        self._arista_wlc = AristaWlcCollector()
        self._topology_sync = TopologySync()
        self._snmp_poller = SnmpPoller()
        self._last_collected: datetime = datetime.now(timezone.utc) - timedelta(hours=24)
        self._last_health_snapshot: datetime = datetime.now(timezone.utc) - timedelta(hours=24)
        self._last_retention: datetime = datetime.now(timezone.utc) - timedelta(hours=24)

        # Correlation engine with Stage 2 topology cascade
        correlation_config = CorrelationConfig(
            time_window_seconds=_settings.correlation_time_window,
            min_event_count=_settings.correlation_min_events,
            topology_cascade_enabled=_settings.correlation_topology_cascade,
        )
        topology_provider = (
            DatabaseTopologyProvider()
            if _settings.correlation_topology_cascade
            else None
        )
        self._correlation_engine = CorrelationEngine(
            config=correlation_config,
            topology_provider=topology_provider,
        )
        self._redis_client = get_redis_client() if _settings.redis_enabled else None
        if _settings.redis_enabled:
            logger.info(
                "Redis pub/sub: enabled (channel=naxis:incidents, url=%s)",
                _settings.redis_url,
            )
        else:
            logger.info(
                "Redis pub/sub: disabled (set REDIS_ENABLED=true to enable)"
            )

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

        # Sync topology before correlation so Stage 2 cascade has
        # populated topology_nodes/edges to query against
        try:
            await self._topology_sync.sync()
        except Exception:
            logger.exception("Topology sync failed — continuing")

        # Correlate events into incidents
        if all_events:
            t0 = time.monotonic()
            incidents = await self._correlation_engine.process_events(all_events)
            duration_ms = (time.monotonic() - t0) * 1000

            if incidents:
                cascade_count = sum(
                    1 for i in incidents
                    if i.symptom_device_ids
                )
                residual_count = len(incidents) - cascade_count

                logger.info(
                    "Correlation: %d incident(s) from %d event(s) "
                    "(cascade=%d, residual=%d, topology=%s) in %.0fms",
                    len(incidents),
                    len(all_events),
                    cascade_count,
                    residual_count,
                    "yes" if self._correlation_engine._topology_cascade else "no",
                    duration_ms,
                )

                if cascade_count == 0 and residual_count > 0 and self._correlation_engine._topology_cascade:
                    logger.warning(
                        "No cascade incidents created — topology may be empty "
                        "or cascade rule misconfigured"
                    )

                for incident in incidents:
                    await upsert_incident(incident)
                    await link_events_to_incident(
                        incident.related_event_ids, incident.incident_id
                    )
                    if self._redis_client:
                        await self._redis_client.publish_incident(
                            incident.to_db_dict()
                        )
            else:
                logger.debug("Correlation: no incidents from %d events", len(all_events))

            # Persist engine telemetry for the API to consume
            try:
                stats = self._correlation_engine.get_stats()
                stats["last_duration_ms"] = duration_ms  # override with wall-clock time
                await save_correlation_telemetry(stats, worker_id=self._worker_id)
            except Exception:
                logger.exception("Failed to persist correlation telemetry")

        # Collector health alerting + push notifications (every cycle)
        try:
            alerts = await check_collector_health(window_minutes=30)
            if alerts:
                dispatch_result = await dispatch_alerts(alerts)
                if dispatch_result.get("sent"):
                    channel_summary = ", ".join(
                        f"{ch}: {info['status']}" for ch, info in dispatch_result.get("channels", {}).items()
                    )
                    logger.info("Sent %d alert(s) via %s", len(alerts), channel_summary)
        except Exception:
            logger.exception("Collector health check failed")

        # Health snapshots (every 5 minutes)
        now_utc = datetime.now(timezone.utc)
        if (now_utc - self._last_health_snapshot).total_seconds() >= 300:
            try:
                result = await collect_health_snapshots()
                if result.get("error"):
                    logger.warning("Health snapshot error: %s", result["error"])
                else:
                    logger.info(
                        "Health snapshots: %d checked, %d changed",
                        result.get("checked", 0),
                        result.get("changed", 0),
                    )
            except Exception:
                logger.exception("Health snapshot collection failed")
            self._last_health_snapshot = now_utc

        # Data retention cleanup (every 24 hours)
        if (now_utc - self._last_retention).total_seconds() >= 86400:
            try:
                result = await run_retention(
                    days=7,
                    event_days=_settings.event_retention_days,
                    incident_days=_settings.incident_retention_days,
                    raw_event_days=_settings.raw_event_debug_days,
                )
                logger.info("Retention cleanup: %s", result)
            except Exception:
                logger.exception("Retention cleanup failed")
            self._last_retention = now_utc

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

            # VeloCloud inventory → populates inventory table for topology sync
            try:
                inv_outcome = await self._run_collector_inventory(self._velocloud_inventory)
                outcomes.append(inv_outcome)
            except Exception:
                logger.exception("VeloCloud inventory collection failed")

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

        # SNMP Poller — discovers LLDP/CDP topology edges and interface events
        if self._snmp_poller._enabled and self._snmp_poller._targets:
            try:
                snmp_events = await self._snmp_poller.collect()
                if snmp_events:
                    snmp_outcome = CollectorOutcome(
                        collector_id="snmp-poller",
                        source_system="snmp",
                        status="success",
                        event_count=len(snmp_events),
                        events=snmp_events,
                    )
                    try:
                        await record_collector_run(snmp_outcome)
                    except Exception:
                        logger.exception("Failed to record SNMP poller run")
                    outcomes.append(snmp_outcome)
            except Exception:
                logger.exception("SNMP polling failed")

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
            await ensure_correlation_telemetry_schema()
            logger.info("Telemetry schema ensured")

            # Verify Redis connectivity at startup (non-blocking)
            if self._redis_client:
                await self._redis_client.warm_up()

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
            await self._velocloud.close()
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
