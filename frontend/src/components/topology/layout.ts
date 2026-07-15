import type { Node, Edge } from "reactflow";
import { MarkerType } from "reactflow";
import dagre from "dagre";

import type { TopologyNode, TopologyEdge } from "@/types/topology";
import { NODE_TYPE_META } from "@/types/topology";

export const NODE_WIDTH = 200;
export const NODE_HEIGHT = 72;
const GROUP_PADDING = 48;
const GROUP_HEADER_HEIGHT = 44;

function deviceTypeMeta(nodeType: string) {
  return NODE_TYPE_META[nodeType] ?? {
    label: nodeType,
    category: "leaf" as const,
    color: "#6b7280",
  };
}

export interface LayoutResult {
  nodes: Node[];
  edges: Edge[];
}

/**
 * Flat dagre layout — positions all nodes without grouping.
 */
export function buildLayout(
  topologyNodes: TopologyNode[],
  topologyEdges: TopologyEdge[],
  highlightSet?: Set<string>,
): LayoutResult {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: "TB", nodesep: 60, ranksep: 100, marginx: 40, marginy: 40 });

  const nodeMap = new Map(topologyNodes.map((n) => [n.node_id, n]));

  for (const node of topologyNodes) {
    g.setNode(node.node_id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  }

  for (const edge of topologyEdges) {
    if (nodeMap.has(edge.src_id) && nodeMap.has(edge.dst_id)) {
      g.setEdge(edge.dst_id, edge.src_id);
    }
  }

  dagre.layout(g);

  const rfNodes: Node[] = [];
  for (const node of topologyNodes) {
    const dagreNode = g.node(node.node_id);
    if (!dagreNode) continue;
    const meta = deviceTypeMeta(node.node_type);
    const isHighlighted = highlightSet?.has(node.node_id) ?? false;
    rfNodes.push({
      id: node.node_id,
      type: "topologyNode",
      position: {
        x: dagreNode.x - NODE_WIDTH / 2,
        y: dagreNode.y - NODE_HEIGHT / 2,
      },
      data: {
        label: node.name || node.node_id,
        node_type: node.node_type,
        vendor: node.vendor,
        node,
        health_status: node.health_status,
        highlighted: isHighlighted,
      },
    });
  }

  const rfEdges: Edge[] = topologyEdges
    .filter((e) => nodeMap.has(e.src_id) && nodeMap.has(e.dst_id))
    .map((e) => ({
      id: `${e.dst_id}->${e.src_id}`,
      source: e.dst_id,
      target: e.src_id,
      type: "smoothstep",
      animated: false,
      markerEnd: { type: MarkerType.ArrowClosed, color: "#6b7280" },
      style: { stroke: "#6b7280", strokeWidth: 1.5 },
    }));

  return { nodes: rfNodes, edges: rfEdges };
}

export interface GroupedLayoutResult extends LayoutResult {
  crossSiteEdgeCounts: Record<string, number>;
}

/**
 * Hierarchical layout — wraps AP / switch nodes inside collapsible site groups.
 *
 * Supports:
 *   - Type filtering (hide APs, switches, or sites)
 *   - Cross-site edge counting for collapsed groups
 *   - Expand/collapse per site
 */
export function buildGroupedLayout(
  topologyNodes: TopologyNode[],
  topologyEdges: TopologyEdge[],
  highlightSet?: Set<string>,
  expandedSites: Set<string> = new Set(),
  activeTypeFilters?: Set<string>,
): GroupedLayoutResult {
  // Apply type filters before layout
  let filteredNodes = topologyNodes;
  let filteredEdges = topologyEdges;
  if (activeTypeFilters && activeTypeFilters.size > 0) {
    filteredNodes = topologyNodes.filter((n) => activeTypeFilters.has(n.node_type));
    const filteredNodeIds = new Set(filteredNodes.map((n) => n.node_id));
    filteredEdges = topologyEdges.filter(
      (e) => filteredNodeIds.has(e.src_id) && filteredNodeIds.has(e.dst_id),
    );
  }

  // All nodes are sites (backbone mode) — nothing to group, return flat layout
  if (filteredNodes.length > 0 && filteredNodes.every((n) => n.node_type === "site")) {
    const flat = buildLayout(filteredNodes, filteredEdges, highlightSet);
    return { nodes: flat.nodes, edges: flat.edges, crossSiteEdgeCounts: {} };
  }

  const flat = buildLayout(filteredNodes, filteredEdges, highlightSet);

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

  const siteChildren = new Map<string, Node[]>();
  const keptNodes: Node[] = [];

  for (const rfNode of flat.nodes) {
    const topoNode = topoNodeMap.get(rfNode.id);

    if (topoNode?.node_type === "site") {
      continue;
    }

    const parentSiteId = childParentId.get(rfNode.id);
    if (parentSiteId) {
      const group = siteChildren.get(parentSiteId) ?? [];
      group.push(rfNode);
      siteChildren.set(parentSiteId, group);
    } else {
      keptNodes.push(rfNode);
    }
  }

  // If site type is filtered out, skip grouping entirely — return flat layout
  const siteTypeFiltered = activeTypeFilters && !activeTypeFilters.has("site");
  if (siteTypeFiltered) {
    return { nodes: flat.nodes, edges: flat.edges, crossSiteEdgeCounts: {} };
  }

  // Build cross-site edge count map before filtering edges
  const crossSiteEdgeCounts: Record<string, number> = {};
  const siteChildNodeIds = new Map<string, Set<string>>();

  for (const [siteId, children] of siteChildren) {
    const ids = new Set(children.map((c) => c.id));
    siteChildNodeIds.set(siteId, ids);
  }

  for (const [siteId, childIds] of siteChildNodeIds) {
    let count = 0;
    for (const edge of flat.edges) {
      const srcInSite = childIds.has(edge.source);
      const dstInSite = childIds.has(edge.target);
      if (srcInSite !== dstInSite) {
        count++;
      }
    }
    crossSiteEdgeCounts[siteId] = count;
  }

  const resultNodes: Node[] = [...keptNodes];
  const groupNodeIds = new Set<string>();

  for (const [siteId, children] of siteChildren) {
    if (children.length === 0) continue;

    const groupId = `group-${siteId}`;
    groupNodeIds.add(groupId);

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const child of children) {
      minX = Math.min(minX, child.position.x);
      minY = Math.min(minY, child.position.y);
      maxX = Math.max(maxX, child.position.x + NODE_WIDTH);
      maxY = Math.max(maxY, child.position.y + NODE_HEIGHT);
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
        label: siteNode?.name || siteId.slice(0, 8),
        site_id: siteId,
        node_type: "site",
        child_count: children.length,
        isExpanded,
        health_status: siteNode?.health_status ?? "unknown",
        vendor: siteNode?.vendor ?? "mist",
        crossSiteEdgeCount: crossSiteEdgeCounts[siteId] ?? 0,
      },
      style: {
        width: pw,
        height: isExpanded ? ph : GROUP_HEADER_HEIGHT,
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
          extent: "parent" as const,
        });
      }
    }
  }

  const resultNodeIds = new Set(resultNodes.map((n) => n.id));
  const resultEdges = flat.edges.filter(
    (e) => resultNodeIds.has(e.source) && resultNodeIds.has(e.target),
  );

  return { nodes: resultNodes, edges: resultEdges, crossSiteEdgeCounts };
}
