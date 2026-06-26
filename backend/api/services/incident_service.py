"""
Incident Service

Business logic layer for incident operations.
Abstracts storage implementation (in-memory for MVP, ClickHouse later).
"""

import logging
from datetime import datetime
from typing import Dict, List, Optional

try:
    from ...shared.models.incident import Incident, IncidentStatus
except (ImportError, ValueError):
    # Fallback for direct execution
    import sys
    from pathlib import Path

    sys.path.insert(0, str(Path(__file__).parent.parent.parent))
    from shared.models.incident import Incident, IncidentStatus

logger = logging.getLogger(__name__)


class IncidentService:
    """
    Service layer for incident operations.

    MVP implementation uses in-memory storage.
    Later: replace with ClickHouse/Redis persistence.
    """

    def __init__(self):
        # In-memory storage: {incident_id: Incident}
        self._incidents: Dict[str, Incident] = {}
        logger.info("IncidentService initialized with in-memory storage")

    def add_incident(self, incident: Incident) -> None:
        """
        Add an incident to storage.

        Args:
            incident: Incident object to store
        """
        self._incidents[incident.incident_id] = incident
        logger.info(f"Added incident: {incident.incident_id} | {incident.severity.value}")

    def add_incidents(self, incidents: List[Incident]) -> None:
        """
        Bulk add incidents to storage.

        Args:
            incidents: List of Incident objects
        """
        for incident in incidents:
            self.add_incident(incident)
        logger.info(f"Bulk added {len(incidents)} incidents")

    def get_incident(self, incident_id: str) -> Optional[Incident]:
        """
        Retrieve incident by ID.

        Args:
            incident_id: Incident ID to fetch

        Returns:
            Incident object or None if not found
        """
        incident = self._incidents.get(incident_id)
        if incident:
            logger.debug(f"Retrieved incident: {incident_id}")
        else:
            logger.debug(f"Incident not found: {incident_id}")
        return incident

    def list_incidents(
        self,
        status_filter: Optional[List[IncidentStatus]] = None,
        severity_filter: Optional[List[str]] = None,
        limit: int = 100,
        offset: int = 0,
    ) -> List[Incident]:
        """
        List incidents with optional filters.

        Args:
            status_filter: Filter by status (e.g., [IncidentStatus.OPEN])
            severity_filter: Filter by severity (e.g., ["critical", "major"])
            limit: Max results to return
            offset: Pagination offset

        Returns:
            List of Incident objects
        """
        incidents = list(self._incidents.values())

        # Apply filters
        if status_filter:
            incidents = [i for i in incidents if i.status in status_filter]

        if severity_filter:
            incidents = [i for i in incidents if i.severity.value in severity_filter]

        # Sort by created_at descending (newest first)
        incidents.sort(key=lambda i: i.created_at, reverse=True)

        # Apply pagination
        incidents = incidents[offset : offset + limit]

        logger.debug(
            f"Listed {len(incidents)} incidents "
            f"(status={status_filter}, severity={severity_filter})"
        )
        return incidents

    def get_active_incidents(self) -> List[Incident]:
        """
        Get incidents that are not yet resolved.

        Returns incidents with status: OPEN, INVESTIGATING, or MITIGATED.

        Returns:
            List of active Incident objects
        """
        active_statuses = [
            IncidentStatus.OPEN,
            IncidentStatus.INVESTIGATING,
            IncidentStatus.MITIGATED,
        ]
        return self.list_incidents(status_filter=active_statuses)

    def count_incidents(
        self,
        status_filter: Optional[List[IncidentStatus]] = None,
        severity_filter: Optional[List[str]] = None,
    ) -> int:
        """
        Count incidents matching filters.

        Args:
            status_filter: Filter by status
            severity_filter: Filter by severity

        Returns:
            Count of matching incidents
        """
        incidents = list(self._incidents.values())

        if status_filter:
            incidents = [i for i in incidents if i.status in status_filter]

        if severity_filter:
            incidents = [i for i in incidents if i.severity.value in severity_filter]

        return len(incidents)

    def clear_all(self) -> None:
        """Clear all incidents from storage (for testing)."""
        count = len(self._incidents)
        self._incidents.clear()
        logger.info(f"Cleared {count} incidents from storage")

    def get_stats(self) -> Dict[str, int]:
        """
        Get incident statistics.

        Returns:
            Dict with counts by status and severity
        """
        incidents = list(self._incidents.values())

        stats = {
            "total": len(incidents),
            "by_status": {},
            "by_severity": {},
        }

        # Count by status
        for incident in incidents:
            status = incident.status.value
            stats["by_status"][status] = stats["by_status"].get(status, 0) + 1

        # Count by severity
        for incident in incidents:
            severity = incident.severity.value
            stats["by_severity"][severity] = stats["by_severity"].get(severity, 0) + 1

        return stats


# Global singleton instance
incident_service = IncidentService()
