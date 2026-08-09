"""
Audit Logging Service (WP-4)

Provides async database helper functions to record user operations, role actions,
and system modifications into the PostgreSQL `audit_log` ledger.
"""

import json
import logging
from typing import Any, Dict, Optional
from datetime import datetime, timezone

try:
    from backend.shared.database.client import db
except ImportError:
    from shared.database.client import db

logger = logging.getLogger(__name__)


async def log_audit_event(
    user_id: str,
    username: str,
    user_role: str,
    action: str,
    resource_type: str,
    resource_id: Optional[str] = None,
    status: str = "success",
    details: Optional[Dict[str, Any]] = None,
    ip_address: Optional[str] = None,
) -> Optional[str]:
    """
    Persists an audit record to the `audit_log` table.

    Returns the audit_id (UUID string) if successful, or None on failure.
    """
    if details is None:
        details = {}

    query = """
        INSERT INTO audit_log (
            timestamp, user_id, username, user_role, action,
            resource_type, resource_id, ip_address, status, details
        )
        VALUES (NOW(), $1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
        RETURNING audit_id;
    """

    try:
        row = await db.fetchrow(
            query,
            user_id,
            username,
            user_role,
            action,
            resource_type,
            resource_id,
            ip_address,
            status,
            json.dumps(details),
        )
        if row:
            audit_id = str(row["audit_id"])
            logger.debug(
                "Audit record logged: user=%s action=%s status=%s audit_id=%s",
                username,
                action,
                status,
                audit_id,
            )
            return audit_id
    except Exception as exc:
        logger.exception("Failed to write audit log record: %s", exc)

    return None
