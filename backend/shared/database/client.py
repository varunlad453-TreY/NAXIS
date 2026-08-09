"""
Database client — asyncpg connection pool.

Usage:
    from shared.database.client import db

    await db.connect()          # on app startup
    await db.disconnect()       # on app shutdown
    async with db.pool.acquire() as conn:
        rows = await conn.fetch("SELECT * FROM incidents")
"""

import logging
import os
from typing import Optional

import asyncpg

logger = logging.getLogger(__name__)

DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql://naxis:naxis_password@localhost:5432/naxis",
)

# asyncpg doesn't accept the SQLAlchemy-style +asyncpg scheme prefix
_PG_URL = DATABASE_URL.replace("postgresql+asyncpg://", "postgresql://")


class Database:
    def __init__(self) -> None:
        self.pool: Optional[asyncpg.Pool] = None

    async def connect(self, min_size: int = 2, max_size: int = 10) -> None:
        if self.pool is not None:
            return
        ssl_mode = None
        if os.getenv("POSTGRES_SSL", "false").lower() in ("true", "1", "yes", "require"):
            ssl_mode = "require"
        elif os.getenv("ENVIRONMENT", "development").lower() == "production":
            ssl_mode = "require"

        logger.info("Connecting to Postgres (ssl=%s)...", ssl_mode or "off")
        self.pool = await asyncpg.create_pool(
            _PG_URL,
            min_size=min_size,
            max_size=max_size,
            ssl=ssl_mode,
        )
        logger.info("Postgres pool ready")

    async def disconnect(self) -> None:
        if self.pool is None:
            return
        await self.pool.close()
        self.pool = None
        logger.info("Postgres pool closed")

    async def fetch(self, query: str, *args) -> list:
        async with self.pool.acquire() as conn:
            return await conn.fetch(query, *args)

    async def fetchrow(self, query: str, *args):
        async with self.pool.acquire() as conn:
            return await conn.fetchrow(query, *args)

    async def execute(self, query: str, *args) -> str:
        async with self.pool.acquire() as conn:
            return await conn.execute(query, *args)

    async def executemany(self, query: str, args: list) -> None:
        async with self.pool.acquire() as conn:
            await conn.executemany(query, args)


# Module-level singleton — import this everywhere
db = Database()
