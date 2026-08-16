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

export const INFRA_NODE_WIDTH = 220;
export const INFRA_NODE_HEIGHT = 90;
export const LEAF_NODE_WIDTH = 220;
export const LEAF_NODE_HEIGHT = 90;
export const SITE_GROUP_WIDTH = 220;
export const SITE_GROUP_HEIGHT = 90;

// Site view uses standard 220x90 context cards
export const SITE_VIEW_NODE_WIDTH = 220;
export const SITE_VIEW_NODE_HEIGHT = 90;

const RANKSEP = 90;
const NODESEP = 50;
const MARGINX = 60;
const MARGINY = 60;

// Generous spacing for readable site topology — must match bigger cards
const SITE_RANKSEP = 180;
const SITE_NODESEP = 100;
const SITE_MARGINX = 100;
const SITE_MARGINY = 80;

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
  const graphEdges: GraphEdge[] = buildGraphEdges(topologyEdges, nodeMap, highlightSet, {});

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
    collapsedRanks?: Set<number>;
    siteView?: boolean;
    adjacentRanksOnly?: boolean;
  } = {}
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const { rankdir = "TB", highlightSet = new Set(), collapsedRanks = new Set(), siteView = false, adjacentRanksOnly = false } = options;

  // Filter out collapsed-rank nodes
  const visibleNodes = topologyNodes.filter((n) => !collapsedRanks.has(getNodeRank(n.node_type)));
  const nodeMap = new Map(visibleNodes.map((n) => [n.node_id, n]));

  if (visibleNodes.length === 0) return { nodes: [], edges: [] };

  const rankGroups = groupNodesByRank(visibleNodes);
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

  // Adaptive density: site-view uses bigger cards so fewer nodes per row
  const MAX_RANK_PX = siteView ? 2200 : 1400;
  const crossMargin = isHorizontal ? marginY * 2 : marginX * 2;
  const maxNodesPerSubRow = Math.max(4, Math.floor((MAX_RANK_PX - crossMargin) / nodeSep));

  const graphNodes: GraphNode[] = [];
  const positionMap = new Map<string, { x: number; y: number }>();

  let currentMain = isHorizontal ? marginX : marginY;
  const mainStart = currentMain;
  const crossStart = isHorizontal ? marginY : marginX;
  const baseNodeMain = isHorizontal
    ? (siteView ? SITE_VIEW_NODE_WIDTH : INFRA_NODE_WIDTH)
    : (siteView ? SITE_VIEW_NODE_HEIGHT : INFRA_NODE_HEIGHT);
  const subRowGap = 24;

  // Place nodes rank by rank
  for (let rIndex = 0; rIndex < sortedRanks.length; rIndex++) {
    const rank = sortedRanks[rIndex];
    let rankNodes = rankGroups.get(rank)!;
    if (!rankNodes || rankNodes.length === 0) continue;

    // Order nodes to minimize edge crossings with previous rank
    if (rIndex > 0) {
      const prevPositions = new Map<string, number>();
      for (const n of graphNodes) {
        prevPositions.set(n.id, isHorizontal ? n.position.y : n.position.x);
      }
      rankNodes = orderNodesInRank(rankNodes, outgoingEdges, prevPositions);
    }

    // Wrap into sub-rows if rank is too wide
    const subRows: TopologyNode[][] = [];
    for (let i = 0; i < rankNodes.length; i += maxNodesPerSubRow) {
      subRows.push(rankNodes.slice(i, i + maxNodesPerSubRow));
    }

    // Compute cross-axis size for centering (based on widest sub-row)
    const maxSubRowNodes = Math.max(...subRows.map((r) => r.length), 1);
    const rankCrossSpan = maxSubRowNodes * nodeSep;
    const rankCrossSize = rankCrossSpan + crossMargin;

    // Place each sub-row
    for (let sr = 0; sr < subRows.length; sr++) {
      const row = subRows[sr];
      const span = row.length * nodeSep;
      const offset = (rankCrossSize - span) / 2 + nodeSep / 2;

      for (let i = 0; i < row.length; i++) {
        const node = row[i];
        const isSite = node.node_type === "site";
        const isLeaf = ["client", "endpoint", "sensor", "camera", "iot", "ap", "access_point"].includes(node.node_type);

        // Site view uses bigger, unified cards for readability
        const width = siteView
          ? SITE_VIEW_NODE_WIDTH
          : isSite
            ? SITE_GROUP_WIDTH
            : isLeaf
              ? LEAF_NODE_WIDTH
              : INFRA_NODE_WIDTH;
        const height = siteView
          ? SITE_VIEW_NODE_HEIGHT
          : isSite
            ? SITE_GROUP_HEIGHT
            : isLeaf
              ? LEAF_NODE_HEIGHT
              : INFRA_NODE_HEIGHT;
        const nodeMain = isHorizontal ? width : height;

        const crossPos = crossStart + offset + i * nodeSep;
        const mainPos = currentMain + sr * (nodeMain + subRowGap);

        const x = isHorizontal ? mainPos : crossPos;
        const y = isHorizontal ? crossPos : mainPos;

        positionMap.set(node.node_id, { x, y });

        const nodeType = siteView
          ? "siteViewNode"
          : isSite
            ? "siteGroup"
            : isLeaf
              ? "leafNode"
              : "topologyNode";

        graphNodes.push({
          id: node.node_id,
          type: nodeType,
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

    // Advance main position by this rank's depth + separation
    const rankDepth = subRows.length * baseNodeMain + (subRows.length - 1) * subRowGap;
    currentMain += rankDepth + rankSep;
  }

  // Build edges (only between visible nodes, optionally adjacent ranks only)
  const graphEdges: GraphEdge[] = buildGraphEdges(topologyEdges, nodeMap, highlightSet, {
    adjacentRanksOnly,
    rankFn: getNodeRank,
  });

  return { nodes: graphNodes, edges: graphEdges };
}

// buildFlatLayout was a wrapper around buildHierarchicalLayout — deleted per ponytail.
// Callers should use buildHierarchicalLayout directly with rankdir="TB".

export interface RegionGroup {
  id: string;
  name: string;
  sites: TopologyNode[];
}

const REGION_RULES: { keywords: string[]; id: string; name: string }[] = [
  { keywords: ["delhi", "gurugram", "palwal", "noida"], id: "delhi-ncr", name: "Delhi NCR Hub" },
  { keywords: ["mumbai", "patalganga", "bhiwandi", "thane"], id: "mumbai-region", name: "Mumbai & West Coast Hub" },
  { keywords: ["bengaluru", "bangalore"], id: "bengaluru-region", name: "Bengaluru Tech Region" },
  { keywords: ["pune", "pimpri", "chinchwad"], id: "pune-region", name: "Pune & Pimpri Belt" },
  { keywords: ["jaipur", "ludhiana", "chandigarh", "lucknow"], id: "north-region", name: "North India Zone" },
  { keywords: ["chennai", "hyderabad", "vijayawada", "kochi"], id: "south-region", name: "South India Zone" },
  { keywords: ["kolkata", "patna", "guwahati", "siliguri", "jamshedpur"], id: "east-region", name: "East & North East Zone" },
  { keywords: ["bhopal", "indore", "raipur", "jabalpur", "nagpur"], id: "central-region", name: "Central India Zone" },
  { keywords: ["cvbu", "pvbu", "plant", "warehouse"], id: "industrial-hub", name: "Plant & Warehouse Facilities" },
];

export function groupSitesIntoRegions(siteNodes: TopologyNode[]): RegionGroup[] {
  const buckets = new Map<string, TopologyNode[]>();
  for (const site of siteNodes) {
    const name = (site.name || "").toLowerCase();
    let matched = false;
    for (const rule of REGION_RULES) {
      if (rule.keywords.some((k) => name.includes(k))) {
        const list = buckets.get(rule.id) ?? [];
        list.push(site);
        buckets.set(rule.id, list);
        matched = true;
        break;
      }
    }
    if (!matched) {
      const list = buckets.get("other") ?? [];
      list.push(site);
      buckets.set("other", list);
    }
  }
  return REGION_RULES.filter((r) => buckets.has(r.id))
    .map((r) => ({ id: r.id, name: r.name, sites: buckets.get(r.id)! }))
    .concat(buckets.has("other") ? [{ id: "other", name: "Regional Facilities", sites: buckets.get("other")! }] : []);
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

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Build GraphEdges from topology edges with health-derived styling. */
interface BuildGraphEdgeOptions {
  adjacentRanksOnly?: boolean;
  rankFn?: (nodeType: string) => number;
}

function buildGraphEdges(
  topologyEdges: TopologyEdge[],
  nodeMap: Map<string, TopologyNode>,
  highlightSet: Set<string>,
  options: BuildGraphEdgeOptions = {},
): GraphEdge[] {
  const { adjacentRanksOnly = false, rankFn } = options;

  // Filter to visible nodes first
  const visibleEdges = topologyEdges.filter(
    (e) => nodeMap.has(e.src_id) && nodeMap.has(e.dst_id),
  );

  // Adjacent-rank filter: only keep edges between neighboring layers
  let edgesToRender = visibleEdges;
  if (adjacentRanksOnly && rankFn) {
    edgesToRender = visibleEdges.filter((e) => {
      const srcRank = rankFn(nodeMap.get(e.src_id)!.node_type);
      const dstRank = rankFn(nodeMap.get(e.dst_id)!.node_type);
      return Math.abs(srcRank - dstRank) <= 1;
    });
  }

  // Bundle parallel edges: group by (source, target) and merge
  const bundleKey = (e: TopologyEdge) => `${e.dst_id}->${e.src_id}`;
  const bundles = new Map<string, { edges: TopologyEdge[]; worstStatus: "down" | "degraded" | "healthy" | "unknown" }>();

  for (const edge of edgesToRender) {
    const key = bundleKey(edge);
    const srcNode = nodeMap.get(edge.src_id)!;
    const dstNode = nodeMap.get(edge.dst_id)!;

    let status: "down" | "degraded" | "healthy" | "unknown" = "unknown";
    if (srcNode.health_status === "critical" || dstNode.health_status === "critical") {
      status = "down";
    } else if (srcNode.health_status === "warning" || dstNode.health_status === "warning") {
      status = "degraded";
    } else if (srcNode.health_status === "healthy" && dstNode.health_status === "healthy") {
      status = "healthy";
    }

    const existing = bundles.get(key);
    if (!existing) {
      bundles.set(key, { edges: [edge], worstStatus: status });
    } else {
      existing.edges.push(edge);
      // Upgrade worst status: down > degraded > healthy > unknown
      const order = { down: 3, degraded: 2, healthy: 1, unknown: 0 };
      if (order[status] > order[existing.worstStatus]) {
        existing.worstStatus = status;
      }
    }
  }

  const out: GraphEdge[] = [];
  for (const [key, bundle] of bundles) {
    const [dstId, srcId] = key.split("->");
    const count = bundle.edges.length;
    const isHighlighted = highlightSet.has(srcId) && highlightSet.has(dstId);
    const linkStatus = bundle.worstStatus;

    out.push({
      id: key,
      source: dstId,
      target: srcId,
      type: "topologyEdge",
      data: {
        topoEdge: bundle.edges[0],
        edgeType: bundle.edges[0].edge_type,
        linkStatus,
        isHighlighted,
        isDimmed: false,
        isPathTrace: false,
        bundleCount: count,
      },
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color: linkStatus === "down" ? "#ef4444" : linkStatus === "degraded" ? "#eab308" : "#9ca3af",
        width: count > 1 ? 12 : 8,
        height: count > 1 ? 12 : 8,
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
        strokeWidth: isHighlighted ? 3 : linkStatus === "down" ? 2.5 : count > 1 ? 2 : 1.5,
        strokeDasharray:
          bundle.edges[0].edge_type === "logical" || bundle.edges[0].edge_type === "wan_link" || linkStatus === "unknown"
            ? "4 4"
            : linkStatus === "down"
              ? "6 3"
              : undefined,
        opacity: 1,
      },
      label: count > 1 ? `×${count}` : undefined,
      labelStyle: { fill: "#94a3b8", fontSize: 9, fontWeight: 700 },
      labelBgStyle: { fill: "#0f172a", fillOpacity: 0.85 },
    });
  }

  return out;
}
