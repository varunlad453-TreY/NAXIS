"""
Unit & Integration Tests for Audit Logging (WP-4)
"""

import pytest
from unittest.mock import AsyncMock, patch
from shared.database.audit import log_audit_event


class TestAuditLogging:
    """Test log_audit_event persistence and error handling."""

    @pytest.mark.asyncio
    @patch("shared.database.audit.db.fetchrow", new_callable=AsyncMock)
    async def test_log_audit_event_success(self, mock_fetchrow):
        mock_fetchrow.return_value = {"audit_id": "00000000-0000-0000-0000-000000000001"}

        audit_id = await log_audit_event(
            user_id="user-123",
            username="test_admin",
            user_role="admin",
            action="UPDATE_MIST_CONFIG",
            resource_type="integration",
            resource_id="mist-primary",
            status="success",
            details={"key_updated": True},
            ip_address="10.0.1.50",
        )

        assert audit_id == "00000000-0000-0000-0000-000000000001"
        mock_fetchrow.assert_called_once()
        args = mock_fetchrow.call_args[0]
        assert "INSERT INTO audit_log" in args[0]
        assert args[1] == "user-123"
        assert args[2] == "test_admin"
        assert args[4] == "UPDATE_MIST_CONFIG"

    @pytest.mark.asyncio
    @patch("shared.database.audit.db.fetchrow", new_callable=AsyncMock)
    async def test_log_audit_event_exception_handled(self, mock_fetchrow):
        mock_fetchrow.side_effect = Exception("Database connection failure")

        audit_id = await log_audit_event(
            user_id="user-456",
            username="operator_bob",
            user_role="operator",
            action="MITIGATE_INCIDENT",
            resource_type="incident",
            resource_id="inc-99",
        )

        assert audit_id is None
