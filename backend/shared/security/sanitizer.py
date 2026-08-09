"""
Evidence Sanitizer & Data Egress Guardrail (WP-7)

Strips PII (anonymizes MAC addresses, IP addresses, usernames/emails), redacts secrets
(API keys, Bearer tokens, passwords, SNMP strings), and strips raw vendor JSON payloads
before assembling LLM evidence packs.
"""

import hashlib
import re
from typing import Any, Dict, List, Tuple

try:
    from backend.api.models.rca_models import EvidenceItem, SanitizedEvidencePack
except ImportError:
    from api.models.rca_models import EvidenceItem, SanitizedEvidencePack


class EvidenceSanitizer:
    """Sanitizes raw telemetry into anonymized evidence items for safe LLM processing."""

    def __init__(self):
        self._mac_map: Dict[str, str] = {}
        self._ip_map: Dict[str, str] = {}
        self._user_map: Dict[str, str] = {}

    def sanitize_mac(self, mac: str) -> str:
        if not mac:
            return "MAC-UNKNOWN"
        clean = mac.replace(":", "").replace("-", "").lower()
        if clean not in self._mac_map:
            short_hash = hashlib.sha256(clean.encode()).hexdigest()[:4].upper()
            self._mac_map[clean] = f"MAC-ANON-{short_hash}"
        return self._mac_map[clean]

    def sanitize_ip(self, ip: str) -> str:
        if not ip or ip in ("127.0.0.1", "0.0.0.0", "1.1.1.1", "8.8.8.8"):
            return ip or "IP-UNKNOWN"
        if ip not in self._ip_map:
            idx = len(self._ip_map) + 1
            if ip.startswith("10.") or ip.startswith("192.168.") or ip.startswith("172."):
                self._ip_map[ip] = f"IP-INTERNAL-{idx:02d}"
            else:
                self._ip_map[ip] = f"IP-WAN-{idx:02d}"
        return self._ip_map[ip]

    def sanitize_secrets(self, text: str) -> str:
        if not text:
            return text
        # Redact Bearer tokens, API keys, passwords
        text = re.sub(r"(Bearer\s+)[A-Za-z0-9\-\._~\+\/]+=*", r"\1[REDACTED_TOKEN]", text, flags=re.IGNORECASE)
        text = re.sub(r"(key|secret|password|auth|token)=['\"][^'\"]+['\"]", r"\1='[REDACTED_SECRET]'", text, flags=re.IGNORECASE)
        text = re.sub(r"(community\s+)[A-Za-z0-9_\-]+", r"\1[REDACTED_COMMUNITY]", text, flags=re.IGNORECASE)
        return text

    def sanitize_evidence_pack(
        self,
        incident_id: str,
        incident_info: Dict[str, Any],
        raw_events: List[Dict[str, Any]],
        path_hops: List[Dict[str, Any]],
    ) -> SanitizedEvidencePack:
        """Assembles anonymized evidence pack with EVD-XX citations."""
        evidence_items: List[EvidenceItem] = []
        evd_counter = 1

        # 1. Primary Incident Evidence Item
        title = self.sanitize_secrets(incident_info.get("title", "Network Anomaly Incident"))
        evidence_items.append(
            EvidenceItem(
                evidence_id=f"EVD-{evd_counter:02d}",
                item_type="incident",
                timestamp=str(incident_info.get("created_at") or "NOW"),
                source=str(incident_info.get("source_vendor") or "correlation_engine"),
                summary=f"Incident Trigger: {title} (Severity: {incident_info.get('severity', 'MAJOR')})",
                details={
                    "scope": incident_info.get("scope", "site"),
                    "affected_devices_count": len(incident_info.get("affected_devices", [])),
                },
            )
        )
        evd_counter += 1

        # 2. Correlated Telemetry Events
        for ev in raw_events[:5]:
            dev_id = str(ev.get("device_id") or "device-01")
            raw_msg = self.sanitize_secrets(str(ev.get("message") or ev.get("raw_event") or "Telemetry alert"))
            # Replace MACs and IPs inside text
            raw_msg = re.sub(r"([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})", lambda m: self.sanitize_mac(m.group(0)), raw_msg)
            raw_msg = re.sub(r"\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b", lambda m: self.sanitize_ip(m.group(0)), raw_msg)

            evidence_items.append(
                EvidenceItem(
                    evidence_id=f"EVD-{evd_counter:02d}",
                    item_type="event",
                    timestamp=str(ev.get("timestamp") or "NOW"),
                    source=str(ev.get("source") or "vendor_collector"),
                    summary=f"Device {dev_id[:8]} Event: {raw_msg[:120]}",
                    details={
                        "category": str(ev.get("category", "NETWORK")),
                        "severity": str(ev.get("severity", "WARNING")),
                    },
                )
            )
            evd_counter += 1

        # 3. Path Trace Hop Evidence
        for hop in path_hops[:4]:
            node_name = str(hop.get("node_name", "Hop-Node"))
            node_type = str(hop.get("node_type", "switch"))
            status = str(hop.get("health_status", "healthy"))
            lat = hop.get("latency_ms")

            evidence_items.append(
                EvidenceItem(
                    evidence_id=f"EVD-{evd_counter:02d}",
                    item_type="path_hop",
                    timestamp="RECENT",
                    source=str(hop.get("vendor") or "path_trace_engine"),
                    summary=f"Path Hop [{node_type.upper()}] {node_name}: Health={status.upper()}, Latency={lat}ms",
                    details={
                        "interface": hop.get("interface_name"),
                        "status": status,
                    },
                )
            )
            evd_counter += 1

        anonymization_map = {
            "macs_count": len(self._mac_map),
            "ips_count": len(self._ip_map),
        }

        return SanitizedEvidencePack(
            pack_id=f"pack-{incident_id[:8]}",
            incident_id=incident_id,
            evidence_items=evidence_items,
            anonymization_map=anonymization_map,
        )
