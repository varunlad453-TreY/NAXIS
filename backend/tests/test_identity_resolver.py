"""
Unit tests for the canonical identity resolver.

Uses mocked DB calls so the resolver can be tested without a live Postgres
instance. Verifies the public API paths that the collectors rely on:
resolve_device, find_device, resolve_devices, resolve_site, resolve_sites.
"""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from backend.shared.database.identity import IdentityResolver


@pytest.fixture
def resolver():
    return IdentityResolver()


@pytest.fixture
def mocked_db(resolver):
    """Patch the resolver's DB module with deterministic responses."""
    with patch("backend.shared.database.identity.db") as mock_db:
        mock_db.pool = MagicMock()
        mock_db.fetchrow = AsyncMock(return_value=None)
        mock_db.fetch = AsyncMock(return_value=[])
        mock_db.execute = AsyncMock(return_value=None)
        mock_db.executemany = AsyncMock(return_value=None)
        yield mock_db


# ---------------------------------------------------------------------------
# resolve_device / find_device
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_resolve_device_creates_when_missing(resolver, mocked_db):
    """When no identity exists, a new device_key is created and returned."""
    mocked_db.fetchrow.return_value = None
    key = await resolver.resolve_device("mist", "ap-abc", display_name="AP-ABC")
    assert key
    # A device row and an identity row were inserted
    assert mocked_db.execute.call_count >= 2
    # The same vendor+id returns the same cached key
    key2 = await resolver.resolve_device("mist", "ap-abc")
    assert key2 == key
    # No extra DB call for the cached lookup
    assert mocked_db.fetchrow.call_count == 1


@pytest.mark.asyncio
async def test_find_device_existing_identity(resolver, mocked_db):
    """find_device returns the existing key without creating anything."""
    mocked_db.fetchrow.return_value = {"device_key": "dev-key-1"}
    key = await resolver.find_device("mist", "ap-abc")
    assert key == "dev-key-1"
    mocked_db.execute.assert_not_called()


@pytest.mark.asyncio
async def test_find_device_no_match_returns_none(resolver, mocked_db):
    mocked_db.fetchrow.return_value = None
    assert await resolver.find_device("mist", "ap-xyz") is None
    mocked_db.execute.assert_not_called()


@pytest.mark.asyncio
async def test_resolve_device_returns_existing_key(resolver, mocked_db):
    mocked_db.fetchrow.return_value = {"device_key": "existing-key"}
    key = await resolver.resolve_device("mist", "ap-abc", display_name="AP-ABC")
    assert key == "existing-key"
    # No inserts because the identity already existed
    mocked_db.execute.assert_not_called()


@pytest.mark.asyncio
async def test_resolve_device_empty_inputs_raises(resolver, mocked_db):
    with pytest.raises(ValueError):
        await resolver.resolve_device("", "ap-abc")
    with pytest.raises(ValueError):
        await resolver.resolve_device("mist", "")


# ---------------------------------------------------------------------------
# resolve_devices bulk
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_resolve_devices_bulk_creates_and_reuses(resolver, mocked_db):
    """Bulk resolve creates missing identities and reuses existing ones."""
    # First call: none exist, bulk creates all
    mocked_db.fetch.return_value = []
    pairs = [
        ("mist", "ap-1", {"display_name": "AP-1"}),
        ("mist", "ap-2", {"display_name": "AP-2"}),
    ]
    result = await resolver.resolve_devices(pairs)
    assert len(result) == 2
    assert result[("mist", "ap-1")] != result[("mist", "ap-2")]
    # One bulk find and one bulk create
    assert mocked_db.fetch.call_count == 1
    assert mocked_db.executemany.call_count == 2  # devices + identities


@pytest.mark.asyncio
async def test_resolve_devices_bulk_uses_existing(resolver, mocked_db):
    """Bulk resolve returns existing keys from the identity table."""
    mocked_db.fetch.return_value = [
        {"vendor": "mist", "vendor_device_id": "ap-1", "device_key": "key-1"},
    ]
    pairs = [
        ("mist", "ap-1", {"display_name": "AP-1"}),
        ("mist", "ap-2", {"display_name": "AP-2"}),
    ]
    result = await resolver.resolve_devices(pairs)
    assert result[("mist", "ap-1")] == "key-1"
    assert result[("mist", "ap-2")]
    # Only one device created (ap-2)
    assert mocked_db.executemany.call_count == 2


@pytest.mark.asyncio
async def test_resolve_devices_caches_within_instance(resolver, mocked_db):
    """The same bulk call is not repeated for the same resolver instance."""
    mocked_db.fetch.return_value = []
    pairs = [("mist", "ap-1", {})]
    await resolver.resolve_devices(pairs)
    await resolver.resolve_devices(pairs)
    # Only one DB fetch because the result was cached
    assert mocked_db.fetch.call_count == 1


# ---------------------------------------------------------------------------
# resolve_site / resolve_sites
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_resolve_site_creates_when_missing(resolver, mocked_db):
    mocked_db.fetchrow.return_value = None
    key = await resolver.resolve_site("site-101", site_name="Pimpri", vendor="mist")
    assert key
    mocked_db.execute.assert_called_once()


@pytest.mark.asyncio
async def test_resolve_site_returns_existing_key(resolver, mocked_db):
    mocked_db.fetchrow.return_value = {"site_key": "site-key-1"}
    key = await resolver.resolve_site("site-101", site_name="Pimpri", vendor="mist")
    assert key == "site-key-1"
    mocked_db.execute.assert_not_called()


@pytest.mark.asyncio
async def test_resolve_sites_bulk(resolver, mocked_db):
    mocked_db.fetch.return_value = [
        {"site_key": "site-key-1", "vendor_ids": {"mist": "site-101"}},
    ]
    specs = [
        ("site-101", "Pimpri", "mist", None),
        ("site-202", "NYC", "mist", None),
    ]
    result = await resolver.resolve_sites(specs)
    assert result[("mist", "site-101")] == "site-key-1"
    assert result[("mist", "site-202")]
    # One bulk find, one bulk create for the missing site
    assert mocked_db.fetch.call_count == 1
    assert mocked_db.executemany.call_count == 1
