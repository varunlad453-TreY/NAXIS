"""
Topology API Models

Pydantic models for the topology graph visualization endpoint.
"""

from datetime import datetime
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


class TopologyNode(BaseModel):
    node_id: str = Field(..., description="Unique node identifier")
    node_type: str = Field(..., description="Device type (switch, router, ap, etc.)")
    name: str = Field(default="", description="Human-readable node name")
    ip_address: str = Field(default="", description="Management IP address")
    vendor: str = Field(default="", description="Vendor/platform name")
    model: str = Field(default="", description="Hardware model")
    site_id: str = Field(default="", description="Site ID")
    site_name: Optional[str] = Field(None, description="Site name (resolved from inventory)")
    health_status: str = Field(default="unknown", description="Live health status: healthy|warning|critical|unknown")
    health_label: str = Field(default="Unknown", description="Human-readable health label")
    props: Optional[Dict[str, Any]] = Field(None, description="Additional properties")


class TopologyEdge(BaseModel):
    src_id: str = Field(..., description="Source node ID (child)")
    dst_id: str = Field(..., description="Destination node ID (parent)")
    edge_type: str = Field(default="wired", description="Edge type (wired, wireless, etc.)")
    props: Optional[Dict[str, Any]] = Field(None, description="Additional edge properties")


class TopologyGraphResponse(BaseModel):
    nodes: List[TopologyNode] = Field(default_factory=list, description="All topology nodes")
    edges: List[TopologyEdge] = Field(default_factory=list, description="All topology edges")
    total_nodes: int = Field(0, description="Total number of nodes")
    total_edges: int = Field(0, description="Total number of edges")


class TopologyNodeDetail(BaseModel):
    node: TopologyNode = Field(..., description="The node")
    parents: List[TopologyNode] = Field(default_factory=list, description="Parent nodes (upstream)")
    children: List[TopologyNode] = Field(default_factory=list, description="Child nodes (downstream)")


class TopologySummaryResponse(BaseModel):
    node_count: int = Field(0, description="Total number of nodes")
    edge_count: int = Field(0, description="Total number of edges")
    by_type: Dict[str, int] = Field(default_factory=dict, description="Node count by type")
    by_vendor: Dict[str, int] = Field(default_factory=dict, description="Node count by vendor")
    last_updated: Optional[datetime] = Field(None, description="Most recent update timestamp")


class BlastRadiusResponse(BaseModel):
    nodes: List[TopologyNode] = Field(default_factory=list, description="Topology nodes in the blast radius subgraph")
    edges: List[TopologyEdge] = Field(default_factory=list, description="Edges connecting blast radius nodes")
    total_nodes: int = Field(0, description="Total nodes in the subgraph")
    total_edges: int = Field(0, description="Total edges in the subgraph")
    root_cause_node_ids: List[str] = Field(default_factory=list, description="Node IDs to highlight as root cause")
    symptom_node_ids: List[str] = Field(default_factory=list, description="Node IDs to highlight as symptoms")
