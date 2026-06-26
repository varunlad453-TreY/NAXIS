# Mock Telemetry Pipeline

End-to-end simulation of the Naxis operational intelligence pipeline with realistic vendor payloads.

## Quick Start

```bash
# Run the complete pipeline
python3 backend/worker/mock_ingest/runner.py
```

## What It Does

```
Mock Vendor Telemetry → UnifiedEvent → CorrelationEngine → Incidents
```

1. Generates realistic payloads from DNAC, Mist, SD-WAN
2. Normalizes to UnifiedEvent schema
3. Runs correlation engine
4. Outputs generated incidents with statistics

## Files

- `runner.py` - Main pipeline orchestrator (executable)
- `dnac_mock.py` - Cisco DNAC generator + normalizer
- `mist_mock.py` - Juniper Mist generator + normalizer
- `sdwan_mock.py` - SD-WAN generator + normalizer
- `sample_payloads.py` - Realistic vendor payload templates

## Example Output

```
[STEP 1] Generating mock vendor telemetry...
  ✓ DNAC:   2 events
  ✓ Mist:   2 events
  ✓ SD-WAN: 2 events

[STEP 2] Normalizing to UnifiedEvent schema...
  ✓ Normalized 6 events

[STEP 3] Running correlation engine...
  ✓ Generated 2 incidents

STATISTICS
  Total events processed:     6
  Incidents generated:        2
  Total devices affected:     6
  Correlation success rate:   33.3%
```

## Usage in Code

```python
from backend.worker.mock_ingest import (
    DNACMockGenerator,
    MistMockGenerator,
    SDWANMockGenerator,
)

# Generate DNAC events
dnac_gen = DNACMockGenerator(site_id="site-nyc-01")
payloads = dnac_gen.generate_events(count=5)
events = [dnac_gen.normalize_payload(p) for p in payloads]

# Use with correlation engine
from backend.shared.correlation import correlate_events
incidents = correlate_events(events)
```

## Customization

```python
from backend.worker.mock_ingest.runner import MockTelemetryPipeline

pipeline = MockTelemetryPipeline(site_id="custom-site")
incidents = pipeline.run(
    dnac_count=10,
    mist_count=5,
    sdwan_count=7,
)
```

## Documentation

See [MOCK_TELEMETRY_COMPLETE.md](../../../MOCK_TELEMETRY_COMPLETE.md) for full documentation.
