"""
Tests for resolve_stale_incidents().

Auto-close is otherwise purely event-driven: an incident resolves only when a
recovery event arrives for its root device. A device that recovered before the
incident was raised — or whose recovery event has rolled out of the 24-48h
event buffer — leaves an incident no future event can ever close. Retention
prunes only `resolved` rows, so those pile up indefinitely (61,744 open, none
ever resolved, when this was found).
"""

from unittest.mock import AsyncMock, patch

import pytest

import backend.shared.database.incidents as incidents_db
from backend.shared.models.incident import IncidentStatus


@pytest.mark.asyncio
async def test_resolves_only_open_incidents_past_the_window():
    fetch = AsyncMock(return_value=[{"incident_id": "inc-1"}, {"incident_id": "inc-2"}])
    with patch.object(incidents_db.db, "fetch", fetch):
        resolved = await incidents_db.resolve_stale_incidents(stale_hours=48)

    assert resolved == 2
    query, *args = fetch.call_args.args
    assert "UPDATE incidents" in query
    assert "status = $2" in query, "must filter to a single source status"
    assert args[0] == IncidentStatus.RESOLVED.value
    assert args[1] == IncidentStatus.OPEN.value, (
        "operator-managed states must not be swept"
    )
    assert args[2] == "48"
    assert "updated_at <" in query, "staleness is measured from last evidence"


@pytest.mark.asyncio
async def test_stale_hours_is_parameterised_not_interpolated():
    fetch = AsyncMock(return_value=[])
    with patch.object(incidents_db.db, "fetch", fetch):
        await incidents_db.resolve_stale_incidents(stale_hours=6)

    query, *args = fetch.call_args.args
    assert "6" not in query, "interval must come from a bind parameter"
    assert args[2] == "6"


@pytest.mark.asyncio
async def test_returns_zero_when_nothing_is_stale():
    with patch.object(incidents_db.db, "fetch", AsyncMock(return_value=[])):
        assert await incidents_db.resolve_stale_incidents() == 0
