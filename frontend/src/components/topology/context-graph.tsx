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
// Icon mapping (same as topology-node-types.tsx)
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
      <Handle type="target" position={Position.Top} style={{ background: "#334155", border: "1px solid #475569" }} />
      <div
        style={{
          width: 220,
          borderColor: isFocus ? hMeta.color : meta.color,
          boxShadow: isFocus ? `0 0 0 3px ${hMeta.color}30, 0 4px 20px ${hMeta.color}20` : "0 2px 8px rgba(0,0,0,0.4)",
          borderWidth: isFocus ? 2 : 1,
        }}
        className="rounded-lg bg-slate-900 border overflow-hidden"
      >
        {/* Health bar */}
        <div className="h-[3px]" style={{ backgroundColor: hMeta.color }} />

        <div className="px-3 py-2.5 space-y-1.5">
          {/* Type + health badge */}
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 min-w-0">
              <Icon className="h-3 w-3 shrink-0" style={{ color: meta.color }} />
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 truncate">
                {meta.label}
              </span>
            </div>
            <span
              className="shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded-sm"
              style={{ color: hMeta.color, backgroundColor: hMeta.bgColor }}
            >
              {hMeta.label}
            </span>
          </div>

          {/* Name */}
          <div
            className="text-xs font-semibold text-white leading-tight"
            style={{ wordBreak: "break-all" }}
            title={topoNode.name || topoNode.node_id}
          >
            {topoNode.name || topoNode.node_id}
          </div>

          {/* IP */}
          {topoNode.ip_address && (
            <div className="font-mono text-[10px] text-slate-400">{topoNode.ip_address}</div>
          )}

          {/* Vendor · Model */}
          {(topoNode.vendor || topoNode.model) && (
            <div className="text-[10px] text-slate-500 truncate">
              {[topoNode.vendor, topoNode.model].filter(Boolean).join(" · ")}
            </div>
          )}

          {/* Focus badge */}
          {isFocus && (
            <div className="text-[9px] font-bold uppercase tracking-widest text-indigo-400 mt-0.5">
              ← Focus device
            </div>
          )}
        </div>
      </div>
      <Handle type="source" position={Position.Bottom} style={{ background: "#334155", border: "1px solid #475569" }} />
    </>
  );
}

const CONTEXT_NODE_TYPES = { contextNode: ContextNodeCard };

// ---------------------------------------------------------------------------
// Layout builder
// ---------------------------------------------------------------------------
const NODE_W = 220;
const NODE_H = 110; // approximate rendered height
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
      style: { stroke: "#6366f1", strokeWidth: 1.5, strokeDasharray: "4 2" },
      markerEnd: { type: MarkerType.ArrowClosed, color: "#6366f1", width: 12, height: 12 },
      label: "upstream",
      labelStyle: { fill: "#6366f1", fontSize: 9, fontWeight: 600 },
      labelBgStyle: { fill: "#0f172a", fillOpacity: 0.8 },
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
      style: { stroke: "#475569", strokeWidth: 1.5 },
      markerEnd: { type: MarkerType.ArrowClosed, color: "#475569", width: 12, height: 12 },
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
      <div className="flex h-[500px] items-center justify-center rounded-xl border border-slate-800/60 bg-slate-900/30">
        <div className="h-10 w-10 animate-pulse rounded-full bg-slate-800" />
      </div>
    );
  }

  if (!detail || nodes.length === 0) {
    return (
      <div className="flex h-[500px] items-center justify-center rounded-xl border border-dashed border-slate-800/60">
        <p className="text-sm text-slate-500">No topology connections found for this device</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {/* Layer legend */}
      <div className="flex items-center gap-4 text-[10px] text-slate-500">
        {detail.parents.length > 0 && (
          <span className="flex items-center gap-1">
            <span className="inline-block h-px w-4 border-t border-dashed border-indigo-500" />
            Upstream ({detail.parents.length})
          </span>
        )}
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-sm bg-indigo-500/40 ring-1 ring-indigo-500" />
          Focus device
        </span>
        {detail.children.length > 0 && (
          <span className="flex items-center gap-1">
            <span className="inline-block h-px w-4 border-t border-slate-500" />
            Downstream ({detail.children.length})
          </span>
        )}
      </div>

      <div className="h-[500px] rounded-xl border border-slate-800/60 overflow-hidden">
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
          className="bg-slate-950"
          defaultEdgeOptions={{ type: "smoothstep" }}
        >
          <Background color="rgba(51,65,85,0.15)" gap={20} size={1} />
          <Controls className="!bg-slate-900 !border-slate-800" showInteractive={false} />
        </ReactFlow>
      </div>
    </div>
  );
}


