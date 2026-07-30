"""
Naxis Correlation Engine

Deterministic rule-based correlation engine that groups UnifiedEvents
into correlated Incidents.

Flow:
    events → time-window grouping → site-based correlation (Stage 1)
           → topology cascade (Stage 2) → Incidents
"""

from .engine import CorrelationEngine, correlate_events
from .rules import (
    CascadeGroup,
    CorrelationConfig,
    CorrelationRule,
    SiteTimeWindowRule,
    TopologyCascadeRule,
    TopologyProvider,
    calculate_confidence_score,
    generate_incident_title,
    group_events_by_site_and_time,
)

__all__ = [
    "CorrelationEngine",
    "correlate_events",
    "CorrelationConfig",
    "CorrelationRule",
    "SiteTimeWindowRule",
    "TopologyCascadeRule",
    "TopologyProvider",
    "CascadeGroup",
    "calculate_confidence_score",
    "generate_incident_title",
    "group_events_by_site_and_time",
]
