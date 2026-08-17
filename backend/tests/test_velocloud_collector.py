"""
Comprehensive tests for all VeloCloud collectors.

Covers VeloCloudCollector, VeloCloudEdgesCollector,
VeloCloudEventsCollector, VelocloudInventoryCollector,
and all helper functions (_raise_for_status, _map_vc_severity,
_map_vc_event_type, _build_rows, _upsert_inventory).
"""

from datetime import datetime, timezone
from typing import Any, Dict, List
from unittest.mock import AsyncMock, MagicMock, PropertyMock, call, patch

import pytest

from backend.shared.models.collector_outcome import CollectorOutcome
from backend.shared.models.event import (
    EventCategory,
    EventSeverity,
    EventSource,
    EventType,
    UnifiedEvent,
)
from backend.worker.collectors.velocloud import (
    VeloCloudApiError,
    VeloCloudAppsCollector,
    VeloCloudCollector,
    VeloCloudEdgesCollector,
    VeloCloudEventsCollector,
    VeloCloudLinksCollector,
    VeloCloudTunnelsCollector,
    _map_vc_event_type,
    _map_vc_severity,
    _raise_for_status,
)
from backend.worker.collectors.velocloud_inventory import (
    COLLECTOR_ID as INV_COLLECTOR_ID,
    SOURCE_SYSTEM as INV_SOURCE_SYSTEM,
    VelocloudInventoryCollector,
    _build_rows,
    _upsert_inventory,
)


# ======================================================================
# Helpers
# ======================================================================

def _mock_response(status_code: int = 200, json_data: Any = None, text: str = "") -> AsyncMock:
    resp = AsyncMock(spec=["status_code", "json", "text", "raise_for_status",
                           "__aenter__", "__aexit__"])
    resp.status_code = status_code
    resp.json.return_value = json_data if json_data is not None else {}
    resp.text = text

    def _rfs():
        if status_code >= 400:
            raise Exception(f"HTTP {status_code}")
    resp.raise_for_status = _rfs
    return resp


def _mock_http_client(post_return: AsyncMock = None) -> AsyncMock:
    client = AsyncMock()
    client.post.return_value = post_return or _mock_response()
    return client


def _mock_async_client_cm(client: AsyncMock = None) -> MagicMock:
    cm = MagicMock()
    actual = client or _mock_http_client()
    cm.__aenter__.return_value = actual
    return MagicMock(return_value=cm)


def _mock_client_factory(client: AsyncMock = None) -> MagicMock:
    """Patch factory for code paths that bind httpx.AsyncClient(...) directly
    (collect_all stores the client on self._client before any post)."""
    return MagicMock(return_value=client or _mock_http_client())


def _make_edge_raw(overrides: Dict[str, Any] = None) -> Dict[str, Any]:
    base = {
        "id": 42,
        "logicalId": "vc-edge-logical-001",
        "name": "sfo-edge-01",
        "edgeState": "CONNECTED",
        "modelNumber": "520-EDGE",
        "softwareVersion": "4.3.0",
        "buildNumber": "4.3.0-12345",
        "serialNumber": "SN-ABC-123",
        "activationKey": "ACT-KEY-001",
        "site": {
            "id": 101,
            "name": "SFO-DC",
            "city": "San Francisco",
            "country": "US",
        },
        "siteId": 101,
        "siteName": "SFO-DC",
        "enterpriseId": 1,
        "recentLinks": [
            {
                "interface": "GE0/0",
                "displayName": "Comcast Business",
                "ipAddress": "203.0.113.10",
                "state": "STABLE",
                "internalId": "int-001",
                "netmask": "255.255.255.0",
                "macAddress": "aa:bb:cc:dd:ee:01",
                "bwUpstreamMbps": 500,
                "bwDownstreamMbps": 1000,
            },
            {
                "interface": "GE0/1",
                "displayName": "AT&T Fiber",
                "ipAddress": "198.51.100.20",
                "state": "STABLE",
                "internalId": "int-002",
                "netmask": "255.255.255.0",
                "macAddress": "aa:bb:cc:dd:ee:02",
            },
        ],
    }
    if overrides:
        base.update(overrides)
    return base


def _make_event_raw(overrides: Dict[str, Any] = None) -> Dict[str, Any]:
    base = {
        "id": "vc-evt-001",
        "event": "LINK_DOWN",
        "severity": "CRITICAL",
        "eventTime": "2025-06-15T10:30:00Z",
        "edgeId": 42,
        "edgeName": "sfo-edge-01",
        "edgeLogicalId": "vc-edge-logical-001",
        "siteName": "SFO-DC",
        "siteId": 101,
        "detail": "WAN link GE0/0 is down (Comcast Business)",
        "message": "WAN link down",
        "enterpriseName": "Acme Corp",
    }
    if overrides:
        base.update(overrides)
    return base


# ======================================================================
# Section A: VeloCloudCollector — orchestrator
# ======================================================================

class TestVeloCloudCollector:

    def _make_collector(self, **settings_overrides):
        with patch("backend.worker.collectors.velocloud.get_settings") as gs:
            settings = MagicMock()
            settings.velocloud_url = settings_overrides.get("url", "https://vco.example.com/")
            settings.velocloud_api_key = settings_overrides.get("api_key", "test-api-key")
            settings.velocloud_enabled = settings_overrides.get("enabled", True)
            gs.return_value = settings
            return VeloCloudCollector()

    # ── Constructor ──────────────────────────────────────────────────

    def test_constructor_strips_trailing_slash(self):
        c = self._make_collector(url="https://vco.example.com/")
        assert c._base_url == "https://vco.example.com"

    def test_constructor_no_trailing_slash(self):
        c = self._make_collector(url="https://vco.example.com")
        assert c._base_url == "https://vco.example.com"

    def test_constructor_sets_api_key(self):
        c = self._make_collector(api_key="key-123")
        assert c._api_key == "key-123"

    def test_constructor_sets_enabled(self):
        c = self._make_collector(enabled=True)
        assert c._enabled is True

    # ── is_configured ─────────────────────────────────────────────────

    def test_is_configured_true(self):
        c = self._make_collector()
        assert c.is_configured is True

    def test_is_configured_false_no_key(self):
        c = self._make_collector(api_key="")
        assert c.is_configured is False

    def test_is_configured_false_no_url(self):
        c = self._make_collector(url="")
        assert c.is_configured is False

    def test_is_configured_false_disabled(self):
        c = self._make_collector(enabled=False)
        assert c.is_configured is False

    # ── connect ──────────────────────────────────────────────────────

    @pytest.mark.asyncio
    async def test_connect_success(self):
        c = self._make_collector()
        mock_client = _mock_http_client(
            _mock_response(200, {"id": 42})
        )
        with patch("backend.worker.collectors.velocloud.httpx.AsyncClient",
                   _mock_async_client_cm(mock_client)):
            result = await c.connect()
        assert result is True

    @pytest.mark.asyncio
    async def test_connect_failure_api_error(self):
        c = self._make_collector()
        mock_client = _mock_http_client(
            _mock_response(401, {"error": "unauthorized"})
        )
        with patch("backend.worker.collectors.velocloud.httpx.AsyncClient",
                   _mock_async_client_cm(mock_client)):
            result = await c.connect()
        assert result is False

    @pytest.mark.asyncio
    async def test_connect_failure_not_configured(self):
        c = self._make_collector(api_key="")
        result = await c.connect()
        assert result is False

    @pytest.mark.asyncio
    async def test_connect_timeout_does_not_hang(self):
        c = self._make_collector()
        mock_client = MagicMock()
        mock_client.post.side_effect = TimeoutError("timed out")
        mock_cm = MagicMock()
        mock_cm.__aenter__.return_value = mock_client
        with patch("backend.worker.collectors.velocloud.httpx.AsyncClient",
                   MagicMock(return_value=mock_cm)):
            result = await c.connect()
        assert result is False

    # ── _get_enterprise_id ───────────────────────────────────────────

    @pytest.mark.asyncio
    async def test_get_enterprise_id_returns_id(self):
        c = self._make_collector()
        client = _mock_http_client(_mock_response(200, {"id": 42}))
        eid = await c._get_enterprise_id(client)
        assert eid == "42"

    @pytest.mark.asyncio
    async def test_get_enterprise_id_empty_dict(self):
        """Empty dict returns empty string (falsy, handled downstream)."""
        c = self._make_collector()
        client = _mock_http_client(_mock_response(200, {}))
        eid = await c._get_enterprise_id(client)
        assert eid == ""

    @pytest.mark.asyncio
    async def test_get_enterprise_id_no_id_key(self):
        """Dict without 'id' returns empty string."""
        c = self._make_collector()
        client = _mock_http_client(_mock_response(200, {"name": "Acme"}))
        eid = await c._get_enterprise_id(client)
        assert eid == ""

    @pytest.mark.asyncio
    async def test_get_enterprise_id_api_error(self):
        c = self._make_collector()
        client = _mock_http_client(_mock_response(500, {"error": "oops"}))
        eid = await c._get_enterprise_id(client)
        assert eid is None

    @pytest.mark.asyncio
    async def test_get_enterprise_id_timeout(self):
        c = self._make_collector()
        client = AsyncMock()
        client.post.side_effect = TimeoutError("timed out")
        eid = await c._get_enterprise_id(client)
        assert eid is None

    @pytest.mark.asyncio
    async def test_get_enterprise_id_http_error_raises(self):
        """Non-VeloCloudApiError HTTP errors (e.g. httpx.HTTPStatusError)
        are caught by the broad except and return None."""
        c = self._make_collector()
        client = AsyncMock()
        client.post.side_effect = Exception("transport error")
        eid = await c._get_enterprise_id(client)
        assert eid is None

    # ── collect_all ──────────────────────────────────────────────────

    @pytest.mark.asyncio
    async def test_collect_all_disabled(self):
        c = self._make_collector(enabled=False)
        outcomes = await c.collect_all()
        assert len(outcomes) == 5
        assert all(o.status == "skipped" for o in outcomes)
        assert all(o.collector_id.startswith("velocloud-") for o in outcomes)
        assert all(o.error_text == "VeloCloud collector disabled" for o in outcomes)

    @pytest.mark.asyncio
    async def test_collect_all_no_credentials(self):
        c = self._make_collector(api_key="", url="")
        outcomes = await c.collect_all()
        assert len(outcomes) == 5
        assert all(o.status == "skipped" for o in outcomes)
        assert all("credentials" in (o.error_text or "") for o in outcomes)

    @pytest.mark.asyncio
    async def test_collect_all_auth_failure(self):
        c = self._make_collector()
        mock_client = _mock_http_client(_mock_response(401, {"error": "unauthorized"}))
        with patch("backend.worker.collectors.velocloud.httpx.AsyncClient",
                   _mock_client_factory(mock_client)):
            outcomes = await c.collect_all()
        assert len(outcomes) == 5
        assert all(o.status == "error" for o in outcomes)
        assert all("Could not fetch VeloCloud enterprise ID" in o.error_text for o in outcomes)

    @pytest.mark.asyncio
    async def test_collect_all_full_success(self):
        c = self._make_collector()
        resp_enterprise = _mock_response(200, {"id": 1})
        edge = _make_edge_raw({
            "links": [
                {"id": "link-1", "displayName": "Comcast", "state": "DOWN", "edgeId": 42}
            ],
            "tunnels": [
                {"id": "tun-1", "state": "DOWN", "edgeId": 42, "peerName": "mpls-peer"}
            ],
        })
        resp_edges = _mock_response(200, [edge])
        resp_events = _mock_response(200, {"data": [_make_event_raw()]})
        resp_apps = _mock_response(200, {"data": [
            {"id": "app-1", "name": "Salesforce", "edgeId": 42},
        ]})

        client = AsyncMock()
        client.post.side_effect = [
            resp_enterprise,
            resp_edges,
            resp_events,
            resp_apps,
            resp_apps,
        ]

        with patch("backend.worker.collectors.velocloud.httpx.AsyncClient",
                   _mock_client_factory(client)):
            outcomes = await c.collect_all()

        # 5 outcomes in orchestration order: edges, links, tunnels, events, apps
        assert len(outcomes) == 5
        assert [o.collector_id for o in outcomes] == [
            "velocloud-edges",
            "velocloud-links",
            "velocloud-tunnels",
            "velocloud-events",
            "velocloud-apps",
        ]
        assert all(o.status == "success" for o in outcomes)
        assert [len(o.events) for o in outcomes] == [1, 1, 1, 1, 1]

    @pytest.mark.asyncio
    async def test_collect_all_edges_and_events_have_correct_source(self):
        c = self._make_collector()
        resp_enterprise = _mock_response(200, {"id": 1})
        resp_edges = _mock_response(200, [_make_edge_raw()])
        resp_events = _mock_response(200, {"data": [_make_event_raw()]})

        client = AsyncMock()
        client.post.side_effect = [resp_enterprise, resp_edges, resp_events]

        with patch("backend.worker.collectors.velocloud.httpx.AsyncClient",
                   _mock_client_factory(client)):
            outcomes = await c.collect_all()

        for evt in outcomes[0].events:
            assert evt.source == EventSource.VELOCLOUD
        for evt in outcomes[3].events:
            assert evt.source == EventSource.VELOCLOUD

    @pytest.mark.asyncio
    async def test_collect_all_subcollector_error_nonfatal(self):
        c = self._make_collector()
        resp_enterprise = _mock_response(200, {"id": 1})
        resp_events = _mock_response(200, {"data": [_make_event_raw()]})
        resp_bad = _mock_response(400, {"error": "methodError"})

        client = AsyncMock()
        # enterprise succeeds, edges fails, events still runs, apps has no endpoint
        client.post.side_effect = [
            resp_enterprise,
            _mock_response(500, "Internal error"),
            resp_events,
            resp_bad,
            resp_bad,
        ]

        with patch("backend.worker.collectors.velocloud.httpx.AsyncClient",
                   _mock_client_factory(client)):
            outcomes = await c.collect_all()

        assert len(outcomes) == 5
        assert outcomes[0].status == "success"  # edges degrades gracefully (empty data)
        assert outcomes[1].status == "success"  # links degrades gracefully (empty data)
        assert outcomes[2].status == "success"  # tunnels degrades gracefully (empty data)
        assert outcomes[3].status == "success"  # events still collected
        assert outcomes[4].status == "skipped"  # apps has no working endpoint

        assert outcomes[0].events == []  # edges fetch failed at the orchestrator


# ======================================================================
# Section B: VeloCloudEdgesCollector
# ======================================================================

class TestVeloCloudEdgesCollector:

    def _make_collector(self, client: AsyncMock = None) -> VeloCloudEdgesCollector:
        return VeloCloudEdgesCollector(
            client or _mock_http_client(),
            "https://vco.example.com",
        )

    def test_collector_id_and_source(self):
        c = self._make_collector()
        assert c.COLLECTOR_ID == "velocloud-edges"
        assert c.SOURCE_SYSTEM == "velocloud"

    @pytest.mark.asyncio
    async def test_empty_response(self):
        client = _mock_http_client(_mock_response(200, []))
        c = self._make_collector(client)
        outcome = await c.collect()
        assert outcome.status == "success"
        assert outcome.events == []

    @pytest.mark.asyncio
    async def test_response_dict_with_data_key(self):
        client = _mock_http_client(_mock_response(200, {
            "data": [_make_edge_raw()],
        }))
        c = self._make_collector(client)
        outcome = await c.collect()
        assert outcome.status == "success"
        assert len(outcome.events) == 1

    @pytest.mark.asyncio
    async def test_single_connected_edge(self):
        client = _mock_http_client(_mock_response(200, [_make_edge_raw()]))
        c = self._make_collector(client)
        outcome = await c.collect()
        evt = outcome.events[0]
        assert evt.severity == EventSeverity.INFO
        assert evt.event_type == EventType.DEVICE_REACHABLE

    @pytest.mark.asyncio
    async def test_single_offline_edge(self):
        raw = _make_edge_raw({"edgeState": "DISCONNECTED"})
        client = _mock_http_client(_mock_response(200, [raw]))
        c = self._make_collector(client)
        outcome = await c.collect()
        evt = outcome.events[0]
        assert evt.severity == EventSeverity.CRITICAL
        assert evt.event_type == EventType.DEVICE_UNREACHABLE

    @pytest.mark.asyncio
    async def test_single_degraded_edge(self):
        raw = _make_edge_raw({"edgeState": "DEGRADED"})
        client = _mock_http_client(_mock_response(200, [raw]))
        c = self._make_collector(client)
        outcome = await c.collect()
        evt = outcome.events[0]
        assert evt.severity == EventSeverity.WARNING
        assert evt.event_type == EventType.OTHER

    @pytest.mark.asyncio
    async def test_edge_with_site(self):
        client = _mock_http_client(_mock_response(200, [_make_edge_raw()]))
        c = self._make_collector(client)
        outcome = await c.collect()
        evt = outcome.events[0]
        assert evt.device.device_id == "42"
        assert evt.device.site_id == "101"
        assert evt.device.site_name == "SFO-DC"

    @pytest.mark.asyncio
    async def test_edge_with_model_and_sw(self):
        client = _mock_http_client(_mock_response(200, [_make_edge_raw()]))
        c = self._make_collector(client)
        outcome = await c.collect()
        evt = outcome.events[0]
        assert evt.device.device_model == "520-EDGE"
        assert "model: 520-EDGE" in evt.description
        assert "SW: 4.3.0" in evt.description

    @pytest.mark.asyncio
    async def test_edge_without_name_falls_back(self):
        raw = _make_edge_raw({})
        # Remove name and logicalId keys to trigger the fallback default
        raw.pop("name", None)
        raw.pop("logicalId", None)
        client = _mock_http_client(_mock_response(200, [raw]))
        c = self._make_collector(client)
        outcome = await c.collect()
        evt = outcome.events[0]
        assert "Edge: unknown" == evt.title

    @pytest.mark.asyncio
    async def test_edge_without_id_falls_back(self):
        raw = _make_edge_raw({})
        raw.pop("id", None)
        raw.pop("logicalId", None)
        client = _mock_http_client(_mock_response(200, [raw]))
        c = self._make_collector(client)
        outcome = await c.collect()
        evt = outcome.events[0]
        # Fallback edge_id starts with "vc-"
        assert evt.source_event_id.startswith("vc-")

    @pytest.mark.asyncio
    async def test_edge_event_fixed_fields(self):
        client = _mock_http_client(_mock_response(200, [_make_edge_raw()]))
        c = self._make_collector(client)
        outcome = await c.collect()
        evt = outcome.events[0]
        assert evt.source == EventSource.VELOCLOUD
        assert evt.category == EventCategory.SYSTEM

    @pytest.mark.asyncio
    async def test_edge_tags_present(self):
        client = _mock_http_client(_mock_response(200, [_make_edge_raw()]))
        c = self._make_collector(client)
        outcome = await c.collect()
        evt = outcome.events[0]
        for tag in ("sdwan", "velocloud", "edge", "inventory"):
            assert tag in evt.tags, f"Missing tag: {tag}"

    @pytest.mark.asyncio
    async def test_edge_metadata_fields(self):
        client = _mock_http_client(_mock_response(200, [_make_edge_raw()]))
        c = self._make_collector(client)
        outcome = await c.collect()
        evt = outcome.events[0]
        md = evt.metadata
        assert md["vc_edge_id"] == "42"
        assert md["vc_enterprise_id"] == "1"
        assert md["vc_site_id"] == "101"
        assert md["vc_model"] == "520-EDGE"
        assert md["vc_sw_version"] == "4.3.0"
        assert md["vc_edge_state"] == "CONNECTED"

    @pytest.mark.asyncio
    async def test_transport_error_retry_then_error(self):
        client = AsyncMock()
        client.post.side_effect = ConnectionError("connection refused")
        c = self._make_collector(client)
        outcome = await c.collect()
        assert outcome.status == "error"
        assert client.post.call_count >= 1

    @pytest.mark.asyncio
    async def test_api_401_error(self):
        client = _mock_http_client(_mock_response(401, {"error": "unauthorized"}))
        c = self._make_collector(client)
        outcome = await c.collect()
        assert outcome.status == "error"
        assert "401" in outcome.error_text

    @pytest.mark.asyncio
    async def test_api_500_error(self):
        client = _mock_http_client(_mock_response(500, "server error"))
        c = self._make_collector(client)
        outcome = await c.collect()
        assert outcome.status == "error"
        assert "500" in outcome.error_text

    @pytest.mark.asyncio
    async def test_posts_to_correct_endpoint(self):
        client = AsyncMock()
        client.post.return_value = _mock_response(200, [])
        c = self._make_collector(client)
        await c.collect()
        client.post.assert_called_once()
        url = client.post.call_args[0][0]
        assert "/portal/rest/enterprise/getEnterpriseEdges" in url
        kwargs = client.post.call_args[1]
        assert kwargs["json"] == {"with": ["site"]}

    @pytest.mark.asyncio
    async def test_metadata_raw_count(self):
        client = _mock_http_client(_mock_response(200, [_make_edge_raw(), _make_edge_raw()]))
        c = self._make_collector(client)
        outcome = await c.collect()
        assert outcome.metadata.get("raw_count") == 2

    @pytest.mark.asyncio
    async def test_metadata_rows_written(self):
        client = _mock_http_client(_mock_response(200, [_make_edge_raw()]))
        c = self._make_collector(client)
        outcome = await c.collect()
        assert outcome.rows_written == 1


# ======================================================================
# Section C: VeloCloudEventsCollector & helpers
# ======================================================================

class TestVeloCloudEventsCollector:

    def _make_collector(self, client: AsyncMock = None,
                        enterprise_id: int = 1) -> VeloCloudEventsCollector:
        return VeloCloudEventsCollector(
            client or _mock_http_client(),
            "https://vco.example.com",
            enterprise_id,
        )

    def test_collector_id(self):
        c = self._make_collector()
        assert c.COLLECTOR_ID == "velocloud-events"

    @pytest.mark.asyncio
    async def test_empty_response(self):
        client = _mock_http_client(_mock_response(200, {"data": []}))
        c = self._make_collector(client)
        outcome = await c.collect()
        assert outcome.status == "success"
        assert len(outcome.events) == 0

    @pytest.mark.asyncio
    async def test_response_dict_with_data(self):
        client = _mock_http_client(_mock_response(200, {"data": [_make_event_raw()]}))
        c = self._make_collector(client)
        outcome = await c.collect()
        assert outcome.status == "success"
        assert len(outcome.events) == 1
        assert outcome.events[0].source == EventSource.VELOCLOUD

    @pytest.mark.asyncio
    async def test_response_is_raw_list(self):
        client = _mock_http_client(_mock_response(200, [_make_event_raw()]))
        c = self._make_collector(client)
        outcome = await c.collect()
        assert outcome.status == "success"
        assert len(outcome.events) == 1

    @pytest.mark.asyncio
    async def test_posts_correct_endpoint(self):
        client = AsyncMock()
        client.post.return_value = _mock_response(200, {"data": []})
        c = self._make_collector(client)
        await c.collect()
        url = client.post.call_args[0][0]
        assert "/portal/rest/event/getEnterpriseEvents" in url

    @pytest.mark.asyncio
    async def test_posts_enterprise_id_in_payload(self):
        client = AsyncMock()
        client.post.return_value = _mock_response(200, {"data": []})
        c = self._make_collector(client, enterprise_id=42)
        await c.collect()
        payload = client.post.call_args[1]["json"]
        assert payload["enterpriseId"] == 42

    @pytest.mark.asyncio
    async def test_event_has_all_fields(self):
        client = _mock_http_client(_mock_response(200, {"data": [_make_event_raw()]}))
        c = self._make_collector(client)
        outcome = await c.collect()
        evt = outcome.events[0]
        assert evt.event_id.startswith("vc-event-")
        assert evt.source_event_id == "vc-evt-001"
        assert evt.source == EventSource.VELOCLOUD
        assert evt.severity == EventSeverity.CRITICAL
        assert evt.category == EventCategory.CONNECTIVITY

    @pytest.mark.asyncio
    async def test_event_has_device_info(self):
        raw = _make_event_raw()
        client = _mock_http_client(_mock_response(200, {"data": [raw]}))
        c = self._make_collector(client)
        outcome = await c.collect()
        evt = outcome.events[0]
        assert evt.device.device_id == "42"
        assert evt.device.device_name == "sfo-edge-01"
        assert evt.device.device_type == "edge"
        assert evt.device.site_id == "101"
        assert evt.device.site_name == "SFO-DC"

    @pytest.mark.asyncio
    async def test_event_has_tags_and_metadata(self):
        client = _mock_http_client(_mock_response(200, {"data": [_make_event_raw()]}))
        c = self._make_collector(client)
        outcome = await c.collect()
        evt = outcome.events[0]
        assert "sdwan" in evt.tags
        assert "velocloud" in evt.tags
        assert "event" in evt.tags
        assert evt.metadata["vc_event_id"] == "vc-evt-001"
        assert evt.metadata["vc_level"] == "CRITICAL"

    @pytest.mark.asyncio
    async def test_event_timestamp_from_event_time(self):
        client = _mock_http_client(_mock_response(200, {"data": [_make_event_raw()]}))
        c = self._make_collector(client)
        outcome = await c.collect()
        evt = outcome.events[0]
        # 2025-06-15T10:30:00Z
        assert evt.timestamp.year == 2025
        assert evt.timestamp.month == 6
        assert evt.timestamp.day == 15
        assert evt.timestamp.hour == 10
        assert evt.timestamp.minute == 30

    @pytest.mark.asyncio
    async def test_event_timestamp_fallback_to_now(self):
        raw = _make_event_raw({"eventTime": None, "createdWhen": None})
        client = _mock_http_client(_mock_response(200, {"data": [raw]}))
        c = self._make_collector(client)
        outcome = await c.collect()
        evt = outcome.events[0]
        now = datetime.now(timezone.utc).replace(tzinfo=None)
        assert abs((evt.timestamp - now).total_seconds()) < 5

    @pytest.mark.asyncio
    async def test_event_timestamp_bad_string_fallback(self):
        raw = _make_event_raw({"eventTime": "not-a-date"})
        client = _mock_http_client(_mock_response(200, {"data": [raw]}))
        c = self._make_collector(client)
        outcome = await c.collect()
        evt = outcome.events[0]
        now = datetime.now(timezone.utc).replace(tzinfo=None)
        assert abs((evt.timestamp - now).total_seconds()) < 5

    @pytest.mark.asyncio
    async def test_event_title_truncated_at_120(self):
        raw = _make_event_raw({"event": "X" * 200})
        client = _mock_http_client(_mock_response(200, {"data": [raw]}))
        c = self._make_collector(client)
        outcome = await c.collect()
        evt = outcome.events[0]
        assert len(evt.title) <= 120

    @pytest.mark.asyncio
    async def test_event_device_info_missing_edge_id(self):
        """When both edgeId and edgeLogicalId are absent, device is None."""
        raw = _make_event_raw({})
        raw.pop("edgeId", None)
        raw.pop("edgeLogicalId", None)
        client = _mock_http_client(_mock_response(200, {"data": [raw]}))
        c = self._make_collector(client)
        outcome = await c.collect()
        evt = outcome.events[0]
        assert evt.device is None

    @pytest.mark.asyncio
    async def test_bad_event_element_skipped(self):
        """A corrupt (non-dict) event should not break the entire batch."""
        good = _make_event_raw({"id": "good-1", "event": "LINK_DOWN"})
        bad = None  # None has no .get() → AttributeError → caught & skipped
        client = _mock_http_client(_mock_response(200, {"data": [good, bad, good]}))
        c = self._make_collector(client)
        outcome = await c.collect()
        # 2 good events should still be returned
        assert outcome.status == "success"
        assert len(outcome.events) == 2

    @pytest.mark.asyncio
    async def test_event_metadata_edge_ids(self):
        raw = _make_event_raw()
        client = _mock_http_client(_mock_response(200, {"data": [raw]}))
        c = self._make_collector(client)
        outcome = await c.collect()
        evt = outcome.events[0]
        assert evt.metadata["vc_edge_id"] == "42"
        assert evt.metadata["vc_edge_name"] == "sfo-edge-01"

    @pytest.mark.asyncio
    async def test_transport_error_retry(self):
        client = AsyncMock()
        client.post.side_effect = ConnectionError("connection error")
        c = self._make_collector(client)
        outcome = await c.collect()
        assert outcome.status == "error"

    @pytest.mark.asyncio
    async def test_api_error_outcome(self):
        client = _mock_http_client(_mock_response(400, {"error": "bad request"}))
        c = self._make_collector(client)
        outcome = await c.collect()
        assert outcome.status == "error"

    @pytest.mark.asyncio
    async def test_raw_count_in_metadata(self):
        client = _mock_http_client(
            _mock_response(200, {"data": [_make_event_raw(), _make_event_raw()]})
        )
        c = self._make_collector(client)
        outcome = await c.collect()
        assert outcome.metadata.get("raw_count") == 2

    @pytest.mark.asyncio
    async def test_rows_written(self):
        client = _mock_http_client(_mock_response(200, {"data": [_make_event_raw()]}))
        c = self._make_collector(client)
        outcome = await c.collect()
        assert outcome.rows_written == 1


# ======================================================================
# Section C-2: Sub-collectors (Links, Tunnels, Apps)
# ======================================================================

class TestVeloCloudAppsCollector:

    def _make_collector(self, client: AsyncMock, edges_data: List[Dict] = None) -> VeloCloudAppsCollector:
        return VeloCloudAppsCollector(
            client,
            "https://vco.example.com",
            enterprise_id=1,
            edges_data=edges_data or [{"id": 42, "site": {"id": 101}},
                                      {"id": 43, "site": {"id": 102}}],
        )

    @pytest.mark.asyncio
    async def test_apps_collector_success(self):
        client = _mock_http_client(_mock_response(200, {"data": [
            {"id": "app-1", "name": "Salesforce", "edgeId": 42,
             "bytesSent": 1024, "bytesReceived": 2048},
        ]}))
        outcome = await self._make_collector(client).collect()
        assert outcome.status == "success"
        assert len(outcome.events) == 1
        assert outcome.events[0].source == EventSource.VELOCLOUD

    @pytest.mark.asyncio
    async def test_apps_collector_skipped_when_no_working_endpoint(self):
        client = _mock_http_client(_mock_response(400, {"error": "methodError"}))
        c = self._make_collector(client)
        outcome = await c.collect()
        assert outcome.status == "skipped"
        assert "No App" in outcome.error_text


class TestVeloCloudLinkTunnelSite:
    """Site info stamped from edge into link/tunnel events (Phase 3)."""

    def _edge_with_site(self, **edge_overrides):
        base = _make_edge_raw(
            {
                "site": {"id": 101, "name": "SFO-DC"},
                "siteId": 101,
                "siteName": "SFO-DC",
                "links": [
                    {
                        "id": "link-1",
                        "displayName": "Comcast",
                        "state": "DOWN",
                        "edgeId": 42,
                    }
                ],
                "tunnels": [
                    {
                        "id": "tun-1",
                        "state": "DOWN",
                        "edgeId": 42,
                        "peerName": "mpls-peer",
                    }
                ],
            }
        )
        base.update(edge_overrides)
        return base

    @pytest.mark.asyncio
    async def test_link_event_gets_site(self):
        c = VeloCloudLinksCollector([self._edge_with_site()])
        outcome = await c.collect()
        evt = outcome.events[0]
        assert evt.event_type == EventType.LINK_DOWN
        assert evt.device.site_id == "101"
        assert evt.device.site_name == "SFO-DC"

    @pytest.mark.asyncio
    async def test_tunnel_event_gets_site(self):
        c = VeloCloudTunnelsCollector([self._edge_with_site()])
        outcome = await c.collect()
        evt = outcome.events[0]
        assert evt.event_type == EventType.TUNNEL_DOWN
        assert evt.device.site_id == "101"
        assert evt.device.site_name == "SFO-DC"

    @pytest.mark.asyncio
    async def test_link_site_falls_back_to_empty(self):
        edge = self._edge_with_site()
        edge.pop("site", None)
        edge.pop("siteId", None)
        c = VeloCloudLinksCollector([edge])
        outcome = await c.collect()
        assert outcome.events[0].device.site_id is None


# ======================================================================
# Section C-3: _map_vc_severity
# ======================================================================

class TestMapVcSeverity:

    def test_critical(self):
        assert _map_vc_severity("CRITICAL") == EventSeverity.CRITICAL

    def test_alert(self):
        assert _map_vc_severity("ALERT") == EventSeverity.CRITICAL

    def test_emergency(self):
        assert _map_vc_severity("EMERGENCY") == EventSeverity.CRITICAL

    def test_error(self):
        assert _map_vc_severity("ERROR") == EventSeverity.MAJOR

    def test_major(self):
        assert _map_vc_severity("MAJOR") == EventSeverity.MAJOR

    def test_warning(self):
        assert _map_vc_severity("WARNING") == EventSeverity.WARNING

    def test_warn(self):
        assert _map_vc_severity("WARN") == EventSeverity.WARNING

    def test_info(self):
        assert _map_vc_severity("INFO") == EventSeverity.INFO

    def test_lowercase(self):
        assert _map_vc_severity("critical") == EventSeverity.CRITICAL

    def test_unknown_level_default_info(self):
        assert _map_vc_severity("DEBUG") == EventSeverity.INFO

    def test_empty_string_default_info(self):
        assert _map_vc_severity("") == EventSeverity.INFO


# ======================================================================
# Section C-4: _map_vc_event_type
# ======================================================================

class TestMapVcEventType:

    def test_link_down(self):
        et, cat = _map_vc_event_type("LINK_DOWN", "")
        assert et == EventType.LINK_DOWN
        assert cat == EventCategory.CONNECTIVITY

    def test_link_up(self):
        et, cat = _map_vc_event_type("LINK_UP", "")
        assert et == EventType.LINK_UP
        assert cat == EventCategory.CONNECTIVITY

    def test_link_down_by_name(self):
        et, cat = _map_vc_event_type("EVENT", "link_down")
        assert et == EventType.LINK_DOWN
        assert cat == EventCategory.CONNECTIVITY

    def test_tunnel_down(self):
        et, cat = _map_vc_event_type("TUNNEL_DOWN", "")
        assert et == EventType.TUNNEL_DOWN
        assert cat == EventCategory.CONNECTIVITY

    def test_tunnel_up(self):
        et, cat = _map_vc_event_type("TUNNEL_UP", "")
        assert et == EventType.TUNNEL_UP
        assert cat == EventCategory.CONNECTIVITY

    def test_edge_offline(self):
        et, cat = _map_vc_event_type("EDGE_OFFLINE", "")
        assert et == EventType.DEVICE_UNREACHABLE
        assert cat == EventCategory.CONNECTIVITY

    def test_edge_disconnected(self):
        et, cat = _map_vc_event_type("EDGE_DISCONNECTED", "")
        assert et == EventType.DEVICE_UNREACHABLE
        assert cat == EventCategory.CONNECTIVITY

    def test_high_latency(self):
        et, cat = _map_vc_event_type("HIGH_LATENCY", "")
        assert et == EventType.HIGH_LATENCY
        assert cat == EventCategory.PERFORMANCE

    def test_latency_in_name(self):
        et, cat = _map_vc_event_type("EVENT", "latency_spike")
        assert et == EventType.HIGH_LATENCY
        assert cat == EventCategory.PERFORMANCE

    def test_packet_loss(self):
        et, cat = _map_vc_event_type("PACKET_LOSS", "")
        assert et == EventType.PACKET_LOSS
        assert cat == EventCategory.PERFORMANCE

    def test_loss_in_name(self):
        et, cat = _map_vc_event_type("EVENT", "high_loss")
        assert et == EventType.PACKET_LOSS
        assert cat == EventCategory.PERFORMANCE

    def test_jitter(self):
        et, cat = _map_vc_event_type("JITTER_HIGH", "")
        assert et == EventType.JITTER
        assert cat == EventCategory.PERFORMANCE

    def test_jitter_in_name(self):
        et, cat = _map_vc_event_type("EVENT", "jitter")
        assert et == EventType.JITTER
        assert cat == EventCategory.PERFORMANCE

    def test_high_cpu(self):
        et, cat = _map_vc_event_type("CPU_HIGH", "")
        assert et == EventType.HIGH_CPU
        assert cat == EventCategory.PERFORMANCE

    def test_high_memory(self):
        et, cat = _map_vc_event_type("MEMORY_HIGH", "")
        assert et == EventType.HIGH_CPU
        assert cat == EventCategory.PERFORMANCE

    def test_unknown_default_other_system(self):
        et, cat = _map_vc_event_type("BACKUP_COMPLETE", "")
        assert et == EventType.OTHER
        assert cat == EventCategory.SYSTEM


# ======================================================================
# Section C-5: _raise_for_status
# ======================================================================

class TestRaiseForStatus:

    def test_2xx_passes(self):
        resp = MagicMock()
        resp.status_code = 200
        _raise_for_status(resp)

    def test_204_passes(self):
        resp = MagicMock()
        resp.status_code = 204
        _raise_for_status(resp)

    def test_401_with_json_detail(self):
        resp = MagicMock()
        resp.status_code = 401
        resp.json.return_value = {"error": "unauthorized"}
        with pytest.raises(VeloCloudApiError) as exc:
            _raise_for_status(resp)
        assert exc.value.status_code == 401
        assert "unauthorized" in str(exc.value)

    def test_500_with_text_detail(self):
        resp = MagicMock()
        resp.status_code = 500
        resp.json.side_effect = ValueError("not json")
        resp.text = "Internal Server Error"
        with pytest.raises(VeloCloudApiError) as exc:
            _raise_for_status(resp)
        assert exc.value.status_code == 500
        assert "Internal Server Error" in str(exc.value)


# ======================================================================
# Section D: VelocloudInventoryCollector
# ======================================================================

class TestVelocloudInventoryCollector:

    def _make_collector(self, **settings_overrides):
        with patch("backend.worker.collectors.velocloud_inventory.get_settings") as gs:
            settings = MagicMock()
            settings.velocloud_url = settings_overrides.get("url", "https://vco.example.com/")
            settings.velocloud_api_key = settings_overrides.get("api_key", "test-api-key")
            settings.velocloud_enabled = settings_overrides.get("enabled", True)
            gs.return_value = settings
            return VelocloudInventoryCollector()

    @pytest.mark.asyncio
    async def test_collect_disabled(self):
        c = self._make_collector(enabled=False)
        outcome = await c.collect()
        assert outcome.status == "skipped"
        assert outcome.collector_id == INV_COLLECTOR_ID
        assert outcome.source_system == INV_SOURCE_SYSTEM

    @pytest.mark.asyncio
    async def test_collect_no_key(self):
        c = self._make_collector(api_key="")
        outcome = await c.collect()
        assert outcome.status == "skipped"

    @pytest.mark.asyncio
    async def test_collect_no_url(self):
        c = self._make_collector(url="")
        outcome = await c.collect()
        assert outcome.status == "skipped"

    @pytest.mark.asyncio
    async def test_collect_full_success(self):
        c = self._make_collector()
        edge_raw = _make_edge_raw()
        resp_enterprise = _mock_response(200, {"id": 1})
        resp_edges = _mock_response(200, [edge_raw])

        mock_client = AsyncMock()
        mock_client.post.side_effect = [resp_enterprise, resp_edges]

        with patch("backend.worker.collectors.velocloud_inventory.httpx.AsyncClient",
                   _mock_async_client_cm(mock_client)):
            with patch("backend.worker.collectors.velocloud_inventory.db.execute",
                       AsyncMock()) as db_exec:
                outcome = await c.collect()

        assert outcome.status == "success"
        assert outcome.rows_written == 1

    @pytest.mark.asyncio
    async def test_collect_empty_edges(self):
        c = self._make_collector()
        resp_enterprise = _mock_response(200, {"id": 1})
        resp_edges = _mock_response(200, [])

        mock_client = AsyncMock()
        mock_client.post.side_effect = [resp_enterprise, resp_edges]

        with patch("backend.worker.collectors.velocloud_inventory.httpx.AsyncClient",
                   _mock_async_client_cm(mock_client)):
            outcome = await c.collect()

        assert outcome.status == "success"
        assert outcome.rows_written == 0

    @pytest.mark.asyncio
    async def test_collect_enterprise_api_fails_still_fetches_edges(self):
        c = self._make_collector()
        resp_enterprise = _mock_response(500, "error")
        resp_edges = _mock_response(200, [_make_edge_raw()])

        mock_client = AsyncMock()
        mock_client.post.side_effect = [resp_enterprise, resp_edges]

        with patch("backend.worker.collectors.velocloud_inventory.httpx.AsyncClient",
                   _mock_async_client_cm(mock_client)):
            with patch("backend.worker.collectors.velocloud_inventory.db.execute",
                       AsyncMock()):
                outcome = await c.collect()

        assert outcome.status == "success"

    @pytest.mark.asyncio
    async def test_collect_edges_api_fails_gracefully(self):
        """Fetch failures are handled internally; outcome is success with 0 rows."""
        c = self._make_collector()
        resp_enterprise = _mock_response(200, {"id": 1})
        resp_edges = _mock_response(500, "error")

        mock_client = AsyncMock()
        mock_client.post.side_effect = [resp_enterprise, resp_edges]

        with patch("backend.worker.collectors.velocloud_inventory.httpx.AsyncClient",
                   _mock_async_client_cm(mock_client)):
            outcome = await c.collect()

        assert outcome.status == "success"
        assert outcome.rows_written == 0

    @pytest.mark.asyncio
    async def test_collect_upsert_called(self):
        c = self._make_collector()
        edge_raw = _make_edge_raw()
        resp_enterprise = _mock_response(200, {"id": 1})
        resp_edges = _mock_response(200, [edge_raw])

        mock_client = AsyncMock()
        mock_client.post.side_effect = [resp_enterprise, resp_edges]

        with patch("backend.worker.collectors.velocloud_inventory.httpx.AsyncClient",
                   _mock_async_client_cm(mock_client)):
            with patch("backend.worker.collectors.velocloud_inventory.db.execute",
                       AsyncMock()) as db_exec:
                await c.collect()

        assert db_exec.called


# ======================================================================
# Section D-2: _build_rows
# ======================================================================

class TestBuildRows:

    def test_empty_edges(self):
        rows = _build_rows([])
        assert rows == []

    def test_single_connected_edge(self):
        rows = _build_rows([_make_edge_raw()])
        assert len(rows) == 1
        row = rows[0]
        assert row["connected"] is True
        assert row["reachability"] == "reachable"
        assert row["device_id"] == "vc-edge-logical-001"
        assert row["hostname"] == "sfo-edge-01"

    def test_degraded_edge(self):
        raw = _make_edge_raw({"edgeState": "DEGRADED"})
        row = _build_rows([raw])[0]
        assert row["connected"] is False
        assert row["reachability"] == "degraded"

    def test_offline_edge(self):
        raw = _make_edge_raw({"edgeState": "DISCONNECTED"})
        row = _build_rows([raw])[0]
        assert row["connected"] is False
        assert row["reachability"] == "unreachable"

    def test_unknown_edge_state(self):
        raw = _make_edge_raw({"edgeState": "UNKNOWN"})
        row = _build_rows([raw])[0]
        assert row["connected"] is False
        assert row["reachability"] == "unreachable"

    # ── props / recentLinks ──────────────────────────────────────────

    def test_build_rows_stores_recent_links_in_props(self):
        row = _build_rows([_make_edge_raw()])[0]
        assert "props" in row
        links = row["props"]["links"]
        assert len(links) == 2

    def test_props_links_have_required_fields(self):
        row = _build_rows([_make_edge_raw()])[0]
        links = row["props"]["links"]
        link = links[0]
        assert link["interface"] == "GE0/0"
        assert link["name"] == "Comcast Business"
        assert link["isp"] == "Comcast Business"
        assert link["public_ip"] == "203.0.113.10"
        assert link["state"] == "STABLE"
        assert link["internal_id"] == "int-001"
        assert link["upstream_mbps"] == 500
        assert link["downstream_mbps"] == 1000

    def test_props_links_empty_recent_links(self):
        raw = _make_edge_raw({"recentLinks": []})
        row = _build_rows([raw])[0]
        assert row["props"]["links"] == []

    def test_props_links_no_recent_links_key(self):
        raw = _make_edge_raw({"recentLinks": None})
        row = _build_rows([raw])[0]
        assert row["props"]["links"] == []

    def test_props_velobrain_score(self):
        row = _build_rows([_make_edge_raw()])[0]
        assert row["props"]["velobrain_score"] == 0.0

    def test_ip_address_from_first_link(self):
        raw = _make_edge_raw()
        row = _build_rows([raw])[0]
        assert row["ip_address"] == "203.0.113.10"

    def test_ip_address_empty_when_no_links(self):
        raw = _make_edge_raw({"recentLinks": []})
        row = _build_rows([raw])[0]
        assert row["ip_address"] == ""

    def test_ip_address_none_in_link(self):
        raw = _make_edge_raw({
            "recentLinks": [{"ipAddress": None, "displayName": "Test", "state": "STABLE"}]
        })
        row = _build_rows([raw])[0]
        assert row["ip_address"] == ""

    # ── Site name ────────────────────────────────────────────────────

    def test_site_name_with_city_country(self):
        row = _build_rows([_make_edge_raw()])[0]
        assert "San Francisco" in row["site_name"]
        assert "US" in row["site_name"]

    def test_site_name_with_city_only(self):
        raw = _make_edge_raw({"site": {"id": 101, "name": "SFO-DC", "city": "Austin", "country": ""}})
        row = _build_rows([raw])[0]
        assert "Austin" in row["site_name"]

    def test_site_name_fallback_to_id(self):
        raw = _make_edge_raw({
            "site": {"id": 101, "name": "", "city": "", "country": ""},
            "siteName": "",
        })
        row = _build_rows([raw])[0]
        assert row["site_id"] == "101"

    def test_model_number(self):
        row = _build_rows([_make_edge_raw()])[0]
        assert row["model"] == "520-EDGE"

    def test_model_fallback_to_device_family(self):
        raw = _make_edge_raw({"modelNumber": "", "deviceFamily": "520"})
        row = _build_rows([raw])[0]
        assert row["model"] == "520"

    def test_firmware_version(self):
        row = _build_rows([_make_edge_raw()])[0]
        assert row["firmware_version"] == "4.3.0-12345"

    def test_serial_number(self):
        row = _build_rows([_make_edge_raw()])[0]
        assert row["serial"] == "SN-ABC-123"

    def test_mac_from_activation_key(self):
        row = _build_rows([_make_edge_raw()])[0]
        assert row["mac"] == "ACT-KEY-001"

    def test_device_type_is_edge(self):
        row = _build_rows([_make_edge_raw()])[0]
        assert row["device_type"] == "edge"

    def test_multiple_edges(self):
        rows = _build_rows([
            _make_edge_raw({"id": 1, "logicalId": "vc-edge-A"}),
            _make_edge_raw({"id": 2, "logicalId": "vc-edge-B"}),
        ])
        assert len(rows) == 2
        assert rows[0]["device_id"] == "vc-edge-A"
        assert rows[1]["device_id"] == "vc-edge-B"

    def test_edge_with_no_id_fallback(self):
        raw = _make_edge_raw({})
        raw.pop("logicalId", None)
        raw.pop("id", None)
        row = _build_rows([raw])[0]
        assert row["device_id"].startswith("velo-")


# ======================================================================
# Section D-3: _upsert_inventory
# ======================================================================

class TestUpsertInventory:

    @pytest.mark.asyncio
    async def test_upsert_called_with_props(self):
        rows = [_make_edge_raw()]
        built = _build_rows(rows)
        assert "props" in built[0]

    @pytest.mark.asyncio
    async def test_upsert_props_includes_links_and_score(self):
        rows = [_build_rows([_make_edge_raw()])[0]]
        # Verify the data that would be sent to db.execute contains props
        assert "links" in rows[0]["props"]
        assert "velobrain_score" in rows[0]["props"]
        assert len(rows[0]["props"]["links"]) == 2

    @pytest.mark.asyncio
    async def test_upsert_executes_db_correctly(self):
        """Integration-style: patch db.execute and verify it's called
        with the right number of parameters."""
        row = _build_rows([_make_edge_raw()])[0]

        mock_db = AsyncMock()
        with patch("backend.worker.collectors.velocloud_inventory.db.execute", mock_db):
            await _upsert_inventory([row])

        mock_db.assert_called_once()
        args = mock_db.call_args[0]
        query = args[0]
        # Verify props is in the SQL
        assert "props" in query
        assert "$17::jsonb" in query
        # Verify 17 parameters (16 columns + $17 jsonb)
        params = args[1:]
        assert len(params) == 17
        assert "links" in params[-1]  # last param is json.dumps(props)
        assert "velobrain_score" in params[-1]

    @pytest.mark.asyncio
    async def test_upsert_empty_rows_does_nothing(self):
        mock_db = AsyncMock()
        with patch("backend.worker.collectors.velocloud_inventory.db.execute", mock_db):
            await _upsert_inventory([])
        mock_db.assert_not_called()

    @pytest.mark.asyncio
    async def test_upsert_called_for_each_row(self):
        rows = _build_rows([_make_edge_raw({"id": 1}), _make_edge_raw({"id": 2})])
        mock_db = AsyncMock()
        with patch("backend.worker.collectors.velocloud_inventory.db.execute", mock_db):
            await _upsert_inventory(rows)
        assert mock_db.call_count == 2

    @pytest.mark.asyncio
    async def test_upsert_sql_includes_props_in_update(self):
        """Verify the ON CONFLICT DO UPDATE SET includes props = EXCLUDED.props."""
        row = _build_rows([_make_edge_raw()])[0]
        mock_db = AsyncMock()
        with patch("backend.worker.collectors.velocloud_inventory.db.execute", mock_db):
            await _upsert_inventory([row])
        query = mock_db.call_args[0][0]
        assert "props            = EXCLUDED.props" in query

    @pytest.mark.asyncio
    async def test_upsert_param_count_matches_placeholders(self):
        row = _build_rows([_make_edge_raw()])[0]
        mock_db = AsyncMock()
        with patch("backend.worker.collectors.velocloud_inventory.db.execute", mock_db):
            await _upsert_inventory([row])
        query = mock_db.call_args[0][0]
        params = mock_db.call_args[0][1:]
        # Count $N placeholders
        import re
        max_param = max(int(m) for m in re.findall(r'\$(\d+)', query))
        assert len(params) == max_param, (
            f"Expected {max_param} params, got {len(params)}"
        )
