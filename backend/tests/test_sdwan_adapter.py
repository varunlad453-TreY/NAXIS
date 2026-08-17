"""
Unit & Integration Tests for SD-WAN Vendor-Neutral Adapter (WP-3.6).

Verifies:
  - BaseSDWANAdapter polymorphism and factory instantiation
  - VeloCloudAdapter integration wrapping
  - SilverPeakAdapter configuration checks and collection outcome handling
"""

from unittest.mock import AsyncMock, patch

import pytest

from backend.worker.collectors.sdwan_adapter import (
    SilverPeakAdapter,
    VeloCloudAdapter,
    get_sdwan_adapter,
)


def test_sdwan_adapter_factory_returns_velocloud_by_default():
    with patch("backend.worker.collectors.sdwan_adapter.get_settings") as mock_settings:
        mock_settings.return_value.sdwan_provider = "velocloud"
        adapter = get_sdwan_adapter()
        assert isinstance(adapter, VeloCloudAdapter)
        assert adapter.provider_name == "velocloud"


def test_sdwan_adapter_factory_returns_silverpeak_when_configured():
    with patch("backend.worker.collectors.sdwan_adapter.get_settings") as mock_settings:
        mock_settings.return_value.sdwan_provider = "silverpeak"
        adapter = get_sdwan_adapter()
        assert isinstance(adapter, SilverPeakAdapter)
        assert adapter.provider_name == "silverpeak"


def test_silverpeak_adapter_is_configured():
    with patch("backend.worker.collectors.sdwan_adapter.get_settings") as mock_settings:
        mock_settings.return_value.silverpeak_host = "https://orchestrator.edgeconnect.local"
        mock_settings.return_value.silverpeak_api_key = "secret-token-123"
        mock_settings.return_value.silverpeak_enabled = True

        adapter = SilverPeakAdapter()
        assert adapter.is_configured is True


@pytest.mark.asyncio
async def test_silverpeak_adapter_collect_all_unconfigured():
    with patch("backend.worker.collectors.sdwan_adapter.get_settings") as mock_settings:
        mock_settings.return_value.silverpeak_enabled = False

        adapter = SilverPeakAdapter()
        outcomes = await adapter.collect_all()
        assert len(outcomes) == 1
        assert outcomes[0].status == "skipped"


@pytest.mark.asyncio
async def test_silverpeak_adapter_collect_all_success():
    mock_appliances = [
        {"id": "sp-edge-01", "hostname": "EC-SFO-01", "model": "EC-V", "site": "SFO"}
    ]
    mock_events = [
        {"id": "evt-100", "severity": "WARNING", "description": "WAN tunnel degradation"}
    ]

    with patch("backend.worker.collectors.sdwan_adapter.get_settings") as mock_settings:
        mock_settings.return_value.silverpeak_host = "https://orchestrator.edgeconnect.local"
        mock_settings.return_value.silverpeak_api_key = "secret-key"
        mock_settings.return_value.silverpeak_enabled = True

        adapter = SilverPeakAdapter()
        with patch.object(adapter, "_fetch_appliances", AsyncMock(return_value=mock_appliances)), \
             patch.object(adapter, "_fetch_events", AsyncMock(return_value=mock_events)):
            
            outcomes = await adapter.collect_all()
            assert len(outcomes) == 1
            assert outcomes[0].status == "success"
            assert outcomes[0].metadata["appliances_found"] == 1
            assert outcomes[0].metadata["events_found"] == 1
