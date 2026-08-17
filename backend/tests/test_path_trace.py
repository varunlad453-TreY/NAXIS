"""
Unit Tests for Client Path Trace Resolution Engine (WP-6)
"""

import pytest
from unittest.mock import AsyncMock, patch
from api.services.path_trace_service import PathTraceService


class TestPathTraceEngine:
    """Test multi-vendor hop chain resolution and first_unhealthy_hop logic."""

    @pytest.mark.asyncio
    @patch.object(PathTraceService, "_lookup_client", new_callable=AsyncMock)
    @patch.object(PathTraceService, "_get_device_health", new_callable=AsyncMock)
    async def test_trace_client_path_healthy(self, mock_health, mock_client):
        mock_client.return_value = {
            "client_mac": "00:11:22:33:44:55",
            "username": "alice@enterprise.com",
            "ip": "10.10.50.142",
            "ap_mac": "ap-01-mac",
            "site_id": "site-hq",
            "site_name": "Enterprise HQ",
        }
        mock_health.return_value = "healthy"

        service = PathTraceService()
        response = await service.trace_client_path("00:11:22:33:44:55")

        assert response.client_mac == "00:11:22:33:44:55"
        assert response.username == "alice@enterprise.com"
        assert len(response.hops) == 7
        assert response.hops[0].node_type == "client"
        assert response.hops[1].node_type == "ap"
        assert response.hops[2].node_type == "switch"
        assert response.hops[4].node_type == "sdwan"
        assert response.hops[5].node_type == "sase"
        assert response.hops[6].node_type == "internet"
        assert response.first_unhealthy_hop is None

    @pytest.mark.asyncio
    @patch.object(PathTraceService, "_lookup_client", new_callable=AsyncMock)
    @patch.object(PathTraceService, "_get_device_health", new_callable=AsyncMock)
    async def test_trace_client_path_identifies_degraded_hop(self, mock_health, mock_client):
        mock_client.return_value = {
            "client_mac": "66:77:88:99:aa:bb",
            "username": "bob@enterprise.com",
            "ip": "10.10.50.99",
            "ap_mac": "ap-degraded-mac",
            "site_id": "site-hq",
            "site_name": "Enterprise HQ",
        }
        # AP is degraded, other devices healthy
        mock_health.side_effect = lambda dev_id: "degraded" if "ap" in str(dev_id).lower() else "healthy"

        service = PathTraceService()
        response = await service.trace_client_path("66:77:88:99:aa:bb")

        assert response.first_unhealthy_hop is not None
        assert response.first_unhealthy_hop.node_type == "ap"
        assert response.first_unhealthy_hop.health_status == "degraded"
