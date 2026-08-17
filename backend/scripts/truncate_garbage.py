"""
Script to truncate events and incidents tables to clear out legacy garbage data,
and run a database vacuum to reclaim disk space.

Usage (from repo root with PYTHONPATH=backend):
    $env:PYTHONPATH="backend"
    python -m scripts.truncate_garbage
"""

import asyncio
import logging

try:
    from backend.shared.database.client import db
except ImportError:
    from shared.database.client import db

logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO, format="%(levelname)s | %(message)s")


async def truncate_tables() -> None:
    """Truncate the events and incidents tables."""
    logger.info("Truncating 'events' and 'incidents' tables...")
    # These tables do not have inbound foreign keys, so TRUNCATE works cleanly.
    await db.execute("TRUNCATE TABLE events;")
    await db.execute("TRUNCATE TABLE incidents;")
    logger.info("Tables truncated successfully.")


async def vacuum_database() -> None:
    """Run VACUUM ANALYZE to reclaim disk space and update stats."""
    logger.info("Running VACUUM ANALYZE...")
    # Vacuum cannot run inside a transaction block. We use the raw pool/connection.
    # By default, db.execute uses an implicitly acquired connection without a transaction block.
    try:
        await db.execute("VACUUM ANALYZE events;")
        await db.execute("VACUUM ANALYZE incidents;")
        logger.info("VACUUM ANALYZE completed successfully.")
    except Exception as e:
        logger.warning("VACUUM ANALYZE failed (this is expected if running in a transacted connection): %s", e)


async def print_stats() -> None:
    """Print the number of rows remaining."""
    events_count = (await db.fetchrow("SELECT COUNT(*) FROM events;"))[0]
    incidents_count = (await db.fetchrow("SELECT COUNT(*) FROM incidents;"))[0]
    logger.info("Current DB stats:")
    logger.info("  Events: %d", events_count)
    logger.info("  Incidents: %d", incidents_count)


async def main() -> None:
    logger.info("Starting WP-2.3 Truncation Script...")
    await db.connect()
    try:
        logger.info("--- BEFORE TRUNCATION ---")
        await print_stats()

        await truncate_tables()
        await vacuum_database()

        logger.info("--- AFTER TRUNCATION ---")
        await print_stats()

        logger.info("WP-2.3 Truncation complete.")
    finally:
        await db.disconnect()


if __name__ == "__main__":
    asyncio.run(main())
