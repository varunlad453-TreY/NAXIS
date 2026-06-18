"""
Naxis Correlation Engine

Deterministic rule-based correlation engine that groups UnifiedEvents
into correlated Incidents.

Flow:
    events → time-window grouping → site-based correlation → Incidents
"""

from .engine import CorrelationEngine, correlate_events
from .rules import CorrelationConfig, CorrelationRule, SiteTimeWindowRule

__all__ = [
    "CorrelationEngine",
    "correlate_events",
    "CorrelationConfig",
    "CorrelationRule",
    "SiteTimeWindowRule",
]
