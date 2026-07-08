import type { Node, Edge } from "reactflow";
import { MarkerType } from "reactflow";
import dagre from "dagre";

import type { TopologyNode, TopologyEdge } from "@/types/topology";
import { NODE_TYPE_META } from "@/types/topology";

export const NODE_WIDTH = 200;
export const NODE_HEIGHT = 72;

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
