"""
Unit Tests for Location Registry & Database Helper (WP-5)
"""

import pytest
from unittest.mock import AsyncMock, patch
from shared.database import locations_db


class TestLocationsDatabase:
    """Test location record creation, tree queries, and vendor site mapping."""

    @pytest.mark.asyncio
    @patch.object(locations_db.db, "execute", new_callable=AsyncMock)
    async def test_create_location_success(self, mock_execute):
        mock_execute.return_value = "INSERT 0 1"
        success = await locations_db.create_location(
            location_id="site-sg-hq",
            name="Singapore HQ Campus",
            location_type="site",
            latitude=1.3521,
            longitude=103.8198,
        )
        assert success is True
        mock_execute.assert_called_once()

    @pytest.mark.asyncio
    @patch.object(locations_db.db, "fetchrow", new_callable=AsyncMock)
    async def test_get_location_success(self, mock_fetchrow):
        mock_fetchrow.return_value = {
            "location_id": "bldg-01",
            "name": "Building 01",
            "type": "building",
            "parent_id": "site-sg-hq",
        }
        loc = await locations_db.get_location("bldg-01")
        assert loc is not None
        assert loc["location_id"] == "bldg-01"
        assert loc["parent_id"] == "site-sg-hq"

    @pytest.mark.asyncio
    @patch.object(locations_db.db, "execute", new_callable=AsyncMock)
    async def test_create_location_mapping(self, mock_execute):
        mock_execute.return_value = "INSERT 0 1"
        success = await locations_db.create_location_mapping(
            location_id="site-sg-hq",
            vendor="mist",
            vendor_site_id="mist-site-uuid-1234",
        )
        assert success is True
        mock_execute.assert_called_once()
