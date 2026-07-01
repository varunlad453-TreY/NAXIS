"""
SD-WAN Intelligence Chat

Natural-language query interface powered entirely by real VeloBrain data
stored in the inventory table (props JSONB) and VCO events pulled live.

No external LLM — answers are built from real metrics:
  scoreTx/Rx, latency, jitter, loss, bps, link state, edge reachability.
"""

import json
import logging
import re
import time
from typing import Any, Dict, List, Optional

import httpx
from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel

from config.settings import get_settings
from shared.database.client import db

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/sdwan", tags=["sdwan"])

_settings = get_settings()

# ── Pydantic models ────────────────────────────────────────────────────────────

class ChatMessage(BaseModel):
    role: str  # "user" or "assistant"
    content: str

class ChatRequest(BaseModel):
    message: str
    history: List[ChatMessage] = []

class ChatResponse(BaseModel):
    answer: str
    data: Optional[List[Dict[str, Any]]] = None
    intent: str = "unknown"

# ── Intent detection ───────────────────────────────────────────────────────────

_INTENTS = [
    ("capacity",           r"capacit|utilisa|utiliz|saturat|provision|mbps|mbit|upload.*speed|download.*speed|bandwidth.*plan|plan.*bandwidth|link.*size|circuit.*size"),
    ("worst_sites",        r"worst|bottom|lowest score|poorest|bad.*site|site.*bad|degraded.*site"),
    ("site_health",        r"site|location|branch|office"),
    ("edge_detail",        r"why|what.*wrong|problem|issue|fault|check.*edge|edge.*check|detail|diagnose"),
    ("offline_edges",      r"offline|down|unreachable|not connected|disconnected"),
    ("degraded_edges",     r"degrad|unstable|poor|bad.*link|link.*bad|low score"),
    ("link_quality",       r"latency|jitter|loss|packet|bandwidth|speed|quality|score"),
    ("top_edges",          r"best|top|healthy|good.*edge|edge.*good|highest score|performing"),
    ("unstable_links",     r"unstable|flap|fluctuat"),
    ("summary",            r"summar|overview|status|how.*doing|overall|health.*check|report"),
    ("edge_count",         r"how many|count|total|number of"),
]

def _detect_intent(text: str) -> str:
    lower = text.lower()
    for intent, pattern in _INTENTS:
        if re.search(pattern, lower):
            return intent
    return "summary"

def _extract_name(text: str) -> Optional[str]:
    """Try to pull an edge/site name from the query."""
    # Look for quoted name
    m = re.search(r'["\']([^"\']+)["\']', text)
    if m:
        return m.group(1)
    # Strip common question words and return remainder
    cleaned = re.sub(
        r'\b(why|is|the|edge|site|link|branch|what|wrong|with|about|check|show|me|status|of|for|at|in)\b',
        ' ', text.lower()
    ).strip()
    cleaned = re.sub(r'\s+', ' ', cleaned).strip()
    return cleaned if len(cleaned) > 2 else None

# ── DB helpers ────────────────────────────────────────────────────────────────

async def _all_edges() -> List[Dict]:
    rows = await db.fetch(
        "SELECT device_id, hostname, site_name, reachability, firmware_version, props "
        "FROM inventory WHERE platform = 'velocloud' ORDER BY site_name, hostname"
    )
    result = []
    for r in rows:
        raw = r["props"]
        props = json.loads(raw) if isinstance(raw, str) else (raw or {})
        # Pass through all link fields (includes capacity: upstream_mbps, downstream_mbps, isp, public_ip)
        result.append({
            "device_id": r["device_id"],
            "hostname": r["hostname"],
            "site_name": r["site_name"],
            "reachability": r["reachability"],
            "firmware_version": r["firmware_version"],
            "score": props.get("velobrain_score"),
            "links": props.get("links", []),
        })
    return result

def _score_str(score) -> str:
    if score is None:
        return "no data"
    s = float(score)
    label = "Excellent" if s >= 4.5 else "Good" if s >= 4 else "Fair" if s >= 3 else "Poor" if s >= 2 else "Critical"
    return f"{s:.1f}/5 ({label})"

def _worst_metric(links: List[Dict]) -> str:
    """Return a plain-English description of which metric is causing score degradation."""
    if not links:
        return "no link data available"
    msgs = []
    for lk in links:
        name = lk.get("name", "link")
        lat = max(lk.get("latency_ms_rx", 0), lk.get("latency_ms_tx", 0))
        jit = max(lk.get("jitter_ms_rx", 0), lk.get("jitter_ms_tx", 0))
        loss = max(lk.get("loss_pct_rx", 0), lk.get("loss_pct_tx", 0))
        state = lk.get("state", "")
        issues = []
        if state not in ("STABLE", ""):
            issues.append(f"link state is {state}")
        if lat > 150:
            issues.append(f"high latency ({lat:.0f} ms)")
        elif lat > 80:
            issues.append(f"elevated latency ({lat:.0f} ms)")
        if jit > 30:
            issues.append(f"high jitter ({jit:.0f} ms)")
        elif jit > 10:
            issues.append(f"elevated jitter ({jit:.0f} ms)")
        if loss > 1:
            issues.append(f"packet loss {loss:.1f}%")
        elif loss > 0.2:
            issues.append(f"minor packet loss ({loss:.2f}%)")
        if issues:
            msgs.append(f"{name}: {', '.join(issues)}")
        else:
            score = min(lk.get("score_tx", 5), lk.get("score_rx", 5))
            if score < 3.5:
                msgs.append(f"{name}: metrics degraded (score {score:.1f})")
    return "; ".join(msgs) if msgs else "metrics within normal range"

# ── VCO live events ────────────────────────────────────────────────────────────

async def _fetch_vco_events(edge_hostname: Optional[str] = None, hours: int = 4) -> List[Dict]:
    """Fetch recent VCO events. Optionally filter by edge name."""
    if not _settings.velocloud_enabled or not _settings.velocloud_api_key:
        return []
    try:
        now_ms = int(time.time() * 1000)
        headers = {
            "Authorization": f"Token {_settings.velocloud_api_key}",
            "Content-Type": "application/json",
        }
        async with httpx.AsyncClient(headers=headers, timeout=20, verify=False) as client:
            r = await client.post(
                f"{_settings.velocloud_url.rstrip('/')}/portal/rest/enterprise/getEnterprise",
                json={},
            )
            eid = r.json().get("id")
            r2 = await client.post(
                f"{_settings.velocloud_url.rstrip('/')}/portal/rest/event/getEnterpriseEvents",
                json={"enterpriseId": eid, "interval": {"start": now_ms - hours * 3_600_000, "end": now_ms}},
            )
            data = r2.json()
            events = data.get("data", []) if isinstance(data, dict) else []
            # Filter out pure config events for readability
            events = [e for e in events if e.get("severity") != "INFO" or e.get("category") != "EDGE"]
            if edge_hostname:
                term = edge_hostname.lower()
                events = [e for e in events if term in (e.get("message") or "").lower()
                          or term in (e.get("detail") or "").lower()]
            return events[:20]
    except Exception as exc:
        logger.warning("VCO events fetch failed: %s", exc)
        return []

# ── Intent handlers ────────────────────────────────────────────────────────────

async def _handle_summary(edges: List[Dict]) -> ChatResponse:
    total = len(edges)
    connected = sum(1 for e in edges if e["reachability"] == "reachable")
    degraded = sum(1 for e in edges if e["reachability"] == "degraded")
    offline = sum(1 for e in edges if e["reachability"] == "unreachable")
    scored = [e for e in edges if e["score"] is not None]
    avg_score = sum(e["score"] for e in scored) / len(scored) if scored else None
    critical = [e for e in scored if e["score"] < 2]
    poor = [e for e in scored if 2 <= e["score"] < 3]
    sites = len(set(e["site_name"] for e in edges))

    lines = [
        f"**SD-WAN Network Health — Tata Motors**",
        f"",
        f"- **{total}** edges across **{sites}** sites",
        f"- **{connected}** connected · **{degraded}** degraded · **{offline}** offline",
    ]
    if avg_score is not None:
        lines.append(f"- Average VeloBrain score: **{avg_score:.1f}/5**")
    if critical:
        lines.append(f"- ⚠ **{len(critical)}** edges in critical state (score < 2.0)")
    if poor:
        lines.append(f"- **{len(poor)}** edges with poor link quality (score 2–3)")
    if offline > 0:
        names = ", ".join(e["hostname"] for e in edges if e["reachability"] == "unreachable")[:120]
        lines.append(f"- Offline edges: {names}")
    if not critical and not poor and offline == 0:
        lines.append("- ✅ No critical issues detected")

    return ChatResponse(answer="\n".join(lines), intent="summary")


async def _handle_worst_sites(edges: List[Dict]) -> ChatResponse:
    scored = [e for e in edges if e["score"] is not None]
    scored.sort(key=lambda e: e["score"])
    worst = scored[:8]
    if not worst:
        return ChatResponse(answer="No VeloBrain scores available yet — metrics are collected every 60 seconds.", intent="worst_sites")

    lines = ["**Lowest VeloBrain scores:**", ""]
    for e in worst:
        issue = _worst_metric(e["links"])
        lines.append(f"- **{e['hostname']}** ({e['site_name']}) — {_score_str(e['score'])} · {issue}")
    return ChatResponse(answer="\n".join(lines), data=worst, intent="worst_sites")


async def _handle_top_edges(edges: List[Dict]) -> ChatResponse:
    scored = [e for e in edges if e["score"] is not None]
    scored.sort(key=lambda e: -e["score"])
    best = scored[:8]
    if not best:
        return ChatResponse(answer="No VeloBrain scores available yet.", intent="top_edges")

    lines = ["**Highest performing edges:**", ""]
    for e in best:
        lines.append(f"- **{e['hostname']}** ({e['site_name']}) — {_score_str(e['score'])}")
    return ChatResponse(answer="\n".join(lines), data=best, intent="top_edges")


async def _handle_offline(edges: List[Dict]) -> ChatResponse:
    offline = [e for e in edges if e["reachability"] == "unreachable"]
    if not offline:
        return ChatResponse(answer="✅ No edges are currently offline.", intent="offline_edges")

    lines = [f"**{len(offline)} offline edge(s):**", ""]
    for e in offline:
        events = await _fetch_vco_events(e["hostname"], hours=2)
        event_note = f" — last event: {events[0]['event']}" if events else ""
        lines.append(f"- **{e['hostname']}** at {e['site_name']}{event_note}")
    lines.append("")
    lines.append("Check the **Troubleshoot → Edge Offline** guide for step-by-step recovery.")
    return ChatResponse(answer="\n".join(lines), data=offline, intent="offline_edges")


async def _handle_degraded(edges: List[Dict]) -> ChatResponse:
    degraded = [e for e in edges if e["reachability"] == "degraded"
                or (e["score"] is not None and e["score"] < 3.5)]
    if not degraded:
        return ChatResponse(answer="✅ No degraded edges detected. All VeloBrain scores are above 3.5.", intent="degraded_edges")

    degraded.sort(key=lambda e: e["score"] if e["score"] is not None else 5)
    lines = [f"**{len(degraded)} edge(s) with degraded quality:**", ""]
    for e in degraded[:10]:
        issue = _worst_metric(e["links"])
        lines.append(f"- **{e['hostname']}** ({e['site_name']}) — {_score_str(e['score'])} — {issue}")
    return ChatResponse(answer="\n".join(lines), data=degraded, intent="degraded_edges")


async def _handle_unstable_links(edges: List[Dict]) -> ChatResponse:
    unstable = []
    for e in edges:
        for lk in e["links"]:
            if lk.get("state") not in ("STABLE", ""):
                unstable.append({"edge": e["hostname"], "site": e["site_name"],
                                  "link": lk.get("name"), "state": lk.get("state"),
                                  "score": min(lk.get("score_tx", 5), lk.get("score_rx", 5))})
    if not unstable:
        return ChatResponse(answer="✅ All WAN links are currently STABLE.", intent="unstable_links")

    lines = [f"**{len(unstable)} unstable WAN link(s):**", ""]
    for u in unstable[:12]:
        lines.append(f"- **{u['edge']}** / {u['link']} — state: **{u['state']}** (score {u['score']:.1f})")
    return ChatResponse(answer="\n".join(lines), data=unstable, intent="unstable_links")


async def _handle_link_quality(edges: List[Dict], query: str) -> ChatResponse:
    name = _extract_name(query)
    if name:
        matches = [e for e in edges if name in e["hostname"].lower() or name in e["site_name"].lower()]
    else:
        matches = sorted([e for e in edges if e["score"] is not None], key=lambda e: e["score"])[:5]

    if not matches:
        return ChatResponse(answer=f"No edges found matching '{name}'. Try the edge hostname or site name.", intent="link_quality")

    lines = []
    for e in matches[:5]:
        lines.append(f"**{e['hostname']}** ({e['site_name']}) — VeloBrain: {_score_str(e['score'])}")
        for lk in e["links"]:
            lat = max(lk.get("latency_ms_rx", 0), lk.get("latency_ms_tx", 0))
            jit = max(lk.get("jitter_ms_rx", 0), lk.get("jitter_ms_tx", 0))
            loss = max(lk.get("loss_pct_rx", 0), lk.get("loss_pct_tx", 0))
            bps_rx = lk.get("bps_rx", 0)
            bps_tx = lk.get("bps_tx", 0)
            mbps_rx = bps_rx / 1_000_000 if bps_rx else 0
            mbps_tx = bps_tx / 1_000_000 if bps_tx else 0
            score = min(lk.get("score_tx", 5), lk.get("score_rx", 5))
            lines.append(
                f"  · {lk.get('name','link')} [{lk.get('state','?')}] — "
                f"score {score:.1f} · latency {lat:.1f} ms · jitter {jit:.1f} ms · "
                f"loss {loss:.2f}% · ↓{mbps_rx:.0f}/↑{mbps_tx:.0f} Mbps"
            )
        lines.append("")
    return ChatResponse(answer="\n".join(lines).strip(), data=matches, intent="link_quality")


async def _handle_edge_detail(edges: List[Dict], query: str) -> ChatResponse:
    name = _extract_name(query)
    if not name:
        return ChatResponse(answer="Which edge or site do you want to check? Try: *why is BANER degraded?*", intent="edge_detail")

    matches = [e for e in edges if name in e["hostname"].lower() or name in e["site_name"].lower()]
    if not matches:
        return ChatResponse(answer=f"No edge found matching '{name}'. Check the Edges tab for the exact hostname.", intent="edge_detail")

    e = matches[0]
    events = await _fetch_vco_events(e["hostname"], hours=6)
    lines = [f"**{e['hostname']}** — {e['site_name']}"]
    lines.append(f"- Status: **{e['reachability'].upper()}**")
    lines.append(f"- VeloBrain score: **{_score_str(e['score'])}**")
    lines.append(f"- Firmware: {e['firmware_version'] or 'unknown'}")

    if e["links"]:
        lines.append("")
        lines.append("**WAN Links:**")
        for lk in e["links"]:
            issue = _worst_metric([lk])
            score = min(lk.get("score_tx", 5), lk.get("score_rx", 5))
            lines.append(f"  · **{lk.get('name')}** [{lk.get('state','?')}] — score {score:.1f} — {issue}")

    if events:
        lines.append("")
        lines.append("**Recent VCO events (last 6h):**")
        for ev in events[:5]:
            t = ev.get("eventTime", "")[:16].replace("T", " ")
            lines.append(f"  · [{t}] **{ev.get('event')}** — {ev.get('message','')[:80]}")

    diagnosis = _worst_metric(e["links"])
    if e["reachability"] == "unreachable":
        lines.append("")
        lines.append("⚠ **Edge is offline.** See **Troubleshoot → Edge Offline** for recovery steps.")
    elif diagnosis != "metrics within normal range":
        lines.append("")
        lines.append(f"⚠ **Degradation cause:** {diagnosis}. See **Troubleshoot → Degraded WAN Link**.")

    return ChatResponse(answer="\n".join(lines), data=matches, intent="edge_detail")


async def _handle_site_health(edges: List[Dict], query: str) -> ChatResponse:
    name = _extract_name(query)
    if not name:
        # summarise all sites
        site_map: Dict[str, List] = {}
        for e in edges:
            site_map.setdefault(e["site_name"], []).append(e)
        rows = []
        for site, devs in sorted(site_map.items()):
            scored = [d for d in devs if d["score"] is not None]
            avg = sum(d["score"] for d in scored) / len(scored) if scored else None
            offline = sum(1 for d in devs if d["reachability"] == "unreachable")
            rows.append((site, len(devs), avg, offline))
        rows.sort(key=lambda x: (x[2] if x[2] is not None else 5))
        lines = ["**Site WAN health (worst first):**", ""]
        for site, cnt, avg, offline in rows[:15]:
            score_txt = f"{avg:.1f}/5" if avg is not None else "no data"
            offline_txt = f" · {offline} offline" if offline else ""
            lines.append(f"- **{site}** — {cnt} edge(s) — avg score {score_txt}{offline_txt}")
        return ChatResponse(answer="\n".join(lines), intent="site_health")

    matches = [e for e in edges if name in e["site_name"].lower() or name in e["hostname"].lower()]
    if not matches:
        return ChatResponse(answer=f"No site or edge found matching '{name}'.", intent="site_health")

    lines = [f"**{matches[0]['site_name']} — WAN health**", ""]
    for e in matches:
        lines.append(f"- **{e['hostname']}** — {_score_str(e['score'])} — {e['reachability']}")
    return ChatResponse(answer="\n".join(lines), data=matches, intent="site_health")


_CAPACITY_GENERIC = re.compile(
    r"^(link|wan|all|circuit|bandwidth|capacit|utilisa|utiliz|overall|show|network|mbps|mbit)[\s\w]*$"
)

async def _handle_capacity(edges: List[Dict], query: str) -> ChatResponse:
    """Show provisioned vs actual throughput per WAN link."""
    name = _extract_name(query)
    # Treat as a general/all-edges query when the extracted term is just capacity jargon
    if not name or _CAPACITY_GENERIC.match(name.strip().lower()):
        name = None
    if name:
        targets = [e for e in edges if name in e["hostname"].lower() or name in e["site_name"].lower()]
    else:
        targets = [e for e in edges if e["links"]]

    # Collect all links with provisioned capacity
    rows = []
    for e in targets:
        for lk in e["links"]:
            up_mbps = lk.get("upstream_mbps")
            dn_mbps = lk.get("downstream_mbps")
            if not up_mbps and not dn_mbps:
                continue
            rx_mbps = lk.get("avg_mbps_rx") or (lk.get("bps_rx", 0) / 1_000_000)
            tx_mbps = lk.get("avg_mbps_tx") or (lk.get("bps_tx", 0) / 1_000_000)
            dn_pct = round((rx_mbps / dn_mbps) * 100, 1) if dn_mbps else None
            up_pct = round((tx_mbps / up_mbps) * 100, 1) if up_mbps else None
            rows.append({
                "edge": e["hostname"],
                "site": e["site_name"],
                "link": lk.get("name", ""),
                "isp": lk.get("isp", ""),
                "upstream_mbps": up_mbps,
                "downstream_mbps": dn_mbps,
                "rx_mbps": round(rx_mbps, 2),
                "tx_mbps": round(tx_mbps, 2),
                "dn_pct": dn_pct,
                "up_pct": up_pct,
            })

    if not rows:
        if name:
            return ChatResponse(
                answer=f"No provisioned capacity data found for '{name}'. "
                       "Capacity figures come from the VCO WAN configuration — links without a configured bandwidth will show '—'.",
                intent="capacity",
            )
        return ChatResponse(
            answer="No provisioned capacity data available yet. "
                   "Capacity is collected from `edge/getEdgeConfigurationStack` in VCO — "
                   "run the worker to populate it, or check that upstreamMbps/downstreamMbps are configured for your WAN links.",
            intent="capacity",
        )

    # Sort by highest utilisation first (downstream, falling back to upstream)
    rows.sort(key=lambda r: -(r["dn_pct"] or r["up_pct"] or 0))

    lines = [f"**Link capacity utilisation** ({len(rows)} links with provisioned bandwidth)", ""]
    saturated = [r for r in rows if (r["dn_pct"] or 0) > 90 or (r["up_pct"] or 0) > 90]
    if saturated:
        lines.append(f"⚠ **{len(saturated)} link(s) near saturation (>90%):**")
        for r in saturated:
            lines.append(
                f"  · **{r['edge']}** / {r['link']} — "
                f"↓{r['rx_mbps']}/{r['downstream_mbps']} Mbps ({r['dn_pct']}%) "
                f"↑{r['tx_mbps']}/{r['upstream_mbps']} Mbps ({r['up_pct']}%)"
            )
        lines.append("")

    lines.append("**All links:**")
    for r in rows[:20]:
        dn = f"↓{r['rx_mbps']}/{r['downstream_mbps']} Mbps ({r['dn_pct']}%)" if r["dn_pct"] is not None else f"↓{r['rx_mbps']} Mbps"
        up = f"↑{r['tx_mbps']}/{r['upstream_mbps']} Mbps ({r['up_pct']}%)" if r["up_pct"] is not None else f"↑{r['tx_mbps']} Mbps"
        isp = f" [{r['isp']}]" if r["isp"] else ""
        lines.append(f"- **{r['edge']}** / {r['link']}{isp} — {dn} · {up}")

    if len(rows) > 20:
        lines.append(f"\n_Showing 20 of {len(rows)} links. Filter by edge or site name for detail._")

    return ChatResponse(answer="\n".join(lines), data=rows, intent="capacity")


async def _handle_count(edges: List[Dict]) -> ChatResponse:
    total = len(edges)
    connected = sum(1 for e in edges if e["reachability"] == "reachable")
    offline = sum(1 for e in edges if e["reachability"] == "unreachable")
    degraded = sum(1 for e in edges if e["reachability"] == "degraded")
    sites = len(set(e["site_name"] for e in edges))
    answer = (
        f"There are **{total}** SD-WAN edges across **{sites}** sites — "
        f"**{connected}** connected, **{degraded}** degraded, **{offline}** offline."
    )
    return ChatResponse(answer=answer, intent="edge_count")


# ── Main endpoint ─────────────────────────────────────────────────────────────

@router.post("/chat", response_model=ChatResponse, summary="SD-WAN intelligence chat")
async def sdwan_chat(req: ChatRequest) -> ChatResponse:
    try:
        intent = _detect_intent(req.message)
        edges = await _all_edges()

        if intent == "capacity":
            return await _handle_capacity(edges, req.message)
        elif intent == "summary":
            return await _handle_summary(edges)
        elif intent == "worst_sites":
            return await _handle_worst_sites(edges)
        elif intent == "top_edges":
            return await _handle_top_edges(edges)
        elif intent == "offline_edges":
            return await _handle_offline(edges)
        elif intent in ("degraded_edges",):
            return await _handle_degraded(edges)
        elif intent == "unstable_links":
            return await _handle_unstable_links(edges)
        elif intent == "link_quality":
            return await _handle_link_quality(edges, req.message)
        elif intent == "edge_detail":
            return await _handle_edge_detail(edges, req.message)
        elif intent == "site_health":
            return await _handle_site_health(edges, req.message)
        elif intent == "edge_count":
            return await _handle_count(edges)
        else:
            return await _handle_summary(edges)

    except Exception as exc:
        logger.error("SD-WAN chat error: %s", exc, exc_info=True)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc))
