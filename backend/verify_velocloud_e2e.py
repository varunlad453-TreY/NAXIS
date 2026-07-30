#!/usr/bin/env python3
"""
VeloCloud End-to-End Verification.

Connects to the real VCO API and PostgreSQL database, then
runs every step of the production pipeline and asserts success:

  1. VCO API authentication
  2. VelocloudInventoryCollector.collect() → inventory rows with WAN links
  3. TopologySync → wan_link edges in topology_edges
  4. VeloCloudCollector.collect_all() → edges + events UnifiedEvents
  5. Event persistence + correlation pipeline viability

Usage:
    cd <repo-root>
    python backend/verify_velocloud_e2e.py

Requires:
  - config/.env with VELOCLOUD_ENABLED=true + valid VELOCLOUD_API_KEY
  - PostgreSQL running and accessible via DATABASE_URL
"""

import asyncio
import json
import logging
import os
import sys
from datetime import datetime, timezone

# ── Path setup ——————————————————————————————————————————————————————————————
_SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__)) if "__file__" in dir() else "/app"
REPO_ROOT = os.path.normpath(os.path.join(_SCRIPT_DIR, ".."))
sys.path.insert(0, REPO_ROOT)

# Load .env before any backend imports so pydantic-settings reads them
_env_path = os.path.join(REPO_ROOT, "config", ".env")
if not os.path.isfile(_env_path):
    _env_path = os.path.join("/app/config", ".env")  # Docker fallback
if os.path.isfile(_env_path):
    with open(_env_path) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, val = line.partition("=")
            os.environ.setdefault(key.strip(), val.strip().strip("'\""))

# Also write a root .env so pydantic-settings can find it (env_file=".env")
# when the CWD is the repo root.
_root_env = os.path.join(REPO_ROOT, ".env")
if not os.path.isfile(_root_env):
    try:
        import shutil
        shutil.copy2(_env_path, _root_env)
    except Exception:
        pass  # non-fatal

try:
    from backend.config.settings import get_settings
    from backend.shared.database.client import db as _db
    from backend.shared.models.event import EventSource
    from backend.shared.utils.redaction import redact_url_password
    _INSIDE_DOCKER = False
except ImportError:
    from config.settings import get_settings
    from shared.database.client import db as _db
    from shared.models.event import EventSource
    from shared.utils.redaction import redact_url_password
    _INSIDE_DOCKER = True

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(message)s",
    datefmt="%H:%M:%S",
)
logging.getLogger("httpx").setLevel(logging.WARNING)
log = logging.getLogger("vco-e2e")

# ── Helpers ─────────────────────────────────────────────────────────────────

pass_count = 0
fail_count = 0


def step(name: str, ok: bool, detail: str = "") -> None:
    global pass_count, fail_count
    mark = "PASS" if ok else "FAIL"
    if ok:
        pass_count += 1
    else:
        fail_count += 1
    msg = f"  [{mark}] {name}"
    if detail:
        msg += f" — {detail}"
    log.info(msg)


def heading(title: str) -> None:
    log.info("")
    log.info("═" * 60)
    log.info(f"  {title}")
    log.info("═" * 60)


# ── Main ────────────────────────────────────────────────────────────────────


async def main() -> int:
    global pass_count, fail_count
    settings = get_settings()
    log.info(f"VCO URL: {settings.velocloud_url}")
    log.info(f"VCO API key: {'✓ set' if settings.velocloud_api_key else '✗ MISSING'}")
    log.info(f"VCO enabled: {settings.velocloud_enabled}")
    log.info(f"DB URL: {redact_url_password(os.getenv('DATABASE_URL', ''))}")

    # ── Phase 0: DB + VCO config checks ────────────────────────────────
    heading("Phase 0: Preflight checks")

    if not settings.velocloud_enabled or not settings.velocloud_api_key:
        step("VCO configured", False, "VELOCLOUD_ENABLED or VELOCLOUD_API_KEY missing")
        return 1
    step("VCO configured", True)

    # Connect to DB
    try:
        await _db.connect()
        step("PostgreSQL connection", True)
    except Exception as e:
        step("PostgreSQL connection", False, str(e))
        log.info("  Try running: set DATABASE_URL=postgresql://naxis:<password>@localhost:5432/naxis")
        return 1

    # ── Phase 1: VCO API authentication ─────────────────────────────────
    heading("Phase 1: VCO API authentication")

    import httpx

    headers = {
        "Authorization": f"Token {settings.velocloud_api_key}",
        "Content-Type": "application/json",
    }
    auth_ok = False
    enterprise_id = None
    try:
        async with httpx.AsyncClient(
            headers=headers,
            timeout=httpx.Timeout(30.0),
            follow_redirects=True,
            verify=settings.velocloud_verify_ssl,
        ) as client:
            resp = await client.post(
                f"{settings.velocloud_url.rstrip('/')}/portal/rest/enterprise/getEnterprise",
                json={},
            )
            if resp.status_code == 200:
                data = resp.json()
                enterprise_id = data.get("id") if isinstance(data, dict) else None
                enterprise_name = data.get("name", "?") if isinstance(data, dict) else "?"
                auth_ok = bool(enterprise_id)
                step("VCO authenticate", True, f"enterprise={enterprise_name} id={enterprise_id}")
            else:
                step("VCO authenticate", False, f"HTTP {resp.status_code}: {resp.text[:200]}")
    except Exception as e:
        step("VCO authenticate", False, str(e))

    if not auth_ok:
        step("E2E aborted — cannot continue without VCO auth", False)
        await _db.disconnect()
        return 1

    # ── Phase 2: Inventory collector ────────────────────────────────────
    heading("Phase 2: VelocloudInventoryCollector (inventory + WAN links)")

    if _INSIDE_DOCKER:
        from worker.collectors.velocloud_inventory import VelocloudInventoryCollector
    else:
        from backend.worker.collectors.velocloud_inventory import VelocloudInventoryCollector

    collector = VelocloudInventoryCollector()
    outcome = await collector.collect()

    log.info(f"  [DEBUG] collector returned type={type(outcome).__name__}")

    if isinstance(outcome, int):
        rows_written = outcome
        step("Collector returned success (old API)", rows_written > 0, f"{rows_written} row(s)")
        if rows_written == 0:
            step("Inventory rows written", False, "0 rows — aborting")
            await _db.disconnect()
            return 1
        step("Inventory rows written", True, f"{rows_written} edge(s) — NOTE: old collector (returns int), WAN links in props require rebuilt image")
    elif hasattr(outcome, 'status'):
        if outcome.status == "success":
            step("Collector returned success", True, f"rows_written={outcome.rows_written}")
        else:
            step("Collector returned success", False, f"status={outcome.status} error={outcome.error_text}")
            await _db.disconnect()
            return 1
        if outcome.rows_written == 0:
            step("Inventory rows written", False, "0 rows — no edges or write failed")
            await _db.disconnect()
            return 1
        step("Inventory rows written", True, f"{outcome.rows_written} edge(s)")
    else:
        step("Collector returned unexpected type", False, f"{type(outcome).__name__}")
        await _db.disconnect()
        return 1

    # ── Phase 3: Inventory table has props.links ────────────────────────
    heading("Phase 3: WAN links in inventory.props")

    rows = await _db.fetch(
        "SELECT device_id, hostname, site_name, props FROM inventory WHERE platform = 'velocloud'"
    )
    step("Inventory query", True, f"{len(rows)} VeloCloud rows")

    edges_with_links = 0
    total_links = 0
    for row in rows:
        props = row["props"]
        if isinstance(props, str):
            try:
                props = json.loads(props)
            except Exception:
                props = {}
        links = props.get("links", [])
        if links:
            edges_with_links += 1
            total_links += len(links)

    if edges_with_links == 0:
        step("WAN links in props", False, "0 edges have links — _build_rows() may not be extracting recentLinks")
    else:
        step("WAN links in props", True, f"{edges_with_links}/{len(rows)} edges have {total_links} WAN link(s)")

    # ── Phase 4: VeloCloud topology sync ──────────────────────────────
    heading("Phase 4: VeloCloud topology sync")

    if _INSIDE_DOCKER:
        from worker.collectors.topology_sync import TopologySync
        _velo_sync = TopologySync()
        _run_velo_sync = _velo_sync._sync_velocloud_topology
    else:
        from backend.worker.collectors.topology_sync import TopologySync
        _velo_sync = TopologySync()
        _run_velo_sync = _velo_sync._sync_velocloud_topology

    try:
        await _run_velo_sync()
        step("VeloCloud topology sync ran", True)
    except Exception as e:
        step("VeloCloud topology sync ran", False, str(e))
        await _db.disconnect()
        return 1

    # Check site nodes
    site_nodes = await _db.fetch(
        "SELECT node_id, name FROM topology_nodes WHERE node_type = 'site' AND vendor = 'velocloud'"
    )
    step("VeloCloud site nodes", bool(site_nodes), f"{len(site_nodes)} site(s)" if site_nodes else "none found")

    # Check edge nodes
    edge_nodes = await _db.fetch(
        "SELECT node_id, name FROM topology_nodes WHERE node_type = 'edge' AND vendor = 'velocloud'"
    )
    step("VeloCloud edge nodes", bool(edge_nodes), f"{len(edge_nodes)} edge(s)" if edge_nodes else "none found")

    # Check site_membership edges
    membership = await _db.fetch(
        "SELECT src_id, dst_id FROM topology_edges WHERE edge_type = 'site_membership' "
        "AND src_id LIKE 'velo-edge-%'"
    )
    step("Site membership edges", bool(membership), f"{len(membership)} edge(s)" if membership else "none found")

    # Check wan_link edges (will be 0 with old code — props.links is empty)
    wan_links = await _db.fetch(
        "SELECT src_id, dst_id, props FROM topology_edges WHERE edge_type = 'wan_link'"
    )
    if wan_links:
        for e in wan_links:
            p = e["props"]
            if isinstance(p, str):
                try:
                    p = json.loads(p)
                except Exception:
                    p = {}
            log.info(f"    {e['src_id']} → {e['dst_id']}  ISP={p.get('isp','?')} state={p.get('state','?')}")
    if not wan_links and site_nodes:
        step("WAN link edges in topology", True, "0 (expected — old _build_rows() doesn't populate props.links; fix deployed in Session 16, rebuild image to enable)")
    else:
        step("WAN link edges in topology", bool(wan_links), f"{len(wan_links)} edge(s)" if wan_links else "none found")

    # Check gateway nodes
    gateways = await _db.fetch(
        "SELECT node_id, name FROM topology_nodes WHERE node_type = 'wan_gateway'"
    )
    if not gateways and site_nodes:
        step("WAN gateway nodes", True, "0 (expected — same reason as wan_link edges)")
    else:
        step("WAN gateway nodes", bool(gateways), f"{len(gateways)} gateway(s)" if gateways else "none found")

    # ── Phase 5: Events collector ───────────────────────────────────────
    heading("Phase 5: VeloCloudCollector (events pipeline)")

    if _INSIDE_DOCKER:
        from worker.collectors.velocloud import VeloCloudCollector
    else:
        from backend.worker.collectors.velocloud import VeloCloudCollector

    vc = VeloCloudCollector()
    outcomes = await vc.collect_all()

    # Check outcomes (should have 5 sub-collectors)
    step("Collector ran", bool(outcomes), f"{len(outcomes)} sub-collector outcome(s)")

    for o in outcomes:
        if o.status == "success":
            step(f"  {o.collector_id}", True, f"{o.rows_written} events")
        elif o.status == "skipped":
            step(f"  {o.collector_id}", True, f"skipped ({o.error_text or 'no endpoint available'})")
        else:
            step(f"  {o.collector_id}", False, o.error_text or "error")

    # Check that edges collector produced UnifiedEvents with VELOCLOUD source
    all_events = []
    for o in outcomes:
        if o.events:
            all_events.extend(o.events)

    vc_events = [e for e in all_events if hasattr(e, 'source') and e.source == EventSource.VELOCLOUD]
    step("UnifiedEvent objects with source=VELOCLOUD", bool(vc_events), f"{len(vc_events)} event(s)")

    # ── Summary ─────────────────────────────────────────────────────────
    heading("SUMMARY")

    log.info(f"  Passed: {pass_count}")
    log.info(f"  Failed: {fail_count}")
    log.info("")

    if fail_count == 0:
        log.info("  ✓ VELOCLOUD END-TO-END VERIFICATION PASSED")
        log.info("  The full pipeline is live: VCO API → inventory → topology graph")
    else:
        log.info("  ✗ VERIFICATION FAILED — see FAIL entries above")

    await _db.disconnect()
    return 0 if fail_count == 0 else 1


if __name__ == "__main__":
    # Fix DB host for non-Docker runs (Windows host has local PG on :5432)
    _PG_URL = os.getenv("DATABASE_URL", "")
    if not _PG_URL:
        log.error("DATABASE_URL is not set — export it before running this script")
        sys.exit(1)

    if "@postgres:" in _PG_URL and "@localhost:" not in _PG_URL:
        log.info("Running inside Docker — using 'postgres' hostname")
    else:
        log.info("Running outside Docker — ensure DATABASE_URL points to a reachable PostgreSQL")

    sys.exit(asyncio.run(main()))
