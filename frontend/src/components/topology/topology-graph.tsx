"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  Node,
  NodeTypes,
  ConnectionLineType,
  useNodesState,
  useEdgesState,
  ReactFlowInstance,
  Handle,
  Position,
  NodeProps,
} from "reactflow";
import "reactflow/dist/style.css";

import type { TopologyGraphResponse } from "@/types/topology";
import { NODE_TYPE_META, HEALTH_STATUS_META } from "@/types/topology";
import { NODE_WIDTH, NODE_HEIGHT, buildLayout } from "./layout";

interface TopologyGraphProps {
  data: TopologyGraphResponse;
  isLoading?: boolean;
  error?: Error | null;
  highlightedNodeIds?: string[];
  onNodeClick?: (nodeId: string) => void;
}

function deviceTypeMeta(nodeType: string) {
  return NODE_TYPE_META[nodeType] ?? {
    label: nodeType,
    category: "leaf" as const,
    color: "#6b7280",
  };
}

function healthMeta(status: string) {
  return HEALTH_STATUS_META[status] ?? HEALTH_STATUS_META.unknown;
}

function TopologyNodeComponent({ data }: NodeProps) {
  const meta = deviceTypeMeta(data.node_type);
  const hMeta = healthMeta(data.health_status as string);
  const isHighlighted = data.highlighted === true;
  const isRootCause = data.rootCause === true;

  return (
    <div
      className={[
        "group cursor-pointer rounded-lg border-2 bg-surface px-4 py-3 shadow-surface transition-all hover:shadow-surface-lg",
        isRootCause ? "animate-pulse" : "",
      ].join(" ")}
      style={{
        borderColor: isHighlighted ? hMeta.color : meta.color,
        width: NODE_WIDTH,
        boxShadow: isHighlighted
          ? `0 0 0 2px ${hMeta.color}, 0 0 12px ${hMeta.color}40`
          : undefined,
      }}
    >
      <Handle type="target" position={Position.Top} className="!border-border !bg-border" />
      <div className="flex items-center gap-3">
        <div
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-xs font-bold text-white"
          style={{ backgroundColor: meta.color }}
        >
          {meta.label.slice(0, 2).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-semibold text-foreground">
              {data.label as string}
            </span>
            {/* Health status dot */}
            <span
              className="relative inline-block h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: hMeta.color }}
              title={hMeta.label}
            >
              <span
                className="absolute inset-0 animate-ping rounded-full opacity-40"
                style={{ backgroundColor: hMeta.color }}
              />
            </span>
          </div>
          <div className="flex items-center gap-2 text-[10px] text-foreground-subtle">
            <span>{meta.label}</span>
            {data.vendor && (
              <>
                <span className="text-border">·</span>
                <span>{data.vendor as string}</span>
              </>
            )}
            <span className="text-border">·</span>
            <span style={{ color: hMeta.color }}>{hMeta.label}</span>
          </div>
        </div>
      </div>
      <Handle type="source" position={Position.Bottom} className="!border-border !bg-border" />
    </div>
  );
}

const nodeTypes: NodeTypes = { topologyNode: TopologyNodeComponent };

function TopologySkeleton() {
  return (
    <div className="flex h-[600px] items-center justify-center rounded-xl border border-border/40 bg-surface/30">
      <div className="space-y-4 text-center">
        <div className="mx-auto h-12 w-12 animate-pulse rounded-full bg-surface-elevated" />
        <div className="mx-auto h-4 w-48 animate-pulse rounded bg-surface-elevated" />
        <div className="mx-auto h-3 w-32 animate-pulse rounded bg-surface-elevated" />
      </div>
    </div>
  );
}

function TopologyEmptyState() {
  return (
    <div className="flex h-[600px] items-center justify-center rounded-xl border-2 border-dashed border-border/40">
      <div className="max-w-md space-y-4 text-center">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <svg className="h-8 w-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4"
            />
          </svg>
        </div>
        <h3 className="text-lg font-semibold text-foreground">No topology data</h3>
        <p className="text-sm text-foreground-muted">
          Topology nodes and edges will appear here once the worker starts
          collecting network topology from Mist, VeloCloud, or SNMP pollers.
        </p>
      </div>
    </div>
  );
}

export function TopologyGraph({
  data,
  isLoading,
  error,
  highlightedNodeIds,
  onNodeClick,
}: TopologyGraphProps) {
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const [reactFlowInstance, setReactFlowInstance] = useState<ReactFlowInstance | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [fitViewKey, setFitViewKey] = useState(0);

  const highlightSet = useMemo(
    () => new Set(highlightedNodeIds ?? []),
    [highlightedNodeIds]
  );

  const { nodes: initialNodes, edges: initialEdges } = useMemo(
    () => buildLayout(data.nodes, data.edges, highlightSet),
    [data.nodes, data.edges, highlightSet]
  );

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  const topologySignature = useMemo(() => {
    const nodeKey = initialNodes.map((n) => n.id).sort().join(",");
    const edgeKey = initialEdges.map((e) => `${e.source}->${e.target}`).sort().join(",");
    return `${nodeKey}|${edgeKey}`;
  }, [initialNodes, initialEdges]);

  useEffect(() => {
    setNodes((prev) => {
      const prevPositions = new Map(prev.map((n) => [n.id, n.position]));
      return initialNodes.map((n) => {
        const kept = prevPositions.get(n.id);
        return kept ? { ...n, position: kept } : n;
      });
    });
    setEdges(initialEdges);
  }, [initialNodes, initialEdges, setNodes, setEdges]);

  useEffect(() => {
    setFitViewKey((k) => k + 1);
  }, [topologySignature]);

  useEffect(() => {
    if (reactFlowInstance && highlightedNodeIds && highlightedNodeIds.length > 0) {
      const timer = setTimeout(() => {
        reactFlowInstance.fitView({
          padding: 0.3,
          nodes: highlightedNodeIds.map((id) => ({ id })),
          duration: 300,
        });
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [reactFlowInstance, highlightedNodeIds, fitViewKey]);

  const onNodeClickHandler = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      const id = node.id;
      setSelectedNodeId((prev) => (prev === id ? null : id));
      onNodeClick?.(id);
    },
    [onNodeClick]
  );

  const onFitView = useCallback(() => {
    reactFlowInstance?.fitView({ padding: 0.2 });
  }, [reactFlowInstance]);

  if (isLoading) return <TopologySkeleton />;
  if (error) {
    return (
      <div className="flex h-[600px] items-center justify-center rounded-xl border border-critical/20 bg-critical/5">
        <div className="max-w-md space-y-3 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-critical/10 text-critical">
            <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z"
              />
            </svg>
          </div>
          <h3 className="font-semibold text-foreground">Failed to load topology</h3>
          <p className="text-sm text-foreground-muted">{error.message}</p>
        </div>
      </div>
    );
  }
  if (!data.nodes.length) return <TopologyEmptyState />;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4 text-sm text-foreground-muted">
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-primary" />
            {data.total_nodes} nodes
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-0.5 w-4 rounded bg-foreground-subtle" />
            {data.total_edges} links
          </span>
        </div>
        <button
          onClick={onFitView}
          className="inline-flex items-center gap-1.5 rounded-md border border-border/60 px-3 py-1.5 text-xs font-medium text-foreground-muted transition-colors hover:bg-surface hover:text-foreground"
        >
          <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4"
            />
          </svg>
          Fit view
        </button>
      </div>
      <div ref={reactFlowWrapper} className="h-[600px] w-full">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          nodeTypes={nodeTypes}
          onInit={setReactFlowInstance}
          onNodeClick={onNodeClickHandler}
          fitView={highlightedNodeIds && highlightedNodeIds.length > 0 ? false : undefined}
          attributionPosition="bottom-left"
          connectionLineType={ConnectionLineType.SmoothStep}
          minZoom={0.1}
          maxZoom={4}
          deleteKeyCode={null}
          className="rounded-xl border border-border/40 bg-surface/20"
        >
          <Background color="hsl(var(--border) / 0.3)" gap={20} size={1} />
          <Controls
            className="!rounded-lg !border-border/60 !bg-surface !shadow-surface"
            showInteractive={false}
          />
          <MiniMap
            nodeStrokeColor="hsl(var(--border))"
            nodeColor={(node) => {
              const meta = deviceTypeMeta((node.data as Record<string, unknown>)?.node_type as string);
              return meta.color;
            }}
            maskColor="hsl(var(--background) / 0.7)"
            className="!rounded-lg !border-border/60"
            pannable
            zoomable
          />
        </ReactFlow>
      </div>
    </div>
  );
}
