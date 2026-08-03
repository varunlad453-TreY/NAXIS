"""
Incident Service

Business logic layer for incident operations — backed by Postgres.
"""

import logging
from typing import Dict, List, Optional

from shared.database import (
    count_incidents,
    get_incident,
    get_incident_stats,
    insert_incident,
    list_incidents,
    upsert_incident,
)
from shared.database.incidents import ACTIVE_STATUS_VALUES
from shared.models.incident import Incident, IncidentStatus

logger = logging.getLogger(__name__)

_ACTIVE_STATUSES = [IncidentStatus(v) for v in ACTIVE_STATUS_VALUES]


class IncidentService:
    """Service layer for incident operations, backed by Postgres."""

    async def add_incident(self, incident: Incident) -> None:
        await insert_incident(incident)
        logger.info(f"Added incident: {incident.incident_id} | {incident.severity.value}")

    async def add_incidents(self, incidents: List[Incident]) -> None:
        for incident in incidents:
            await self.add_incident(incident)
        logger.info(f"Bulk added {len(incidents)} incidents")

    async def upsert_incident(self, incident: Incident) -> None:
        await upsert_incident(incident)

    async def get_incident(self, incident_id: str) -> Optional[Incident]:
        incident = await get_incident(incident_id)
        if not incident:
            logger.debug(f"Incident not found: {incident_id}")
        return incident

    async def list_incidents(
        self,
        status_filter: Optional[List[IncidentStatus]] = None,
        severity_filter: Optional[List[str]] = None,
        limit: int = 100,
        offset: int = 0,
    ) -> List[Incident]:
        return await list_incidents(
            status_filter=status_filter,
            severity_filter=severity_filter,
            limit=limit,
            offset=offset,
        )

    async def get_active_incidents(
        self, limit: int = 100, offset: int = 0
    ) -> List[Incident]:
        return await list_incidents(
            status_filter=_ACTIVE_STATUSES,
            limit=limit,
            offset=offset,
        )

    async def count_incidents(
        self,
        status_filter: Optional[List[IncidentStatus]] = None,
        severity_filter: Optional[List[str]] = None,
    ) -> int:
        return await count_incidents(
            status_filter=status_filter,
            severity_filter=severity_filter,
        )

    async def get_stats(self) -> dict:
        """
        Truthful incident KPIs from a single SQL aggregate pass.

        Unlike the old per-status loop (N+1 queries) this returns counts the
        DB computed directly — total, active, by_severity, distinct
        sites/devices, avg_confidence — independent of any list page size.
        """
        return await get_incident_stats()


# Global singleton
incident_service = IncidentService()
