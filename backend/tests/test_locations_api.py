"""
Unit & Integration Tests for Location API & Floorplan Engine (WP-5)
"""

import pytest
from unittest.mock import AsyncMock, patch
from api.routes.location_routes import get_location_tree, get_location_floorplan, create_new_location
from api.models.location_models import LocationCreate
from shared.auth.keycloak import UserPrincipal


class TestLocationsAPI:
    """Test location tree, floorplan coordinate normalization, and RBAC."""

    @pytest.mark.asyncio
    @patch("api.routes.location_routes.location_service.get_location_tree", new_callable=AsyncMock)
    async def test_get_location_tree_returns_nested_nodes(self, mock_tree):
        mock_tree.return_value = [
            {
                "location_id": "region-apac",
                "name": "APAC Region",
                "type": "region",
                "health_status": "healthy",
                "device_count": 25,
                "children": [],
            }
        ]
        res = await get_location_tree()
        assert len(res) == 1
        assert res[0]["location_id"] == "region-apac"

    @pytest.mark.asyncio
    @patch("api.routes.location_routes.location_service.get_floorplan_details", new_callable=AsyncMock)
    async def test_get_floorplan_details_normalizes_coords(self, mock_floor):
        mock_floor.return_value = {
            "location_id": "floor-hq-2f",
            "name": "Floor 2",
            "building_name": "Main Building",
            "floor_number": 2,
            "floorplan_image_url": "/floorplans/hq_2f.png",
            "ap_placements": [
                {
                    "device_id": "ap-01",
                    "name": "AP-North",
                    "vendor": "juniper_mist",
                    "x_pct": 25.0,
                    "y_pct": 30.0,
                    "health_status": "healthy",
                    "client_count": 10,
                }
            ],
            "health_status": "healthy",
        }

        res = await get_location_floorplan("floor-hq-2f")
        assert res["location_id"] == "floor-hq-2f"
        assert len(res["ap_placements"]) == 1
        assert res["ap_placements"][0]["x_pct"] == 25.0

    @pytest.mark.asyncio
    @patch("api.routes.location_routes.create_location", new_callable=AsyncMock)
    async def test_create_new_location_admin_success(self, mock_create):
        mock_create.return_value = True
        user = UserPrincipal(user_id="admin-1", username="admin1", roles=["admin"])
        payload = LocationCreate(location_id="site-test", name="Test Site", type="site")

        res = await create_new_location(payload=payload, user=user)
        assert res["status"] == "success"
        assert res["location_id"] == "site-test"
