"""
Path Trace & Diagnostic Models (WP-6)

Defines Pydantic request and response schemas for client hop chain resolution
and live edge network diagnostic runs.
"""

from datetime import datetime
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field


class PathHop(BaseModel):
    """Represents a single network hop in a client's end-to-end path chain."""
    hop_index: int = Field(..., description="1-based sequence index in the hop chain")
    node_id: str = Field(..., description="Canonical node identifier")
    node_name: str = Field(..., description="Human-readable node name")
    node_type: str = Field(..., description="Layer type: 'client' | 'ap' | 'switch' | 'sdwan' | 'sase' | 'internet'")
    vendor: Optional[str] = Field(None, description="Vendor name (mist, dnac, velocloud, etc.)")
    ip_address: Optional[str] = Field(None, description="Hop IP address")
    mac_address: Optional[str] = Field(None, description="Hop MAC address")
    interface_name: Optional[str] = Field(None, description="Connected port / interface name")
    health_status: str = Field("healthy", description="Status: 'healthy' | 'degraded' | 'critical'")
    latency_ms: Optional[float] = Field(None, description="Hop or tunnel latency in milliseconds")
    packet_loss_pct: Optional[float] = Field(None, description="Packet loss percentage")
    details: Dict[str, Any] = Field(default_factory=dict, description="Metadata & evidence details")


class PathTraceResponse(BaseModel):
    """End-to-end path trace result for a client MAC."""
    client_mac: str = Field(..., description="Normalized client MAC address")
    client_ip: Optional[str] = Field(None, description="Associated client IP address")
    username: Optional[str] = Field(None, description="Authenticated 802.1X username")
    site_id: Optional[str] = Field(None, description="Site identifier")
    site_name: Optional[str] = Field(None, description="Resolved site name")
    hops: List[PathHop] = Field(default_factory=list, description="Ordered hop chain from client to internet")
    first_unhealthy_hop: Optional[PathHop] = Field(None, description="First degraded or critical hop in path")
    traced_at: datetime = Field(default_factory=datetime.utcnow, description="Timestamp of path trace query")


class DiagnosticRequest(BaseModel):
    """Request payload for triggering a live edge diagnostic test."""
    target_device_id: str = Field(..., description="Target device UUID / node_id to execute test from")
    test_type: str = Field(..., description="Type of test: 'ping' | 'traceroute' | 'port_stats'")
    destination_ip: Optional[str] = Field(None, description="Destination IP address for ping/traceroute")
    interface: Optional[str] = Field(None, description="Target interface for port_stats")
    count: int = Field(default=5, description="Number of packets for ping test (max 10)")


class DiagnosticResponse(BaseModel):
    """Response payload for a diagnostic test execution."""
    run_id: str = Field(..., description="Diagnostic run UUID")
    test_type: str = Field(..., description="Test type executed")
    target_device_id: str = Field(..., description="Target device UUID")
    status: str = Field(..., description="Execution status: 'success' | 'failed'")
    results: Dict[str, Any] = Field(default_factory=dict, description="Structured execution results & output")
    duration_ms: float = Field(..., description="Execution duration in milliseconds")
    executed_at: datetime = Field(default_factory=datetime.utcnow, description="Timestamp of test execution")
