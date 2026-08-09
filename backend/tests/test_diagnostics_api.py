"""
Unit & Integration Tests for Live Diagnostics API & Rate Limiter (WP-6)
"""

import pytest
from unittest.mock import AsyncMock, patch
from fastapi import HTTPException
from api.routes.diagnostics_routes import RateLimiter, execute_ping, execute_traceroute, execute_port_stats
from api.models.path_trace_models import DiagnosticRequest
from shared.auth.keycloak import UserPrincipal


class TestRateLimiter:
    """Test sliding window rate limiting."""

    def test_rate_limiter_allows_under_limit(self):
        limiter = RateLimiter(max_calls=3, period_seconds=60.0)
        assert limiter.check_rate_limit("user-1") is True
        assert limiter.check_rate_limit("user-1") is True
        assert limiter.check_rate_limit("user-1") is True
        assert limiter.check_rate_limit("user-1") is False  # 4th call blocked

    def test_rate_limiter_per_user_isolation(self):
        limiter = RateLimiter(max_calls=1, period_seconds=60.0)
        assert limiter.check_rate_limit("user-A") is True
        assert limiter.check_rate_limit("user-A") is False
        assert limiter.check_rate_limit("user-B") is True  # User B unaffected


class TestDiagnosticsEndpoints:
    """Test RBAC role enforcement and diagnostic test execution."""

    @pytest.mark.asyncio
    @patch("api.routes.diagnostics_routes.log_audit_event", new_callable=AsyncMock)
    @patch("api.routes.diagnostics_routes.create_diagnostic_run", new_callable=AsyncMock)
    @patch("api.routes.diagnostics_routes.update_diagnostic_run", new_callable=AsyncMock)
    async def test_execute_ping_success(self, mock_update, mock_create, mock_audit):
        mock_create.return_value = "run-uuid-101"
        user = UserPrincipal(user_id="op-1", username="operator1", roles=["operator"])
        payload = DiagnosticRequest(target_device_id="edge-101", test_type="ping", destination_ip="8.8.8.8", count=3)

        response = await execute_ping(payload=payload, user=user)

        assert response.run_id == "run-uuid-101"
        assert response.test_type == "ping"
        assert response.status == "success"
        assert response.results["destination"] == "8.8.8.8"
        mock_create.assert_called_once()
        mock_audit.assert_called_once()

    @pytest.mark.asyncio
    @patch("api.routes.diagnostics_routes.log_audit_event", new_callable=AsyncMock)
    @patch("api.routes.diagnostics_routes.create_diagnostic_run", new_callable=AsyncMock)
    @patch("api.routes.diagnostics_routes.update_diagnostic_run", new_callable=AsyncMock)
    async def test_execute_traceroute_success(self, mock_update, mock_create, mock_audit):
        mock_create.return_value = "run-uuid-102"
        user = UserPrincipal(user_id="admin-1", username="admin1", roles=["admin"])
        payload = DiagnosticRequest(target_device_id="edge-102", test_type="traceroute", destination_ip="1.1.1.1")

        response = await execute_traceroute(payload=payload, user=user)

        assert response.run_id == "run-uuid-102"
        assert response.test_type == "traceroute"
        assert response.status == "success"
        assert len(response.results["hops"]) == 4

    @pytest.mark.asyncio
    @patch("api.routes.diagnostics_routes.log_audit_event", new_callable=AsyncMock)
    @patch("api.routes.diagnostics_routes.create_diagnostic_run", new_callable=AsyncMock)
    @patch("api.routes.diagnostics_routes.update_diagnostic_run", new_callable=AsyncMock)
    async def test_execute_port_stats_success(self, mock_update, mock_create, mock_audit):
        mock_create.return_value = "run-uuid-103"
        user = UserPrincipal(user_id="op-2", username="operator2", roles=["operator"])
        payload = DiagnosticRequest(target_device_id="sw-01", test_type="port_stats", interface="ge-0/0/1")

        response = await execute_port_stats(payload=payload, user=user)

        assert response.run_id == "run-uuid-103"
        assert response.test_type == "port_stats"
        assert response.results["interface"] == "ge-0/0/1"
        assert response.results["oper_status"] == "up"
