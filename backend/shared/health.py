"""
Shared health derivation logic.

Used by both the API route layer (`_enrich_health()`) and the
health snapshot collector to compute per-node health status
from events, inventory, and topology node properties.
"""

from typing import Dict, List, Optional, Tuple


_HEALTH_META: Dict[str, Dict[str, str]] = {
    "healthy": {"status": "healthy", "label": "Healthy"},
    "warning": {"status": "warning", "label": "Warning"},
    "critical": {"status": "critical", "label": "Critical"},
    "unknown": {"status": "unknown", "label": "Unknown"},
}

_INFRASTRUCTURE_TYPES = {
    "switch", "core_switch", "distribution_switch", "access_switch",
    "router", "wan_edge", "gateway", "firewall", "controller",
}


def extract_event_device_id(node_id: str) -> str:
    """Map a topology node_id back to the raw device_id used in events."""
    for prefix in ("mist-ap-", "velo-edge-", "mist-site-", "velo-site-", "switch-"):
        if node_id.startswith(prefix):
            return node_id[len(prefix):]
    return node_id


def compute_node_health(
    node_id: str,
    device_id: str,
    worst_event_severity: Optional[str],
    inventory_reachability: Optional[str],
    props_reachability: Optional[str],
    props_connected: Optional[bool],
) -> Tuple[str, str, str]:
    """
    Derive health status for a single node.

    Returns (health_status, health_label, derived_from) where
    derived_from is one of 'events', 'inventory', 'props', or 'none'.
    """
    # 1. Critical from events
    if worst_event_severity == "critical":
        return ("critical", "Critical", "events")

    # 2. Critical from props
    if props_reachability == "unreachable":
        return ("critical", "Critical", "props")
    if props_connected is False:
        return ("critical", "Critical", "props")

    # 3. Critical from inventory
    if inventory_reachability == "unreachable":
        return ("critical", "Critical", "inventory")

    # 4. Healthy from props
    if props_reachability == "reachable" or props_connected is True:
        return ("healthy", "Healthy", "props")

    # 5. Warning from events
    if worst_event_severity == "major":
        return ("warning", "Warning", "events")

    # 6. Healthy from inventory
    if inventory_reachability == "reachable":
        return ("healthy", "Healthy", "inventory")

    # 7. Default: unknown
    return ("unknown", "Unknown", "none")


def is_infrastructure_type(node_type: str) -> bool:
    """Check if a node type is considered infrastructure (potential root cause)."""
    return node_type.lower() in _INFRASTRUCTURE_TYPES
