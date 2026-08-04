"""
Comprehensive tests for the Naxis Correlation Engine.

Tests cover:
- Stage 1: CorrelationEngine.process_events() — site+time-window grouping
- Stage 2: TopologyCascadeRule — infrastructure-aware cascade
- Stage 2 full pipeline: engine with topology provider
- Incident model — construction, blast radius, lifecycle
- Correlation rules — site-time-window, confidence, title generation
- Cross-vendor correlation — Mist + VeloCloud + DNAC
- Edge cases — empty, dedup, time window boundaries, severity thresholds
"""

import math
from collections import Counter
from datetime import datetime, timedelta
from typing import Dict, List, Set

import pytest

from backend.shared.correlation import (
    CascadeGroup,
    CorrelationEngine,
    TopologyCascadeRule,
    TopologyProvider,
    correlate_events,
)
from backend.shared.correlation.rules import (
    CorrelationConfig,
    SiteTimeWindowRule,
    calculate_confidence_score,
    generate_incident_title,
    group_events_by_site_and_time,
)
from backend.shared.models.event import (
    EventCategory,
    EventSeverity,
    EventSource,
    EventType,
    UnifiedEvent,
)
from backend.shared.models.incident import (
    Incident,
    IncidentSeverity,
    IncidentStatus,
)
from backend.tests.conftest import MockTopologyProvider, make_event

# ==============================================================================
# Stage 1: CorrelationEngine.process_events() — Integration Tests
# ==============================================================================


class TestCorrelationEngineProcessEvents:
    """Tests for the main correlation engine entry point (Stage 1)."""

    @pytest.mark.asyncio
    async def test_empty_events_returns_empty_list(self, default_config):
        engine = CorrelationEngine(config=default_config)
        incidents = await engine.process_events([])
        assert incidents == []

    @pytest.mark.asyncio
    async def test_single_critical_event_creates_incident(self, single_critical_config, site_sfo_events):
        engine = CorrelationEngine(config=single_critical_config)
        events = [site_sfo_events[0]]
        incidents = await engine.process_events(events)
        assert len(incidents) == 1
        i = incidents[0]
        assert i.severity == IncidentSeverity.CRITICAL
        assert i.status == IncidentStatus.OPEN
        assert "sfo-evt-1" in i.related_event_ids
        assert i.confidence_score > 0

    @pytest.mark.asyncio
    async def test_multiple_events_same_site_one_incident(self, default_config, site_sfo_events):
        engine = CorrelationEngine(config=default_config)
        incidents = await engine.process_events(site_sfo_events)
        assert len(incidents) == 1
        i = incidents[0]
        assert len(i.related_event_ids) == 3
        assert "SFO-01" in i.title or "SFO" in i.title
        assert "site-sfo-01" in i.affected_sites

    @pytest.mark.asyncio
    async def test_events_at_different_sites_separate_incidents(self, default_config, multi_site_events):
        engine = CorrelationEngine(config=default_config)
        incidents = await engine.process_events(multi_site_events)
        assert len(incidents) == 2

        site_ids = set()
        for inc in incidents:
            for sid in inc.affected_sites:
                site_ids.add(sid)
        assert site_ids == {"site-sfo-01", "site-nyc-01"}

    @pytest.mark.asyncio
    async def test_duplicate_events_are_skipped(self, default_config, site_sfo_events):
        engine = CorrelationEngine(config=default_config)
        incidents1 = await engine.process_events(site_sfo_events)
        assert len(incidents1) == 1
        incidents2 = await engine.process_events(site_sfo_events)
        assert len(incidents2) == 0

    @pytest.mark.asyncio
    async def test_reset_clears_processed_cache(self, default_config, site_sfo_events):
        engine = CorrelationEngine(config=default_config)
        await engine.process_events(site_sfo_events)
        assert engine.get_processed_count() == 3
        engine.reset()
        assert engine.get_processed_count() == 0
        incidents = await engine.process_events(site_sfo_events)
        assert len(incidents) == 1

    @pytest.mark.asyncio
    async def test_info_only_events_no_incidents(self, default_config, info_only_events):
        engine = CorrelationEngine(config=default_config)
        incidents = await engine.process_events(info_only_events)
        assert len(incidents) == 0

    @pytest.mark.asyncio
    async def test_low_severity_events_filtered(self, default_config):
        engine = CorrelationEngine(config=default_config)
        now = datetime.utcnow()
        events = [
            make_event("evt-1", severity=EventSeverity.WARNING, timestamp=now),
            make_event("evt-2", severity=EventSeverity.INFO, timestamp=now + timedelta(seconds=30)),
        ]
        incidents = await engine.process_events(events)
        assert len(incidents) == 0

    @pytest.mark.asyncio
    async def test_single_critical_creates_incident(self, single_critical_config):
        engine = CorrelationEngine(config=single_critical_config)
        now = datetime.utcnow()
        event = make_event("evt-crit", severity=EventSeverity.CRITICAL, timestamp=now)
        incidents = await engine.process_events([event])
        assert len(incidents) == 1
        assert incidents[0].severity == IncidentSeverity.CRITICAL

    @pytest.mark.asyncio
    async def test_cross_vendor_correlation(self, default_config, cross_vendor_events):
        """Mist + VeloCloud + DNAC events at the same site become one incident."""
        engine = CorrelationEngine(config=default_config)
        incidents = await engine.process_events(cross_vendor_events)
        assert len(incidents) == 1
        i = incidents[0]
        assert len(i.related_event_ids) == 3
        assert len(i.affected_devices) == 3

    @pytest.mark.asyncio
    async def test_time_window_boundary(self, tight_window_config):
        """Events outside the time window should not be grouped."""
        engine = CorrelationEngine(config=tight_window_config)
        now = datetime.utcnow()
        events = [
            make_event("evt-early", severity=EventSeverity.MAJOR, site_id="site-a", timestamp=now),
            make_event("evt-late", severity=EventSeverity.MAJOR, site_id="site-a",
                       timestamp=now + timedelta(seconds=30)),
        ]
        incidents = await engine.process_events(events)
        assert len(incidents) == 0

    @pytest.mark.asyncio
    async def test_time_window_inclusive(self, default_config):
        """Events exactly at the window boundary should be grouped."""
        engine = CorrelationEngine(config=CorrelationConfig(time_window_seconds=60))
        now = datetime.utcnow()
        events = [
            make_event("evt-1", severity=EventSeverity.MAJOR, site_id="site-a", timestamp=now),
            make_event("evt-2", severity=EventSeverity.MAJOR, site_id="site-a",
                       timestamp=now + timedelta(seconds=60)),
        ]
        incidents = await engine.process_events(events)
        assert len(incidents) == 1

    @pytest.mark.asyncio
    async def test_blast_radius_populated_correctly(self, default_config, events_with_clients):
        """Verify affected_sites, affected_devices, affected_clients."""
        engine = CorrelationEngine(config=default_config)
        incidents = await engine.process_events(events_with_clients)
        assert len(incidents) == 1
        i = incidents[0]
        assert i.affected_sites == ["site-sfo-01"]
        assert sorted(i.affected_devices) == ["ap-sfo-01", "ap-sfo-02"]
        assert sorted(i.affected_clients) == ["client-001", "client-002", "client-003"]

    @pytest.mark.asyncio
    async def test_confidence_score_calculation(self, default_config, site_sfo_events):
        """Confidence should be a float in [0, 1] with breakdown."""
        engine = CorrelationEngine(config=default_config)
        incidents = await engine.process_events(site_sfo_events)
        assert len(incidents) == 1
        i = incidents[0]
        assert 0.0 <= i.confidence_score <= 1.0
        assert i.confidence_score > 0.5
        assert i.confidence_breakdown is not None
        assert i.confidence_breakdown["total"] == pytest.approx(i.confidence_score, rel=1e-3)

    @pytest.mark.asyncio
    async def test_incident_title_generated(self, default_config, site_sfo_events):
        """Title should be descriptive and human-readable."""
        engine = CorrelationEngine(config=default_config)
        incidents = await engine.process_events(site_sfo_events)
        title = incidents[0].title
        assert "SFO-01" in title
        assert "link down" in title or "degraded" in title

    @pytest.mark.asyncio
    async def test_severity_determination_highest_wins(self, default_config):
        """Incident severity should be the highest severity among its events."""
        engine = CorrelationEngine(config=default_config)
        now = datetime.utcnow()
        events = [
            make_event("evt-1", severity=EventSeverity.MINOR, timestamp=now, site_id="site-a"),
            make_event("evt-2", severity=EventSeverity.MAJOR, timestamp=now + timedelta(seconds=10), site_id="site-a"),
            make_event("evt-3", severity=EventSeverity.CRITICAL, timestamp=now + timedelta(seconds=20), site_id="site-a"),
        ]
        incidents = await engine.process_events(events)
        assert len(incidents) == 1
        assert incidents[0].severity == IncidentSeverity.CRITICAL

    @pytest.mark.asyncio
    async def test_correlate_site_events_filters_by_site(self, default_config, multi_site_events):
        """correlate_site_events should only process events for one site."""
        engine = CorrelationEngine(config=default_config)
        incidents = await engine.correlate_site_events(multi_site_events, "site-sfo-01")
        assert len(incidents) == 1
        assert incidents[0].affected_sites == ["site-sfo-01"]

    def test_group_by_site(self, default_config, multi_site_events):
        """group_by_site should partition events correctly."""
        engine = CorrelationEngine(config=default_config)
        groups = engine.group_by_site(multi_site_events)
        assert set(groups.keys()) == {"site-sfo-01", "site-nyc-01", "site-lax-01"}
        assert len(groups["site-sfo-01"]) == 1
        assert len(groups["site-nyc-01"]) == 1
        assert len(groups["site-lax-01"]) == 1

    @pytest.mark.asyncio
    async def test_convenience_correlate_events(self, default_config, site_sfo_events):
        """correlate_events() convenience function should work."""
        incidents = await correlate_events(site_sfo_events, default_config)
        assert len(incidents) >= 1

    @pytest.mark.asyncio
    async def test_large_event_batch(self, default_config):
        """Should handle hundreds of events efficiently."""
        engine = CorrelationEngine(config=default_config)
        now = datetime.utcnow()
        events = []
        sites = ["site-a", "site-b", "site-c", "site-d", "site-e"]
        for i in range(500):
            site = sites[i % len(sites)]
            events.append(
                make_event(
                    event_id=f"batch-evt-{i}",
                    severity=EventSeverity.MAJOR,
                    site_id=site,
                    timestamp=now + timedelta(seconds=i * 2),
                )
            )
        incidents = await engine.process_events(events)
        assert len(incidents) > 0
        assert engine.get_processed_count() == 500


# ==============================================================================
# Stage 2: TopologyCascadeRule — Unit Tests
# ==============================================================================


class TestTopologyCascadeRuleUnit:
    """Unit tests for TopologyCascadeRule in isolation."""

    @pytest.mark.asyncio
    async def test_cascade_identifies_root_and_symptoms(self, cascade_events_same_site, mock_topology_provider):
        """Switch failure + 3 AP failures → 1 cascade group."""
        rule = TopologyCascadeRule(
            provider=mock_topology_provider,
            config=CorrelationConfig(topology_cascade_enabled=True),
        )
        groups = await rule.evaluate(cascade_events_same_site)
        assert len(groups) == 1
        group = groups[0]
        assert group.root_device_id == "core-switch-01"
        assert len(group.root_events) == 1
        assert group.root_events[0].event_id == "cascade-root-1"
        assert len(group.symptom_events) == 3
        symptom_ids = {e.event_id for e in group.symptom_events}
        assert symptom_ids == {"cascade-leaf-1", "cascade-leaf-2", "cascade-leaf-3"}

    @pytest.mark.asyncio
    async def test_cascade_multi_infra_separate_groups(self, cascade_events_multi_infra, mock_topology_provider):
        """Two infra devices with separate leaves → 2 cascade groups."""
        rule = TopologyCascadeRule(
            provider=mock_topology_provider,
            config=CorrelationConfig(topology_cascade_enabled=True),
        )
        groups = await rule.evaluate(cascade_events_multi_infra)
        assert len(groups) == 2

        group_map: Dict[str, CascadeGroup] = {g.root_device_id: g for g in groups}
        assert "core-switch-A" in group_map
        assert "edge-nyc-B" in group_map

        # Switch A has 2 leaf APs
        assert len(group_map["core-switch-A"].symptom_events) == 2
        # Edge B has 1 leaf AP
        assert len(group_map["edge-nyc-B"].symptom_events) == 1

    @pytest.mark.asyncio
    async def test_cascade_no_infra_no_groups(self, cascade_events_no_infra, mock_topology_provider):
        """Only leaf events → no cascade groups."""
        rule = TopologyCascadeRule(
            provider=mock_topology_provider,
            config=CorrelationConfig(topology_cascade_enabled=True),
        )
        groups = await rule.evaluate(cascade_events_no_infra)
        assert len(groups) == 0

    @pytest.mark.asyncio
    async def test_cascade_empty_events(self, mock_topology_provider):
        """Empty events → no cascade groups."""
        rule = TopologyCascadeRule(
            provider=mock_topology_provider,
            config=CorrelationConfig(topology_cascade_enabled=True),
        )
        groups = await rule.evaluate([])
        assert len(groups) == 0

    @pytest.mark.asyncio
    async def test_cascade_no_provider_returns_empty(self, cascade_events_same_site):
        """Without a provider, no cascade groups — topology is the only source of truth."""
        rule = TopologyCascadeRule(
            provider=None,
            config=CorrelationConfig(
                topology_cascade_enabled=True,
            ),
        )
        groups = await rule.evaluate(cascade_events_same_site)
        assert groups == []

    @pytest.mark.asyncio
    async def test_cascade_provider_no_match_returns_empty(self):
        """When provider has no matching topology, returns empty."""
        provider = MockTopologyProvider({})
        rule = TopologyCascadeRule(
            provider=provider,
            config=CorrelationConfig(topology_cascade_enabled=True),
        )
        now = datetime.utcnow()
        events = [
            make_event("evt-1", severity=EventSeverity.CRITICAL, device_id="unknown-device",
                      device_type="switch", site_id="site-x", timestamp=now),
            make_event("evt-2", severity=EventSeverity.MAJOR, device_id="ap-unknown",
                      device_type="ap", site_id="site-x",
                      timestamp=now + timedelta(seconds=10)),
        ]
        groups = await rule.evaluate(events)
        # Provider returns no matches — no cascade groups without topology data
        assert groups == []

    def test_separate_by_device_type(self):
        """_separate_by_device_type correctly categorises infrastructure vs leaf."""
        rule = TopologyCascadeRule(
            config=CorrelationConfig(topology_cascade_enabled=True),
        )
        now = datetime.utcnow()
        infra_event = make_event("infra-1", severity=EventSeverity.CRITICAL,
                                device_id="sw-01", device_type="switch",
                                timestamp=now)
        leaf_event = make_event("leaf-1", severity=EventSeverity.MAJOR,
                               device_id="ap-01", device_type="ap",
                               timestamp=now)
        unknown_event = make_event("unk-1", severity=EventSeverity.INFO,
                                  device_id="xyz-01", device_type="unknown",
                                  timestamp=now)
        infra, leaf = rule._separate_by_device_type([infra_event, leaf_event, unknown_event])
        assert len(infra) == 1
        assert infra[0].event_id == "infra-1"
        assert len(leaf) == 2  # leaf + unknown


# ==============================================================================
# Stage 2: CorrelationEngine with Topology Provider — Integration Tests
# ==============================================================================


class TestCorrelationEngineStage2:
    """Full pipeline tests: Stage 1 + Stage 2 with topology provider."""

    @pytest.mark.asyncio
    async def test_cascade_produces_root_incident_with_symptoms(
        self, cascade_events_same_site, mock_topology_provider, topology_aware_config
    ):
        """Cascading failure → 1 root incident, symptoms linked."""
        engine = CorrelationEngine(
            config=topology_aware_config,
            topology_provider=mock_topology_provider,
        )
        incidents = await engine.process_events(cascade_events_same_site)
        assert len(incidents) == 1
        i = incidents[0]

        # Root cause event + 3 symptom events
        assert len(i.related_event_ids) == 4
        assert "cascade-root-1" in i.related_event_ids
        assert "cascade-leaf-1" in i.related_event_ids
        assert "cascade-leaf-2" in i.related_event_ids
        assert "cascade-leaf-3" in i.related_event_ids

        # Severity should be CRITICAL (from root event)
        assert i.severity == IncidentSeverity.CRITICAL

        # Title names the root cause with plain language + blast radius
        assert "SFO-01" in i.title
        assert "naxis-core-01" in i.title
        assert "link down" in i.title
        assert "4 devices affected" in i.title

        # Blast radius includes all devices
        assert "core-switch-01" in i.affected_devices
        assert "ap-sfo-101" in i.affected_devices

        # Root cause / symptom split
        assert "core-switch-01" in i.root_device_ids
        assert len(i.root_device_ids) == 1
        for leaf in ("ap-sfo-101", "ap-sfo-102", "ap-sfo-103"):
            assert leaf in i.symptom_device_ids
        assert len(i.symptom_device_ids) == 3

        # Confidence breakdown stored
        assert i.confidence_breakdown is not None
        for key in ("event_score", "avg_severity", "device_score", "total"):
            assert key in i.confidence_breakdown
            assert isinstance(i.confidence_breakdown[key], float)

    @pytest.mark.asyncio
    async def test_cascade_multi_infra_produces_separate_incidents(
        self, cascade_events_multi_infra, mock_topology_provider, topology_aware_config
    ):
        """Two failing infra devices → 2 separate incidents."""
        engine = CorrelationEngine(
            config=topology_aware_config,
            topology_provider=mock_topology_provider,
        )
        incidents = await engine.process_events(cascade_events_multi_infra)
        assert len(incidents) == 2

        incident_map: Dict[str, Incident] = {}
        for inc in incidents:
            for dev in inc.affected_devices:
                if dev.startswith("core-switch-A") or dev == "ap-nyc-A1":
                    incident_map["switch-A"] = inc
                elif dev.startswith("edge-nyc-B") or dev == "ap-nyc-B1":
                    incident_map["edge-B"] = inc

        # Each incident should have its own root + symptoms
        if "switch-A" in incident_map:
            inc_a = incident_map["switch-A"]
            assert any("A" in d for d in inc_a.affected_devices)
        if "edge-B" in incident_map:
            inc_b = incident_map["edge-B"]
            assert any("B" in d for d in inc_b.affected_devices)

    @pytest.mark.asyncio
    async def test_cascade_no_infra_falls_back_to_stage1(
        self, cascade_events_no_infra, mock_topology_provider, topology_aware_config
    ):
        """No infra events → falls back to Stage 1 flat incident."""
        engine = CorrelationEngine(
            config=topology_aware_config,
            topology_provider=mock_topology_provider,
        )
        incidents = await engine.process_events(cascade_events_no_infra)
        assert len(incidents) == 1
        i = incidents[0]
        assert len(i.related_event_ids) == 2
        assert "leaf-only-1" in i.related_event_ids

    @pytest.mark.asyncio
    async def test_cascade_deduplicates_across_cycles(
        self, cascade_events_same_site, mock_topology_provider, topology_aware_config
    ):
        """Processed events should be skipped on subsequent cycles."""
        engine = CorrelationEngine(
            config=topology_aware_config,
            topology_provider=mock_topology_provider,
        )
        incidents1 = await engine.process_events(cascade_events_same_site)
        assert len(incidents1) == 1

        incidents2 = await engine.process_events(cascade_events_same_site)
        assert len(incidents2) == 0

    @pytest.mark.asyncio
    async def test_cascade_confidence_score(
        self, cascade_events_same_site, mock_topology_provider, topology_aware_config
    ):
        """Confidence should be high with many correlated events."""
        engine = CorrelationEngine(
            config=topology_aware_config,
            topology_provider=mock_topology_provider,
        )
        incidents = await engine.process_events(cascade_events_same_site)
        assert len(incidents) == 1
        i = incidents[0]
        assert i.confidence_score > 0.5
        assert i.confidence_breakdown is not None
        assert i.confidence_breakdown["total"] == pytest.approx(i.confidence_score, rel=1e-3)

    @pytest.mark.asyncio
    async def test_cascade_preserves_stage1_when_no_topology(
        self, cascade_events_same_site, topology_aware_config
    ):
        """
        Without a topology provider, cascade returns empty and the engine
        falls back to Stage 1 — flat incident with all group events.
        """
        engine = CorrelationEngine(
            config=topology_aware_config,
            topology_provider=None,
        )
        incidents = await engine.process_events(cascade_events_same_site)
        # Stage 1 flat incident containing all events
        assert len(incidents) == 1
        assert len(incidents[0].related_event_ids) == 4

    @pytest.mark.asyncio
    async def test_cascade_disabled_uses_stage1_only(
        self, cascade_events_same_site, mock_topology_provider
    ):
        """When cascade is disabled, events stay in a single flat group."""
        config = CorrelationConfig(topology_cascade_enabled=False)
        engine = CorrelationEngine(
            config=config,
            topology_provider=mock_topology_provider,
        )
        incidents = await engine.process_events(cascade_events_same_site)
        assert len(incidents) >= 1

    @pytest.mark.asyncio
    async def test_normal_events_still_work_with_topology_enabled(
        self, site_sfo_events, mock_topology_provider, topology_aware_config
    ):
        """
        Regression: existing Stage 1 tests should still pass even when
        topology cascade is enabled but no infra→leaf relationships exist.
        """
        engine = CorrelationEngine(
            config=topology_aware_config,
            topology_provider=mock_topology_provider,
        )
        incidents = await engine.process_events(site_sfo_events)
        assert len(incidents) >= 1
        i = incidents[0]
        assert len(i.related_event_ids) == 3
        assert i.confidence_score > 0
        # Flat incident (no cascade) — root is the highest-severity device
        assert i.root_device_ids == ["edge-sfo-01"]
        assert i.symptom_device_ids == []
        assert i.confidence_breakdown is not None
        assert i.confidence_breakdown["total"] == pytest.approx(i.confidence_score, rel=1e-3)
        assert "SFO-01" in i.title

    @pytest.mark.asyncio
    async def test_cross_vendor_with_cascade(
        self, cross_vendor_events, topology_aware_config
    ):
        """Cross-vendor events with topology cascade enabled but no provider — flat incident."""
        engine = CorrelationEngine(
            config=topology_aware_config,
            topology_provider=None,
        )
        incidents = await engine.process_events(cross_vendor_events)
        # All events at same site → flat Stage 1 incident
        assert len(incidents) == 1


# ==============================================================================
# CascadeGroup Model — Unit Tests
# ==============================================================================


class TestCascadeGroup:
    """Tests for the CascadeGroup data class."""

    def test_cascade_group_properties(self):
        now = datetime.utcnow()
        root_event = make_event("root-1", severity=EventSeverity.CRITICAL,
                               device_id="sw-01", device_type="switch",
                               timestamp=now)
        symptom1 = make_event("sym-1", severity=EventSeverity.MAJOR,
                             device_id="ap-01", device_type="ap",
                             timestamp=now + timedelta(seconds=10))
        symptom2 = make_event("sym-2", severity=EventSeverity.MAJOR,
                             device_id="ap-02", device_type="ap",
                             timestamp=now + timedelta(seconds=20))
        group = CascadeGroup(
            root_events=[root_event],
            symptom_events=[symptom1, symptom2],
            root_device_id="sw-01",
        )
        assert group.total_events == 3
        assert len(group.all_event_ids()) == 3
        assert "root-1" in group.all_event_ids()
        assert group.all_device_ids() == {"sw-01", "ap-01", "ap-02"}


# ==============================================================================
# Incident Model — Unit Tests
# ==============================================================================


class TestIncidentModel:
    """Tests for the Incident Pydantic model."""

    def test_create_incident(self):
        incident = Incident(
            title="Test incident",
            severity=IncidentSeverity.MAJOR,
        )
        assert incident.incident_id.startswith("inc-")
        assert incident.status == IncidentStatus.OPEN
        assert incident.event_count() == 0
        assert incident.confidence_score == 0.0
        assert incident.probable_cause is None

    def test_add_event_updates_blast_radius(self):
        incident = Incident(
            title="Test incident",
            severity=IncidentSeverity.CRITICAL,
        )
        result = incident.add_event(
            "evt-001", device_id="dev-001", site_id="site-sfo-01", client_id="client-001",
        )
        assert result is True
        assert incident.related_event_ids == ["evt-001"]
        assert incident.affected_devices == ["dev-001"]
        assert incident.affected_sites == ["site-sfo-01"]
        assert incident.affected_clients == ["client-001"]

    def test_add_duplicate_event_skipped(self):
        incident = Incident(
            title="Test incident",
            severity=IncidentSeverity.MAJOR,
        )
        incident.add_event("evt-001", device_id="dev-001")
        result = incident.add_event("evt-001", device_id="dev-001")
        assert result is False
        assert len(incident.related_event_ids) == 1

    def test_terminal_status_rejects_new_events(self):
        incident = Incident(
            title="Test incident",
            severity=IncidentSeverity.MAJOR,
            status=IncidentStatus.RESOLVED,
        )
        result = incident.add_event("evt-002", device_id="dev-002")
        assert result is False
        assert len(incident.related_event_ids) == 0

    def test_update_confidence(self):
        incident = Incident(
            title="Test incident",
            severity=IncidentSeverity.MAJOR,
        )
        incident.update_confidence(0.85, probable_cause="BGP flap detected")
        assert incident.confidence_score == 0.85
        assert incident.probable_cause == "BGP flap detected"

    def test_confidence_clamped(self):
        incident = Incident(
            title="Test incident",
            severity=IncidentSeverity.MAJOR,
        )
        incident.update_confidence(1.5)
        assert incident.confidence_score == 1.0
        incident.update_confidence(-0.5)
        assert incident.confidence_score == 0.0

    def test_set_status(self):
        incident = Incident(
            title="Test incident",
            severity=IncidentSeverity.MAJOR,
        )
        assert incident.status == IncidentStatus.OPEN
        incident.set_status(IncidentStatus.INVESTIGATING)
        assert incident.status == IncidentStatus.INVESTIGATING

    def test_is_enriched(self):
        incident = Incident(
            title="Test incident",
            severity=IncidentSeverity.MAJOR,
        )
        assert incident.is_enriched() is False
        incident.update_confidence(0.75, probable_cause="Test")
        assert incident.is_enriched() is True

    def test_is_terminal(self):
        assert Incident(title="T", severity=IncidentSeverity.MAJOR).is_terminal() is False
        assert Incident(title="T", severity=IncidentSeverity.MAJOR, status=IncidentStatus.RESOLVED).is_terminal() is True
        assert Incident(title="T", severity=IncidentSeverity.MAJOR, status=IncidentStatus.CLOSED).is_terminal() is True
        assert Incident(title="T", severity=IncidentSeverity.MAJOR, status=IncidentStatus.SUPPRESSED).is_terminal() is True

    def test_to_db_dict(self):
        incident = Incident(
            title="Test incident",
            severity=IncidentSeverity.MAJOR,
        )
        incident.add_event("evt-001", device_id="dev-001", site_id="site-sfo-01")
        d = incident.to_db_dict()
        assert d["incident_id"] == incident.incident_id
        assert d["severity"] == "major"
        assert d["status"] == "open"
        assert d["affected_devices"] == ["dev-001"]
        assert "event_count" not in d

    def test_to_summary(self):
        incident = Incident(
            title="Test incident",
            severity=IncidentSeverity.CRITICAL,
        )
        summary = incident.to_summary()
        assert summary["incident_id"] == incident.incident_id
        assert summary["severity"] == "critical"
        assert "affected_sites" in summary
        assert "affected_devices" in summary

    def test_dedupe_affected_lists(self):
        incident = Incident(
            title="Test incident",
            severity=IncidentSeverity.MAJOR,
        )
        incident.add_event("evt-001", device_id="dev-001")
        incident.add_event("evt-002", device_id="dev-001")
        incident.add_event("evt-003", device_id="dev-002")
        assert incident.affected_devices == ["dev-001", "dev-002"]

    def test_event_count(self):
        incident = Incident(
            title="Test incident",
            severity=IncidentSeverity.MAJOR,
        )
        assert incident.event_count() == 0
        incident.add_event("evt-001", device_id="dev-001")
        assert incident.event_count() == 1
        incident.add_event("evt-002", device_id="dev-002")
        assert incident.event_count() == 2


# ==============================================================================
# Correlation Rules — Unit Tests
# ==============================================================================


class TestGroupEventsBySiteAndTime:
    """Tests for the group_events_by_site_and_time function."""

    def test_groups_by_site_id(self, default_config, site_sfo_events):
        groups = group_events_by_site_and_time(site_sfo_events, default_config)
        assert len(groups) >= 1
        assert any(k.startswith("site:site-sfo-01") for k in groups)

    def test_multi_site_separate_groups(self, default_config, multi_site_events):
        groups = group_events_by_site_and_time(multi_site_events, default_config)
        assert len(groups) == 3

    def test_events_without_site_id_fallback_to_device(self, default_config):
        rule = SiteTimeWindowRule()
        event = make_event("evt-no-site", severity=EventSeverity.CRITICAL, site_id=None)
        key = rule.group_key(event)
        assert key.startswith("device:")
        assert "dev-001" in key

    def test_low_severity_events_excluded(self, default_config, info_only_events):
        groups = group_events_by_site_and_time(info_only_events, default_config)
        assert len(groups) == 0

    def test_out_of_window_different_groups(self, default_config, out_of_window_events):
        groups = group_events_by_site_and_time(out_of_window_events, default_config)
        group_keys = list(groups.keys())
        assert len(group_keys) == 2


class TestSiteTimeWindowRule:
    """Tests for the SiteTimeWindowRule."""

    def test_should_correlate_sufficient_events(self, default_config):
        rule = SiteTimeWindowRule()
        now = datetime.utcnow()
        events = [
            make_event("evt-1", severity=EventSeverity.MAJOR, timestamp=now),
            make_event("evt-2", severity=EventSeverity.MAJOR, timestamp=now + timedelta(seconds=30)),
        ]
        assert rule.should_correlate(events, default_config) is True

    def test_should_not_correlate_insufficient_events(self, default_config):
        rule = SiteTimeWindowRule()
        now = datetime.utcnow()
        events = [make_event("evt-1", severity=EventSeverity.MAJOR, timestamp=now)]
        config = CorrelationConfig(min_event_count=2, correlate_single_critical=False)
        assert rule.should_correlate(events, config) is False

    def test_single_critical_event_correlates(self):
        rule = SiteTimeWindowRule()
        now = datetime.utcnow()
        events = [make_event("evt-1", severity=EventSeverity.CRITICAL, timestamp=now)]
        config = CorrelationConfig(correlate_single_critical=True)
        assert rule.should_correlate(events, config) is True

    def test_empty_events_returns_false(self, default_config):
        rule = SiteTimeWindowRule()
        assert rule.should_correlate([], default_config) is False

    def test_are_in_time_window(self):
        rule = SiteTimeWindowRule()
        now = datetime.utcnow()
        e1 = make_event("evt-1", severity=EventSeverity.MAJOR, timestamp=now)
        e2 = make_event("evt-2", severity=EventSeverity.MAJOR, timestamp=now + timedelta(seconds=200))
        assert rule.are_in_time_window(e1, e2, 300) is True
        assert rule.are_in_time_window(e1, e2, 100) is False


class TestConfidenceScore:
    """Tests for calculate_confidence_score."""

    def test_empty_events_returns_zero(self):
        result = calculate_confidence_score([])
        assert result.total == 0.0
        assert result.event_score == 0.0
        assert result.avg_severity == 0.0
        assert result.device_score == 0.0

    def test_single_event_baseline(self):
        now = datetime.utcnow()
        event = make_event("evt-1", severity=EventSeverity.MAJOR, timestamp=now)
        result = calculate_confidence_score([event])
        assert 0.0 <= result.total <= 1.0
        assert result.event_score > 0.0
        assert result.avg_severity > 0.0

    def test_more_events_higher_confidence(self):
        now = datetime.utcnow()
        single = [make_event("evt-1", severity=EventSeverity.CRITICAL, timestamp=now)]
        multi = [
            make_event(f"evt-{i}", severity=EventSeverity.CRITICAL,
                      timestamp=now + timedelta(seconds=i * 10))
            for i in range(5)
        ]
        score_single = calculate_confidence_score(single)
        score_multi = calculate_confidence_score(multi)
        assert score_multi.total > score_single.total

    def test_critical_events_score_higher(self):
        now = datetime.utcnow()
        critical = [make_event("evt-c", severity=EventSeverity.CRITICAL, timestamp=now)]
        info = [make_event("evt-i", severity=EventSeverity.INFO, timestamp=now)]
        result_crit = calculate_confidence_score(critical)
        result_info = calculate_confidence_score(info)
        assert result_crit.total > result_info.total
        assert result_crit.avg_severity > result_info.avg_severity

    def test_multiple_devices_higher_confidence(self):
        now = datetime.utcnow()
        single_device = [
            make_event("evt-1", severity=EventSeverity.CRITICAL, device_id="dev-1", timestamp=now),
            make_event("evt-2", severity=EventSeverity.CRITICAL, device_id="dev-1",
                      timestamp=now + timedelta(seconds=10)),
        ]
        multi_device = [
            make_event("evt-3", severity=EventSeverity.CRITICAL, device_id="dev-1", timestamp=now),
            make_event("evt-4", severity=EventSeverity.CRITICAL, device_id="dev-2",
                      timestamp=now + timedelta(seconds=10)),
        ]
        sd = calculate_confidence_score(single_device)
        md = calculate_confidence_score(multi_device)
        assert md.total > sd.total
        assert md.device_score > sd.device_score

    def test_score_clamped_to_range(self):
        now = datetime.utcnow()
        many = [
            make_event(f"evt-{i}", severity=EventSeverity.CRITICAL,
                      timestamp=now + timedelta(seconds=i))
            for i in range(100)
        ]
        result = calculate_confidence_score(many)
        assert 0.0 <= result.total <= 1.0

    def test_confidence_breakdown_to_dict_includes_all_factors(self):
        """to_dict() should return all four factor keys."""
        now = datetime.utcnow()
        events = [
            make_event("evt-1", severity=EventSeverity.CRITICAL, timestamp=now, device_id="dev-1"),
            make_event("evt-2", severity=EventSeverity.MAJOR, timestamp=now + timedelta(seconds=10), device_id="dev-2"),
        ]
        result = calculate_confidence_score(events)
        d = result.to_dict()
        for key in ("event_score", "avg_severity", "device_score", "total"):
            assert key in d
            assert isinstance(d[key], float)


class TestIncidentTitle:
    """Tests for generate_incident_title (Phase 3: human titles)."""

    def test_empty_events_returns_fallback(self):
        assert generate_incident_title([]) == "Unknown incident"

    def test_real_site_name_in_title(self, site_sfo_events):
        """Uses the real site name, not a prefixed code."""
        title = generate_incident_title(site_sfo_events)
        assert "SFO-01" in title
        assert not title.startswith("Site ")

    def test_plain_language_issue_label(self, site_sfo_events):
        """Issue is a plain-language phrase, not a raw category code."""
        title = generate_incident_title(site_sfo_events)
        assert "link down" in title

    def test_root_device_named(self, site_sfo_events):
        title = generate_incident_title(site_sfo_events)
        assert "edge-sfo-01" in title

    def test_affected_device_count_in_title(self, site_sfo_events):
        title = generate_incident_title(site_sfo_events)
        assert "2 devices affected" in title

    def test_spec_example_phrase(self):
        """Matches the Phase 3 target: 'Site · RootDevice unreachable — N devices affected'."""
        now = datetime.utcnow()
        events = [
            make_event(
                f"pune-{i}",
                severity=(
                    EventSeverity.CRITICAL if i == 0 else EventSeverity.MAJOR
                ),
                event_type=EventType.DEVICE_UNREACHABLE,
                device_id=f"ap-pune-{i:02d}",
                device_name="AP32-02" if i == 0 else f"ap-pune-{i:02d}",
                site_id="site-pimpri",
                site_name="Pimpri Plant",
                timestamp=now + timedelta(seconds=10 * i),
            )
            for i in range(5)
        ]
        assert generate_incident_title(events) == (
            "Pimpri Plant · AP32-02 unreachable — 5 devices affected"
        )

    def test_unreachable_label(self):
        now = datetime.utcnow()
        event = make_event(
            "uv-1",
            severity=EventSeverity.CRITICAL,
            event_type=EventType.DEVICE_UNREACHABLE,
            device_id="ap-101",
            device_name="AP101",
            site_name="Pune Plant",
            timestamp=now,
        )
        assert generate_incident_title([event]) == "Pune Plant · AP101 unreachable"

    def test_degraded_label_multiple_devices(self):
        now = datetime.utcnow()
        events = [
            make_event(
                "dg-1", severity=EventSeverity.CRITICAL,
                event_type=EventType.PACKET_LOSS,
                device_id="edge-1", device_name="edge-A",
                site_name="Pim Plant", timestamp=now,
            ),
            make_event(
                "dg-2", severity=EventSeverity.MAJOR,
                event_type=EventType.HIGH_LATENCY,
                device_id="edge-2", device_name="edge-B",
                site_name="Pim Plant",
                timestamp=now + timedelta(seconds=10),
            ),
        ]
        assert generate_incident_title(events) == (
            "Pim Plant · edge-A degraded — 2 devices affected"
        )

    def test_single_device_omits_count(self):
        now = datetime.utcnow()
        event = make_event(
            "sd-1", severity=EventSeverity.CRITICAL,
            event_type=EventType.LINK_DOWN,
            device_id="core-1", device_name="core-01",
            site_name="SFO", timestamp=now,
        )
        assert generate_incident_title([event]) == "SFO · core-01 link down"

    def test_site_falls_back_to_site_id(self):
        now = datetime.utcnow()
        event = make_event(
            "sf-1", severity=EventSeverity.MAJOR,
            event_type=EventType.HIGH_CPU,
            device_id="sw-1", device_name="sw-1",
            site_id="site-nyc-01", site_name=None,
            timestamp=now,
        )
        assert generate_incident_title([event]) == "site-nyc-01 · sw-1 degraded"

    def test_no_device_falls_back_to_category(self):
        now = datetime.utcnow()
        event = UnifiedEvent(
            event_id="nd-1",
            timestamp=now,
            source=EventSource.MIST,
            severity=EventSeverity.MAJOR,
            category=EventCategory.CONNECTIVITY,
            event_type=EventType.OTHER,
            title="t",
            description="d",
            device=None,
        )
        assert generate_incident_title([event]) == "Connectivity issue"

    def test_category_fallback_when_type_unknown(self):
        now = datetime.utcnow()
        event = make_event(
            "cf-1", severity=EventSeverity.CRITICAL,
            event_type=EventType.OTHER,
            category=EventCategory.PERFORMANCE,
            device_id="sw-1", device_name="sw-1",
            site_name="SFO", timestamp=now,
        )
        assert generate_incident_title([event]) == "SFO · sw-1 degraded"


# ==============================================================================
# EventFactory Consistency
# ==============================================================================

class TestEventFactoryHelpers:
    """Verify test event factory produces valid UnifiedEvents."""

    def test_event_has_all_required_fields(self):
        event = make_event("test-1", severity=EventSeverity.CRITICAL)
        assert event.event_id == "test-1"
        assert event.severity == EventSeverity.CRITICAL
        assert event.source == EventSource.MIST
        assert event.device is not None
        assert event.device.device_id == "dev-001"
        assert event.device.site_id == "site-sfo-01"

    def test_event_serialization_roundtrip(self):
        event = make_event("rt-1", severity=EventSeverity.MAJOR,
                          device_id="dev-001", site_id="site-nyc-01")
        d = event.to_db_row()
        assert d["event_id"] == "rt-1"
        assert d["severity"] == "major"
        assert d["device_id"] == "dev-001"
        assert d["site_id"] == "site-nyc-01"

    def test_event_different_sources(self):
        for source in EventSource:
            event = make_event(event_id=f"src-{source.value}", severity=EventSeverity.INFO, source=source)
            assert event.source == source

    def test_event_with_client_info(self):
        event = make_event(
            event_id="client-test",
            severity=EventSeverity.MAJOR,
            client_id="client-mac-001",
        )
        assert event.client is not None
        assert event.client.client_id == "client-mac-001"


# ==============================================================================
# Pipeline Integration Tests
# ==============================================================================

class TestCorrelationPipeline:
    """Verify the full pipeline: collect → normalize → correlate → incidents."""

    @pytest.mark.asyncio
    async def test_worker_daemon_correlation_contract(self, default_config, site_sfo_events):
        """Simulate what WorkerDaemon.run_once does."""
        engine = CorrelationEngine(config=default_config)
        all_events = site_sfo_events
        incidents = await engine.process_events(all_events)

        assert len(incidents) >= 1
        for incident in incidents:
            assert incident.incident_id
            assert incident.title
            assert incident.severity in IncidentSeverity
            assert incident.status == IncidentStatus.OPEN
            assert isinstance(incident.affected_sites, list)
            assert isinstance(incident.affected_devices, list)
            assert isinstance(incident.affected_clients, list)
            assert isinstance(incident.related_event_ids, list)
            assert len(incident.related_event_ids) >= 1
            assert 0.0 <= incident.confidence_score <= 1.0

            input_ids = {e.event_id for e in all_events}
            for eid in incident.related_event_ids:
                assert eid in input_ids

    @pytest.mark.asyncio
    async def test_multi_source_pipeline(self, default_config, cross_vendor_events):
        """Mist + VeloCloud + DNAC events at the same site should correlate."""
        engine = CorrelationEngine(config=default_config)
        incidents = await engine.process_events(cross_vendor_events)

        assert len(incidents) == 1
        incident = incidents[0]

        sources_in_incident = set()
        for eid in incident.related_event_ids:
            for event in cross_vendor_events:
                if event.event_id == eid:
                    sources_in_incident.add(event.source)
                    break

        assert EventSource.MIST in sources_in_incident
        assert EventSource.VELOCLOUD in sources_in_incident
        assert EventSource.DNAC in sources_in_incident

    @pytest.mark.asyncio
    async def test_incremental_correlation(self, default_config):
        """Multiple worker cycles should only process new events."""
        engine = CorrelationEngine(config=default_config)

        now = datetime.utcnow()
        cycle1 = [
            make_event("c1-evt-1", severity=EventSeverity.CRITICAL, site_id="site-a", timestamp=now),
            make_event("c1-evt-2", severity=EventSeverity.MAJOR, site_id="site-a",
                      timestamp=now + timedelta(seconds=30)),
        ]
        incidents1 = await engine.process_events(cycle1)
        assert len(incidents1) == 1
        assert engine.get_processed_count() == 2

        cycle2 = [
            make_event("c2-evt-1", severity=EventSeverity.CRITICAL, site_id="site-b",
                      timestamp=now + timedelta(seconds=120)),
            make_event("c2-evt-2", severity=EventSeverity.MAJOR, site_id="site-b",
                      timestamp=now + timedelta(seconds=150)),
        ]
        incidents2 = await engine.process_events(cycle2)
        assert len(incidents2) == 1
        assert incidents2[0].affected_sites == ["site-b"]
        assert engine.get_processed_count() == 4

        cycle3 = [
            make_event("c3-evt-1", severity=EventSeverity.CRITICAL, site_id="site-c",
                      timestamp=now + timedelta(seconds=200)),
            make_event("c3-evt-2", severity=EventSeverity.MAJOR, site_id="site-c",
                      timestamp=now + timedelta(seconds=230)),
        ]
        incidents3 = await engine.process_events(cycle3)
        assert len(incidents3) == 1
        assert incidents3[0].affected_sites == ["site-c"]
        assert engine.get_processed_count() == 6

    @pytest.mark.asyncio
    async def test_stage2_pipeline_contract(
        self, cascade_events_same_site, mock_topology_provider, topology_aware_config
    ):
        """Stage 2 pipeline contract: root + symptoms produce one incident."""
        engine = CorrelationEngine(
            config=topology_aware_config,
            topology_provider=mock_topology_provider,
        )
        incidents = await engine.process_events(cascade_events_same_site)
        assert len(incidents) >= 1
        for incident in incidents:
            assert incident.incident_id
            assert incident.title
            assert incident.severity in IncidentSeverity
            assert len(incident.related_event_ids) >= 2
            assert incident.confidence_score > 0


class TestEngineTelemetry:
    """Telemetry counters on CorrelationEngine."""

    @pytest.mark.asyncio
    async def test_get_stats_returns_all_keys(self, default_config):
        """get_stats() includes all expected telemetry keys."""
        engine = CorrelationEngine(config=default_config)
        stats = engine.get_stats()

        assert "cycle_count" in stats
        assert "total_events_processed" in stats
        assert "total_incidents_created" in stats
        assert "cascade_incidents" in stats
        assert "residual_incidents" in stats
        assert "processed_set_size" in stats
        assert "last_duration_ms" in stats
        assert "last_cycle_events" in stats
        assert "last_cycle_incidents" in stats
        assert "cascade_enabled" in stats

        # Default values
        assert stats["cycle_count"] == 0
        assert stats["total_events_processed"] == 0
        assert stats["total_incidents_created"] == 0
        assert stats["last_duration_ms"] == 0.0
        assert stats["last_cycle_events"] == 0
        assert stats["last_cycle_incidents"] == 0

    @pytest.mark.asyncio
    async def test_cycle_count_increments(self, default_config):
        """Each process_events call increments cycle_count."""
        engine = CorrelationEngine(config=default_config)
        assert engine._cycle_count == 0

        now = datetime.utcnow()
        events = [
            make_event("t-1", severity=EventSeverity.CRITICAL, site_id="site-a", timestamp=now),
            make_event("t-2", severity=EventSeverity.MAJOR, site_id="site-a",
                       timestamp=now + timedelta(seconds=10)),
        ]
        await engine.process_events(events)
        assert engine._cycle_count == 1

        await engine.process_events(events)
        assert engine._cycle_count == 2

    @pytest.mark.asyncio
    async def test_last_duration_ms_set_after_process(self, default_config):
        """last_duration_ms is set after processing events."""
        engine = CorrelationEngine(config=default_config)
        assert engine._last_duration_ms == 0.0

        now = datetime.utcnow()
        events = [
            make_event("t-3", severity=EventSeverity.CRITICAL, site_id="site-a", timestamp=now),
            make_event("t-4", severity=EventSeverity.MAJOR, site_id="site-a",
                       timestamp=now + timedelta(seconds=10)),
        ]
        await engine.process_events(events)
        # _last_duration_ms is finalised even if clock resolution makes it 0.0
        assert isinstance(engine._last_duration_ms, float)
        assert engine._cycle_count == 1
        assert engine._last_cycle_events == 2
        assert engine._last_cycle_incidents == 1

    @pytest.mark.asyncio
    async def test_last_cycle_events_and_incidents(self, default_config):
        """Per-cycle counters reflect the most recent cycle."""
        engine = CorrelationEngine(config=default_config)
        now = datetime.utcnow()

        events = [
            make_event("t-5", severity=EventSeverity.CRITICAL, site_id="site-a", timestamp=now),
            make_event("t-6", severity=EventSeverity.MAJOR, site_id="site-a",
                       timestamp=now + timedelta(seconds=10)),
        ]
        incidents = await engine.process_events(events)
        assert engine._last_cycle_events == 2
        assert engine._last_cycle_incidents == len(incidents)

    @pytest.mark.asyncio
    async def test_total_counters_accumulate(self, default_config):
        """Total counters accumulate across cycles."""
        engine = CorrelationEngine(config=default_config)
        now = datetime.utcnow()

        events_a = [
            make_event("t-7", severity=EventSeverity.CRITICAL, site_id="site-a", timestamp=now),
            make_event("t-8", severity=EventSeverity.MAJOR, site_id="site-a",
                       timestamp=now + timedelta(seconds=10)),
        ]
        await engine.process_events(events_a)
        assert engine._total_incidents_created == engine._last_cycle_incidents
        assert engine._total_events_processed >= 2

        events_b = [
            make_event("t-9", severity=EventSeverity.CRITICAL, site_id="site-b", timestamp=now),
            make_event("t-10", severity=EventSeverity.MAJOR, site_id="site-b",
                       timestamp=now + timedelta(seconds=10)),
        ]
        await engine.process_events(events_b)
        assert engine._total_incidents_created >= 2
        assert engine._total_events_processed >= 4

    @pytest.mark.asyncio
    async def test_telemetry_updated_on_early_return(self, default_config):
        """Telemetry is updated even when all events were already processed."""
        engine = CorrelationEngine(config=default_config)
        now = datetime.utcnow()
        events = [
            make_event("t-er-1", severity=EventSeverity.CRITICAL, site_id="site-a", timestamp=now),
            make_event("t-er-2", severity=EventSeverity.MAJOR, site_id="site-a",
                       timestamp=now + timedelta(seconds=10)),
        ]
        # First call: processes events
        await engine.process_events(events)
        assert engine._cycle_count == 1
        assert engine._last_cycle_events == 2

        # Second call: all already processed, early return — telemetry still set
        await engine.process_events(events)
        assert engine._cycle_count == 2
        assert engine._last_cycle_events == 0  # zero new events
        assert engine._last_cycle_incidents == 0
        assert isinstance(engine._last_duration_ms, float)

    @pytest.mark.asyncio
    async def test_cascade_enabled_in_stats(self, default_config, topology_aware_config):
        """Stats reflect whether cascade is enabled."""
        engine_no = CorrelationEngine(config=default_config)
        assert engine_no.get_stats()["cascade_enabled"] is False

        engine_yes = CorrelationEngine(config=topology_aware_config)
        assert engine_yes.get_stats()["cascade_enabled"] is True

    @pytest.mark.asyncio
    async def test_reset_clears_telemetry(self, default_config):
        """reset() clears all counters including per-cycle telemetry."""
        engine = CorrelationEngine(config=default_config)
        now = datetime.utcnow()
        events = [
            make_event("t-11", severity=EventSeverity.CRITICAL, site_id="site-a", timestamp=now),
            make_event("t-12", severity=EventSeverity.MAJOR, site_id="site-a",
                       timestamp=now + timedelta(seconds=10)),
        ]
        await engine.process_events(events)
        assert engine._cycle_count > 0
        assert engine._total_events_processed > 0

        engine.reset()
        stats = engine.get_stats()
        assert stats["cycle_count"] == 0
        assert stats["total_events_processed"] == 0
        assert stats["total_incidents_created"] == 0
        assert stats["last_duration_ms"] == 0.0
        assert stats["last_cycle_events"] == 0
        assert stats["last_cycle_incidents"] == 0


# ==============================================================================
# Phase 2: Root-Cause Dedup + Recovery Resolution
# ==============================================================================


class TestRootCauseDedupAndRecovery:
    """Stable root-cause incident IDs + DEVICE_REACHABLE resolution."""

    @pytest.mark.asyncio
    async def test_stable_incident_id_for_same_root_cause(self, default_config):
        """New events for the same device+site+category reuse the incident ID."""
        engine = CorrelationEngine(config=default_config)
        now = datetime.utcnow()

        incidents1 = await engine.process_events([
            make_event("u1", severity=EventSeverity.CRITICAL,
                       event_type=EventType.DEVICE_UNREACHABLE,
                       device_id="ap-1", site_id="site-a", timestamp=now),
        ])
        assert len(incidents1) == 1
        assert incidents1[0].root_device_ids == ["ap-1"]

        incidents2 = await engine.process_events([
            make_event("u2", severity=EventSeverity.CRITICAL,
                       event_type=EventType.DEVICE_UNREACHABLE,
                       device_id="ap-1", site_id="site-a",
                       timestamp=now + timedelta(minutes=2)),
        ])
        assert len(incidents2) == 1
        assert incidents2[0].incident_id == incidents1[0].incident_id
        assert incidents2[0].affected_sites == ["site-a"]

    @pytest.mark.asyncio
    async def test_different_devices_get_different_incident_ids(self, default_config):
        """Different root devices (different sites) → separate incidents."""
        engine = CorrelationEngine(config=default_config)
        incidents = await engine.process_events([
            make_event("d1", severity=EventSeverity.CRITICAL,
                       device_id="ap-1", site_id="site-a"),
            make_event("d2", severity=EventSeverity.CRITICAL,
                       device_id="ap-2", site_id="site-b",
                       timestamp=datetime.utcnow() + timedelta(seconds=30)),
        ])
        assert len(incidents) == 2
        assert incidents[0].incident_id != incidents[1].incident_id

    @pytest.mark.asyncio
    async def test_issue_type_is_part_of_key(self, default_config):
        """Same device, different issue category → separate incidents."""
        engine = CorrelationEngine(config=default_config)
        now = datetime.utcnow()
        incident_system = await engine.process_events([
            make_event("s1", severity=EventSeverity.CRITICAL,
                       category=EventCategory.SYSTEM,
                       event_type=EventType.DEVICE_UNREACHABLE,
                       device_id="ap-1", site_id="site-a", timestamp=now),
        ])
        incident_connectivity = await engine.process_events([
            make_event("c1", severity=EventSeverity.CRITICAL,
                       category=EventCategory.CONNECTIVITY,
                       event_type=EventType.LINK_DOWN,
                       device_id="ap-1", site_id="site-a",
                       timestamp=now + timedelta(minutes=5)),
        ])
        assert incident_system[0].incident_id != incident_connectivity[0].incident_id

    @pytest.mark.asyncio
    async def test_cross_cycle_severity_escalation_same_incident(self, default_config):
        """
        A worse event in a later cycle escalates the SAME incident.

        The dedup key (site|root device|category) is stable across cycles, so
        the upsert overwrites severity with the recomputed worst severity —
        an operator watching Alerts sees one alert escalate instead of two.
        """
        engine = CorrelationEngine(config=default_config)
        now = datetime.utcnow()

        first = await engine.process_events([
            make_event("w1", severity=EventSeverity.MAJOR,
                       category=EventCategory.CONNECTIVITY,
                       event_type=EventType.LINK_DOWN,
                       device_id="ap-1", site_id="site-a", timestamp=now),
            make_event("w1b", severity=EventSeverity.MAJOR,
                       category=EventCategory.CONNECTIVITY,
                       event_type=EventType.LINK_DOWN,
                       device_id="ap-2", site_id="site-a",
                       timestamp=now + timedelta(seconds=10)),
        ])
        assert len(first) == 1
        assert first[0].severity == IncidentSeverity.MAJOR

        later = await engine.process_events([
            make_event("w2", severity=EventSeverity.CRITICAL,
                       category=EventCategory.CONNECTIVITY,
                       event_type=EventType.DEVICE_UNREACHABLE,
                       device_id="ap-1", site_id="site-a",
                       timestamp=now + timedelta(minutes=5)),
        ])
        assert len(later) == 1
        assert later[0].incident_id == first[0].incident_id
        assert later[0].severity == IncidentSeverity.CRITICAL

    @pytest.mark.asyncio
    async def test_recovery_event_resolves_open_incident(self, default_config, monkeypatch):
        """DEVICE_REACHABLE resolves open incidents for the recovered device."""
        resolved: List[str] = []

        async def fake_resolve(device_ids):
            resolved.extend(device_ids)
            return 1

        monkeypatch.setattr(
            "backend.shared.database.incidents.resolve_open_incidents_for_devices",
            fake_resolve,
        )
        engine = CorrelationEngine(config=default_config)
        now = datetime.utcnow()
        await engine.process_events([
            make_event("u1", severity=EventSeverity.CRITICAL,
                       event_type=EventType.DEVICE_UNREACHABLE,
                       device_id="ap-1", site_id="site-a", timestamp=now),
        ])
        await engine.process_events([
            make_event("r1", severity=EventSeverity.INFO,
                       event_type=EventType.DEVICE_REACHABLE,
                       device_id="ap-1", site_id="site-a",
                       timestamp=now + timedelta(minutes=10)),
        ])
        assert resolved == ["ap-1"]

    @pytest.mark.asyncio
    async def test_recovery_after_outage_in_same_cycle(self, default_config, monkeypatch):
        """Recovery that arrives with its own outage still resolves it."""
        resolved: List[str] = []

        async def fake_resolve(device_ids):
            resolved.extend(device_ids)
            return 1

        monkeypatch.setattr(
            "backend.shared.database.incidents.resolve_open_incidents_for_devices",
            fake_resolve,
        )
        engine = CorrelationEngine(config=default_config)
        now = datetime.utcnow()
        await engine.process_events([
            make_event("u1", severity=EventSeverity.CRITICAL,
                       event_type=EventType.DEVICE_UNREACHABLE,
                       device_id="ap-1", site_id="site-a", timestamp=now),
            make_event("r1", severity=EventSeverity.INFO,
                       event_type=EventType.DEVICE_REACHABLE,
                       device_id="ap-1", site_id="site-a",
                       timestamp=now + timedelta(minutes=1)),
        ])
        assert resolved == ["ap-1"]

    @pytest.mark.asyncio
    async def test_recovery_db_failure_does_not_crash(self, default_config, monkeypatch):
        """DB failure during resolution is swallowed, not propagated."""
        def boom(*args, **kwargs):
            raise RuntimeError("db down")

        monkeypatch.setattr(
            "backend.shared.database.incidents.resolve_open_incidents_for_devices",
            boom,
        )
        engine = CorrelationEngine(config=default_config)
        await engine.process_events([
            make_event("r1", severity=EventSeverity.INFO,
                       event_type=EventType.DEVICE_REACHABLE,
                       device_id="ap-1", site_id="site-a"),
        ])

    @pytest.mark.asyncio
    async def test_recovery_only_cycle_produces_no_incidents(self, default_config, monkeypatch):
        """INFO recovery events never create incidents themselves."""
        resolved: List[str] = []

        async def fake_resolve(device_ids):
            resolved.extend(device_ids)
            return 0

        monkeypatch.setattr(
            "backend.shared.database.incidents.resolve_open_incidents_for_devices",
            fake_resolve,
        )
        engine = CorrelationEngine(config=default_config)
        incidents = await engine.process_events([
            make_event("r1", severity=EventSeverity.INFO,
                       event_type=EventType.DEVICE_REACHABLE,
                       device_id="ap-1", site_id="site-a"),
        ])
        assert incidents == []
        assert resolved == ["ap-1"]
