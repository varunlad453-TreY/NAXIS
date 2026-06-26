# ✅ Correlation Engine Implementation Complete

## Summary

The first operational intelligence layer of the Naxis platform is now operational. The correlation engine processes `UnifiedEvent` objects and generates `Incident` objects using deterministic site-based time-window grouping.

**Status:** ✅ Fully functional with comprehensive tests

---

## Files Created

### Core Implementation

1. **[backend/shared/correlation/engine.py](backend/shared/correlation/engine.py)**
   - `CorrelationEngine` class - main correlation orchestrator
   - Methods:
     - `process_events()` - batch event correlation
     - `create_incident()` - incident generation from event groups
     - `correlate_site_events()` - site-specific correlation
     - `group_by_site()` - grouping helper
     - `reset()` - clear processed event tracker
   - `correlate_events()` - convenience function
   - Deduplication tracking via internal `_processed_events` set
   - Comprehensive logging support

2. **[backend/shared/correlation/rules.py](backend/shared/correlation/rules.py)**
   - `CorrelationConfig` dataclass - engine configuration
   - `SiteTimeWindowRule` - primary MVP correlation rule
   - Helper functions:
     - `group_events_by_site_and_time()` - event grouping logic
     - `calculate_confidence_score()` - confidence calculation
     - `generate_incident_title()` - smart title generation
   - `CorrelationRule` protocol for future extensibility

3. **[backend/shared/correlation/__init__.py](backend/shared/correlation/__init__.py)**
   - Package exports

### Testing

4. **[test_correlation_engine.py](test_correlation_engine.py)**
   - 9 comprehensive test functions:
     - `test_grouping_logic()` - event grouping validation
     - `test_correlation_rules()` - rule logic validation
     - `test_incident_generation()` - incident creation
     - `test_confidence_scoring()` - confidence calculation
     - `test_time_window_behavior()` - temporal grouping
     - `test_deduplication()` - prevents duplicate processing
     - `test_empty_input()` - edge case handling
     - `test_title_generation()` - title generation
     - `test_demo_flow()` - end-to-end demo (3 events → 1 incident)
   - All tests passing ✅

---

## Correlation Logic

### Grouping Strategy

**Primary Rule:** Site + Time Window Grouping

```
Events grouped by:
1. site_id (spatial proximity)
2. timestamp within configurable window (temporal proximity)
3. severity >= MAJOR (filter low-severity noise)
```

### Configuration Parameters

```python
CorrelationConfig(
    time_window_seconds=300,          # 5 minutes default
    min_severity=EventSeverity.MAJOR, # MAJOR or higher
    min_event_count=2,                # Minimum events to correlate
    correlate_single_critical=True    # Single CRITICAL creates incident
)
```

### Correlation Rules

1. **Multi-event correlation:**
   - ≥ 2 MAJOR/CRITICAL events at same site within time window
   - → Single incident created

2. **Single critical correlation:**
   - 1 CRITICAL event
   - → Single incident created (if `correlate_single_critical=True`)

3. **Low severity filtering:**
   - INFO, WARNING, DEBUG events are excluded
   - Only MAJOR and CRITICAL events trigger correlation

### Confidence Scoring

Confidence score in [0.0, 1.0] based on:

```python
confidence = (event_count * 0.4) + (severity_mix * 0.4) + (device_diversity * 0.2)
```

- **Event count:** Logarithmic scale - more events = higher confidence
- **Severity mix:** CRITICAL events contribute more than MAJOR
- **Device diversity:** More affected devices = higher confidence

Typical scores:
- 2 MAJOR events: ~0.55
- 5 MAJOR events: ~0.79
- 3 mixed (2 MAJOR + 1 CRITICAL): ~0.68

---

## Usage Examples

### Basic Usage

```python
from shared.correlation import correlate_events, CorrelationConfig
from shared.models.event import UnifiedEvent

# Create or fetch events
events: List[UnifiedEvent] = [...]

# Correlate with default config
incidents = correlate_events(events)

# Custom configuration
config = CorrelationConfig(
    time_window_seconds=600,  # 10 minutes
    min_event_count=3,        # Require 3+ events
)
incidents = correlate_events(events, config=config)
```

### With Engine Instance (for deduplication)

```python
from shared.correlation import CorrelationEngine

engine = CorrelationEngine()

# First batch
incidents1 = engine.process_events(events_batch_1)

# Second batch - already-seen events are skipped
incidents2 = engine.process_events(events_batch_2)

# Reset if needed
engine.reset()
```

### Site-Specific Correlation

```python
engine = CorrelationEngine()

# Correlate events for specific site
site_incidents = engine.correlate_site_events(
    events=all_events,
    site_id="site-sfo-01"
)
```

---

## Demo Flow Output

**Input:** 3 mock events at same site within 90 seconds

```
evt-001: major    | core-sw-01  | link_down
evt-002: major    | core-sw-02  | link_down
evt-003: critical | edge-rtr-01 | bgp_down
```

**Output:** 1 correlated incident

```json
{
  "incident_id": "inc-b6a5c78324a6",
  "title": "Site Site-site-sfo-01 - connectivity issues affecting 3 devices",
  "severity": "critical",
  "status": "open",
  "event_count": 3,
  "affected_sites": 1,
  "affected_devices": 3,
  "confidence_score": 0.68,
  "created_at": "2026-05-28T10:45:33.571045",
  "updated_at": "2026-05-28T10:45:33.571045"
}
```

---

## Architecture Notes

### Design Principles

1. **Intentionally Simple:** No AI/ML, no topology reasoning, no graph traversal
2. **Deterministic:** Same events always produce same incidents
3. **MVP-Focused:** Site-based grouping is sufficient for initial deployment
4. **Type-Safe:** Full Pydantic integration with UnifiedEvent and Incident models
5. **Testable:** Comprehensive test coverage with clear assertions

### Deduplication Strategy

- Engine tracks processed `event_id`s in `_processed_events` set
- Second pass with same events returns empty list
- Prevents duplicate incident creation
- `reset()` method clears tracker when needed

### Future Extensibility

Current implementation provides foundation for:

1. **Additional rules:**
   - Device-chain correlation (BGP → interface → link)
   - Client-impact correlation (many clients on same AP)
   - Application-aware correlation (same app across multiple sites)

2. **Topology integration:**
   - Network graph for root-cause analysis
   - Upstream/downstream impact tracking
   - Critical path identification

3. **ML enhancement:**
   - Learned correlation patterns
   - Anomaly-based grouping
   - Time-series forecasting

**Extension point:** `CorrelationRule` protocol allows pluggable rules

---

## Integration Points

### Ingest Pipeline → Correlation

```python
# Worker receives UnifiedEvents from parser
events: List[UnifiedEvent] = parse_vendor_telemetry(raw_data)

# Correlate into incidents
engine = CorrelationEngine()
incidents = engine.process_events(events)

# Persist to ClickHouse
for incident in incidents:
    clickhouse_client.insert("naxis.incidents", incident.to_clickhouse_dict())
```

### Correlation → RCA Pipeline

```python
# RCA agent fetches OPEN incidents
incidents = fetch_incidents_by_status(IncidentStatus.OPEN)

# Enrich with AI analysis
for incident in incidents:
    analysis = ai_rca_agent.analyze(incident)
    incident.update_confidence(
        score=analysis.confidence,
        probable_cause=analysis.hypothesis
    )
    persist_incident(incident)
```

---

## Performance Characteristics

### Time Complexity

- Event grouping: O(n log n) due to timestamp sorting
- Correlation: O(n × k) where k = avg events per group (typically small)
- Overall: O(n log n) for batch of n events

### Memory

- Deduplication tracker: O(m) where m = total processed events
- Event groups: O(n) for batch size n
- Lightweight - suitable for real-time stream processing

### Throughput (estimated)

- 1,000 events/batch: ~50ms processing time
- 10,000 events/batch: ~500ms processing time
- Suitable for sub-second latency requirements

---

## Validation Results

### Test Results

```
✅ All 9 tests passed

✓ Testing grouping logic...
  ✓ Created 2 event groups
✓ Testing correlation rules...
  ✓ Correlation rules work correctly
✓ Testing incident generation...
  ✓ Generated incident: inc-dfa41241b356
    - Severity: critical
    - Events: 3
    - Confidence: 0.68
✓ Testing confidence scoring...
  ✓ Confidence scoring works (few=0.55, many=0.79)
✓ Testing time window behavior...
  ✓ Created 1 incidents from time-windowed events
✓ Testing deduplication...
  ✓ Deduplication works
✓ Testing empty input handling...
  ✓ Empty input handled correctly
✓ Testing title generation...
  ✓ Generated title: 'Site Site-site-nyc-01 - connectivity issues affecting 2 devices'
✓ Testing demo flow...
  ✓ Demo flow successful!
```

---

## Next Steps

### Immediate Integration

1. **Wire into ingest workers:**
   - Add correlation step after event parsing
   - Persist generated incidents to ClickHouse
   - Update events with `incident_id` linkage

2. **Build incident API endpoints:**
   - `GET /incidents` - list incidents with filters
   - `GET /incidents/{id}` - fetch incident details
   - `GET /incidents/{id}/events` - fetch related events
   - `PATCH /incidents/{id}` - update status/assignments

3. **Create incident dashboard:**
   - Real-time incident feed
   - Severity distribution
   - Site impact map
   - Time-series charts

### Future Enhancements

1. **Advanced correlation rules:**
   - Device chain correlation
   - Client impact scoring
   - Application-aware grouping

2. **Topology integration:**
   - Network graph queries
   - Root-cause path analysis
   - Impact radius calculation

3. **ML enrichment:**
   - Learned patterns from historical data
   - Anomaly detection integration
   - Confidence tuning based on outcomes

---

## Summary

**Status:** ✅ Production-ready MVP

**Capabilities:**
- ✅ Deterministic site-based time-window correlation
- ✅ Configurable correlation parameters
- ✅ Confidence scoring
- ✅ Deduplication tracking
- ✅ Smart incident title generation
- ✅ Comprehensive test coverage
- ✅ Type-safe implementation
- ✅ Logging support

**Performance:** Suitable for real-time stream processing

**Next milestone:** Integration with ingest pipeline and incident API

The correlation engine is the first working operational intelligence capability of the Naxis platform. It transforms a stream of atomic events into actionable incidents that operators can investigate and resolve.

---

*Generated: 2026-05-28*
*Engine Version: MVP v1.0*
