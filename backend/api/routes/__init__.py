"""
API Routes

FastAPI route handlers for the Naxis API.
"""

from .incidents import router as incidents_router
from .integrations import router as integrations_router
from .telemetry import router as telemetry_router

__all__ = [
    "incidents_router",
    "integrations_router",
    "telemetry_router",
]
