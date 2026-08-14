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

// ponytail: generous spacing for readable site topology — increase if still cramped
const SITE_RANKSEP = 140;
const SITE_NODESEP = 80;
const SITE_MARGINX = 80;
const SITE_MARGINY = 60;

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

// ---------------------------------------------------------------------------
// Readable Layered Layout — replaces dagre for site-level topology
// ---------------------------------------------------------------------------

function groupNodesByRank(nodes: TopologyNode[]) {
  const groups = new Map<number, TopologyNode[]>();
  for (const n of nodes) {
    const rank = getNodeRank(n.node_type);
    const arr = groups.get(rank) ?? [];
    arr.push(n);
    groups.set(rank, arr);
  }
  return groups;
}

function orderNodesInRank(
  rankNodes: TopologyNode[],
  edgeMap: Map<string, TopologyEdge[]>,
  prevRankPositions: Map<string, number>
): TopologyNode[] {
  if (rankNodes.length <= 1) return rankNodes;

  // Sort by average x-position of connected nodes in previous rank
  return [...rankNodes].sort((a, b) => {
    const aEdges = edgeMap.get(a.node_id) ?? [];
    const bEdges = edgeMap.get(b.node_id) ?? [];
    const aConn = aEdges
      .map((e) => prevRankPositions.get(e.dst_id))
      .filter((x): x is number => x !== undefined);
    const bConn = bEdges
      .map((e) => prevRankPositions.get(e.dst_id))
      .filter((x): x is number => x !== undefined);
    const aAvg = aConn.length ? aConn.reduce((s, x) => s + x, 0) / aConn.length : Infinity;
    const bAvg = bConn.length ? bConn.reduce((s, x) => s + x, 0) / bConn.length : Infinity;
    return aAvg - bAvg;
  });
}

/**
 * Build a clean layered layout for site-level topology.
 * Nodes are placed in horizontal rows by network role (internet → edge → core → dist → access → wireless → endpoints).
 * Much more readable than dagre for network diagrams because we enforce the semantic hierarchy.
 */
export function buildReadableHierarchicalLayout(
  topologyNodes: TopologyNode[],
  topologyEdges: TopologyEdge[],
  options: {
    rankdir?: "TB" | "LR";
    highlightSet?: Set<string>;
  } = {}
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const { rankdir = "TB", highlightSet = new Set() } = options;
  const nodeMap = new Map(topologyNodes.map((n) => [n.node_id, n]));

  if (topologyNodes.length === 0) return { nodes: [], edges: [] };

  const rankGroups = groupNodesByRank(topologyNodes);
  const sortedRanks = Array.from(rankGroups.keys()).sort((a, b) => a - b);

  // Build adjacency: edges where current node is source (child → parent in data model)
  const outgoingEdges = new Map<string, TopologyEdge[]>();
  for (const e of topologyEdges) {
    const arr = outgoingEdges.get(e.src_id) ?? [];
    arr.push(e);
    outgoingEdges.set(e.src_id, arr);
  }

  const isHorizontal = rankdir === "LR";
  const rankSep = SITE_RANKSEP;
  const nodeSep = SITE_NODESEP;
  const marginX = SITE_MARGINX;
  const marginY = SITE_MARGINY;

  const graphNodes: GraphNode[] = [];
  const positionMap = new Map<string, { x: number; y: number }>();

  // Place nodes rank by rank
  for (let rIndex = 0; rIndex < sortedRanks.length; rIndex++) {
    const rank = sortedRanks[rIndex];
    let rankNodes = rankGroups.get(rank)!;

    // Order nodes to minimize edge crossings with previous rank
    if (rIndex > 0) {
      const prevPositions = new Map<string, number>();
      for (const n of graphNodes) {
        prevPositions.set(n.id, isHorizontal ? n.position.y : n.position.x);
      }
      rankNodes = orderNodesInRank(rankNodes, outgoingEdges, prevPositions);
    }

    const maxInRank = Math.max(
      ...Array.from(rankGroups.values()).map((arr) => arr.length)
    );
    const rankWidth = maxInRank * nodeSep + marginX * 2;

    for (let i = 0; i < rankNodes.length; i++) {
      const node = rankNodes[i];
      const isSite = node.node_type === "site";
      const isLeaf = ["client", "endpoint", "sensor", "camera", "iot", "ap", "access_point"].includes(node.node_type);
      const width = isSite ? SITE_GROUP_WIDTH : isLeaf ? LEAF_NODE_WIDTH : INFRA_NODE_WIDTH;
      const height = isSite ? SITE_GROUP_HEIGHT : isLeaf ? LEAF_NODE_HEIGHT : INFRA_NODE_HEIGHT;

      // Spread evenly within the rank, centered
      const span = rankNodes.length * nodeSep;
      const offset = (rankWidth - span) / 2 + i * nodeSep + nodeSep / 2;

      let x: number;
      let y: number;
      if (isHorizontal) {
        x = marginX + rIndex * rankSep;
        y = marginY + offset;
      } else {
        x = marginX + offset;
        y = marginY + rIndex * rankSep;
      }

      positionMap.set(node.node_id, { x, y });

      graphNodes.push({
        id: node.node_id,
        type: isSite ? "siteGroup" : isLeaf ? "leafNode" : "topologyNode",
        position: { x: x - width / 2, y: y - height / 2 },
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
  }

  // Build edges
  const graphEdges: GraphEdge[] = [];
  for (const edge of topologyEdges) {
    if (!nodeMap.has(edge.src_id) || !nodeMap.has(edge.dst_id)) continue;

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
      source: edge.dst_id, // visual direction: parent → child
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

export interface RegionGroup {
  id: string;
  name: string;
  sites: TopologyNode[];
}

export function groupSitesIntoRegions(siteNodes: TopologyNode[]): RegionGroup[] {
  const regions: Record<string, { id: string; name: string; sites: TopologyNode[] }> = {
    "delhi-ncr": { id: "delhi-ncr", name: "Delhi NCR Hub", sites: [] },
    "mumbai-region": { id: "mumbai-region", name: "Mumbai & West Coast Hub", sites: [] },
    "bengaluru-region": { id: "bengaluru-region", name: "Bengaluru Tech Region", sites: [] },
    "pune-region": { id: "pune-region", name: "Pune & Pimpri Belt", sites: [] },
    "north-region": { id: "north-region", name: "North India Zone", sites: [] },
    "south-region": { id: "south-region", name: "South India Zone", sites: [] },
    "east-region": { id: "east-region", name: "East & North East Zone", sites: [] },
    "central-region": { id: "central-region", name: "Central India Zone", sites: [] },
    "industrial-hub": { id: "industrial-hub", name: "Plant & Warehouse Facilities", sites: [] },
    "other": { id: "other", name: "Regional Facilities", sites: [] },
  };

  for (const site of siteNodes) {
    const name = (site.name || "").toLowerCase();

    if (name.includes("delhi") || name.includes("gurugram") || name.includes("palwal") || name.includes("noida")) {
      regions["delhi-ncr"].sites.push(site);
    } else if (name.includes("mumbai") || name.includes("patalganga") || name.includes("bhiwandi") || name.includes("thane")) {
      regions["mumbai-region"].sites.push(site);
    } else if (name.includes("bengaluru") || name.includes("bangalore")) {
      regions["bengaluru-region"].sites.push(site);
    } else if (name.includes("pune") || name.includes("pimpri") || name.includes("chinchwad")) {
      regions["pune-region"].sites.push(site);
    } else if (name.includes("jaipur") || name.includes("ludhiana") || name.includes("chandigarh") || name.includes("lucknow")) {
      regions["north-region"].sites.push(site);
    } else if (name.includes("chennai") || name.includes("hyderabad") || name.includes("vijayawada") || name.includes("kochi")) {
      regions["south-region"].sites.push(site);
    } else if (name.includes("kolkata") || name.includes("patna") || name.includes("guwahati") || name.includes("siliguri") || name.includes("jamshedpur")) {
      regions["east-region"].sites.push(site);
    } else if (name.includes("bhopal") || name.includes("indore") || name.includes("raipur") || name.includes("jabalpur") || name.includes("nagpur")) {
      regions["central-region"].sites.push(site);
    } else if (name.includes("cvbu") || name.includes("pvbu") || name.includes("plant") || name.includes("warehouse")) {
      regions["industrial-hub"].sites.push(site);
    } else {
      regions["other"].sites.push(site);
    }
  }

  return Object.values(regions).filter((r) => r.sites.length > 0);
}

/**
 * Build Regional Hub layout for backbone view.
 * Renders 10-12 large regional cluster cards in a clean 3-column matrix at 1.0x readability scale.
 */
export function buildRegionClustersLayout(
  siteNodes: TopologyNode[],
  highlightSet?: Set<string>
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const groups = groupSitesIntoRegions(siteNodes);
  if (!groups.length) return { nodes: [], edges: [] };

  const COLS = 3;
  const X_GAP = 60;
  const Y_GAP = 50;
  const CARD_WIDTH = 320;
  const CARD_HEIGHT = 110;

  const nodes: GraphNode[] = groups.map((group, index) => {
    const col = index % COLS;
    const row = Math.floor(index / COLS);

    const x = 60 + col * (CARD_WIDTH + X_GAP);
    const y = 60 + row * (CARD_HEIGHT + Y_GAP);

    const criticalCount = group.sites.filter((s) => s.health_status === "critical").length;
    const warningCount = group.sites.filter((s) => s.health_status === "warning" || s.health_status === "degraded").length;
    const healthyCount = group.sites.length - criticalCount - warningCount;

    const aggregateHealth = criticalCount > 0 ? "critical" : warningCount > 0 ? "warning" : "healthy";

    return {
      id: `region-${group.id}`,
      type: "regionalHub",
      position: { x, y },

      data: {
        topoNode: {
          node_id: `region-${group.id}`,
          node_type: "site",
          name: group.name,
          ip_address: "",
          vendor: "regional_hub",
          model: "Hub Cluster",
          site_id: `region-${group.id}`,
          site_name: group.name,
          health_status: aggregateHealth,
          health_label: criticalCount > 0 ? `${criticalCount} critical` : warningCount > 0 ? `${warningCount} degraded` : "All healthy",
          device_count: group.sites.reduce((acc, s) => acc + ((s as any).device_count ?? 1), 0),
          critical_count: criticalCount,
          warning_count: warningCount,
        },
        label: group.name,
        nodeType: "site",
        healthStatus: aggregateHealth as any,
        healthColor: "",
        deviceColor: "#6366f1",
        deviceLabel: "Region Hub",
        rank: 0,
        isHighlighted: false,
        isDimmed: false,
        isRootCause: false,
        isSymptom: false,
        isSelected: false,
        isSiteGroup: true,
        childCount: group.sites.length,
        crossSiteEdgeCount: 0,
        regionSites: group.sites,
      },
      width: CARD_WIDTH,
      height: CARD_HEIGHT,
    };
  });

  return { nodes, edges: [] };
}

/**
 * Build backbone layout: sites only with inter-site edges.
 * Uses a smart 5-column 2D Matrix Grid layout sorted by health status (critical/warning first)
 * so disconnected sites do not stack in a single 1D vertical line.
 */
export function buildBackboneLayout(
  siteNodes: TopologyNode[],
  interSiteEdges: TopologyEdge[],
  highlightSet?: Set<string>
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  if (!siteNodes.length) return { nodes: [], edges: [] };

  // 1. Sort site nodes: critical/warning first, then connected hubs, then name
  const sortedSites = [...siteNodes].sort((a, b) => {
    const healthWeight = (status?: string) =>
      status === "critical" ? 0 : status === "warning" ? 1 : status === "degraded" ? 2 : 3;

    const wA = healthWeight(a.health_status);
    const wB = healthWeight(b.health_status);
    if (wA !== wB) return wA - wB;

    return (a.name || a.node_id).localeCompare(b.name || b.node_id);
  });

  // 2. 2D Matrix Grid calculation: 5 columns
  const COLS = 5;
  const X_GAP = 50;
  const Y_GAP = 40;
  const CARD_WIDTH = SITE_GROUP_WIDTH; // 260
  const CARD_HEIGHT = SITE_GROUP_HEIGHT; // 52

  const nodes: GraphNode[] = sortedSites.map((node, index) => {
    const col = index % COLS;
    const row = Math.floor(index / COLS);

    const x = 60 + col * (CARD_WIDTH + X_GAP);
    const y = 60 + row * (CARD_HEIGHT + Y_GAP);

    return {
      id: node.node_id,
      type: "siteGroup",
      position: { x, y },
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
      width: CARD_WIDTH,
      height: CARD_HEIGHT,
    };
  });

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
