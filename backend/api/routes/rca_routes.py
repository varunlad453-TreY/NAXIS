"""
Falsifiable AI Root Cause Analysis (RCA) API Routes (WP-7)

Provides endpoints to trigger and query evidence-cited AI RCA reports.
"""

import logging
from typing import Any, Dict

from fastapi import APIRouter, Depends, HTTPException, status

try:
    from backend.api.models.rca_models import RCAResponse
    from backend.api.services.rca_service import rca_service
    from backend.shared.auth.dependencies import get_current_user, require_role
    from backend.shared.auth.keycloak import UserPrincipal
    from backend.shared.database.audit import log_audit_event
except ImportError:
    from api.models.rca_models import RCAResponse
    from api.services.rca_service import rca_service
    from shared.auth.dependencies import get_current_user, require_role
    from shared.auth.keycloak import UserPrincipal
    from shared.database.audit import log_audit_event

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/incidents", tags=["rca"])


@router.post(
    "/{incident_id}/rca",
    response_model=RCAResponse,
    summary="Generate AI Root Cause Analysis (RBAC & Audit)",
    description="Assembles sanitized evidence pack, redacts PII/secrets, and synthesizes cited RCA diagnosis.",
)
async def generate_incident_rca(
    incident_id: str,
    user: UserPrincipal = Depends(require_role(["operator", "admin"])),
) -> RCAResponse:
    try:
        rca_res = await rca_service.generate_rca(incident_id)

        await log_audit_event(
            user_id=user.user_id,
            username=user.username,
            user_role=user.roles[0] if user.roles else "operator",
            action="GENERATE_AI_RCA",
            resource_type="incident",
            resource_id=incident_id,
            status="success",
            details={"confidence_score": rca_res.confidence_score},
        )

        return rca_res
    except Exception as exc:
        logger.error(f"Error generating RCA for incident {incident_id}: {exc}", exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to generate AI root cause analysis")


@router.get(
    "/{incident_id}/rca",
    response_model=RCAResponse,
    summary="Get existing AI Root Cause Analysis report",
)
async def get_incident_rca(incident_id: str) -> RCAResponse:
    rca_res = await rca_service.get_existing_rca(incident_id)
    if not rca_res:
        # Auto-generate if not existing
        rca_res = await rca_service.generate_rca(incident_id)
    return rca_res
