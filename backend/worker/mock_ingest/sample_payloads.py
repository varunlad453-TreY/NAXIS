"""
Sample Vendor Payloads

Realistic mock payloads matching actual vendor API/webhook structures.
These represent what the platform would receive from real integrations.
"""

from datetime import datetime
from typing import Any, Dict


def dnac_high_latency_payload(
    device_id: str, site_id: str, latency_ms: float, timestamp: datetime
) -> Dict[str, Any]:
    """Cisco DNAC assurance issue - high WAN latency."""
    return {
        "version": "1.0.0",
        "instanceId": f"dnac-{device_id}-{int(timestamp.timestamp())}",
        "eventId": f"ASSURANCE_{device_id}_{int(timestamp.timestamp())}",
        "namespace": "ASSURANCE",
        "name": "High_WAN_Latency",
        "description": f"WAN interface latency exceeds threshold",
        "type": "NETWORK",
        "category": "WARN",
        "domain": "Connectivity",
        "subDomain": "Performance",
        "severity": 3,  # DNAC: 1=critical, 3=major, 5=minor
        "source": "DNAC-AI",
        "timestamp": int(timestamp.timestamp() * 1000),
        "tags": ["wan", "latency", "performance"],
        "details": {
            "Type": "Network Device",
            "Assurance Issue Details": f"WAN latency is {latency_ms}ms (threshold: 100ms)",
            "Assurance Issue Priority": "P1",
            "Assurance Issue Status": "active",
            "Device": device_id,
        },
        "ciscoDnaEventLink": f"https://dnac.example.com/#/assurance/issues/{device_id}",
        "note": "Network conditions degraded",
        "issueId": f"issue-{device_id}-latency",
        "tntId": "production",
        "context": f"dna/assurance/issue/{device_id}",
        "userId": "system",
        "i18n": "en",
        "eventHierarchy": "dnac.assurance.network.performance",
        "message": f"High WAN latency detected on {device_id}",
        "messageParams": f"{device_id},{latency_ms}ms",
        "parentInstanceId": "",
        "network": {
            "deviceId": device_id,
            "siteId": site_id,
            "interface": "GigabitEthernet0/0/1",
            "latency_ms": latency_ms,
            "threshold_ms": 100.0,
        },
    }


def dnac_device_unreachable_payload(
    device_id: str, site_id: str, timestamp: datetime
) -> Dict[str, Any]:
    """Cisco DNAC device reachability issue."""
    return {
        "version": "1.0.0",
        "instanceId": f"dnac-{device_id}-{int(timestamp.timestamp())}",
        "eventId": f"NETWORK_DEVICE_{device_id}_{int(timestamp.timestamp())}",
        "namespace": "ASSURANCE",
        "name": "Device_Unreachable",
        "description": "Network device is unreachable",
        "type": "NETWORK",
        "category": "ERROR",
        "domain": "Connectivity",
        "subDomain": "Device",
        "severity": 1,  # Critical
        "source": "DNAC-Polling",
        "timestamp": int(timestamp.timestamp() * 1000),
        "tags": ["device", "unreachable", "critical"],
        "details": {
            "Type": "Network Device",
            "Assurance Issue Details": "Device is not responding to ICMP/SNMP polls",
            "Assurance Issue Priority": "P0",
            "Assurance Issue Status": "active",
            "Device": device_id,
            "Last Seen": int((timestamp.timestamp() - 300) * 1000),  # 5 min ago
        },
        "issueId": f"issue-{device_id}-unreachable",
        "network": {
            "deviceId": device_id,
            "siteId": site_id,
            "reachability": "UNREACHABLE",
            "managementIp": "10.1.1.1",
        },
    }


def mist_client_retry_payload(
    ap_id: str, site_id: str, client_mac: str, ssid: str, retry_pct: float, timestamp: datetime
) -> Dict[str, Any]:
    """Juniper Mist wireless client retry event."""
    return {
        "topic": "audits",
        "events": [
            {
                "org_id": "12345678-1234-1234-1234-123456789abc",
                "site_id": site_id,
                "timestamp": int(timestamp.timestamp()),
                "type": "MARVIS_CLIENT_INSIGHTS",
                "text": f"High retry rate detected for client {client_mac}",
                "ap": ap_id,
                "ap_name": f"ap-{ap_id}",
                "ssid": ssid,
                "client_mac": client_mac,
                "retry_pct": retry_pct,
                "threshold": 10.0,
                "severity": "warn" if retry_pct < 30 else "critical",
                "reason": "Poor RF conditions or interference",
                "band": "5GHz",
                "channel": 36,
                "rssi": -72,
                "snr": 18,
                "classification": "wireless_issue",
            }
        ],
    }


def mist_ap_degraded_payload(
    ap_id: str, site_id: str, timestamp: datetime
) -> Dict[str, Any]:
    """Juniper Mist AP health degradation."""
    return {
        "topic": "device-events",
        "events": [
            {
                "org_id": "12345678-1234-1234-1234-123456789abc",
                "site_id": site_id,
                "site_name": f"site-{site_id}",
                "timestamp": int(timestamp.timestamp()),
                "type": "AP_HEALTH_DEGRADED",
                "ap_id": ap_id,
                "ap_name": f"ap-{ap_id}",
                "ap_mac": f"aa:bb:cc:dd:{ap_id[:2]}:{ap_id[2:4]}",
                "model": "AP43",
                "text": f"AP {ap_id} health score degraded",
                "health_score": 42,
                "previous_health_score": 85,
                "reason": "High CPU utilization and memory pressure",
                "cpu_util": 92,
                "mem_util": 88,
                "uptime": 345600,  # 4 days
                "num_clients": 47,
                "severity": "major",
            }
        ],
    }


def sdwan_packet_loss_payload(
    device_id: str, site_id: str, tunnel_id: str, loss_pct: float, timestamp: datetime
) -> Dict[str, Any]:
    """SD-WAN/MPLS tunnel packet loss event."""
    return {
        "eventType": "tunnel_quality_degraded",
        "eventId": f"sdwan-{tunnel_id}-{int(timestamp.timestamp())}",
        "timestamp": timestamp.isoformat() + "Z",
        "source": "sd-wan-controller",
        "severity": "HIGH" if loss_pct > 5 else "MEDIUM",
        "category": "connectivity",
        "device": {
            "id": device_id,
            "name": f"edge-{device_id}",
            "type": "edge_router",
            "site": site_id,
            "model": "ISR4331",
            "version": "17.6.3",
        },
        "tunnel": {
            "id": tunnel_id,
            "name": f"MPLS-{tunnel_id}",
            "type": "mpls",
            "local_ip": "10.10.1.1",
            "remote_ip": "10.20.1.1",
            "state": "up",
            "admin_state": "enabled",
        },
        "metrics": {
            "packet_loss_pct": loss_pct,
            "latency_ms": 85.3,
            "jitter_ms": 12.7,
            "bandwidth_mbps": 950.0,
            "threshold_loss_pct": 2.0,
        },
        "message": f"Tunnel {tunnel_id} experiencing {loss_pct}% packet loss",
        "recommendation": "Check MPLS provider SLA and circuit health",
        "priority": "P1",
        "tags": ["mpls", "packet-loss", "wan"],
    }


def sdwan_high_cpu_payload(
    device_id: str, site_id: str, cpu_pct: float, timestamp: datetime
) -> Dict[str, Any]:
    """SD-WAN edge device high CPU utilization."""
    return {
        "eventType": "device_performance_issue",
        "eventId": f"sdwan-cpu-{device_id}-{int(timestamp.timestamp())}",
        "timestamp": timestamp.isoformat() + "Z",
        "source": "sd-wan-controller",
        "severity": "CRITICAL" if cpu_pct > 90 else "HIGH",
        "category": "performance",
        "device": {
            "id": device_id,
            "name": f"edge-{device_id}",
            "type": "edge_router",
            "site": site_id,
            "model": "ISR4331",
            "mgmt_ip": "10.1.1.10",
        },
        "metrics": {
            "cpu_utilization_pct": cpu_pct,
            "cpu_5sec_avg": cpu_pct - 2,
            "cpu_1min_avg": cpu_pct - 5,
            "cpu_5min_avg": cpu_pct - 8,
            "threshold_pct": 80.0,
            "memory_utilization_pct": 72.0,
            "processes": [
                {"name": "NAT", "cpu_pct": 45.2},
                {"name": "BGP", "cpu_pct": 18.7},
                {"name": "Crypto", "cpu_pct": 12.3},
            ],
        },
        "message": f"Device {device_id} CPU utilization at {cpu_pct}%",
        "recommendation": "Consider traffic shaping or upgrade hardware",
        "priority": "P0" if cpu_pct > 95 else "P1",
        "tags": ["cpu", "performance", "edge"],
    }
