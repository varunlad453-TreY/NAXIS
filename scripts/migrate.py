#!/usr/bin/env python3
"""
Automated PostgreSQL Database Migration Runner (WP-4)

Executes all SQL migration scripts in `schemas/postgres/` in alphabetical order.
Tracks applied migrations in a `schema_migrations` tracking table to ensure idempotency
on both local Docker containers and external AWS RDS instances.
"""

import asyncio
import logging
import os
import sys
from pathlib import Path
import asyncpg

logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO").upper(),
    format="%(asctime)s | %(name)-25s | %(levelname)-8s | %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("migration_runner")

DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql://naxis:naxis_password@localhost:5432/naxis",
).replace("postgresql+asyncpg://", "postgresql://")

SCHEMAS_DIR = Path(__file__).parent.parent / "schemas" / "postgres"


async def ensure_migrations_table(conn: asyncpg.Connection) -> None:
    """Ensure the schema_migrations tracking table exists."""
    await conn.execute("""
        CREATE TABLE IF NOT EXISTS schema_migrations (
            filename TEXT PRIMARY KEY,
            applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
    """)


async def run_migrations() -> None:
    """Find and execute all unapplied SQL migration files in order."""
    if not SCHEMAS_DIR.exists():
        logger.error("Schemas directory not found at %s", SCHEMAS_DIR)
        sys.exit(1)

    ssl_mode = None
    if os.getenv("POSTGRES_SSL", "false").lower() in ("true", "1", "yes", "require"):
        ssl_mode = "require"
    elif os.getenv("ENVIRONMENT", "development").lower() == "production":
        ssl_mode = "require"

    logger.info("Connecting to database URL: %s (ssl=%s)", DATABASE_URL.split("@")[-1], ssl_mode or "off")

    try:
        conn = await asyncpg.connect(DATABASE_URL, ssl=ssl_mode)
    except Exception as exc:
        logger.exception("Database connection failed: %s", exc)
        sys.exit(1)

    try:
        await ensure_migrations_table(conn)

        # Get list of already applied migrations
        rows = await conn.fetch("SELECT filename FROM schema_migrations;")
        applied_files = {row["filename"] for row in rows}

        # Find all .sql files sorted alphabetically by name
        sql_files = sorted([f for f in SCHEMAS_DIR.glob("*.sql") if f.is_file()], key=lambda f: f.name)
        logger.info("Found %d total SQL schema files in %s", len(sql_files), SCHEMAS_DIR)

        applied_count = 0
        skipped_count = 0

        for sql_file in sql_files:
            filename = sql_file.name
            if filename in applied_files:
                logger.debug("Skipping already applied migration: %s", filename)
                skipped_count += 1
                continue

            logger.info("Applying migration: %s ...", filename)
            sql_content = sql_file.read_text(encoding="utf-8")

            async with conn.transaction():
                await conn.execute(sql_content)
                await conn.execute(
                    "INSERT INTO schema_migrations (filename, applied_at) VALUES ($1, NOW());",
                    filename,
                )

            logger.info("Successfully applied: %s", filename)
            applied_count += 1

        logger.info(
            "Migration summary: %d newly applied, %d skipped (already applied), %d total",
            applied_count,
            skipped_count,
            len(sql_files),
        )
    finally:
        await conn.close()


if __name__ == "__main__":
    asyncio.run(run_migrations())
