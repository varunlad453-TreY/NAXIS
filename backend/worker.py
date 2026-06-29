#!/usr/bin/env python3
"""
Naxis Worker Entry Point

Background worker that runs inside the monolith codebase.

Run with:
    python backend/worker.py
"""

import asyncio
import logging
import sys

from backend.config.settings import get_settings
from backend.db.base import init_db
from backend.services.device_service import device_service
from backend.services.event_service import event_service
from backend.services.incident_service import incident_service
from backend.shared.database.redis import get_redis_client
from backend.worker.mock_ingest.runner import MockTelemetryPipeline

settings = get_settings()

logging.basicConfig(
    level=getattr(logging, settings.log_level.upper(), logging.INFO),
    format="%(asctime)s | %(name)-20s | %(levelname)-8s | %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger(__name__)


async def worker_loop() -> None:
    """Main worker loop: collect, normalize, correlate, persist, sleep."""
    redis_client = get_redis_client() if settings.redis_enabled else None

    if settings.is_postgres_enabled:
        await init_db()
        logger.info("PostgreSQL tables initialized for worker")

    logger.info("=" * 80)
    logger.info("Naxis Worker starting")
    logger.info("Environment: %s", settings.environment)
    logger.info("Storage mode: %s", settings.storage_mode)
    logger.info("Redis enabled: %s", settings.redis_enabled)
    logger.info("Collector interval: %ds", settings.collector_interval)
    logger.info("Mode: mock telemetry (no vendor credentials configured)")
    logger.info("=" * 80)

    sites = ["site-sfo-01", "site-nyc-01", "site-lax-01", "site-lon-01"]
    site_index = 0

    while True:
        try:
            site_id = sites[site_index % len(sites)]
            site_index += 1

            logger.info("Running mock collection cycle for %s", site_id)
            pipeline = MockTelemetryPipeline(site_id=site_id)
            events, incidents = pipeline.run(dnac_count=2, mist_count=1, sdwan_count=1)

            await event_service.add_events(events)
            await incident_service.add_incidents(incidents)
            await device_service.upsert_from_events(events)

            if redis_client:
                for incident in incidents:
                    await redis_client.publish_incident(incident.to_clickhouse_dict())

            logger.info(
                "Cycle complete for %s: %d event(s), %d incident(s)",
                site_id,
                len(events),
                len(incidents),
            )
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
