"""
API Routes

FastAPI route handlers for the Naxis API.
"""

from .incidents import router as incidents_router

__all__ = [
    "incidents_router",
]
