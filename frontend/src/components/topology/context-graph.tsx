import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactFlow, {
  Background,
  Controls,
  type Node,
  type Edge,
  MarkerType,
} from "reactflow";
import "reactflow/dist/style.css";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { NODE_WIDTH, NODE_HEIGHT } from "./layout";
import { NODE_TYPE_META, HEALTH_STATUS_META } from "@/types/topology";
import type { TopologyNodeDetail } from "@/types/topology";

interface ContextGraphProps {
  nodeId: string;
  nodeName: string;
  onBack: () => void;
  onNodeClick?: (nodeId: string, nodeName: string) => void;
  allNodeIds: string[];
}

function buildContextLayout(detail: TopologyNodeDetail) {
  const { node, parents, children } = detail;
  const nodes: Node[] = [];
  const edges: Edge[] = [];

  const cw = NODE_WIDTH;
  const ch = NODE_HEIGHT;
  const gapX = 60;
  const gapY = 80;
  const centerX = 400;

  const parentStartX = centerX - ((parents.length - 1) * (cw + gapX)) / 2;
  const addedIds = new Set<string>();

  for (let i = 0; i < parents.length; i++) {
    const p = parents[i];
    nodes.push({
      id: p.node_id,
      type: "default",
      position: { x: parentStartX + i * (cw + gapX), y: 40 },
      data: {
        label: p.name || p.node_id,
        nodeType: p.node_type,
        health: p.health_status,
      },
      style: nodeStyle(p),
    });
    addedIds.add(p.node_id);
  }

  nodes.push({
    id: node.node_id,
    type: "default",
    position: { x: centerX - cw / 2, y: 40 + ch + gapY },
    data: {
      label: node.name || node.node_id,
      nodeType: node.node_type,
      health: node.health_status,
      isTarget: true,
    },
    style: {
      ...nodeStyle(node),
      borderWidth: 3,
      boxShadow: `0 0 0 3px ${HEALTH_STATUS_META[node.health_status]?.color ?? "#6b7280"}40`,
    },
  });
  addedIds.add(node.node_id);

  const childStartX = centerX - ((children.length - 1) * (cw + gapX)) / 2;
  for (let i = 0; i < children.length; i++) {
    const c = children[i];
    nodes.push({
      id: c.node_id,
      type: "default",
      position: { x: childStartX + i * (cw + gapX), y: 40 + 2 * (ch + gapY) },
      data: {
        label: c.name || c.node_id,
        nodeType: c.node_type,
        health: c.health_status,
      },
      style: nodeStyle(c),
    });
    addedIds.add(c.node_id);
  }

  for (const parent of parents) {
    edges.push({
      id: `ctx-edge-${parent.node_id}-${node.node_id}`,
      source: parent.node_id,
      target: node.node_id,
      type: "smoothstep",
      style: { stroke: "#6b7280", strokeWidth: 1.5 },
      markerEnd: { type: MarkerType.ArrowClosed, color: "#6b7280" },
    });
  }

  for (const child of children) {
    edges.push({
      id: `ctx-edge-${node.node_id}-${child.node_id}`,
      source: node.node_id,
      target: child.node_id,
      type: "smoothstep",
      style: { stroke: "#6b7280", strokeWidth: 1.5 },
      markerEnd: { type: MarkerType.ArrowClosed, color: "#6b7280" },
    });
  }

  return { nodes, edges };
}

function nodeStyle(topoNode: { node_type: string; health_status: string }) {
  const meta = NODE_TYPE_META[topoNode.node_type];
  const hMeta = HEALTH_STATUS_META[topoNode.health_status] ?? HEALTH_STATUS_META.unknown;
  return {
    background: "hsl(var(--surface))",
    border: `2px solid ${meta?.color ?? "#6b7280"}`,
    borderRadius: 8,
    padding: "6px 12px",
    fontSize: 11,
    fontWeight: 500,
    color: "hsl(var(--foreground))",
    width: NODE_WIDTH,
    minHeight: NODE_HEIGHT,
    display: "flex",
    alignItems: "center",
    gap: 8,
    borderLeft: `4px solid ${hMeta.color}`,
  };
}

export function ContextGraph({ nodeId, nodeName, onBack, onNodeClick, allNodeIds }: ContextGraphProps) {
  const reactFlowInstance = useRef<any>(null);
  const firstFitDone = useRef(false);

  const { data: detail, isLoading } = useQuery({
    queryKey: ["topology-node-ctx", nodeId],
    queryFn: () => api.getTopologyNode(nodeId),
    staleTime: 30000,
  });

  const { nodes, edges } = useMemo(
    () => (detail ? buildContextLayout(detail) : { nodes: [], edges: [] }),
    [detail],
  );

  useEffect(() => {
    if (reactFlowInstance.current && !firstFitDone.current && nodes.length > 0) {
      firstFitDone.current = true;
      setTimeout(() => reactFlowInstance.current.fitView({ padding: 0.3, duration: 300 }), 100);
    }
  }, [nodes.length]);

  const handleNodeClick = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      if (node.id === nodeId) return;
      if (onNodeClick && allNodeIds.includes(node.id)) {
        onNodeClick(node.id, (node.data as any)?.label ?? node.id);
      }
    },
    [nodeId, onNodeClick, allNodeIds],
  );

  return (
    <div>
      {/* Mode bar */}
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button
            onClick={onBack}
            className="inline-flex items-center gap-1 rounded-md border border-border/60 px-2.5 py-1.5 text-xs font-medium text-foreground-muted transition-colors hover:bg-surface hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back
          </button>
          <div className="text-sm text-foreground-muted">
            Connections for <span className="font-medium text-foreground">{nodeName}</span>
          </div>
        </div>
      </div>

      {/* Graph */}
      <div className="h-[600px] rounded-xl border border-border/40 bg-surface/20">
        {isLoading ? (
          <div className="flex h-full items-center justify-center">
            <div className="h-8 w-8 animate-pulse rounded-full bg-surface-elevated" />
          </div>
        ) : nodes.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <div className="text-center">
              <ExternalLink className="mx-auto h-8 w-8 text-foreground-subtle" />
              <p className="mt-2 text-sm text-foreground-muted">No neighbor data available</p>
            </div>
          </div>
        ) : (
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onInit={(instance) => { reactFlowInstance.current = instance; }}
            onNodeClick={handleNodeClick}
            fitView
            onlyRenderVisibleElements
            attributionPosition="bottom-left"
            minZoom={0.2}
            maxZoom={4}
          >
            <Background color="hsl(var(--border) / 0.3)" gap={20} size={1} />
            <Controls className="!rounded-lg !border-border/60 !bg-surface !shadow-surface" showInteractive={false} />
          </ReactFlow>
        )}
      </div>

      {/* Legend */}
      {detail && (
        <div className="mt-2 flex items-center gap-4 text-[10px] text-foreground-muted">
          <span>Parents: {detail.parents.length}</span>
          <span>Children: {detail.children.length}</span>
          <span className="text-border">·</span>
          <span>Click any node to view its connections</span>
        </div>
      )}
    </div>
  );
}
