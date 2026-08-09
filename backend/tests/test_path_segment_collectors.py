"""
Unit & Integration Tests for Cloudflare & Netskope Path Segment Collectors (WP-3.5).

Verifies:
  - Cloudflare tunnel metric transformation into path_segment_telemetry
  - Netskope SASE & NPA publisher metric transformation into path_segment_telemetry
  - Graceful skipping when unconfigured
"""

from unittest.mock import AsyncMock, patch

import pytest

from backend.worker.collectors.cloudflare_segment import (
    CloudflarePathSegmentCollector,
    _build_cloudflare_segment_rows,
)
from backend.worker.collectors.netskope_segment import (
    NetskopePathSegmentCollector,
    _build_netskope_segment_rows,
)


def test_cloudflare_segment_row_building():
    tunnels = [
        {
            "id": "tunnel-guid-123",
            "name": "magic-transit-mumbai-primary",
            "status": "healthy",
            "pop_name": "BOM-01",
            "avg_latency_ms": 14.2,
            "packet_loss": 0.0,
            "jitter_ms": 1.1,
            "connections": [{"id": "c1"}, {"id": "c2"}],
        }
    ]

    rows = _build_cloudflare_segment_rows(tunnels)
    assert len(rows) == 1
    r = rows[0]
    assert r["provider"] == "cloudflare"
    assert r["segment_name"] == "magic-transit-mumbai-primary"
    assert r["status"] == "healthy"
    assert r["latency_ms"] == 14.2
    assert r["active_tunnels"] == 2


def test_netskope_segment_row_building():
    publishers = [
        {
            "publisher_id": "pub-guid-456",
            "publisher_name": "netskope-npa-mumbai-pub01",
            "status": "connected",
            "rtt_ms": 19.5,
            "loss_rate": 0.0,
            "jitter": 2.3,
            "active_connections": 5,
        }
    ]

    rows = _build_netskope_segment_rows(publishers)
    assert len(rows) == 1
    r = rows[0]
    assert r["provider"] == "netskope"
    assert r["segment_name"] == "netskope-npa-mumbai-pub01"
    assert r["status"] == "healthy"
    assert r["latency_ms"] == 19.5
    assert r["active_tunnels"] == 5


@pytest.mark.asyncio
async def test_cloudflare_collector_unconfigured():
    with patch("backend.worker.collectors.cloudflare_segment.get_settings") as mock_settings:
        mock_settings.return_value.cloudflare_enabled = False
        collector = CloudflarePathSegmentCollector()
        outcome = await collector.collect()
        assert outcome.status == "skipped"


@pytest.mark.asyncio
async def test_netskope_collector_unconfigured():
    with patch("backend.worker.collectors.netskope_segment.get_settings") as mock_settings:
        mock_settings.return_value.netskope_enabled = False
        collector = NetskopePathSegmentCollector()
        outcome = await collector.collect()
        assert outcome.status == "skipped"


@pytest.mark.asyncio
async def test_cloudflare_collector_collect_success():
    tunnels = [
        {
            "id": "t1",
            "name": "cf-warp-gateway",
            "status": "healthy",
            "pop_name": "SFO",
        }
    ]
    with patch("backend.worker.collectors.cloudflare_segment.get_settings") as mock_settings:
        mock_settings.return_value.cloudflare_api_token = "tok-123"
        mock_settings.return_value.cloudflare_account_id = "acc-456"
        mock_settings.return_value.cloudflare_enabled = True

        collector = CloudflarePathSegmentCollector()
        with patch.object(collector, "_fetch_tunnels", AsyncMock(return_value=tunnels)), \
             patch("backend.worker.collectors.cloudflare_segment._insert_path_segment_telemetry", AsyncMock()):

            outcome = await collector.collect()
            assert outcome.status == "success"
            assert outcome.metadata["tunnels_found"] == 1


@pytest.mark.asyncio
async def test_netskope_collector_collect_success():
    publishers = [
        {
            "publisher_id": "p1",
            "publisher_name": "netskope-pub-1",
            "status": "connected",
        }
    ]
    with patch("backend.worker.collectors.netskope_segment.get_settings") as mock_settings:
        mock_settings.return_value.netskope_tenant_url = "https://tenant.goskope.com"
        mock_settings.return_value.netskope_api_token = "tok-789"
        mock_settings.return_value.netskope_enabled = True

        collector = NetskopePathSegmentCollector()
        with patch.object(collector, "_fetch_publishers", AsyncMock(return_value=publishers)), \
             patch("backend.worker.collectors.netskope_segment._insert_path_segment_telemetry", AsyncMock()):

            outcome = await collector.collect()
            assert outcome.status == "success"
            assert outcome.metadata["publishers_found"] == 1
