"""
Full-pipeline integration tests.

Exercises WorkerDaemon.run_once() with mocked external dependencies to
verify the end-to-end flow produces correct incidents in every mode:
  - Topology cascade (root-cause + symptoms)
  - Heuristic fallback (flat incident when topology absent)
  - Residual incidents (events unassigned by cascade)
  - Cross-cycle correlation (events across collection cycles)
  - Restart resilience (deterministic IDs prevent duplicates)
"""

from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from backend.shared.models.collector_outcome import CollectorOutcome
from backend.shared.models.event import (
    EventSeverity,
    EventSource,
    EventType,
    UnifiedEvent,
)
from backend.shared.models.incident import Incident, IncidentSeverity, IncidentStatus
from backend.tests.conftest import MockTopologyProvider, make_event


TEST_CASCADE_MAP = {"core-switch-01": ["ap-sfo-101", "ap-sfo-102", "ap-sfo-103"]}


def _make_events_for_cascade() -> List[UnifiedEvent]:
    now = datetime.now(timezone.utc)
    return [
        make_event(event_id="int-cascade-root",
            severity=EventSeverity.CRITICAL, event_type=EventType.LINK_DOWN,
            title="Core switch uplink down",
            device_id="core-switch-01", device_name="naxis-core-01",
            device_type="switch", site_id="site-sfo-01", site_name="SFO-01",
            timestamp=now),
        make_event(event_id="int-cascade-leaf-1",
            severity=EventSeverity.MAJOR, event_type=EventType.DEVICE_UNREACHABLE,
            title="AP-101 unreachable",
            device_id="ap-sfo-101", device_name="ap-101",
            device_type="ap", site_id="site-sfo-01", site_name="SFO-01",
            timestamp=now + timedelta(seconds=10)),
        make_event(event_id="int-cascade-leaf-2",
            severity=EventSeverity.MAJOR, event_type=EventType.DEVICE_UNREACHABLE,
            title="AP-102 unreachable",
            device_id="ap-sfo-102", device_name="ap-102",
            device_type="ap", site_id="site-sfo-01", site_name="SFO-01",
            timestamp=now + timedelta(seconds=15)),
        make_event(event_id="int-cascade-leaf-3",
            severity=EventSeverity.MAJOR, event_type=EventType.DEVICE_UNREACHABLE,
            title="AP-103 unreachable",
            device_id="ap-sfo-103", device_name="ap-103",
            device_type="ap", site_id="site-sfo-01", site_name="SFO-01",
            timestamp=now + timedelta(seconds=20)),
    ]


def _build_worker(events, cascade_map=None):
    """Create a WorkerDaemon with all deps mocked via direct module patching."""
    import worker.main as wm

    async def _collect(since=None):
        return CollectorOutcome(
            collector_id="mist-events", source_system="mist",
            status="success", events=events)

    wm.MistCollector = MagicMock()
    wm.MistCollector.return_value.collect = _collect

    wm.MistInventoryCollector = MagicMock()
    wm.MistInventoryCollector.return_value.collect = AsyncMock(
        return_value=CollectorOutcome(
            collector_id="mist-inventory", source_system="mist", events=[]))

    for name in ["DNACCollector", "MistTopologyCollector",
                 "VeloCloudCollector", "AristaWlcCollector"]:
        c = MagicMock()
        c.return_value.is_configured = False
        setattr(wm, name, c)

    wm.VelocloudInventoryCollector = MagicMock()
    wm.VelocloudInventoryCollector.return_value.collect = AsyncMock(
        return_value=CollectorOutcome(
            collector_id="velo-inventory", source_system="velocloud", events=[]))

    wm.TopologySync = MagicMock()
    wm.TopologySync.return_value.sync = AsyncMock()

    if cascade_map is not None:
        tp = MagicMock()
        tp.return_value = MockTopologyProvider(cascade_map)
        wm.DatabaseTopologyProvider = tp
    else:
        tp = MagicMock()
        tp.return_value.get_parent_child_map = AsyncMock(return_value={})
        wm.DatabaseTopologyProvider = tp

    wm.insert_events = AsyncMock()
    wm.upsert_incident = AsyncMock()
    wm.link_events_to_incident = AsyncMock()
    wm.record_worker_heartbeat = AsyncMock()
    wm.record_collector_run = AsyncMock()

    return wm.WorkerDaemon()


# ======================================================================
# Tests
# ======================================================================

@pytest.mark.asyncio
async def test_pipeline_produces_incidents_with_cascade():
    import worker.main as wm
    daemon = _build_worker(_make_events_for_cascade(),
                           cascade_map=TEST_CASCADE_MAP)
    wm.upsert_incident.reset_mock()
    await daemon.run_once()

    assert wm.upsert_incident.call_count >= 1
    for call_args in wm.upsert_incident.call_args_list:
        inc = call_args[0][0]
        assert inc.incident_id
        assert inc.title
        assert inc.severity.value in ("critical", "major", "minor", "warning", "info")
        assert inc.status.value == "open"
        assert len(inc.related_event_ids) >= 1
        assert 0.0 <= inc.confidence_score <= 1.0


@pytest.mark.asyncio
async def test_topology_cascade_root_cause_incident():
    import worker.main as wm
    daemon = _build_worker(_make_events_for_cascade(),
                           cascade_map=TEST_CASCADE_MAP)
    wm.upsert_incident.reset_mock()
    await daemon.run_once()

    assert wm.upsert_incident.call_count == 1, (
        f"Expected 1 cascade incident, got {wm.upsert_incident.call_count}")
    inc = wm.upsert_incident.call_args[0][0]
    title = inc.title.lower()
    assert "failure cascading" in title, (
        f"Cascade title should mention cascading: {title}")
    assert inc.severity == IncidentSeverity.CRITICAL
    assert "core-switch-01" in inc.affected_devices
    for leaf in ("ap-sfo-101", "ap-sfo-102", "ap-sfo-103"):
        assert leaf in inc.affected_devices, f"Symptom {leaf} missing"
    assert "site-sfo-01" in inc.affected_sites
    assert len(inc.related_event_ids) == 4


@pytest.mark.asyncio
async def test_heuristic_fallback_no_topology():
    import worker.main as wm
    now = datetime.now(timezone.utc)
    flat_events = [
        make_event(event_id="flat-1", severity=EventSeverity.CRITICAL,
            event_type=EventType.CLIENT_DISCONNECTED, title="Client surge",
            device_id="ap-site-01", device_name="ap-01",
            device_type="ap", site_id="site-a", site_name="Site-A",
            timestamp=now),
        make_event(event_id="flat-2", severity=EventSeverity.MAJOR,
            event_type=EventType.DEVICE_UNREACHABLE, title="AP unreachable",
            device_id="ap-site-02", device_name="ap-02",
            device_type="ap", site_id="site-a", site_name="Site-A",
            timestamp=now + timedelta(seconds=30)),
    ]
    daemon = _build_worker(flat_events, cascade_map=None)
    wm.upsert_incident.reset_mock()
    await daemon.run_once()

    inc = wm.upsert_incident.call_args[0][0]
    assert "failure cascading" not in inc.title.lower()
    assert len(inc.related_event_ids) == 2
    assert "site-a" in inc.affected_sites


@pytest.mark.asyncio
async def test_residual_incident_for_unassigned_events():
    import worker.main as wm
    cascade_events = _make_events_for_cascade()
    orphan = make_event(event_id="int-orphan",
        severity=EventSeverity.CRITICAL, event_type=EventType.DEVICE_UNREACHABLE,
        title="Unmanaged device down",
        device_id="unknown-device-99", device_name="unknown-99",
        device_type="sensor", site_id="site-sfo-01", site_name="SFO-01",
        timestamp=datetime.now(timezone.utc) + timedelta(seconds=30))

    daemon = _build_worker(cascade_events + [orphan],
                           cascade_map=TEST_CASCADE_MAP)
    wm.upsert_incident.reset_mock()
    await daemon.run_once()

    upserted = [call[0][0] for call in wm.upsert_incident.call_args_list]
    cascade_inc = [i for i in upserted if "failure cascading" in i.title.lower()]
    residual_inc = [i for i in upserted if "failure cascading" not in i.title.lower()]
    assert len(cascade_inc) == 1, f"Expected 1 cascade, got {len(cascade_inc)}"
    assert len(residual_inc) == 1, f"Expected 1 residual, got {len(residual_inc)}"
    assert "int-orphan" in residual_inc[0].related_event_ids
    assert "unknown-device-99" in residual_inc[0].affected_devices


@pytest.mark.asyncio
async def test_cross_cycle_correlation():
    import worker.main as wm
    now = datetime.now(timezone.utc)
    b1 = [
        make_event(event_id="cross-a", severity=EventSeverity.CRITICAL,
            event_type=EventType.LINK_DOWN, title="WAN down",
            device_id="edge-sfo-01", device_name="edge-sfo-01",
            device_type="wan_edge", site_id="site-sfo-01", site_name="SFO-01",
            timestamp=now),
        make_event(event_id="cross-b", severity=EventSeverity.MAJOR,
            event_type=EventType.HIGH_LATENCY, title="High latency",
            device_id="edge-sfo-01", device_name="edge-sfo-01",
            device_type="wan_edge", site_id="site-sfo-01", site_name="SFO-01",
            timestamp=now + timedelta(seconds=30)),
    ]
    b2 = [
        make_event(event_id="cross-c", severity=EventSeverity.MAJOR,
            event_type=EventType.CLIENT_DISCONNECTED, title="Client disconnects",
            device_id="ap-sfo-01", device_name="ap-sfo-01",
            device_type="ap", site_id="site-sfo-01", site_name="SFO-01",
            timestamp=now + timedelta(seconds=60)),
    ]

    daemon = _build_worker(b1, cascade_map=None)
    wm.upsert_incident.reset_mock()

    async def mock_fetch(ws, limit=5000):
        return b1 + b2

    import worker.main as wm_module
    orig_fetch = daemon._correlation_engine._fetch_unlinked_events
    daemon._correlation_engine._fetch_unlinked_events = mock_fetch
    await daemon.run_once()
    daemon._correlation_engine._fetch_unlinked_events = orig_fetch

    assert wm.upsert_incident.call_count == 1, (
        f"Expected 1 incident, got {wm.upsert_incident.call_count}")
    inc = wm.upsert_incident.call_args[0][0]
    for eid in ("cross-a", "cross-b", "cross-c"):
        assert eid in inc.related_event_ids, f"Missing {eid}"
    assert "site-sfo-01" in inc.affected_sites
    assert "edge-sfo-01" in inc.affected_devices
    assert "ap-sfo-01" in inc.affected_devices


@pytest.mark.asyncio
async def test_deterministic_incident_ids():
    import worker.main as wm
    events = _make_events_for_cascade()

    daemon_a = _build_worker(events, cascade_map=TEST_CASCADE_MAP)
    wm.upsert_incident.reset_mock()
    await daemon_a.run_once()
    inc_a = wm.upsert_incident.call_args[0][0]

    daemon_b = _build_worker(events, cascade_map=TEST_CASCADE_MAP)
    wm.upsert_incident.reset_mock()
    await daemon_b.run_once()
    inc_b = wm.upsert_incident.call_args[0][0]

    assert inc_a.incident_id == inc_b.incident_id, (
        f"ID mismatch: {inc_a.incident_id} vs {inc_b.incident_id}")


@pytest.mark.asyncio
async def test_pipeline_does_not_duplicate_processed_events():
    import worker.main as wm
    daemon = _build_worker(_make_events_for_cascade(), cascade_map=None)
    wm.upsert_incident.reset_mock()

    upserted: List[Incident] = []
    async def cap(i):
        upserted.append(i)
    wm.upsert_incident.side_effect = cap

    await daemon.run_once()
    first = len(upserted)
    await daemon.run_once()

    assert len(upserted) == first, (
        f"Second cycle created {len(upserted) - first} extra incidents")


# ======================================================================
# Redis pub/sub integration tests
# ======================================================================

@pytest.mark.asyncio
async def test_pipeline_publishes_incidents_to_redis_when_enabled():
    """Worker publishes incidents to Redis when redis_enabled=True."""
    import worker.main as wm

    # Enable Redis at the worker module level
    mock_redis_client = AsyncMock()
    mock_redis_client.publish_incident = AsyncMock()
    mock_redis_client.warm_up = AsyncMock(return_value=True)

    with patch.object(wm._settings, "redis_enabled", True):
        with patch("worker.main.get_redis_client", return_value=mock_redis_client):
            daemon = _build_worker(_make_events_for_cascade(),
                                   cascade_map=TEST_CASCADE_MAP)
            wm.upsert_incident.reset_mock()
            mock_redis_client.publish_incident.reset_mock()

            await daemon.run_once()

            # Should have published each incident to Redis
            assert mock_redis_client.publish_incident.call_count == wm.upsert_incident.call_count
            for call_args in mock_redis_client.publish_incident.call_args_list:
                payload = call_args[0][0]
                assert "incident_id" in payload
                assert "title" in payload
                assert "severity" in payload


@pytest.mark.asyncio
async def test_pipeline_does_not_publish_when_redis_disabled():
    """Worker skips Redis publishing when redis_enabled=False (default)."""
    import worker.main as wm
    daemon = _build_worker(_make_events_for_cascade(),
                           cascade_map=TEST_CASCADE_MAP)
    wm.upsert_incident.reset_mock()

    assert daemon._redis_client is None
    # No Redis client should be created — no side effects to check beyond
    # the reference being None, which proves the guard works.


# ======================================================================
# VeloCloud-enabled pipeline tests
# ======================================================================

def _build_worker_with_velo(events, cascade_map=None):
    """Create a WorkerDaemon with VeloCloud collectors enabled."""
    import worker.main as wm

    async def _collect(since=None):
        return CollectorOutcome(
            collector_id="mist-events", source_system="mist",
            status="success", events=events)

    wm.MistCollector = MagicMock()
    wm.MistCollector.return_value.collect = _collect

    wm.MistInventoryCollector = MagicMock()
    wm.MistInventoryCollector.return_value.collect = AsyncMock(
        return_value=CollectorOutcome(
            collector_id="mist-inventory", source_system="mist", events=[]))

    for name in ["DNACCollector", "MistTopologyCollector",
                 "AristaWlcCollector"]:
        c = MagicMock()
        c.return_value.is_configured = False
        setattr(wm, name, c)

    # VeloCloud enabled with mock outcomes
    vc_outcomes = [
        CollectorOutcome(
            collector_id="velocloud-edges", source_system="velocloud",
            status="success", events=[], rows_written=1),
        CollectorOutcome(
            collector_id="velocloud-events", source_system="velocloud",
            status="success", events=[], rows_written=0),
        CollectorOutcome(
            collector_id="velocloud-links", source_system="velocloud",
            status="skipped"),
        CollectorOutcome(
            collector_id="velocloud-tunnels", source_system="velocloud",
            status="skipped"),
        CollectorOutcome(
            collector_id="velocloud-apps", source_system="velocloud",
            status="skipped"),
    ]

    vc_collector = MagicMock()
    vc_collector.return_value.is_configured = True
    vc_collector.return_value.collect_all = AsyncMock(return_value=vc_outcomes)
    wm.VeloCloudCollector = vc_collector

    wm.VelocloudInventoryCollector = MagicMock()
    wm.VelocloudInventoryCollector.return_value.collect = AsyncMock(
        return_value=CollectorOutcome(
            collector_id="velo-inventory", source_system="velocloud",
            status="success", events=[], rows_written=2))

    wm.TopologySync = MagicMock()
    wm.TopologySync.return_value.sync = AsyncMock()

    if cascade_map is not None:
        tp = MagicMock()
        tp.return_value = MockTopologyProvider(cascade_map)
        wm.DatabaseTopologyProvider = tp
    else:
        tp = MagicMock()
        tp.return_value.get_parent_child_map = AsyncMock(return_value={})
        wm.DatabaseTopologyProvider = tp

    wm.insert_events = AsyncMock()
    wm.upsert_incident = AsyncMock()
    wm.link_events_to_incident = AsyncMock()
    wm.record_worker_heartbeat = AsyncMock()
    wm.record_collector_run = AsyncMock()

    return wm.WorkerDaemon()


@pytest.mark.asyncio
async def test_pipeline_velocloud_enabled_collects_outcomes():
    """Worker produces outcomes when VeloCloud is enabled."""
    daemon = _build_worker_with_velo([])
    import worker.main as wm
    wm.record_collector_run.reset_mock()
    await daemon.run_once()
    # VeloCloud outcomes should have been recorded
    velo_calls = [
        c for c in wm.record_collector_run.call_args_list
        if c[0][0].source_system == "velocloud"
    ]
    assert len(velo_calls) >= 1


@pytest.mark.asyncio
async def test_pipeline_velocloud_api_failure_nonfatal():
    """VeloCloud failure does not crash the pipeline."""
    import worker.main as wm

    async def _collect(since=None):
        return CollectorOutcome(
            collector_id="mist-events", source_system="mist",
            status="success", events=_make_events_for_cascade())

    wm.MistCollector = MagicMock()
    wm.MistCollector.return_value.collect = _collect

    wm.MistInventoryCollector = MagicMock()
    wm.MistInventoryCollector.return_value.collect = AsyncMock(
        return_value=CollectorOutcome(
            collector_id="mist-inventory", source_system="mist", events=[]))

    for name in ["DNACCollector", "MistTopologyCollector",
                 "AristaWlcCollector"]:
        c = MagicMock()
        c.return_value.is_configured = False
        setattr(wm, name, c)

    vc_collector = MagicMock()
    vc_collector.return_value.is_configured = True
    vc_collector.return_value.collect_all = AsyncMock(
        side_effect=Exception("VCO API unreachable"))
    wm.VeloCloudCollector = vc_collector

    wm.VelocloudInventoryCollector = MagicMock()
    wm.VelocloudInventoryCollector.return_value.collect = AsyncMock(
        return_value=CollectorOutcome(
            collector_id="velo-inventory", source_system="velocloud",
            events=[]))

    wm.TopologySync = MagicMock()
    wm.TopologySync.return_value.sync = AsyncMock()

    tp = MagicMock()
    tp.return_value.get_parent_child_map = AsyncMock(return_value={})
    wm.DatabaseTopologyProvider = tp

    wm.insert_events = AsyncMock()
    wm.upsert_incident = AsyncMock()
    wm.link_events_to_incident = AsyncMock()
    wm.record_worker_heartbeat = AsyncMock()
    wm.record_collector_run = AsyncMock()

    daemon = wm.WorkerDaemon()
    wm.upsert_incident.reset_mock()

    try:
        await daemon.run_once()
    except Exception:
        pytest.fail("VeloCloud failure should not propagate")

    # Mist events should still produce incidents
    assert wm.upsert_incident.called, (
        "Incidents should still be created despite VeloCloud failure"
    )
