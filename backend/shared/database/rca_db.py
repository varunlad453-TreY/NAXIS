"""
RCA Database Helper (WP-7)

Provides async database helper functions to persist and query AI RCA reports in PostgreSQL.
"""

import json
import logging
from typing import Any, Dict, Optional

try:
    from backend.shared.database.client import db
except ImportError:
    from shared.database.client import db

logger = logging.getLogger(__name__)


async def save_rca(
    incident_id: str,
    confidence_score: float,
    summary: str,
    root_cause_hypothesis: str,
    mitigation_steps: list,
    citations_json: list,
    evidence_pack_json: Dict[str, Any],
) -> bool:
    """Inserts or updates an AI RCA diagnosis report in PostgreSQL."""
    query = """
        INSERT INTO incident_rca (
            incident_id, created_at, confidence_score, summary,
            root_cause_hypothesis, mitigation_steps, citations_json, evidence_pack_json
        )
        VALUES ($1, NOW(), $2, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb)
        ON CONFLICT (incident_id) DO UPDATE SET
            created_at = NOW(),
            confidence_score = EXCLUDED.confidence_score,
            summary = EXCLUDED.summary,
            root_cause_hypothesis = EXCLUDED.root_cause_hypothesis,
            mitigation_steps = EXCLUDED.mitigation_steps,
            citations_json = EXCLUDED.citations_json,
            evidence_pack_json = EXCLUDED.evidence_pack_json;
    """

    try:
        res = await db.execute(
            query,
            incident_id,
            confidence_score,
            summary,
            root_cause_hypothesis,
            json.dumps(mitigation_steps),
            json.dumps(citations_json),
            json.dumps(evidence_pack_json),
        )
        return "INSERT" in res or "UPDATE" in res
    except Exception as exc:
        logger.exception("Failed to save RCA for incident %s: %s", incident_id, exc)
        return False


async def get_rca(incident_id: str) -> Optional[Dict[str, Any]]:
    """Fetches RCA report for an incident."""
    query = """
        SELECT incident_id, created_at, confidence_score, summary,
               root_cause_hypothesis, mitigation_steps, citations_json, evidence_pack_json
        FROM incident_rca
        WHERE incident_id = $1;
    """
    try:
        row = await db.fetchrow(query, incident_id)
        return dict(row) if row else None
    except Exception as exc:
        logger.exception("Failed to fetch RCA for incident %s: %s", incident_id, exc)
        return None
