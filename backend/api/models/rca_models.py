"""
Root Cause Analysis (RCA) Pydantic Schemas (WP-7)

Defines data models for sanitized evidence items, evidence packs, citations, and AI RCA reports.
"""

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field


class EvidenceItem(BaseModel):
    """Single sanitized evidence record assigned a unique EVD-XX citation tag."""
    evidence_id: str = Field(..., description="Unique evidence citation tag e.g. EVD-01")
    item_type: str = Field(..., description="Type: 'incident' | 'event' | 'path_hop' | 'telemetry'")
    timestamp: str = Field(..., description="Timestamp or freshness label")
    source: str = Field(..., description="Originating vendor or system")
    summary: str = Field(..., description="Sanitized human-readable telemetry summary")
    details: Dict[str, Any] = Field(default_factory=dict, description="Metadata details")


class SanitizedEvidencePack(BaseModel):
    """Complete anonymized evidence pack supplied to the LLM prompt engine."""
    pack_id: str = Field(..., description="Pack UUID")
    incident_id: str = Field(..., description="Associated Incident ID")
    created_at: datetime = Field(default_factory=datetime.utcnow, description="Pack creation timestamp")
    evidence_items: List[EvidenceItem] = Field(default_factory=list, description="Array of sanitized evidence items")
    anonymization_map: Dict[str, Any] = Field(default_factory=dict, description="PII redaction statistics")


class RCACitation(BaseModel):
    """Citation linking an AI statement to a specific evidence ID."""
    citation_id: str = Field(..., description="Matching Evidence ID e.g. EVD-02")
    evidence_summary: str = Field(..., description="Summary of cited telemetry")


class RCAResponse(BaseModel):
    """Falsifiable AI Root Cause Analysis diagnosis report."""
    incident_id: str = Field(..., description="Associated Incident ID")
    generated_at: datetime = Field(default_factory=datetime.utcnow, description="RCA generation timestamp")
    confidence_score: float = Field(..., description="Model confidence score between 0.0 and 1.0")
    summary: str = Field(..., description="Plain-English diagnosis summary with bracketed [EVD-XX] citations")
    root_cause_hypothesis: str = Field(..., description="Primary technical root cause hypothesis")
    mitigation_steps: List[str] = Field(default_factory=list, description="Ordered actionable remediation steps")
    citations: List[RCACitation] = Field(default_factory=list, description="Array of evidence citations")
    evidence_pack: SanitizedEvidencePack = Field(..., description="Sanitized evidence pack used for analysis")
