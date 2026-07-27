"""
Collector Health Notifier — push-based alert delivery.

Sends alerts via Slack webhook and/or SMTP email when collectors
fail repeatedly or skip. Deduplicates alerts so the same notification
isn't sent twice within a configurable window.

Designed to be called by the worker after each collection cycle.
"""

import asyncio
import json
import logging
import smtplib
import time
from datetime import datetime, timezone
from email.message import EmailMessage
from typing import Any, Dict, List, Optional, Set, Tuple

import httpx

from config.settings import get_settings

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# In-memory dedup tracking (survives until process restart)
# ---------------------------------------------------------------------------
# Structure: {alert_key: epoch_timestamp_of_last_send}
_sent_alerts: Dict[str, float] = {}


def _alert_key(alert_type: str, collector_id: str) -> str:
    return f"{alert_type}:{collector_id}"


def _is_deduplicated(alert_type: str, collector_id: str, window_seconds: int) -> bool:
    """True if this alert was sent within the dedup window."""
    key = _alert_key(alert_type, collector_id)
    last = _sent_alerts.get(key)
    if last is None:
        return False
    return (time.time() - last) < window_seconds


def _mark_sent(alert_type: str, collector_id: str) -> None:
    _sent_alerts[_alert_key(alert_type, collector_id)] = time.time()


# ---------------------------------------------------------------------------
# Slack
# ---------------------------------------------------------------------------

def _slack_color(severity: str) -> str:
    return {"critical": "#FF0000", "warning": "#FFA500", "info": "#36A64F"}.get(severity, "#808080")


def _slack_payload(alerts: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Build a richly formatted Slack message with one attachment per alert."""
    fields = []
    for a in alerts:
        sev = a.get("severity", "warning")
        emoji = {"critical": ":red_circle:", "warning": ":warning:", "info": ":information_source:"}.get(sev, ":grey_question:")
        fields.append({
            "title": a.get("message", ""),
            "value": f"{emoji} *Severity:* {sev}\n• *Collector:* `{a['collector_id']}`\n• *Source:* {a.get('source_system', '?')}\n• *Count:* {a.get('count', '?')}\n• *Last:* {_fmt_time(a.get('last_at'))}",
            "short": False,
        })

    return {
        "text": f"*Naxis Collector Health Alerts* ({len(alerts)} issue{'s' if len(alerts) != 1 else ''})",
        "attachments": [
            {
                "color": _slack_color("critical" if any(a.get("severity") == "critical" for a in alerts) else "warning"),
                "fields": fields,
                "footer": "Naxis Monitoring",
                "ts": int(time.time()),
            }
        ],
    }


async def send_slack(webhook_url: str, alerts: List[Dict[str, Any]]) -> int:
    """Send a batch of alerts to a Slack webhook. Returns HTTP status code (0 on failure)."""
    if not webhook_url or not alerts:
        return 0
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.post(webhook_url, json=_slack_payload(alerts))
            if resp.status_code >= 400:
                logger.error("Slack notification failed: HTTP %d %s", resp.status_code, resp.text[:200])
            return resp.status_code
    except Exception as exc:
        logger.error("Slack notification error: %s", exc)
        return 0


# ---------------------------------------------------------------------------
# Email
# ---------------------------------------------------------------------------

def _fmt_time(dt) -> str:
    if dt is None:
        return "N/A"
    if isinstance(dt, datetime):
        return dt.strftime("%Y-%m-%d %H:%M:%S UTC")
    return str(dt)


def _build_email_body(alerts: List[Dict[str, Any]]) -> str:
    lines = [
        "<html><body>",
        "<h2>Naxis Collector Health Alerts</h2>",
        f"<p><em>{len(alerts)} issue(s) detected</em></p>",
        "<table border='1' cellpadding='8' cellspacing='0' style='border-collapse:collapse; font-family: sans-serif;'>",
        "<tr style='background:#f0f0f0;'><th>Severity</th><th>Collector</th><th>Source</th><th>Count</th><th>Last</th><th>Message</th></tr>",
    ]
    for a in alerts:
        sev = a.get("severity", "warning")
        color = {"critical": "#FF0000", "warning": "#FFA500", "info": "#36A64F"}.get(sev, "#808080")
        lines.append(
            f"<tr><td style='color:{color};font-weight:bold;'>{sev}</td>"
            f"<td><code>{a['collector_id']}</code></td>"
            f"<td>{a.get('source_system', '?')}</td>"
            f"<td>{a.get('count', '?')}</td>"
            f"<td>{_fmt_time(a.get('last_at'))}</td>"
            f"<td>{a.get('message', '')}</td></tr>"
        )
    lines.append("</table><hr><p><small>Sent by Naxis Monitoring</small></p></body></html>")
    return "\n".join(lines)


async def send_email(
    smtp_host: str, smtp_port: int, smtp_user: str, smtp_password: str,
    from_addr: str, to_addrs: List[str], alerts: List[Dict[str, Any]],
) -> int:
    """Send alert email via SMTP. Returns number of recipients or 0 on failure."""
    if not smtp_host or not to_addrs or not alerts:
        return 0
    try:
        msg = EmailMessage()
        msg["Subject"] = f"Naxis Alert: {len(alerts)} collector issue(s)"
        msg["From"] = from_addr
        msg["To"] = ", ".join(to_addrs)
        msg.set_content(_build_email_body(alerts), subtype="html")

        loop = asyncio.get_running_loop()

        def _send():
            with smtplib.SMTP(smtp_host, smtp_port, timeout=15) as server:
                if smtp_user:
                    server.starttls()
                    server.login(smtp_user, smtp_password)
                server.send_message(msg)
            return len(to_addrs)

        return await loop.run_in_executor(None, _send)
    except Exception as exc:
        logger.error("Email notification error: %s", exc)
        return 0


# ---------------------------------------------------------------------------
# Main dispatch
# ---------------------------------------------------------------------------

async def dispatch_alerts(alerts: List[Dict[str, Any]]) -> Dict[str, Any]:
    """
    Send alerts to all configured notification channels.
    Returns a dict of channel → result for observability.
    """
    if not alerts:
        return {"sent": False, "reason": "no alerts", "channels": {}}

    settings = get_settings()
    if not settings.notification_enabled:
        logger.debug("Notifications disabled — %d alerts would have been sent", len(alerts))
        return {"sent": False, "reason": "notifications disabled", "channels": {}}

    window = settings.notification_dedup_minutes * 60

    # Deduplicate: only keep alerts that haven't been sent recently
    new_alerts: List[Dict[str, Any]] = []
    for a in alerts:
        key = _alert_key(a["type"], a["collector_id"])
        if _is_deduplicated(a["type"], a["collector_id"], window):
            logger.debug("Dedup suppressed alert: %s", key)
        else:
            new_alerts.append(a)
            _mark_sent(a["type"], a["collector_id"])

    if not new_alerts:
        return {"sent": False, "reason": "all deduplicated", "channels": {}}

    results: Dict[str, Any] = {}

    # Slack
    if settings.notification_slack_webhook:
        code = await send_slack(settings.notification_slack_webhook, new_alerts)
        results["slack"] = {"status": "sent" if code == 200 else "failed", "http_code": code}
        if code == 200:
            logger.info("Sent %d alert(s) to Slack", len(new_alerts))

    # Email
    to_list = [e.strip() for e in settings.notification_email_to.split(",") if e.strip()]
    if to_list:
        sent_count = await send_email(
            settings.notification_smtp_host,
            settings.notification_smtp_port,
            settings.notification_smtp_user,
            settings.notification_smtp_password,
            settings.notification_smtp_from,
            to_list,
            new_alerts,
        )
        results["email"] = {"status": "sent" if sent_count else "failed", "recipients": sent_count}
        if sent_count:
            logger.info("Sent %d alert(s) to %d recipient(s)", len(new_alerts), sent_count)

    return {"sent": bool(results), "channels": results}
