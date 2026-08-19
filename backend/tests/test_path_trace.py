"""
Unit Tests for Client Path Trace Resolution Engine (WP-6)
"""

import pytest
from unittest.mock import AsyncMock, patch

try:
    from backend.api.services.path_trace_service import PathTraceService
except ImportError:
    from api.services.path_trace_service import PathTraceService


class TestPathTraceEngine:
    """Test multi-vendor hop chain resolution and first_unhealthy_hop logic."""

    @pytest.mark.asyncio
    @patch.object(PathTraceService, "_resolve_target_entity", new_callable=AsyncMock)
    @patch.object(PathTraceService, "_get_device_health", new_callable=AsyncMock)
    async def test_trace_client_path_healthy(self, mock_health, mock_entity):
        mock_entity.return_value = {
            "node_id": "client-00:11:22:33:44:55",
            "name": "alice-laptop",
            "node_type": "client",
            "vendor": "apple",
            "ip_address": "10.10.50.142",
            "mac": "00:11:22:33:44:55",
            "site_id": "site-hq",
            "site_name": "Enterprise HQ",
        }
        mock_health.return_value = "healthy"

        service = PathTraceService()
        response = await service.trace_client_path("00:11:22:33:44:55")

        assert response is not None
        assert response.client_mac == "00:11:22:33:44:55"
        assert response.hops[0].node_type == "client"
        assert response.hops[-1].node_type == "internet"
        assert response.first_unhealthy_hop is None

    @pytest.mark.asyncio
    @patch.object(PathTraceService, "_resolve_target_entity", new_callable=AsyncMock)
    @patch.object(PathTraceService, "_get_device_health", new_callable=AsyncMock)
    async def test_trace_client_path_identifies_degraded_hop(self, mock_health, mock_entity):
        mock_entity.return_value = {
            "node_id": "client-66:77:88:99:aa:bb",
            "name": "bob-laptop",
            "node_type": "client",
            "vendor": "dell",
            "ip_address": "10.10.50.99",
            "mac": "66:77:88:99:aa:bb",
            "site_id": "site-hq",
            "site_name": "Enterprise HQ",
        }
        # Client is degraded, other devices healthy
        mock_health.side_effect = lambda dev_id: "degraded" if "client" in str(dev_id).lower() else "healthy"

        service = PathTraceService()
        response = await service.trace_client_path("66:77:88:99:aa:bb")

        assert response is not None
        assert response.first_unhealthy_hop is not None
        assert response.first_unhealthy_hop.node_type == "client"
        assert response.first_unhealthy_hop.health_status == "degraded"

    @pytest.mark.asyncio
    @patch.object(PathTraceService, "_resolve_target_entity", new_callable=AsyncMock)
    async def test_trace_client_path_not_found(self, mock_entity):
        mock_entity.return_value = None

        service = PathTraceService()
        response = await service.trace_client_path("non-existent-mac")

        assert response is None
