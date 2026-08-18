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
    statements = [c.args[0] for c in mocked_db.execute.call_args_list]
    # The canonical row plus the identity row that claims the vendor id, plus the
    # locations mirror. The identity row is what makes the vendor id unique.
    assert any("INSERT INTO sites" in s for s in statements)
    assert any("INSERT INTO site_identities" in s for s in statements)


@pytest.mark.asyncio
async def test_resolve_site_returns_existing_key(resolver, mocked_db):
    mocked_db.fetchrow.return_value = {"site_key": "site-key-1"}
    key = await resolver.resolve_site("site-101", site_name="Pimpri", vendor="mist")
    assert key == "site-key-1"
    mocked_db.execute.assert_not_called()


@pytest.mark.asyncio
async def test_resolve_sites_bulk(resolver, mocked_db):
    mocked_db.fetch.side_effect = [
        # site_identities lookup resolves site-101 only
        [{"vendor": "mist", "vendor_site_id": "site-101", "site_key": "site-key-1"}],
        # legacy vendor_ids fallback finds nothing for site-202
        [],
        # post-create winner re-check
        [
            {"vendor": "mist", "vendor_site_id": "site-101", "site_key": "site-key-1"},
            {"vendor": "mist", "vendor_site_id": "site-202", "site_key": "site-key-2"},
        ],
    ]
    specs = [
        ("site-101", "Pimpri", "mist", None),
        ("site-202", "NYC", "mist", None),
    ]
    result = await resolver.resolve_sites(specs)
    assert result[("mist", "site-101")] == "site-key-1"
    # The identity table is authoritative, so a concurrent winner is adopted.
    assert result[("mist", "site-202")] == "site-key-2"
    # sites insert + site_identities claim
    assert mocked_db.executemany.call_count == 2


@pytest.mark.asyncio
async def test_resolve_sites_dedupes_repeated_specs(resolver, mocked_db):
    """Callers pass one spec per DEVICE, so the same site repeats many times.

    Each repeat used to be treated as a distinct missing site and, because the
    bulk create minted a fresh uuid per row with a never-firing
    ON CONFLICT (site_key), produced one duplicate `sites` row per device.
    """
    mocked_db.fetch.side_effect = [
        [],  # site_identities: nothing known
        [],  # legacy fallback: nothing known
        [{"vendor": "mist", "vendor_site_id": "site-101", "site_key": "site-key-1"}],
    ]
    specs = [("site-101", "Pimpri", "mist", None)] * 345

    result = await resolver.resolve_sites(specs)

    assert result[("mist", "site-101")] == "site-key-1"
    sites_insert = next(
        c for c in mocked_db.executemany.call_args_list if "INSERT INTO sites" in c.args[0]
    )
    assert len(sites_insert.args[1]) == 1, "345 repeats of one site must create one row"


# ---------------------------------------------------------------------------
# MAC reconciliation — one physical device, many vendor id forms
# ---------------------------------------------------------------------------

class TestMacReconciliation:
    """Mist emits three id forms for the same AP: '00000000-0000-0000-1000-<mac>'
    (inventory), a bare MAC (LLDP/topology), and a site-device UUID (events).

    Exact-match-only lookup minted a separate canonical device per form, so
    `devices` held 4,021 rows for 1,966 distinct MACs and current events
    resolved against none of them.
    """

    @pytest.mark.asyncio
    async def test_find_device_falls_back_to_mac_and_registers_alias(self, resolver, mocked_db):
        # No identity row for the bare-MAC form, but a device with that MAC exists.
        mocked_db.fetchrow.side_effect = [None, {"device_key": "dev-key-1"}]

        key = await resolver.find_device("mist", "a8:53:7d:81:d7:4f")

        assert key == "dev-key-1", "must reconcile to the existing canonical device"
        aliases = [
            c for c in mocked_db.execute.call_args_list
            if "INSERT INTO device_identities" in c.args[0]
        ]
        assert aliases, "the new id form must be registered as an alias"
        assert aliases[0].args[3] == "a8:53:7d:81:d7:4f", "alias keeps the raw vendor id"

    @pytest.mark.asyncio
    async def test_non_mac_id_does_not_reconcile(self, resolver, mocked_db):
        """A UUID that is not a MAC must not be coerced into a MAC lookup."""
        mocked_db.fetchrow.return_value = None
        key = await resolver.find_device("mist", "05a6aa52-c525-4491-9be9-2c08489c3686")
        assert key is None
        # Only the exact identity lookup ran; no devices.mac probe.
        assert mocked_db.fetchrow.call_count == 1

    @pytest.mark.asyncio
    async def test_bulk_create_reuses_device_for_known_mac(self, resolver, mocked_db):
        """A second id form for a known MAC adds an alias, not a second device."""
        mocked_db.fetch.side_effect = [
            [],  # no existing identities for these vendor ids
            [{"mac": "a8537d81d74f", "device_key": "dev-key-1"}],  # but the MAC is known
        ]

        result = await resolver.resolve_devices(
            [("mist", "00000000-0000-0000-1000-a8537d81d74f", {"mac": "a8537d81d74f"})]
        )

        assert result[("mist", "00000000-0000-0000-1000-a8537d81d74f")] == "dev-key-1"
        device_inserts = [
            c for c in mocked_db.executemany.call_args_list
            if "INSERT INTO devices" in c.args[0]
        ]
        assert not device_inserts, "must not mint a second canonical device"

    @pytest.mark.asyncio
    async def test_bulk_create_collapses_same_mac_within_one_batch(self, resolver, mocked_db):
        """Two id forms of one AP arriving in the same batch share one device_key."""
        # identity lookup, MAC fallback for misses, MAC probe inside create,
        # post-insert winner adoption
        mocked_db.fetch.side_effect = [[], [], [], []]

        result = await resolver.resolve_devices([
            ("mist", "00000000-0000-0000-1000-a8537d81d74f", {"mac": "a8537d81d74f"}),
            ("mist", "a8537d81d74f", {"mac": "a8537d81d74f"}),
        ])

        keys = set(result.values())
        assert len(keys) == 1, f"one physical AP must yield one device_key, got {keys}"
        device_inserts = next(
            c for c in mocked_db.executemany.call_args_list if "INSERT INTO devices" in c.args[0]
        )
        assert len(device_inserts.args[1]) == 1
        identity_inserts = next(
            c for c in mocked_db.executemany.call_args_list
            if "INSERT INTO device_identities" in c.args[0]
        )
        assert len(identity_inserts.args[1]) == 2, "both forms must be registered as aliases"

    @pytest.mark.asyncio
    async def test_adopts_concurrently_created_device(self, resolver, mocked_db):
        """Two collectors racing on the same MAC must converge on one device_key.

        Each collector holds its own resolver cache, so on a cold start both mint
        a key for the same MAC. The MAC uniqueness index means one INSERT is
        skipped; returning the skipped key produced FK violations downstream on
        topology_nodes.canonical_key.
        """
        # Only three queries run: the '00000000-...' id is 32 hex chars, so it is
        # not a MAC and the bulk MAC fallback short-circuits without querying.
        mocked_db.fetch.side_effect = [
            [],  # no identities
            [],  # MAC not known when create begins
            [{"mac": "a8537d81d74f", "device_key": "winner-key"}],  # another writer won
        ]

        result = await resolver.resolve_devices(
            [("mist", "00000000-0000-0000-1000-a8537d81d74f", {"mac": "a8537d81d74f"})]
        )

        key = result[("mist", "00000000-0000-0000-1000-a8537d81d74f")]
        assert key == "winner-key", "must adopt the persisted device, not the lost one"

        identity_insert = next(
            c for c in mocked_db.executemany.call_args_list
            if "INSERT INTO device_identities" in c.args[0]
        )
        assert identity_insert.args[1][0][0] == "winner-key", (
            "the alias must attach to the surviving device"
        )
