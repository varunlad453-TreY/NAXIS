/**
 * Topology type definitions
 *
 * Matches the backend Pydantic models from the Naxis API.
 */

export interface TopologyNode {
  node_id: string;
  node_type: string;
  name: string;
  ip_address: string;
  vendor: string;
  model: string;
  site_id: string;
  site_name: string | null;
  health_status: string;
  health_label: string;
  props?: Record<string, unknown> | null;
}

export interface TopologyEdge {
  src_id: string;
  dst_id: string;
  edge_type: string;
  props?: Record<string, unknown> | null;
}

export interface TopologyGraphResponse {
  nodes: TopologyNode[];
  edges: TopologyEdge[];
  total_nodes: number;
  total_edges: number;
}

export interface TopologyNodeDetail {
  node: TopologyNode;
  parents: TopologyNode[];
  children: TopologyNode[];
}

export interface TopologySummaryResponse {
  node_count: number;
  edge_count: number;
  by_type: Record<string, number>;
  by_vendor: Record<string, number>;
  last_updated: string | null;
}

/**
 * Device type categories for visual styling
 */
export type DeviceCategory = "infrastructure" | "leaf" | "edge" | "wireless";

export interface BlastRadiusResponse {
  nodes: TopologyNode[];
  edges: TopologyEdge[];
  total_nodes: number;
  total_edges: number;
  root_cause_node_ids: string[];
  symptom_node_ids: string[];
}

export type HealthStatus = "healthy" | "warning" | "critical" | "unknown";

export const HEALTH_STATUS_META: Record<string, { color: string; bgColor: string; label: string }> = {
  healthy: { color: "#22c55e", bgColor: "rgba(34, 197, 94, 0.15)", label: "Healthy" },
  warning: { color: "#eab308", bgColor: "rgba(234, 179, 8, 0.15)", label: "Warning" },
  critical: { color: "#ef4444", bgColor: "rgba(239, 68, 68, 0.15)", label: "Critical" },
  unknown: { color: "#6b7280", bgColor: "rgba(107, 114, 128, 0.15)", label: "Unknown" },
};

export const NODE_TYPE_META: Record<
  string,
  { label: string; category: DeviceCategory; color: string }
> = {
  switch: { label: "Switch", category: "infrastructure", color: "#3b82f6" },
  core_switch: { label: "Core Switch", category: "infrastructure", color: "#1d4ed8" },
  distribution_switch: { label: "Dist Switch", category: "infrastructure", color: "#2563eb" },
  access_switch: { label: "Access Switch", category: "infrastructure", color: "#60a5fa" },
  router: { label: "Router", category: "infrastructure", color: "#8b5cf6" },
  wan_edge: { label: "WAN Edge", category: "edge", color: "#7c3aed" },
  gateway: { label: "Gateway", category: "edge", color: "#a78bfa" },
  firewall: { label: "Firewall", category: "infrastructure", color: "#ef4444" },
  controller: { label: "Controller", category: "infrastructure", color: "#f59e0b" },
  ap: { label: "AP", category: "wireless", color: "#10b981" },
  access_point: { label: "Access Point", category: "wireless", color: "#34d399" },
  client: { label: "Client", category: "leaf", color: "#6b7280" },
  endpoint: { label: "Endpoint", category: "leaf", color: "#9ca3af" },
  sensor: { label: "Sensor", category: "leaf", color: "#14b8a6" },
  camera: { label: "Camera", category: "leaf", color: "#0d9488" },
  iot: { label: "IoT", category: "leaf", color: "#eab308" },
};
