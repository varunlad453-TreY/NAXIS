#!/usr/bin/env python3
"""
Naxis Monolith API

Main FastAPI application for the Naxis operational intelligence platform.

Run with:
    uvicorn backend.main:app --reload --host 0.0.0.0 --port 8000
"""

import logging
import secrets
from contextlib import asynccontextmanager
from datetime import datetime

from fastapi import Depends, FastAPI, Request, Security
from fastapi.exceptions import HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import APIKeyHeader

from api.routes.correlation import router as correlation_router
from api.routes.devices import router as devices_router
from api.routes.integrations import router as integrations_router
from api.routes.events import router as events_router
from api.routes.incidents import health_router, router as incidents_router
from api.routes.telemetry import router as telemetry_router
from api.routes.mist import router as mist_router
from api.routes.mist_clients import router as mist_clients_router
from api.routes.mist_sle import router as mist_sle_router
from api.routes.sdwan_chat import router as sdwan_router
from api.routes.topology import router as topology_router
from api.routes.diagnostics_routes import router as diagnostics_router
from api.routes.location_routes import router as location_router
from api.routes.rca_routes import router as rca_router
from config.settings import get_settings
from shared.database.client import db
from shared.database.collector_telemetry import ensure_collector_telemetry_schema

_settings = get_settings()

logging.basicConfig(
    level=getattr(logging, _settings.log_level.upper(), logging.INFO),
    format="%(asctime)s | %(name)-30s | %(levelname)-8s | %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger(__name__)

_api_key_header = APIKeyHeader(name="X-API-Key", auto_error=False)


async def _require_api_key(
    request: Request,
    api_key: str = Security(_api_key_header),
) -> None:
    # Empty api_key disables auth so local dev works without a key; any non-empty
    # value is enforced on every router below.
    if not _settings.api_key:
        return
    # EventSource cannot set headers, so the SSE stream must pass the key as a
    # query param. Accepted only there to keep it out of general access logs.
    if not api_key and request.url.path.endswith("/incidents/stream"):
        api_key = request.query_params.get("api_key", "")
    if not api_key or not secrets.compare_digest(api_key, _settings.api_key):
        raise HTTPException(status_code=403, detail="Forbidden")


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("=" * 60)
    logger.info("Naxis API starting...")
    await db.connect()
    try:
        await ensure_collector_telemetry_schema()
        logger.info("Telemetry schema ensured")
    except Exception:
        logger.warning("Could not ensure telemetry schema (Postgres may be unavailable)")
    logger.info("API Documentation: http://localhost:8000/docs")
    logger.info("=" * 60)
    yield
    await db.disconnect()
    logger.info("Naxis API shut down")


_is_production = _settings.environment.lower() in ("production", "prod")

app = FastAPI(
    title="Naxis API",
    description="Operational intelligence API for multi-vendor network monitoring",
    version="1.0.0",
    # Schema browsing is unauthenticated by nature; keep it out of production.
    docs_url=None if _is_production else "/docs",
    redoc_url=None if _is_production else "/redoc",
    openapi_url=None if _is_production else "/openapi.json",
    lifespan=lifespan,
)

_cors_origins = _settings.api_cors_origins_list

# "*" with allow_credentials=True is silently downgraded by browsers and lets any
# site read authenticated responses. Only send credentials for an explicit allowlist.
_cors_wildcard = "*" in _cors_origins
if _cors_wildcard:
    logger.warning(
        "API_CORS_ORIGINS='*' — credentialed CORS disabled. "
        "Set an explicit origin list before exposing this API."
    )

# The UI is served from whatever host the operator browses to, not necessarily
# localhost, and the browser sends that origin. With only an explicit localhost
# allowlist every request from another machine was blocked, which reads as a dead
# backend. Allow the configured origins plus any private-network origin, so a NOC
# workstation on the corporate LAN works without re-listing every address.
# Deliberately private ranges only — this must not become a wildcard.
_PRIVATE_ORIGIN_REGEX = (
    r"^https?://("
    r"localhost|127\.0\.0\.1|\[::1\]|"
    r"10\.\d{1,3}\.\d{1,3}\.\d{1,3}|"
    r"192\.168\.\d{1,3}\.\d{1,3}|"
    r"172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}"
    r")(:\d+)?$"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_origin_regex=None if _cors_wildcard else _PRIVATE_ORIGIN_REGEX,
    allow_credentials=not _cors_wildcard,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-API-Key"],
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

# health_router stays unauthenticated for container/LB probes.
app.include_router(health_router)
app.include_router(incidents_router, dependencies=_auth)
app.include_router(events_router, dependencies=_auth)
app.include_router(devices_router, dependencies=_auth)
app.include_router(integrations_router, dependencies=_auth)
app.include_router(telemetry_router, dependencies=_auth)
app.include_router(mist_router, dependencies=_auth)
app.include_router(mist_clients_router, dependencies=_auth)
app.include_router(mist_sle_router, dependencies=_auth)
app.include_router(sdwan_router, dependencies=_auth)
app.include_router(topology_router, dependencies=_auth)
app.include_router(correlation_router, dependencies=_auth)
app.include_router(diagnostics_router, dependencies=_auth)
app.include_router(location_router, dependencies=_auth)
app.include_router(rca_router, dependencies=_auth)


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
