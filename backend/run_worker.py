#!/usr/bin/env python3
"""
Naxis Worker Entry Point

Background worker that runs inside the monolith codebase.

Run with:
    python backend/run_worker.py
"""

import asyncio
import logging
import sys
from datetime import datetime, timezone
from typing import List, Tuple

from backend.config.settings import get_settings
from backend.db.base import init_db
from backend.services.device_service import device_service
from backend.services.event_service import event_service
from backend.services.incident_service import incident_service
from backend.shared.correlation import CorrelationEngine
from backend.shared.database.redis import get_redis_client
from backend.shared.models.event import UnifiedEvent
from backend.shared.models.incident import Incident
from backend.worker.collectors.mist import MistCollector
from backend.worker.mock_ingest.runner import MockTelemetryPipeline

settings = get_settings()

logging.basicConfig(
    level=getattr(logging, settings.log_level.upper(), logging.INFO),
    format="%(asctime)s | %(name)-20s | %(levelname)-8s | %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger(__name__)


async def _collect_real_mist(since: datetime) -> List[UnifiedEvent]:
    """Collect live Juniper Mist events when configured."""
    if not settings.mist_enabled:
        logger.debug("Mist collector disabled")
        return []

    if not settings.mist_api_key or not settings.mist_org_id:
        logger.warning(
            "Mist collector enabled but MIST_API_KEY / MIST_ORG_ID are missing"
        )
        return []

    try:
        collector = MistCollector()
        events = await collector.collect(since=since)
        logger.info("Mist collector returned %d event(s)", len(events))
        return events
    except Exception:
        logger.exception("Mist real-time collection failed")
        return []


async def _run_cycle(
    site_id: str,
    correlation_engine: CorrelationEngine,
    last_mist_collect: datetime,
) -> Tuple[List[UnifiedEvent], List[Incident]]:
    """Run one collection + correlation cycle for a site."""
    # 1. Real Mist events (if configured)
    real_mist_events = await _collect_real_mist(since=last_mist_collect)

    # 2. Mock telemetry for DNAC / SD-WAN and Mist fallback
    pipeline = MockTelemetryPipeline(site_id=site_id)
    mock_events, _ = pipeline.run(
        dnac_count=2,
        mist_count=0 if real_mist_events else 1,
        sdwan_count=1,
    )

    all_events = real_mist_events + mock_events

    # 3. Correlate everything together
    incidents = correlation_engine.process_events(all_events)

    return all_events, incidents


async def worker_loop() -> None:
    """Main worker loop: collect, normalize, correlate, persist, sleep."""
    redis_client = get_redis_client() if settings.redis_enabled else None

    if settings.is_postgres_enabled:
        await init_db()
        logger.info("PostgreSQL tables initialized for worker")

    mode = "real Mist + mock telemetry" if settings.mist_enabled else "mock telemetry only"

    logger.info("=" * 80)
    logger.info("Naxis Worker starting")
    logger.info("Environment: %s", settings.environment)
    logger.info("Storage mode: %s", settings.storage_mode)
    logger.info("Redis enabled: %s", settings.redis_enabled)
    logger.info("Collector interval: %ds", settings.collector_interval)
    logger.info("Mode: %s", mode)
    logger.info("=" * 80)

    sites = ["site-sfo-01", "site-nyc-01", "site-lax-01", "site-lon-01"]
    site_index = 0
    correlation_engine = CorrelationEngine()
    last_mist_collect = datetime.now(timezone.utc) - settings.collector_interval

    while True:
        try:
            site_id = sites[site_index % len(sites)]
            site_index += 1

            logger.info("Running collection cycle for %s", site_id)
            events, incidents = await _run_cycle(
                site_id=site_id,
                correlation_engine=correlation_engine,
                last_mist_collect=last_mist_collect,
            )

            await event_service.add_events(events)
            await incident_service.add_incidents(incidents)
            await device_service.upsert_from_events(events)

            if redis_client:
                for incident in incidents:
                    await redis_client.publish_incident(incident.to_db_dict())

            logger.info(
                "Cycle complete for %s: %d event(s), %d incident(s)",
                site_id,
                len(events),
                len(incidents),
            )

            # Advance Mist watermark only on successful cycles so we don't drop events
            last_mist_collect = datetime.now(timezone.utc)
        except Exception:
            logger.exception("Worker cycle failed")

        logger.info("Sleeping for %ds", settings.collector_interval)
        await asyncio.sleep(settings.collector_interval)


async def shutdown() -> None:
    """Close external connections gracefully."""
    if settings.redis_enabled:
        await get_redis_client().close()
    logger.info("Worker shutdown complete")


def main() -> None:
    """Run the worker."""
    try:
        asyncio.run(worker_loop())
    except KeyboardInterrupt:
        logger.info("Worker stopped by user")
        sys.exit(0)


if __name__ == "__main__":
    main()
