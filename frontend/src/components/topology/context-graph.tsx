import { useCallback, useEffect, useMemo, useRef } from "react";
import ReactFlow, {
  Background,
  Controls,
  type Node,
  type Edge,
  type NodeProps,
  MarkerType,
  Handle,
  Position,
} from "reactflow";
import "reactflow/dist/style.css";
import {
  Globe, Shield, Router, Server, Network, Wifi,
  Radio, Monitor, Smartphone, Camera, Cpu, HardDrive,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { NODE_TYPE_META, HEALTH_STATUS_META } from "@/types/topology";
import type { TopologyNode } from "@/types/topology";

interface ContextGraphProps {
  nodeId: string;
  nodeName: string;
  onBack: () => void;
  onNodeClick?: (nodeId: string, nodeName: string) => void;
  allNodeIds: string[];
}

// ---------------------------------------------------------------------------
// Icon mapping
// ---------------------------------------------------------------------------
type IconComp = React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
const TYPE_ICONS: Record<string, IconComp> = {
  internet: Globe, wan: Globe, cloud: Globe,
  site: Server,
  firewall: Shield, vpn_gateway: Shield,
  router: Router, gateway: Router, wan_edge: Router,
  core_switch: Network, distribution_switch: Network, access_switch: Network, switch: Network, controller: Server, edge: Server,
  ap: Wifi, access_point: Wifi,
  wireless_controller: Radio,
  client: Monitor, endpoint: Smartphone,
  sensor: Cpu, camera: Camera, iot: Cpu,
};
function getIcon(nodeType: string): IconComp {
  return TYPE_ICONS[nodeType] ?? HardDrive;
}

// ---------------------------------------------------------------------------
// Custom context node card
// ---------------------------------------------------------------------------
interface ContextNodeData {
  topoNode: TopologyNode;
  isFocus: boolean;
}

function ContextNodeCard({ data }: NodeProps<ContextNodeData>) {
  const { topoNode, isFocus } = data;
  const meta = NODE_TYPE_META[topoNode.node_type] ?? { label: topoNode.node_type, color: "#6b7280" };
  const hMeta = HEALTH_STATUS_META[topoNode.health_status] ?? HEALTH_STATUS_META.unknown;
  const Icon = getIcon(topoNode.node_type);

  return (
    <>
      <Handle type="target" position={Position.Top} style={{ background: "hsl(var(--border))", border: "none" }} />
      <div
        style={{
          width: 220,
          borderColor: isFocus ? hMeta.color : "hsl(var(--border) / 0.6)",
          boxShadow: isFocus ? `0 0 0 2px ${hMeta.color}40` : "0 2px 8px rgba(0,0,0,0.3)",
          borderWidth: isFocus ? 2 : 1,
        }}
        className="rounded bg-surface p-3 border overflow-hidden transition-all hover:border-primary/50"
      >
        <div className="space-y-1.5">
          {/* Type + health badge */}
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 min-w-0">
              <Icon className="h-3.5 w-3.5 shrink-0" style={{ color: meta.color }} />
              <span className="text-[10px] font-bold uppercase tracking-wider text-foreground-subtle truncate">
                {meta.label}
              </span>
            </div>
            <span
              className="shrink-0 text-[10px] font-semibold"
              style={{ color: hMeta.color }}
            >
              {hMeta.label}
            </span>
          </div>

          {/* Name */}
          <div
            className="text-xs font-bold text-foreground leading-tight truncate"
            title={topoNode.name || topoNode.node_id}
          >
            {topoNode.name || topoNode.node_id}
          </div>

          {/* IP / Vendor Model */}
          <div className="flex flex-wrap items-center gap-x-2 text-[10px] font-mono text-foreground-muted">
            {topoNode.ip_address && <span>{topoNode.ip_address}</span>}
            {(topoNode.vendor || topoNode.model) && (
              <span>{[topoNode.vendor, topoNode.model].filter(Boolean).join(" · ")}</span>
            )}
          </div>

          {/* Focus badge */}
          {isFocus && (
            <div className="text-[9px] font-bold uppercase tracking-widest text-primary pt-0.5">
              ← Focus Device
            </div>
          )}
        </div>
      </div>
      <Handle type="source" position={Position.Bottom} style={{ background: "hsl(var(--border))", border: "none" }} />
    </>
  );
}

const CONTEXT_NODE_TYPES = { contextNode: ContextNodeCard };

// ---------------------------------------------------------------------------
// Layout builder
// ---------------------------------------------------------------------------
const NODE_W = 220;
const NODE_H = 110;
const GAP_X = 40;
const GAP_Y = 100;

function buildContextLayout(
  focusNode: TopologyNode,
  parents: TopologyNode[],
  children: TopologyNode[],
) {
  const nodes: Node[] = [];
  const edges: Edge[] = [];

  const parentRowWidth = parents.length * (NODE_W + GAP_X) - GAP_X;
  const childRowWidth = children.length * (NODE_W + GAP_X) - GAP_X;
  const maxWidth = Math.max(NODE_W, parentRowWidth, childRowWidth);
  const centerX = maxWidth / 2;

  // Parents row (top)
  const parentStartX = centerX - parentRowWidth / 2;
  for (let i = 0; i < parents.length; i++) {
    const p = parents[i];
    nodes.push({
      id: p.node_id,
      type: "contextNode",
      position: { x: parentStartX + i * (NODE_W + GAP_X), y: 0 },
      data: { topoNode: p, isFocus: false } satisfies ContextNodeData,
    });
    edges.push({
      id: `edge-parent-${p.node_id}`,
      source: p.node_id,
      target: focusNode.node_id,
      type: "smoothstep",
      style: { stroke: "hsl(var(--primary))", strokeWidth: 1.5, strokeDasharray: "4 2" },
      markerEnd: { type: MarkerType.ArrowClosed, color: "hsl(var(--primary))", width: 12, height: 12 },
      label: "upstream",
      labelStyle: { fill: "hsl(var(--primary))", fontSize: 9, fontWeight: 600 },
      labelBgStyle: { fill: "hsl(var(--surface))", fillOpacity: 0.9 },
    });
  }

  // Focus node (middle)
  nodes.push({
    id: focusNode.node_id,
    type: "contextNode",
    position: { x: centerX - NODE_W / 2, y: parents.length > 0 ? NODE_H + GAP_Y : 0 },
    data: { topoNode: focusNode, isFocus: true } satisfies ContextNodeData,
  });

  // Children row (bottom)
  const childStartX = centerX - childRowWidth / 2;
  const childY = (parents.length > 0 ? NODE_H + GAP_Y : 0) + NODE_H + GAP_Y;
  for (let i = 0; i < children.length; i++) {
    const c = children[i];
    nodes.push({
      id: c.node_id,
      type: "contextNode",
      position: { x: childStartX + i * (NODE_W + GAP_X), y: childY },
      data: { topoNode: c, isFocus: false } satisfies ContextNodeData,
    });
    edges.push({
      id: `edge-child-${c.node_id}`,
      source: focusNode.node_id,
      target: c.node_id,
      type: "smoothstep",
      style: { stroke: "hsl(var(--border) / 0.8)", strokeWidth: 1.5 },
      markerEnd: { type: MarkerType.ArrowClosed, color: "hsl(var(--border))", width: 12, height: 12 },
    });
  }

  return { nodes, edges };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export function ContextGraph({ nodeId, onNodeClick, allNodeIds }: ContextGraphProps) {
  const reactFlowInstance = useRef<any>(null);
  const firstFitDone = useRef(false);

  const { data: detail, isLoading } = useQuery({
    queryKey: ["topology-node-ctx", nodeId],
    queryFn: () => api.getTopologyNode(nodeId),
    staleTime: 30000,
  });

  const { nodes, edges } = useMemo(() => {
    if (!detail) return { nodes: [], edges: [] };
    return buildContextLayout(detail.node, detail.parents, detail.children);
  }, [detail]);

  useEffect(() => {
    if (reactFlowInstance.current && !firstFitDone.current && nodes.length > 0) {
      firstFitDone.current = true;
      setTimeout(() => reactFlowInstance.current.fitView({ padding: 0.2, duration: 300 }), 120);
    }
  }, [nodes.length]);

  const handleNodeClick = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      if (node.id === nodeId) return;
      if (onNodeClick && allNodeIds.includes(node.id)) {
        const topoNode = (node.data as ContextNodeData).topoNode;
        onNodeClick(node.id, topoNode.name || node.id);
      }
    },
    [nodeId, onNodeClick, allNodeIds],
  );

  if (isLoading) {
    return (
      <div className="flex h-[520px] items-center justify-center rounded-lg border border-border/40 bg-surface/30">
        <div className="h-10 w-10 animate-pulse rounded-full bg-surface" />
      </div>
    );
  }

  if (!detail || nodes.length === 0) {
    return (
      <div className="flex h-[520px] items-center justify-center rounded-lg border border-dashed border-border/40">
        <p className="text-xs text-foreground-subtle">No topology connections found for this device</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Layer legend */}
      <div className="flex items-center gap-4 text-[10px] text-foreground-subtle font-medium uppercase tracking-wider">
        {detail.parents.length > 0 && (
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-px w-4 border-t border-dashed border-primary" />
            Upstream ({detail.parents.length})
          </span>
        )}
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 rounded-sm bg-primary/40 ring-1 ring-primary" />
          Focus Device
        </span>
        {detail.children.length > 0 && (
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-px w-4 border-t border-border" />
            Downstream ({detail.children.length})
          </span>
        )}
      </div>

      <div className="h-[520px] rounded-lg border border-border/40 overflow-hidden bg-background">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={CONTEXT_NODE_TYPES}
          onInit={(inst) => { reactFlowInstance.current = inst; }}
          onNodeClick={handleNodeClick}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          onlyRenderVisibleElements
          attributionPosition="bottom-left"
          minZoom={0.3}
          maxZoom={3}
          nodesDraggable
          zoomOnScroll={false}
          panOnScroll={false}
          zoomOnPinch={true}
          preventScrolling={false}
          className="bg-background"
          defaultEdgeOptions={{ type: "smoothstep" }}
        >
          <Background color="hsl(var(--border) / 0.25)" gap={20} size={1} />
          <Controls className="!bg-surface !border-border/60" showInteractive={false} />
        </ReactFlow>
      </div>
    </div>
  );
}
