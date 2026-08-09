"""
Unit Tests for EvidenceSanitizer & Data Egress Guardrails (WP-7)
"""

import pytest
from shared.security.sanitizer import EvidenceSanitizer


class TestEvidenceSanitizer:
    """Test MAC/IP anonymization, secret redaction, and evidence pack construction."""

    def test_sanitize_mac_address(self):
        sanitizer = EvidenceSanitizer()
        mac1 = sanitizer.sanitize_mac("5c:5b:35:00:11:22")
        mac2 = sanitizer.sanitize_mac("5c:5b:35:00:11:22")
        mac3 = sanitizer.sanitize_mac("00:11:22:33:44:55")

        assert mac1.startswith("MAC-ANON-")
        assert mac1 == mac2  # Deterministic hash mapping
        assert mac1 != mac3  # Unique per MAC

    def test_sanitize_ip_address(self):
        sanitizer = EvidenceSanitizer()
        ip_int = sanitizer.sanitize_ip("10.10.50.142")
        ip_wan = sanitizer.sanitize_ip("198.51.100.10")

        assert ip_int.startswith("IP-INTERNAL-")
        assert ip_wan.startswith("IP-WAN-")

    def test_sanitize_secrets_and_credentials(self):
        sanitizer = EvidenceSanitizer()
        text = "Authorization: Bearer eyJhbGciOiJIUzI1NiJ9 password='secret123' community public"
        sanitized = sanitizer.sanitize_secrets(text)

        assert "[REDACTED_TOKEN]" in sanitized
        assert "[REDACTED_SECRET]" in sanitized
        assert "[REDACTED_COMMUNITY]" in sanitized
        assert "secret123" not in sanitized

    def test_sanitize_evidence_pack_assembly(self):
        sanitizer = EvidenceSanitizer()
        incident = {
            "title": "Switch Port Link Flap at 10.10.1.20",
            "severity": "CRITICAL",
            "source_vendor": "juniper_mist",
        }
        events = [
            {
                "device_id": "sw-01",
                "message": "CRC error on MAC 5c:5b:35:00:11:22 IP 10.10.1.20",
                "source": "juniper_mist_ex",
            }
        ]
        hops = [
            {"node_name": "AP-01", "node_type": "ap", "health_status": "degraded", "latency_ms": 4.5}
        ]

        pack = sanitizer.sanitize_evidence_pack(
            incident_id="inc-101",
            incident_info=incident,
            raw_events=events,
            path_hops=hops,
        )

        assert pack.incident_id == "inc-101"
        assert len(pack.evidence_items) == 3
        assert pack.evidence_items[0].evidence_id == "EVD-01"
        assert pack.evidence_items[1].evidence_id == "EVD-02"
        assert "MAC-ANON-" in pack.evidence_items[1].summary
        assert "IP-INTERNAL-" in pack.evidence_items[1].summary
