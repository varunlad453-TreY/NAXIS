"""
Unit & Integration Tests for AI RCA Engine & API (WP-7)
"""

import pytest
from unittest.mock import AsyncMock, patch
from api.routes.rca_routes import generate_incident_rca, get_incident_rca
from api.services.rca_service import rca_service
from shared.auth.keycloak import UserPrincipal


class TestRCAEngine:
    """Test RCA synthesis, mandatory EVD citations, database persistence, and RBAC."""

    @pytest.mark.asyncio
    @patch("api.services.rca_service.save_rca", new_callable=AsyncMock)
    @patch("api.services.rca_service.get_incident", new_callable=AsyncMock)
    async def test_generate_rca_enforces_citations(self, mock_get_inc, mock_save):
        mock_get_inc.return_value = {
            "incident_id": "inc-202",
            "title": "High Retries on Access AP",
            "severity": "CRITICAL",
        }
        mock_save.return_value = True

        rca = await rca_service.generate_rca("inc-202")

        assert rca.incident_id == "inc-202"
        assert rca.confidence_score >= 0.85
        assert "[EVD-" in rca.summary
        assert len(rca.citations) > 0
        assert len(rca.mitigation_steps) > 0
        mock_save.assert_called_once()

    @pytest.mark.asyncio
    @patch("api.routes.rca_routes.log_audit_event", new_callable=AsyncMock)
    @patch("api.routes.rca_routes.rca_service.generate_rca", new_callable=AsyncMock)
    async def test_generate_incident_rca_endpoint_rbac_success(self, mock_gen, mock_audit):
        mock_gen.return_value = AsyncMock(
            incident_id="inc-202",
            confidence_score=0.92,
            summary="Cited RCA summary [EVD-01]",
        )
        user = UserPrincipal(user_id="op-1", username="operator1", roles=["operator"])

        res = await generate_incident_rca(incident_id="inc-202", user=user)

        mock_gen.assert_called_once_with("inc-202")
        mock_audit.assert_called_once()
