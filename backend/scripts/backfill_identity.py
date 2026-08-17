"""
Backfill canonical identity tables from existing inventory data.

Run once against an existing database to seed `sites`, `devices`, and
`device_identities` from the `inventory` table, then link `topology_nodes`
to the new canonical keys where the old node_id naming convention matches.

The script is idempotent: re-running it updates existing rows and inserts
missing ones.

Usage (from repo root with PYTHONPATH=backend):
    $env:PYTHONPATH="backend"
    $env:DATABASE_URL="postgresql+asyncpg://naxis:naxis_password@localhost:5433/naxis"
    python -m scripts.backfill_identity
"""

import asyncio
import json
import logging
from typing import Any, Dict, List, Tuple

try:
    from backend.shared.database.client import db
    from backend.shared.database.identity import IdentityResolver
except ImportError:
    from shared.database.client import db
    from shared.database.identity import IdentityResolver

logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO, format="%(levelname)s | %(message)s")


async def backfill_sites(resolver: IdentityResolver) -> Dict[Tuple[str, str], str]:
    """Seed sites from distinct inventory (platform, site_id, site_name)."""
    rows = await db.fetch(
        "SELECT DISTINCT platform, site_id, site_name FROM inventory WHERE site_id <> ''"
    )
    specs: List[Tuple[str, str, str, Optional[str]]] = []
    for row in rows:
        platform = (row["platform"] or "unknown").lower()
        site_id = row["site_id"]
        site_name = row["site_name"] or site_id
        specs.append((site_id, site_name, platform, None))

    result = await resolver.resolve_sites(specs)
    logger.info("Backfilled %d sites", len(result))
    return result


async def backfill_devices(
    resolver: IdentityResolver,
    site_map: Dict[Tuple[str, str], str],
) -> Dict[Tuple[str, str], str]:
    """Seed devices and identities from inventory rows."""
    rows = await db.fetch(
        """
        SELECT device_id, platform, hostname, mac, serial, model, device_type,
               ip_address, site_id, site_name, connected
        FROM inventory
        """
    )

    pairs: List[Tuple[str, str, Dict[str, Any]]] = []
    for row in rows:
        platform = (row["platform"] or "unknown").lower()
        vendor_id = row["device_id"]
        if not vendor_id:
            continue

        site_key = site_map.get((platform, row["site_id"]))
        hints: Dict[str, Any] = {
            "display_name": row["hostname"] or vendor_id,
            "device_type": row["device_type"] or "unknown",
            "model": row["model"] or "",
            "serial": row["serial"] or "",
            "mac": row["mac"] or "",
            "ip_address": row["ip_address"] or "",
            "site_key": site_key,
        }
        pairs.append((platform, vendor_id, hints))

        # Also index by MAC when available so MAC-based events resolve
        mac = row["mac"]
        if mac and isinstance(mac, str) and mac.strip():
            mac_hints = dict(hints)
            mac_hints["vendor_display_name"] = f"{row['hostname'] or vendor_id} (mac)"
            pairs.append((platform, mac.strip(), mac_hints))

    result = await resolver.resolve_devices(pairs)
    logger.info("Backfilled %d device identities", len(result))
    return result


async def link_topology_nodes(
    device_map: Dict[Tuple[str, str], str],
) -> int:
    """Set topology_nodes.canonical_key from the identity map."""
    # Build a lookup from vendor_id -> device_key per platform
    id_to_key: Dict[Tuple[str, str], str] = {}
    for (platform, vendor_id), device_key in device_map.items():
        id_to_key[(platform, vendor_id)] = device_key

    # Update Mist AP nodes: node_id = 'mist-ap-<inventory_uuid>'
    mist_ap_rows = await db.fetch(
        "SELECT node_id FROM topology_nodes WHERE node_id LIKE 'mist-ap-%' AND canonical_key IS NULL"
    )
    updates = 0
    for row in mist_ap_rows:
        node_id = row["node_id"]
        vendor_id = node_id[len("mist-ap-"):]
        device_key = id_to_key.get(("mist", vendor_id))
        if device_key:
            await db.execute(
                "UPDATE topology_nodes SET canonical_key = $1 WHERE node_id = $2",
                device_key,
                node_id,
            )
            updates += 1

    # Update VeloCloud edge nodes: node_id = 'velo-edge-<logical_id>'
    velo_rows = await db.fetch(
        "SELECT node_id FROM topology_nodes WHERE node_id LIKE 'velo-edge-%' AND canonical_key IS NULL"
    )
    for row in velo_rows:
        node_id = row["node_id"]
        vendor_id = node_id[len("velo-edge-"):]
        device_key = id_to_key.get(("velocloud", vendor_id))
        if device_key:
            await db.execute(
                "UPDATE topology_nodes SET canonical_key = $1 WHERE node_id = $2",
                device_key,
                node_id,
            )
            updates += 1

    logger.info("Linked %d topology nodes to canonical keys", updates)
    return updates


async def main() -> None:
    await db.connect()
    try:
        resolver = IdentityResolver()
        site_map = await backfill_sites(resolver)
        device_map = await backfill_devices(resolver, site_map)
        await link_topology_nodes(device_map)
        logger.info("Identity backfill complete")
    finally:
        await db.disconnect()


if __name__ == "__main__":
    asyncio.run(main())
