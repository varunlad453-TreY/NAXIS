"""
Diagnostics Ledger Database Helper (WP-6)

Provides async database helper functions to persist and query live edge network
diagnostic test runs in PostgreSQL.
"""

import json
import logging
from typing import Any, Dict, List, Optional

try:
    from backend.shared.database.client import db
except ImportError:
    from shared.database.client import db

logger = logging.getLogger(__name__)


async def create_diagnostic_run(
    actor_id: str,
    actor_name: str,
    actor_role: str,
    target_device_id: str,
    target_device_name: str,
    test_type: str,
    status: str = "running",
    results_json: Optional[Dict[str, Any]] = None,
    duration_ms: float = 0.0,
) -> Optional[str]:
    """Inserts a new diagnostic run record into PostgreSQL and returns its UUID."""
    if results_json is None:
        results_json = {}

    query = """
        INSERT INTO diagnostic_runs (
            created_at, actor_id, actor_name, actor_role,
            target_device_id, target_device_name, test_type,
            status, results_json, duration_ms
        )
        VALUES (NOW(), $1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9)
        RETURNING run_id;
    """

    try:
        row = await db.fetchrow(
            query,
            actor_id,
            actor_name,
            actor_role,
            target_device_id,
            target_device_name,
            test_type,
            status,
            json.dumps(results_json),
            duration_ms,
        )
        if row:
            run_id = str(row["run_id"])
            logger.debug(
                "Diagnostic run created: actor=%s type=%s target=%s run_id=%s",
                actor_name,
                test_type,
                target_device_id,
                run_id,
            )
            return run_id
    except Exception as exc:
        logger.exception("Failed to insert diagnostic_run: %s", exc)

    return None


async def update_diagnostic_run(
    run_id: str,
    status: str,
    results_json: Dict[str, Any],
    duration_ms: float,
) -> bool:
    """Updates an existing diagnostic run with final execution status and results."""
    query = """
        UPDATE diagnostic_runs
        SET status = $1, results_json = $2::jsonb, duration_ms = $3
        WHERE run_id = $4::uuid;
    """

    try:
        res = await db.execute(query, status, json.dumps(results_json), duration_ms, run_id)
        return "UPDATE 1" in res
    except Exception as exc:
        logger.exception("Failed to update diagnostic_run %s: %s", run_id, exc)
        return False


async def list_diagnostic_runs(limit: int = 50) -> List[Dict[str, Any]]:
    """Lists recent diagnostic runs for audit and UI reporting."""
    query = """
        SELECT
            run_id::text,
            created_at,
            actor_id,
            actor_name,
            actor_role,
            target_device_id,
            target_device_name,
            test_type,
            status,
            results_json,
            duration_ms
        FROM diagnostic_runs
        ORDER BY created_at DESC
        LIMIT $1;
    """

    try:
        rows = await db.fetch(query, limit)
        return [dict(r) for r in rows]
    except Exception as exc:
        logger.exception("Failed to list diagnostic_runs: %s", exc)
        return []
