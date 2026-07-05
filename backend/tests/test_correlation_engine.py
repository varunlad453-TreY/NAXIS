"""
Comprehensive tests for the Naxis Correlation Engine.

Tests cover:
- CorrelationEngine.process_events() — full lifecycle
- Incident model — construction, blast radius, lifecycle
- Correlation rules — site-time-window, confidence, title generation
- Cross-vendor correlation — Mist + VeloCloud + DNAC
- Edge cases — empty, dedup, time window boundaries, severity thresholds
"""

import math
from collections import Counter
from datetime import datetime, timedelta

import pytest

from backend.shared.correlation import CorrelationEngine
from backend.shared.correlation.engine import correlate_events
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

# ==============================================================================
# CorrelationEngine.process_events() — Integration Tests
# ==============================================================================


class TestCorrelationEngineProcessEvents:
    """Tests for the main correlation engine entry point."""

    def test_empty_events_returns_empty_list(self, default_config):
        engine = CorrelationEngine(config=default_config)
        incidents = engine.process_events([])
        assert incidents == []

    def test_single_critical_event_creates_incident(self, single_critical_config, site_sfo_events):
        engine = CorrelationEngine(config=single_critical_config)
        events = [site_sfo_events[0]]  # just the CRITICAL event
        incidents = engine.process_events(events)
        assert len(incidents) == 1
        i = incidents[0]
        assert i.severity == IncidentSeverity.CRITICAL
        assert i.status == IncidentStatus.OPEN
        assert "sfo-evt-1" in i.related_event_ids
        assert i.confidence_score > 0

    def test_multiple_events_same_site_one_incident(self, default_config, site_sfo_events):
        engine = CorrelationEngine(config=default_config)
        incidents = engine.process_events(site_sfo_events)
        assert len(incidents) == 1
        i = incidents[0]
        assert len(i.related_event_ids) == 3
        assert "SFO-01" in i.title or "SFO" in i.title
        assert "site-sfo-01" in i.affected_sites

    def test_events_at_different_sites_separate_incidents(self, default_config, multi_site_events):
        engine = CorrelationEngine(config=default_config)
        incidents = engine.process_events(multi_site_events)
        # Only SFO and NYC have CRITICAL (single critical creates incident);
        # LAX has only 1 MAJOR which is below min_event_count=2
        assert len(incidents) == 2

        site_ids = set()
        for inc in incidents:
            for sid in inc.affected_sites:
                site_ids.add(sid)
        assert site_ids == {"site-sfo-01", "site-nyc-01"}

    def test_duplicate_events_are_skipped(self, default_config, site_sfo_events):
        engine = CorrelationEngine(config=default_config)
        # First pass
        incidents1 = engine.process_events(site_sfo_events)
        assert len(incidents1) == 1
        # Second pass with same events — engine tracks processed IDs
        incidents2 = engine.process_events(site_sfo_events)
        assert len(incidents2) == 0

    def test_reset_clears_processed_cache(self, default_config, site_sfo_events):
        engine = CorrelationEngine(config=default_config)
        engine.process_events(site_sfo_events)
        assert engine.get_processed_count() == 3
        engine.reset()
        assert engine.get_processed_count() == 0
        incidents = engine.process_events(site_sfo_events)
        assert len(incidents) == 1

    def test_info_only_events_no_incidents(self, default_config, info_only_events):
        engine = CorrelationEngine(config=default_config)
        incidents = engine.process_events(info_only_events)
        assert len(incidents) == 0

    def test_low_severity_events_filtered(self, default_config):
        engine = CorrelationEngine(config=default_config)
        now = datetime.utcnow()
        events = [
            _make_event("evt-1", EventSeverity.WARNING, timestamp=now),
            _make_event("evt-2", EventSeverity.INFO, timestamp=now + timedelta(seconds=30)),
        ]
        incidents = engine.process_events(events)
        assert len(incidents) == 0

    def test_single_critical_creates_incident(self, single_critical_config):
        engine = CorrelationEngine(config=single_critical_config)
        now = datetime.utcnow()
        event = _make_event("evt-crit", EventSeverity.CRITICAL, timestamp=now)
        incidents = engine.process_events([event])
        assert len(incidents) == 1
        assert incidents[0].severity == IncidentSeverity.CRITICAL

    def test_cross_vendor_correlation(self, default_config, cross_vendor_events):
        """Mist + VeloCloud + DNAC events at the same site become one incident."""
        engine = CorrelationEngine(config=default_config)
        incidents = engine.process_events(cross_vendor_events)
        assert len(incidents) == 1
        i = incidents[0]
        # All 3 events should be in the incident
        assert len(i.related_event_ids) == 3
        # Blast radius includes all device types
        assert len(i.affected_devices) == 3

    def test_time_window_boundary(self, tight_window_config):
        """Events outside the time window should not be grouped."""
        engine = CorrelationEngine(config=tight_window_config)
        now = datetime.utcnow()
        events = [
            _make_event("evt-early", EventSeverity.MAJOR, site_id="site-a",
                        timestamp=now),
            _make_event("evt-late", EventSeverity.MAJOR, site_id="site-a",
                        timestamp=now + timedelta(seconds=30)),
        ]
        incidents = engine.process_events(events)
        assert len(incidents) == 0  # 30 > 10, so no group

    def test_time_window_inclusive(self, default_config):
        """Events exactly at the window boundary should be grouped."""
        engine = CorrelationEngine(config=CorrelationConfig(time_window_seconds=60))
        now = datetime.utcnow()
        events = [
            _make_event("evt-1", EventSeverity.MAJOR, site_id="site-a",
                        timestamp=now),
            _make_event("evt-2", EventSeverity.MAJOR, site_id="site-a",
                        timestamp=now + timedelta(seconds=60)),
        ]
        incidents = engine.process_events(events)
        assert len(incidents) == 1

    def test_blast_radius_populated_correctly(self, default_config, events_with_clients):
        """Verify affected_sites, affected_devices, affected_clients."""
        engine = CorrelationEngine(config=default_config)
        incidents = engine.process_events(events_with_clients)
        assert len(incidents) == 1
        i = incidents[0]
        assert i.affected_sites == ["site-sfo-01"]
        assert sorted(i.affected_devices) == ["ap-sfo-01", "ap-sfo-02"]
        assert sorted(i.affected_clients) == ["client-001", "client-002", "client-003"]

    def test_confidence_score_calculation(self, default_config, site_sfo_events):
        """Confidence should be a float in [0, 1]."""
        engine = CorrelationEngine(config=default_config)
        incidents = engine.process_events(site_sfo_events)
        assert len(incidents) == 1
        assert 0.0 <= incidents[0].confidence_score <= 1.0
        assert incidents[0].confidence_score > 0.5  # 3 events, critical + major

    def test_incident_title_generated(self, default_config, site_sfo_events):
        """Title should be descriptive and human-readable."""
        engine = CorrelationEngine(config=default_config)
        incidents = engine.process_events(site_sfo_events)
        title = incidents[0].title
        assert "SFO" in title
        assert "connectivity" in title.lower() or "issue" in title.lower()
        assert "device" in title.lower() or "devices" in title.lower() or "2" in title

    def test_severity_determination_highest_wins(self, default_config):
        """Incident severity should be the highest severity among its events."""
        engine = CorrelationEngine(config=default_config)
        now = datetime.utcnow()
        events = [
            _make_event("evt-1", EventSeverity.MINOR, timestamp=now,
                        site_id="site-a"),
            _make_event("evt-2", EventSeverity.MAJOR, timestamp=now + timedelta(seconds=10),
                        site_id="site-a"),
            _make_event("evt-3", EventSeverity.CRITICAL, timestamp=now + timedelta(seconds=20),
                        site_id="site-a"),
        ]
        incidents = engine.process_events(events)
        assert len(incidents) == 1
        assert incidents[0].severity == IncidentSeverity.CRITICAL

    def test_correlate_site_events_filters_by_site(self, default_config, multi_site_events):
        """correlate_site_events should only process events for one site."""
        engine = CorrelationEngine(config=default_config)
        incidents = engine.correlate_site_events(multi_site_events, "site-sfo-01")
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

    def test_convenience_correlate_events(self, default_config, site_sfo_events):
        """correlate_events() convenience function should work."""
        incidents = correlate_events(site_sfo_events, default_config)
        assert len(incidents) >= 1

    def test_large_event_batch(self, default_config):
        """Should handle hundreds of events efficiently."""
        engine = CorrelationEngine(config=default_config)
        now = datetime.utcnow()
        events = []
        sites = ["site-a", "site-b", "site-c", "site-d", "site-e"]
        for i in range(500):
            site = sites[i % len(sites)]
            events.append(
                _make_event(
                    f"batch-evt-{i}",
                    EventSeverity.MAJOR,
                    site_id=site,
                    timestamp=now + timedelta(seconds=i * 2),
                )
            )
        incidents = engine.process_events(events)
        # Each site has ~100 events within 1000 seconds (500 * 2 / 5 sites)
        # With 300s window, each site should get multiple groups
        assert len(incidents) > 0
        assert engine.get_processed_count() == 500


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
            "evt-001",
            device_id="dev-001",
            site_id="site-sfo-01",
            client_id="client-001",
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
        assert "event_count" in d

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
        incident.add_event("evt-002", device_id="dev-001")  # same device
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
        # All events share site-sfo-01, so at least one group key starts with "site:site-sfo-01"
        assert any(k.startswith("site:site-sfo-01") for k in groups)

    def test_multi_site_separate_groups(self, default_config, multi_site_events):
        groups = group_events_by_site_and_time(multi_site_events, default_config)
        assert len(groups) == 3

    def test_events_without_site_id_fallback_to_device(self, default_config):
        rule = SiteTimeWindowRule()
        event = _make_event("evt-no-site", EventSeverity.CRITICAL, site_id=None)
        key = rule.group_key(event)
        # Falls back to "device:{device_id}" when site_id is None
        assert key.startswith("device:")
        assert "dev-001" in key

    def test_low_severity_events_excluded(self, default_config, info_only_events):
        groups = group_events_by_site_and_time(info_only_events, default_config)
        assert len(groups) == 0

    def test_out_of_window_different_groups(self, default_config, out_of_window_events):
        groups = group_events_by_site_and_time(out_of_window_events, default_config)
        # Same site but hours apart → separate subgroups
        group_keys = list(groups.keys())
        assert len(group_keys) == 2


class TestSiteTimeWindowRule:
    """Tests for the SiteTimeWindowRule."""

    def test_should_correlate_sufficient_events(self, default_config):
        rule = SiteTimeWindowRule()
        now = datetime.utcnow()
        events = [
            _make_event("evt-1", EventSeverity.MAJOR, timestamp=now),
            _make_event("evt-2", EventSeverity.MAJOR, timestamp=now + timedelta(seconds=30)),
        ]
        assert rule.should_correlate(events, default_config) is True

    def test_should_not_correlate_insufficient_events(self, default_config):
        rule = SiteTimeWindowRule()
        now = datetime.utcnow()
        events = [
            _make_event("evt-1", EventSeverity.MAJOR, timestamp=now),
        ]
        config = CorrelationConfig(min_event_count=2, correlate_single_critical=False)
        assert rule.should_correlate(events, config) is False

    def test_single_critical_event_correlates(self):
        rule = SiteTimeWindowRule()
        now = datetime.utcnow()
        events = [
            _make_event("evt-1", EventSeverity.CRITICAL, timestamp=now),
        ]
        config = CorrelationConfig(correlate_single_critical=True)
        assert rule.should_correlate(events, config) is True

    def test_empty_events_returns_false(self, default_config):
        rule = SiteTimeWindowRule()
        assert rule.should_correlate([], default_config) is False

    def test_are_in_time_window(self):
        rule = SiteTimeWindowRule()
        now = datetime.utcnow()
        e1 = _make_event("evt-1", EventSeverity.MAJOR, timestamp=now)
        e2 = _make_event("evt-2", EventSeverity.MAJOR, timestamp=now + timedelta(seconds=200))
        assert rule.are_in_time_window(e1, e2, 300) is True
        assert rule.are_in_time_window(e1, e2, 100) is False


class TestConfidenceScore:
    """Tests for calculate_confidence_score."""

    def test_empty_events_returns_zero(self):
        assert calculate_confidence_score([]) == 0.0

    def test_single_event_baseline(self):
        now = datetime.utcnow()
        event = _make_event("evt-1", EventSeverity.MAJOR, timestamp=now)
        score = calculate_confidence_score([event])
        assert 0.0 <= score <= 1.0

    def test_more_events_higher_confidence(self):
        now = datetime.utcnow()
        single = [_make_event("evt-1", EventSeverity.CRITICAL, timestamp=now)]
        multi = [
            _make_event(f"evt-{i}", EventSeverity.CRITICAL,
                       timestamp=now + timedelta(seconds=i * 10))
            for i in range(5)
        ]
        score_single = calculate_confidence_score(single)
        score_multi = calculate_confidence_score(multi)
        assert score_multi > score_single

    def test_critical_events_score_higher(self):
        now = datetime.utcnow()
        critical = [_make_event("evt-c", EventSeverity.CRITICAL, timestamp=now)]
        info = [_make_event("evt-i", EventSeverity.INFO, timestamp=now)]
        score_crit = calculate_confidence_score(critical)
        score_info = calculate_confidence_score(info)
        assert score_crit > score_info

    def test_multiple_devices_higher_confidence(self):
        now = datetime.utcnow()
        single_device = [
            _make_event("evt-1", EventSeverity.CRITICAL, device_id="dev-1", timestamp=now),
            _make_event("evt-2", EventSeverity.CRITICAL, device_id="dev-1",
                       timestamp=now + timedelta(seconds=10)),
        ]
        multi_device = [
            _make_event("evt-3", EventSeverity.CRITICAL, device_id="dev-1", timestamp=now),
            _make_event("evt-4", EventSeverity.CRITICAL, device_id="dev-2",
                       timestamp=now + timedelta(seconds=10)),
        ]
        assert calculate_confidence_score(multi_device) > calculate_confidence_score(single_device)

    def test_score_clamped_to_range(self):
        now = datetime.utcnow()
        many = [
            _make_event(f"evt-{i}", EventSeverity.CRITICAL,
                       timestamp=now + timedelta(seconds=i))
            for i in range(100)
        ]
        score = calculate_confidence_score(many)
        assert 0.0 <= score <= 1.0


class TestIncidentTitle:
    """Tests for generate_incident_title."""

    def test_empty_events_returns_fallback(self):
        assert generate_incident_title([]) == "Unknown incident"

    def test_single_site_in_title(self, site_sfo_events):
        title = generate_incident_title(site_sfo_events)
        assert "SFO-01" in title or "site-sfo-01" in title

    def test_category_in_title(self, site_sfo_events):
        title = generate_incident_title(site_sfo_events)
        assert "connectivity" in title.lower()

    def test_device_count_in_title(self, site_sfo_events):
        title = generate_incident_title(site_sfo_events)
        assert "2" in title  # 2 unique devices


# ==============================================================================
# EventFactory Consistency — Ensure generated events match the real schema
# ==============================================================================

class TestEventFactoryHelpers:
    """Verify test event factory produces valid UnifiedEvents."""

    def test_event_has_all_required_fields(self):
        event = _make_event("test-1", EventSeverity.CRITICAL)
        assert event.event_id == "test-1"
        assert event.severity == EventSeverity.CRITICAL
        assert event.source == EventSource.MIST
        assert event.device is not None
        assert event.device.device_id == "dev-001"
        assert event.device.site_id == "site-sfo-01"

    def test_event_serialization_roundtrip(self):
        event = _make_event("rt-1", EventSeverity.MAJOR,
                           device_id="dev-001", site_id="site-nyc-01")
        d = event.to_db_row()
        assert d["event_id"] == "rt-1"
        assert d["severity"] == "major"
        assert d["device_id"] == "dev-001"
        assert d["site_id"] == "site-nyc-01"

    def test_event_different_sources(self):
        for source in EventSource:
            event = _make_event(f"src-{source.value}", EventSeverity.INFO,
                               source=source)
            assert event.source == source

    def test_event_with_client_info(self):
        from backend.tests.conftest import make_event
        event = make_event(
            event_id="client-test",
            severity=EventSeverity.MAJOR,
            client_id="client-mac-001",
        )
        assert event.client is not None
        assert event.client.client_id == "client-mac-001"


# ==============================================================================
# Pipeline Integration Tests (mocked)
# ==============================================================================

class TestCorrelationPipeline:
    """Verify the full pipeline: collect → normalize → correlate → incidents."""

    def test_worker_daemon_correlation_contract(self, default_config, site_sfo_events):
        """
        Simulate what WorkerDaemon.run_once does: collect events,
        persist them, run correlation, verify incidents produced.
        """
        # This tests the contract that the worker pipeline must fulfill
        from backend.shared.correlation import CorrelationEngine

        engine = CorrelationEngine(config=default_config)

        # Simulate: worker collected these events from collectors
        all_events = site_sfo_events

        # Simulate: worker persists events (we skip actual DB here)
        # Then runs correlation
        incidents = engine.process_events(all_events)

        # Verify incidents match expectations
        assert len(incidents) >= 1
        for incident in incidents:
            # Every incident must have these fields populated
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

            # All event IDs in the incident must be from the input set
            input_ids = {e.event_id for e in all_events}
            for eid in incident.related_event_ids:
                assert eid in input_ids

    def test_multi_source_pipeline(self, default_config, cross_vendor_events):
        """
        Simulate the pipeline with events from multiple vendors.
        This is the core value proposition: Mist + VeloCloud + DNAC
        events at the same site should be correlated together.
        """
        engine = CorrelationEngine(config=default_config)
        incidents = engine.process_events(cross_vendor_events)

        assert len(incidents) == 1
        incident = incidents[0]

        # Verify cross-vendor correlation
        sources_in_incident = set()
        for eid in incident.related_event_ids:
            for event in cross_vendor_events:
                if event.event_id == eid:
                    sources_in_incident.add(event.source)
                    break

        assert EventSource.MIST in sources_in_incident
        assert EventSource.VELOCLOUD in sources_in_incident
        assert EventSource.DNAC in sources_in_incident

    def test_incremental_correlation(self, default_config):
        """
        Simulate multiple worker cycles. The engine should only process
        new events each cycle, creating new incidents or appending to existing ones.
        """
        engine = CorrelationEngine(config=default_config)

        # Cycle 1: 2 events at site-a
        now = datetime.utcnow()
        cycle1 = [
            _make_event("c1-evt-1", EventSeverity.CRITICAL, site_id="site-a",
                       timestamp=now),
            _make_event("c1-evt-2", EventSeverity.MAJOR, site_id="site-a",
                       timestamp=now + timedelta(seconds=30)),
        ]
        incidents1 = engine.process_events(cycle1)
        assert len(incidents1) == 1
        assert engine.get_processed_count() == 2

        # Cycle 2: 2 new events at site-b (different site, gets its own incident)
        cycle2 = [
            _make_event("c2-evt-1", EventSeverity.CRITICAL, site_id="site-b",
                       timestamp=now + timedelta(seconds=120)),
            _make_event("c2-evt-2", EventSeverity.MAJOR, site_id="site-b",
                       timestamp=now + timedelta(seconds=150)),
        ]
        incidents2 = engine.process_events(cycle2)
        assert len(incidents2) == 1
        assert incidents2[0].affected_sites == ["site-b"]
        assert engine.get_processed_count() == 4

        # Cycle 3: 2 new events at site-c
        cycle3 = [
            _make_event("c3-evt-1", EventSeverity.CRITICAL, site_id="site-c",
                       timestamp=now + timedelta(seconds=200)),
            _make_event("c3-evt-2", EventSeverity.MAJOR, site_id="site-c",
                       timestamp=now + timedelta(seconds=230)),
        ]
        incidents3 = engine.process_events(cycle3)
        assert len(incidents3) == 1
        assert incidents3[0].affected_sites == ["site-c"]
        assert engine.get_processed_count() == 6


# ==============================================================================
# Helpers
# ==============================================================================


def _make_event(
    event_id: str,
    severity: EventSeverity,
    source: EventSource = EventSource.MIST,
    device_id: str = "dev-001",
    site_id: str = "site-sfo-01",
    timestamp: datetime = None,
) -> UnifiedEvent:
    """Minimal event factory for tests within this module."""
    from backend.tests.conftest import make_event
    return make_event(
        event_id=event_id,
        source=source,
        severity=severity,
        device_id=device_id,
        site_id=site_id,
        timestamp=timestamp or datetime.utcnow(),
    )
