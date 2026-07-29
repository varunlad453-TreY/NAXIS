"""
API Routes

FastAPI route handlers for the Naxis API.
"""

from .correlation import router as correlation_router
from .incidents import router as incidents_router
from .integrations import router as integrations_router
from .telemetry import router as telemetry_router

__all__ = [
    "correlation_router",
    "incidents_router",
    "integrations_router",
    "telemetry_router",
]
