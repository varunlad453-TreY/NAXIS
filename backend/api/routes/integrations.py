"""
Integration API Routes.
"""

import logging

from fastapi import APIRouter

from api.services.integration_service import integration_service
from api.models.integration_models import (
    IntegrationActionResponse,
    IntegrationConfigResponse,
    IntegrationDetailResponse,
    IntegrationListResponse,
)

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/integrations",
    tags=["integrations"],
    responses={500: {"description": "Internal server error"}},
)


@router.get("", response_model=IntegrationListResponse, summary="List integrations")
async def list_integrations() -> IntegrationListResponse:
    return await integration_service.list_integrations()


@router.get("/{integration_id}", response_model=IntegrationDetailResponse, summary="Get integration details")
async def get_integration(integration_id: str) -> IntegrationDetailResponse:
    return await integration_service.get_integration(integration_id)


@router.post("/{integration_id}/test", response_model=IntegrationActionResponse, summary="Test integration connectivity")
async def test_integration(integration_id: str) -> IntegrationActionResponse:
    return await integration_service.test_connection(integration_id)


@router.post("/{integration_id}/sync", response_model=IntegrationActionResponse, summary="Trigger integration sync")
async def sync_integration(integration_id: str) -> IntegrationActionResponse:
    return await integration_service.trigger_sync(integration_id)


@router.get("/{integration_id}/config", response_model=IntegrationConfigResponse, summary="Get integration config")
async def get_integration_config(integration_id: str) -> IntegrationConfigResponse:
    return await integration_service.get_config(integration_id)