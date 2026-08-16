/**
 * Topology Graph Model
 *
 * Clean domain layer separating data acquisition → normalization → graph model.
 * Uses ONLY real data from the backend. No fabricated relationships.
 */

import type { TopologyNode, TopologyEdge, HealthStatus } from "@/types/topology";
import { NODE_TYPE_META, HEALTH_STATUS_META } from "@/types/topology";
import { MarkerType } from "reactflow";

// ---------------------------------------------------------------------------
// Hierarchical rank assignment based on actual device roles
// ---------------------------------------------------------------------------

const ROLE_RANK: Record<string, number> = {
  // Layer 0: Internet / WAN / Global
  internet: 0,
  wan: 0,
  cloud: 0,
  site: 0,

  // Layer 1: Edge / Security
  firewall: 1,
  router: 1,
  gateway: 1,
  wan_edge: 1,
  vpn_gateway: 1,
  load_balancer: 1,

  // Layer 2: Core / Controllers
  core_switch: 2,
  controller: 2,
  edge: 2, // velo edge sits here
  server: 2,

  // Layer 3: Distribution
  distribution_switch: 3,

  // Layer 4: Access
  access_switch: 4,
  switch: 4,

  // Layer 5: Wireless
  ap: 5,
  access_point: 5,
  wireless_controller: 5,

  // Layer 6: Endpoints
  client: 6,
  endpoint: 6,
  sensor: 6,
  camera: 6,
  iot: 6,
  printer: 6,
};

export function getNodeRank(nodeType: string): number {
  return ROLE_RANK[nodeType] ?? 4; // default to access layer
}

// ---------------------------------------------------------------------------
// Graph Node
// ---------------------------------------------------------------------------

export interface GraphNode {
  id: string;
  type: string; // reactflow node type
  position: { x: number; y: number };
  data: GraphNodeData;
  parentId?: string;
  extent?: "parent" | undefined;
  style?: React.CSSProperties;
  width?: number;
  height?: number;
}

export interface GraphNodeData {
  topoNode: TopologyNode;
  label: string;
  nodeType: string;
  healthStatus: HealthStatus;
  healthColor: string;
  deviceColor: string;
  deviceLabel: string;
  rank: number;
  isHighlighted: boolean;
  isDimmed: boolean;
  isRootCause: boolean;
  isSymptom: boolean;
  isSelected: boolean;
  isSiteGroup: boolean;
  childCount?: number;
  crossSiteEdgeCount?: number;
}

// ---------------------------------------------------------------------------
// Graph Edge
// ---------------------------------------------------------------------------

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  type: string; // reactflow edge type
  animated?: boolean;
  style?: React.CSSProperties;
  markerEnd?: { type: MarkerType; color?: string; width?: number; height?: number };
  markerStart?: { type: MarkerType; color?: string; width?: number; height?: number };
  data?: GraphEdgeData;
  label?: string;
  labelStyle?: React.CSSProperties;
  labelBgStyle?: React.CSSProperties;
}

export interface GraphEdgeData {
  topoEdge: TopologyEdge;
  edgeType: string;
  sourceInterface?: string;
  targetInterface?: string;
  linkSpeed?: string;
  linkStatus: "healthy" | "degraded" | "down" | "unknown";
  isHighlighted: boolean;
  isDimmed: boolean;
  isPathTrace: boolean;
  bundleCount?: number;
}

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

export interface NormalizedGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  nodeMap: Map<string, GraphNode>;
  edgeMap: Map<string, GraphEdge>;
  siteNodes: GraphNode[];
  deviceNodes: GraphNode[];
  maxRank: number;
  minRank: number;
}

export function normalizeTopology(
  topologyNodes: TopologyNode[],
  topologyEdges: TopologyEdge[],
  options: {
    highlightedNodeIds?: Set<string>;
    dimmedNodeIds?: Set<string>;
    selectedNodeId?: string | null;
    rootCauseIds?: Set<string>;
    symptomIds?: Set<string>;
    expandedSites?: Set<string>;
    activeTypeFilters?: Set<string>;
  } = {}
): NormalizedGraph {
  const {
    highlightedNodeIds = new Set(),
    dimmedNodeIds = new Set(),
    selectedNodeId = null,
    rootCauseIds = new Set(),
    symptomIds = new Set(),
    expandedSites = new Set(),
    activeTypeFilters = new Set(),
  } = options;

  // Filter nodes by type if filters are active
  let nodes = topologyNodes;
  if (activeTypeFilters.size > 0) {
    nodes = topologyNodes.filter((n) => activeTypeFilters.has(n.node_type));
  }

  const nodeIds = new Set(nodes.map((n) => n.node_id));

  // Filter edges to only connect visible nodes
  const edges = topologyEdges.filter(
    (e) => nodeIds.has(e.src_id) && nodeIds.has(e.dst_id)
  );

  const nodeMap = new Map<string, GraphNode>();
  const edgeMap = new Map<string, GraphEdge>();
  const siteNodes: GraphNode[] = [];
  const deviceNodes: GraphNode[] = [];

  let maxRank = 0;
  let minRank = Infinity;

  for (const tn of nodes) {
    const meta = NODE_TYPE_META[tn.node_type] ?? {
      label: tn.node_type,
      category: "leaf" as const,
      color: "#6b7280",
    };
    const hMeta = HEALTH_STATUS_META[tn.health_status] ?? HEALTH_STATUS_META.unknown;
    const rank = getNodeRank(tn.node_type);

    maxRank = Math.max(maxRank, rank);
    minRank = Math.min(minRank, rank);

    const isSite = tn.node_type === "site";
    const isExpanded = isSite ? expandedSites.has(tn.site_id) : false;

    const gNode: GraphNode = {
      id: tn.node_id,
      type: isSite ? "siteGroup" : "topologyNode",
      position: { x: 0, y: 0 }, // layout engine fills this
      data: {
        topoNode: tn,
        label: tn.name || tn.node_id,
        nodeType: tn.node_type,
        healthStatus: (tn.health_status as HealthStatus) || "unknown",
        healthColor: hMeta.color,
        deviceColor: meta.color,
        deviceLabel: meta.label,
        rank,
        isHighlighted: highlightedNodeIds.has(tn.node_id),
        isDimmed: dimmedNodeIds.has(tn.node_id) && !highlightedNodeIds.has(tn.node_id),
        isRootCause: rootCauseIds.has(tn.node_id),
        isSymptom: symptomIds.has(tn.node_id),
        isSelected: selectedNodeId === tn.node_id,
        isSiteGroup: isSite,
        childCount: (tn as any).device_count ?? 0,
      },
      width: isSite ? 240 : 160,
      height: isSite ? 48 : 36,
    };

    nodeMap.set(tn.node_id, gNode);
    if (isSite) {
      siteNodes.push(gNode);
    } else {
      deviceNodes.push(gNode);
    }
  }

  for (const te of edges) {
    // Derive edge health from connected nodes (conservative: worst wins)
    const srcNode = nodeMap.get(te.src_id);
    const dstNode = nodeMap.get(te.dst_id);
    let linkStatus: GraphEdgeData["linkStatus"] = "unknown";

    if (srcNode && dstNode) {
      const srcHealth = srcNode.data.healthStatus;
      const dstHealth = dstNode.data.healthStatus;
      if (srcHealth === "critical" || dstHealth === "critical") {
        linkStatus = "down";
      } else if (srcHealth === "warning" || dstHealth === "warning") {
        linkStatus = "degraded";
      } else if (srcHealth === "healthy" && dstHealth === "healthy") {
        linkStatus = "healthy";
      }
    }

    const isHighlighted =
      highlightedNodeIds.has(te.src_id) && highlightedNodeIds.has(te.dst_id);
    const isDimmed =
      (dimmedNodeIds.has(te.src_id) || dimmedNodeIds.has(te.dst_id)) && !isHighlighted;

    // Extract props if available
    const props = te.props || {};
    const sourceInterface = (props as any)?.source_interface || (props as any)?.srcInterface;
    const targetInterface = (props as any)?.target_interface || (props as any)?.dstInterface;
    const linkSpeed = (props as any)?.speed || (props as any)?.bandwidth;

    const gEdge: GraphEdge = {
      id: `${te.src_id}->${te.dst_id}`,
      source: te.src_id,
      target: te.dst_id,
      type: "topologyEdge",
      data: {
        topoEdge: te,
        edgeType: te.edge_type,
        sourceInterface,
        targetInterface,
        linkSpeed,
        linkStatus,
        isHighlighted,
        isDimmed,
        isPathTrace: false,
      },
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color: linkStatus === "down" ? "#ef4444" : linkStatus === "degraded" ? "#eab308" : "#9ca3af",
        width: 10,
        height: 10,
      },
      style: {
        stroke:
          linkStatus === "down"
            ? "#ef4444"
            : linkStatus === "degraded"
            ? "#eab308"
            : isHighlighted
            ? "#3b82f6"
            : "#9ca3af",
        strokeWidth: isHighlighted ? 2.5 : linkStatus === "down" ? 2 : 1.5,
        strokeDasharray:
          te.edge_type === "logical" || te.edge_type === "wan_link" || linkStatus === "unknown"
            ? "4 4"
            : linkStatus === "down"
            ? "6 3"
            : undefined,
        opacity: isDimmed ? 0.25 : 1,
      },
    };

    edgeMap.set(gEdge.id, gEdge);
  }

  return {
    nodes: Array.from(nodeMap.values()),
    edges: Array.from(edgeMap.values()),
    nodeMap,
    edgeMap,
    siteNodes,
    deviceNodes,
    maxRank,
    minRank,
  };
}

// ---------------------------------------------------------------------------
// Path trace
// ---------------------------------------------------------------------------

export function tracePath(
  normalizedGraph: NormalizedGraph,
  startNodeId: string,
  endNodeId: string
): { nodeIds: Set<string>; edgeIds: Set<string> } | null {
  const { nodeMap, edgeMap } = normalizedGraph;
  if (!nodeMap.has(startNodeId) || !nodeMap.has(endNodeId)) return null;

  // BFS upstream from startNodeId
  const upstream = new Map<string, string[]>(); // nodeId -> path from start
  const queue = [startNodeId];
  upstream.set(startNodeId, [startNodeId]);

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current === endNodeId) break;

    // Find edges where current is the target (parents)
    for (const edge of edgeMap.values()) {
      if (edge.target === current && !upstream.has(edge.source)) {
        upstream.set(edge.source, [...upstream.get(current)!, edge.source]);
        queue.push(edge.source);
      }
    }
  }

  if (!upstream.has(endNodeId)) {
    // Try downstream
    const downstream = new Map<string, string[]>();
    const dQueue = [startNodeId];
    downstream.set(startNodeId, [startNodeId]);

    while (dQueue.length > 0) {
      const current = dQueue.shift()!;
      if (current === endNodeId) break;
      for (const edge of edgeMap.values()) {
        if (edge.source === current && !downstream.has(edge.target)) {
          downstream.set(edge.target, [...downstream.get(current)!, edge.target]);
          dQueue.push(edge.target);
        }
      }
    }

    if (!downstream.has(endNodeId)) return null;

    const path = downstream.get(endNodeId)!;
    const nodeIds = new Set(path);
    const edgeIds = new Set<string>();
    for (let i = 0; i < path.length - 1; i++) {
      edgeIds.add(`${path[i]}->${path[i + 1]}`);
    }
    return { nodeIds, edgeIds };
  }

  const path = upstream.get(endNodeId)!;
  const nodeIds = new Set(path);
  const edgeIds = new Set<string>();
  for (let i = 0; i < path.length - 1; i++) {
    edgeIds.add(`${path[i + 1]}->${path[i]}`);
  }
  return { nodeIds, edgeIds };
}

// ---------------------------------------------------------------------------
// Impact / blast radius (downstream from a node)
// ---------------------------------------------------------------------------

export function getDownstreamImpact(
  normalizedGraph: NormalizedGraph,
  startNodeId: string,
  maxDepth: number = 5
): { nodeIds: Set<string>; edgeIds: Set<string> } {
  const { edgeMap } = normalizedGraph;
  const nodeIds = new Set<string>();
  const edgeIds = new Set<string>();
  const visited = new Set<string>();
  const queue: [string, number][] = [[startNodeId, 0]];

  while (queue.length > 0) {
    const [current, depth] = queue.shift()!;
    if (visited.has(current) || depth > maxDepth) continue;
    visited.add(current);
    nodeIds.add(current);

    for (const edge of edgeMap.values()) {
      if (edge.source === current) {
        edgeIds.add(edge.id);
        if (!visited.has(edge.target)) {
          queue.push([edge.target, depth + 1]);
        }
      }
    }
  }

  return { nodeIds, edgeIds };
}
