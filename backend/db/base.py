"""
SQLAlchemy base setup for PostgreSQL.

Uses asyncpg driver and asyncio session maker.
"""

from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.orm import declarative_base

from backend.config.settings import get_settings

Base = declarative_base()


def get_database_url() -> str:
    """Build async PostgreSQL URL from settings."""
    settings = get_settings()
    password = settings.postgres_password or ""
    return (
        f"postgresql+asyncpg://{settings.postgres_user}:"
        f"{password}@{settings.postgres_host}:"
        f"{settings.postgres_port}/{settings.postgres_database}"
    )


# Lazy engine creation so imports work before env vars are set
_engine = None


def get_engine():
    """Return the async SQLAlchemy engine singleton."""
    global _engine
    if _engine is None:
        _engine = create_async_engine(
            get_database_url(),
            echo=False,
            future=True,
            pool_pre_ping=True,
        )
    return _engine


async def get_session() -> AsyncSession:
    """Yield an async database session."""
    async with AsyncSession(get_engine(), expire_on_commit=False) as session:
        yield session


async def init_db() -> None:
    """Create all tables if they don't exist."""
    async with get_engine().begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
