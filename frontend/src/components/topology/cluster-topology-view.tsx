"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactFlow, { Background, Controls, type Node, type Edge } from "reactflow";
import "reactflow/dist/style.css";

import type { TopologyNode, TopologyEdge, DeviceCategoryCluster } from "@/types/topology";
import { CATEGORY_META } from "@/types/topology";
import { buildReadableHierarchicalLayout } from "./topology-layout-engine";
import { topologyNodeTypes } from "./topology-node-types";
import { topologyEdgeTypes } from "./topology-edge-types";
import { X, List } from "lucide-react";
import { DeviceBrowser } from "./device-browser";

interface ClusterTopologyViewProps {
  allNodes: TopologyNode[];
  allEdges: TopologyEdge[];
  cluster: DeviceCategoryCluster;
  onSelect: (nodeId: string, nodeName: string) => void;
  onClose: () => void;
  initialHealthFilter?: import("@/types/topology").HealthStatus;
}

export function ClusterTopologyView({
  allNodes,
  allEdges,
  cluster,
  onSelect,
  onClose,
  initialHealthFilter,
}: ClusterTopologyViewProps) {
  const rfRef = useRef<any>(null);
  const [showList, setShowList] = useState(false);
  const firstFit = useRef(false);

  // Filter nodes to this cluster
  const categoryNodes = useMemo(() => {
    const ids = new Set(cluster.nodeIds);
    return allNodes.filter((n) => ids.has(n.node_id));
  }, [allNodes, cluster.nodeIds]);

  // Filter edges to only those between cluster nodes
  const categoryEdges = useMemo(() => {
    const ids = new Set(cluster.nodeIds);
    return allEdges.filter((e) => ids.has(e.src_id) && ids.has(e.dst_id));
  }, [allEdges, cluster.nodeIds]);

  const { nodes, edges } = useMemo(() => {
    if (categoryNodes.length === 0) return { nodes: [] as Node[], edges: [] as Edge[] };
    return buildReadableHierarchicalLayout(categoryNodes, categoryEdges, {
      rankdir: "TB",
      highlightSet: new Set(),
      collapsedRanks: new Set(),
    });
  }, [categoryNodes, categoryEdges]);

  useEffect(() => {
    if (rfRef.current && !firstFit.current && nodes.length > 0) {
      firstFit.current = true;
      setTimeout(() => rfRef.current.fitView({ padding: 0.2, duration: 300 }), 100);
    }
  }, [nodes.length]);

  const handleNodeClick = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      const name = (node.data as any)?.label || node.id;
      onSelect(node.id, name);
    },
    [onSelect]
  );

  const catMeta = CATEGORY_META[cluster.category];

  return (
    <div className="w-96 shrink-0 rounded-xl border border-border/40 bg-surface shadow-surface-lg flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border/30 px-4 py-3">
        <div className="flex items-center gap-2">
          <div
            className="flex h-7 w-7 items-center justify-center rounded-md text-xs font-bold text-white"
            style={{ backgroundColor: catMeta.color }}
          >
            {cluster.count}
          </div>
          <div>
            <div className="text-sm font-semibold text-foreground">{catMeta.label}</div>
            <div className="text-[10px] text-foreground-subtle uppercase tracking-wider">
              {cluster.count} device{cluster.count !== 1 ? "s" : ""}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setShowList((v) => !v)}
            className="rounded p-1 text-foreground-muted transition-colors hover:bg-surface-hover hover:text-foreground"
            title={showList ? "Show graph" : "Show list"}
          >
            <List className="h-4 w-4" />
          </button>
          <button
            onClick={onClose}
            className="rounded p-1 text-foreground-muted transition-colors hover:bg-surface-hover hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Content: graph or list */}
      <div className="flex-1 overflow-hidden">
        {showList ? (
          <div className="h-[400px] overflow-y-auto">
            <DeviceBrowser
              nodes={categoryNodes}
              cluster={cluster}
              onSelect={onSelect}
              onClose={onClose}
              initialHealthFilter={initialHealthFilter}
            />
          </div>
        ) : (
          <div className="h-[400px]">
            {nodes.length > 0 ? (
              <ReactFlow
                nodes={nodes}
                edges={edges}
                nodeTypes={topologyNodeTypes}
                edgeTypes={topologyEdgeTypes}
                onInit={(instance) => { rfRef.current = instance; }}
                onNodeClick={handleNodeClick}
                fitView
                fitViewOptions={{ padding: 0.2 }}
                onlyRenderVisibleElements
                attributionPosition="bottom-left"
                minZoom={0.3}
                maxZoom={3}
                className="bg-surface/20"
              >
                <Background color="hsl(var(--border) / 0.25)" gap={20} size={1} />
                <Controls className="!rounded-lg !border-border/60 !bg-surface !shadow-surface" showInteractive={false} />
              </ReactFlow>
            ) : (
              <div className="flex h-full items-center justify-center text-xs text-foreground-muted">
                No devices to visualize
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
