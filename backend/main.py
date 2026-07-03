#!/usr/bin/env python3
"""
Naxis Monolith API

Main FastAPI application for the Naxis operational intelligence platform.

Run with:
    uvicorn backend.main:app --reload --host 0.0.0.0 --port 8000
"""

import logging
from contextlib import asynccontextmanager
from datetime import datetime

from fastapi import Depends, FastAPI, Security
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import APIKeyHeader
from fastapi.exceptions import HTTPException

from api.routes.devices import router as devices_router
from api.routes.events import router as events_router
from api.routes.incidents import health_router, router as incidents_router
from api.routes.mist import router as mist_router
from api.routes.mist_clients import router as mist_clients_router
from api.routes.mist_sle import router as mist_sle_router
from api.routes.sdwan_chat import router as sdwan_router
from config.settings import get_settings
from shared.database.client import db

_settings = get_settings()

_api_key_header = APIKeyHeader(name="X-API-Key", auto_error=False)


async def _require_api_key(api_key: str = Security(_api_key_header)) -> None:
    if not _settings.api_key:
        return
    if api_key != _settings.api_key:
        raise HTTPException(status_code=403, detail="Forbidden")


logging.basicConfig(
    level=getattr(logging, _settings.log_level.upper(), logging.INFO),
    format="%(asctime)s | %(name)-30s | %(levelname)-8s | %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("=" * 60)
    logger.info("Naxis API starting...")
    await db.connect()
    logger.info("API Documentation: http://localhost:8000/docs")
    logger.info("=" * 60)
    yield
    await db.disconnect()
    logger.info("Naxis API shut down")


app = FastAPI(
    title="Naxis API",
    description="Operational intelligence API for multi-vendor network monitoring",
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=_settings.api_cors_origins_list,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "X-API-Key", "Authorization"],
)


@app.middleware("http")
async def add_process_time_header(request, call_next):
    """Add X-Process-Time header to responses."""
    start_time = datetime.utcnow()
    response = await call_next(request)
    process_time = (datetime.utcnow() - start_time).total_seconds()
    response.headers["X-Process-Time"] = f"{process_time:.4f}"
    return response


_auth = [Depends(_require_api_key)]

app.include_router(health_router)
app.include_router(incidents_router, dependencies=_auth)
app.include_router(events_router, dependencies=_auth)
app.include_router(devices_router, dependencies=_auth)
app.include_router(mist_router, dependencies=_auth)
app.include_router(mist_clients_router, dependencies=_auth)
app.include_router(mist_sle_router, dependencies=_auth)
app.include_router(sdwan_router, dependencies=_auth)


@app.get("/", include_in_schema=False)
async def root():
    """Root endpoint - redirect to docs."""
    return {
        "message": "Naxis API",
        "version": "1.0.0",
        "docs": "/docs",
        "health": "/health",
    }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "backend.main:app",
        host=_settings.api_host,
        port=_settings.api_port,
        reload=True,
        log_level="info",
    )
