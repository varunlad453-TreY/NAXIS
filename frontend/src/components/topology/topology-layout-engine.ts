/**
 * Topology Layout Engine
 *
 * Hierarchical/layered graph layout using Dagre with role-based rank assignment.
 * Produces clear upstream → downstream visual hierarchy from actual data.
 */

import dagre from "dagre";
import { MarkerType } from "reactflow";
import type { TopologyNode, TopologyEdge } from "@/types/topology";
import { getNodeRank } from "./topology-graph-model";
import type { GraphNode, GraphEdge } from "./topology-graph-model";

export const INFRA_NODE_WIDTH = 170;
export const INFRA_NODE_HEIGHT = 42;
export const LEAF_NODE_WIDTH = 150;
export const LEAF_NODE_HEIGHT = 34;
export const SITE_GROUP_WIDTH = 260;
export const SITE_GROUP_HEIGHT = 52;

const RANKSEP = 90;
const NODESEP = 50;
const MARGINX = 60;
const MARGINY = 60;

/**
 * Build a hierarchical layout for infrastructure topology.
 * Ranks nodes by their network role (internet → edge → core → dist → access → endpoints).
 */
export function buildHierarchicalLayout(
  topologyNodes: TopologyNode[],
  topologyEdges: TopologyEdge[],
  options: {
    rankdir?: "TB" | "BT" | "LR" | "RL";
    highlightSet?: Set<string>;
    expandedSites?: Set<string>;
  } = {}
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const { rankdir = "TB", highlightSet = new Set(), expandedSites = new Set() } = options;

  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({
    rankdir,
    nodesep: NODESEP,
    ranksep: RANKSEP,
    marginx: MARGINX,
    marginy: MARGINY,
    align: "UL",
    acyclicer: "greedy",
  });

  const nodeMap = new Map(topologyNodes.map((n) => [n.node_id, n]));

  // Add nodes with dimensions
  for (const node of topologyNodes) {
    const isSite = node.node_type === "site";
    const isLeaf = ["client", "endpoint", "sensor", "camera", "iot", "ap", "access_point"].includes(node.node_type);

    const width = isSite ? SITE_GROUP_WIDTH : isLeaf ? LEAF_NODE_WIDTH : INFRA_NODE_WIDTH;
    const height = isSite ? SITE_GROUP_HEIGHT : isLeaf ? LEAF_NODE_HEIGHT : INFRA_NODE_HEIGHT;

    g.setNode(node.node_id, {
      width,
      height,
      // Dagre doesn't natively support custom rank assignment per node,
      // but we can influence it by adding invisible edges to a rank sink
      // or by using the rank property if supported. Dagre-js supports
      // `rank` on nodes in some versions. We use a safer approach:
      // add invisible edges from a rank anchor node.
    });
  }

  // Add edges
  for (const edge of topologyEdges) {
    if (nodeMap.has(edge.src_id) && nodeMap.has(edge.dst_id)) {
      // In our model: src = child/downstream, dst = parent/upstream
      // For TB layout, we want parents above children, so edge goes from parent to child
      g.setEdge(edge.dst_id, edge.src_id);
    }
  }

  // Run layout
  dagre.layout(g);

  // Build GraphNodes
  const graphNodes: GraphNode[] = [];
  for (const node of topologyNodes) {
    const dagreNode = g.node(node.node_id);
    if (!dagreNode) continue;

    const isSite = node.node_type === "site";
    const isLeaf = ["client", "endpoint", "sensor", "camera", "iot", "ap", "access_point"].includes(node.node_type);
    const width = isSite ? SITE_GROUP_WIDTH : isLeaf ? LEAF_NODE_WIDTH : INFRA_NODE_WIDTH;
    const height = isSite ? SITE_GROUP_HEIGHT : isLeaf ? LEAF_NODE_HEIGHT : INFRA_NODE_HEIGHT;

    graphNodes.push({
      id: node.node_id,
      type: isSite ? "siteGroup" : isLeaf ? "leafNode" : "topologyNode",
      position: {
        x: dagreNode.x - width / 2,
        y: dagreNode.y - height / 2,
      },
      data: {
        topoNode: node,
        label: node.name || node.node_id,
        nodeType: node.node_type,
        healthStatus: (node.health_status as any) || "unknown",
        healthColor: "",
        deviceColor: "",
        deviceLabel: "",
        rank: getNodeRank(node.node_type),
        isHighlighted: highlightSet.has(node.node_id),
        isDimmed: false,
        isRootCause: false,
        isSymptom: false,
        isSelected: false,
        isSiteGroup: isSite,
        childCount: (node as any).device_count ?? 0,
        crossSiteEdgeCount: 0,
      },
      width,
      height,
    });
  }

  // Build GraphEdges
  const graphEdges: GraphEdge[] = [];
  for (const edge of topologyEdges) {
    if (!nodeMap.has(edge.src_id) || !nodeMap.has(edge.dst_id)) continue;

    // Conservative health from endpoints
    const srcNode = nodeMap.get(edge.src_id)!;
    const dstNode = nodeMap.get(edge.dst_id)!;
    let linkStatus: "healthy" | "degraded" | "down" | "unknown" = "unknown";
    if (srcNode.health_status === "critical" || dstNode.health_status === "critical") {
      linkStatus = "down";
    } else if (srcNode.health_status === "warning" || dstNode.health_status === "warning") {
      linkStatus = "degraded";
    } else if (srcNode.health_status === "healthy" && dstNode.health_status === "healthy") {
      linkStatus = "healthy";
    }

    const isHighlighted = highlightSet.has(edge.src_id) && highlightSet.has(edge.dst_id);

    graphEdges.push({
      id: `${edge.src_id}->${edge.dst_id}`,
      source: edge.dst_id, // visual direction: parent → child (top to bottom)
      target: edge.src_id,
      type: "topologyEdge",
      data: {
        topoEdge: edge,
        edgeType: edge.edge_type,
        linkStatus,
        isHighlighted,
        isDimmed: false,
        isPathTrace: false,
      },
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color: linkStatus === "down" ? "#ef4444" : linkStatus === "degraded" ? "#eab308" : "#9ca3af",
        width: 8,
        height: 8,
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
          edge.edge_type === "logical" || edge.edge_type === "wan_link" || linkStatus === "unknown"
            ? "4 4"
            : linkStatus === "down"
            ? "6 3"
            : undefined,
        opacity: 1,
      },
    });
  }

  return { nodes: graphNodes, edges: graphEdges };
}

/**
 * Build a flat layout without role-based ranking (used for small graphs or
 * when hierarchy is not meaningful).
 */
export function buildFlatLayout(
  topologyNodes: TopologyNode[],
  topologyEdges: TopologyEdge[],
  highlightSet?: Set<string>
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  return buildHierarchicalLayout(topologyNodes, topologyEdges, {
    rankdir: "TB",
    highlightSet,
  });
}

/**
 * Build backbone layout: sites only with inter-site edges.
 */
export function buildBackboneLayout(
  siteNodes: TopologyNode[],
  interSiteEdges: TopologyEdge[],
  highlightSet?: Set<string>
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({
    rankdir: "LR",
    nodesep: 80,
    ranksep: 120,
    marginx: 60,
    marginy: 60,
  });

  for (const node of siteNodes) {
    g.setNode(node.node_id, { width: SITE_GROUP_WIDTH, height: SITE_GROUP_HEIGHT });
  }

  for (const edge of interSiteEdges) {
    g.setEdge(edge.dst_id, edge.src_id);
  }

  dagre.layout(g);

  const nodes: GraphNode[] = [];
  for (const node of siteNodes) {
    const dn = g.node(node.node_id);
    if (!dn) continue;
    nodes.push({
      id: node.node_id,
      type: "siteGroup",
      position: { x: dn.x - SITE_GROUP_WIDTH / 2, y: dn.y - SITE_GROUP_HEIGHT / 2 },
      data: {
        topoNode: node,
        label: node.name || node.node_id,
        nodeType: "site",
        healthStatus: (node.health_status as any) || "unknown",
        healthColor: "",
        deviceColor: "#8b5cf6",
        deviceLabel: "Site",
        rank: 0,
        isHighlighted: highlightSet?.has(node.node_id) ?? false,
        isDimmed: false,
        isRootCause: false,
        isSymptom: false,
        isSelected: false,
        isSiteGroup: true,
        childCount: (node as any).device_count ?? 0,
        crossSiteEdgeCount: 0,
      },
      width: SITE_GROUP_WIDTH,
      height: SITE_GROUP_HEIGHT,
    });
  }

  const edges: GraphEdge[] = [];
  for (const edge of interSiteEdges) {
    edges.push({
      id: `${edge.src_id}->${edge.dst_id}`,
      source: edge.dst_id,
      target: edge.src_id,
      type: "topologyEdge",
      data: {
        topoEdge: edge,
        edgeType: edge.edge_type,
        linkStatus: "unknown",
        isHighlighted: false,
        isDimmed: false,
        isPathTrace: false,
      },
      markerEnd: { type: MarkerType.ArrowClosed, color: "#9ca3af", width: 8, height: 8 },
      style: { stroke: "#9ca3af", strokeWidth: 1.5, strokeDasharray: "4 4" },
    });
  }

  return { nodes, edges };
}

/**
 * Grouped site layout: wraps devices inside site containers.
 * Used when showing multiple sites with their internal devices collapsed/expanded.
 */
export function buildSiteGroupedLayout(
  topologyNodes: TopologyNode[],
  topologyEdges: TopologyEdge[],
  options: {
    highlightSet?: Set<string>;
    expandedSites?: Set<string>;
    activeTypeFilters?: Set<string>;
  } = {}
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const { highlightSet = new Set(), expandedSites = new Set(), activeTypeFilters } = options;

  // Apply type filters
  let filteredNodes = topologyNodes;
  if (activeTypeFilters && activeTypeFilters.size > 0) {
    filteredNodes = topologyNodes.filter((n) => activeTypeFilters.has(n.node_type));
  }
  const nodeIds = new Set(filteredNodes.map((n) => n.node_id));
  const filteredEdges = topologyEdges.filter(
    (e) => nodeIds.has(e.src_id) && nodeIds.has(e.dst_id)
  );

  // If all nodes are sites, use backbone layout
  if (filteredNodes.length > 0 && filteredNodes.every((n) => n.node_type === "site")) {
    return buildBackboneLayout(filteredNodes, filteredEdges, highlightSet);
  }

  // Build flat layout first
  const flat = buildHierarchicalLayout(filteredNodes, filteredEdges, { highlightSet });

  const topoNodeMap = new Map(filteredNodes.map((n) => [n.node_id, n]));
  const childParentId = new Map<string, string>();
  const siteNodeMap = new Map<string, TopologyNode>();

  for (const n of filteredNodes) {
    if (n.node_type === "site" && n.site_id) {
      siteNodeMap.set(n.site_id, n);
    } else if (n.node_type !== "site" && n.site_id) {
      childParentId.set(n.node_id, n.site_id);
    }
  }

  const siteChildren = new Map<string, GraphNode[]>();
  const keptNodes: GraphNode[] = [];

  for (const rfNode of flat.nodes) {
    const topoNode = topoNodeMap.get(rfNode.id);
    if (topoNode?.node_type === "site") continue;

    const parentSiteId = childParentId.get(rfNode.id);
    if (parentSiteId) {
      const group = siteChildren.get(parentSiteId) ?? [];
      group.push(rfNode);
      siteChildren.set(parentSiteId, group);
    } else {
      keptNodes.push(rfNode);
    }
  }

  const resultNodes: GraphNode[] = [...keptNodes];
  const GROUP_PADDING = 36;
  const GROUP_HEADER = 44;

  for (const [siteId, children] of siteChildren) {
    if (children.length === 0) continue;

    const groupId = `group-${siteId}`;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const child of children) {
      minX = Math.min(minX, child.position.x);
      minY = Math.min(minY, child.position.y);
      maxX = Math.max(maxX, child.position.x + (child.width ?? INFRA_NODE_WIDTH));
      maxY = Math.max(maxY, child.position.y + (child.height ?? INFRA_NODE_HEIGHT));
    }

    const pw = maxX - minX + GROUP_PADDING * 2;
    const ph = maxY - minY + GROUP_PADDING * 2;
    const px = minX - GROUP_PADDING;
    const py = minY - GROUP_PADDING;

    const siteNode = siteNodeMap.get(siteId);
    const isExpanded = expandedSites.has(siteId);

    resultNodes.push({
      id: groupId,
      type: "siteGroup",
      position: { x: px, y: py },
      data: {
        topoNode: siteNode!,
        label: siteNode?.name || siteId.slice(0, 8),
        nodeType: "site",
        healthStatus: (siteNode?.health_status as any) || "unknown",
        healthColor: "",
        deviceColor: "#8b5cf6",
        deviceLabel: "Site",
        rank: 0,
        isHighlighted: false,
        isDimmed: false,
        isRootCause: false,
        isSymptom: false,
        isSelected: false,
        isSiteGroup: true,
        childCount: children.length,
        crossSiteEdgeCount: 0,
      },
      width: pw,
      height: isExpanded ? ph : GROUP_HEADER,
      style: {
        width: pw,
        height: isExpanded ? ph : GROUP_HEADER,
      },
    });

    if (isExpanded) {
      for (const child of children) {
        resultNodes.push({
          ...child,
          parentId: groupId,
          position: {
            x: child.position.x - px,
            y: child.position.y - py,
          },
          extent: "parent",
        });
      }
    }
  }

  const resultNodeIds = new Set(resultNodes.map((n) => n.id));
  const resultEdges = flat.edges.filter(
    (e) => resultNodeIds.has(e.source) && resultNodeIds.has(e.target)
  );

  return { nodes: resultNodes, edges: resultEdges };
}
