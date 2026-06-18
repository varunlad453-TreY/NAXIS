"""
API Service Layer

Business logic and data access for API endpoints.
"""

from .incident_service import IncidentService, incident_service

__all__ = [
    "IncidentService",
    "incident_service",
]
