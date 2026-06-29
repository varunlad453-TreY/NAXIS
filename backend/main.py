#!/usr/bin/env python3
"""
Naxis Monolith API

Main FastAPI application for the Naxis operational intelligence platform.

Run with:
    uvicorn backend.main:app --reload --host 0.0.0.0 --port 8000
"""

import logging
from datetime import datetime

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.api.routes.devices import router as devices_router
from backend.api.routes.events import router as events_router
from backend.api.routes.incidents import health_router, router as incidents_router
from backend.config.settings import get_settings
from backend.db.base import init_db

logging.basicConfig(
    level=getattr(logging, get_settings().log_level.upper(), logging.INFO),
    format="%(asctime)s | %(name)-30s | %(levelname)-8s | %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger(__name__)

app = FastAPI(
    title="Naxis API",
    description="Operational intelligence API for multi-vendor network monitoring",
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=get_settings().api_cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def add_process_time_header(request, call_next):
    """Add X-Process-Time header to responses."""
    start_time = datetime.utcnow()
    response = await call_next(request)
    process_time = (datetime.utcnow() - start_time).total_seconds()
    response.headers["X-Process-Time"] = f"{process_time:.4f}"
    return response


app.include_router(health_router)
app.include_router(incidents_router)
app.include_router(events_router)
app.include_router(devices_router)


@app.get("/", include_in_schema=False)
async def root():
    """Root endpoint - redirect to docs."""
    return {
        "message": "Naxis API",
        "version": "1.0.0",
        "docs": "/docs",
        "health": "/health",
    }


@app.on_event("startup")
async def startup_event():
    """Run on application startup."""
    settings = get_settings()
    logger.info("=" * 80)
    logger.info("Naxis API starting...")
    logger.info("Storage mode: %s", settings.storage_mode)
    logger.info("=" * 80)
    if settings.is_postgres_enabled:
        await init_db()
        logger.info("PostgreSQL tables initialized")
    logger.info("API Documentation: http://localhost:8000/docs")
    logger.info("Health check:      http://localhost:8000/health")
    logger.info("=" * 80)


@app.on_event("shutdown")
async def shutdown_event():
    """Run on application shutdown."""
    logger.info("Naxis API shutting down...")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "backend.main:app",
        host=get_settings().api_host,
        port=get_settings().api_port,
        reload=True,
        log_level="info",
    )
