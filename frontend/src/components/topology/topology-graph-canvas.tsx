"use client";

import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  type Node,
  type Edge,
  type ReactFlowInstance,
  Panel,
  ConnectionLineType,
} from "reactflow";
import "reactflow/dist/style.css";

import { topologyNodeTypes } from "./topology-node-types";
import { topologyEdgeTypes } from "./topology-edge-types";
import { TopologyLegend } from "./topology-legend";

interface TopologyGraphCanvasProps {
  nodes: Node[];
  edges: Edge[];
  onNodeClick: (event: React.MouseEvent, node: Node) => void;
  onInit: (instance: ReactFlowInstance) => void;
  activeSiteId?: string;
  legendVisible: boolean;
  onCloseLegend: () => void;
  /** Absolutely-positioned overlays (side panels, drawers). */
  children?: React.ReactNode;
}

export function TopologyGraphCanvas({
  nodes,
  edges,
  onNodeClick,
  onInit,
  activeSiteId,
  legendVisible,
  onCloseLegend,
  children,
}: TopologyGraphCanvasProps) {
  return (
    <div className="relative h-[640px] w-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={topologyNodeTypes}
        edgeTypes={topologyEdgeTypes}
        onInit={onInit}
        onNodeClick={onNodeClick}
        fitView
        fitViewOptions={{ padding: 0.15 }}
        onlyRenderVisibleElements
        attributionPosition="bottom-left"
        connectionLineType={ConnectionLineType.SmoothStep}
        minZoom={activeSiteId ? 0.25 : 0.05}
        maxZoom={4}
        deleteKeyCode={null}
        multiSelectionKeyCode={["Shift", "Control"]}
        zoomOnScroll={false}
        panOnScroll={false}
        zoomOnPinch={true}
        preventScrolling={false}
        className="bg-slate-950"
        defaultEdgeOptions={{
          type: "topologyEdge",
          style: { stroke: "#9ca3af", strokeWidth: 1.5 },
        }}
      >
        <Background color="rgba(51,65,85,0.2)" gap={24} size={1} />
        <Controls className="!bg-slate-900 !border-slate-800" showInteractive={false} />
        <MiniMap
          className="!bg-slate-900 !border-slate-800"
          nodeColor={(node) => {
            const color = (node.data as any)?.deviceColor ?? "#6b7280";
            const health = (node.data as any)?.healthStatus;
            if (health === "critical") return "#ef4444";
            if (health === "warning") return "#eab308";
            return color;
          }}
          maskColor="rgba(0,0,0,0.05)"
          style={{ width: 140, height: 90 }}
        />
        <Panel position="bottom-left" className="!mb-14 !ml-3 z-30 pointer-events-auto">
          <TopologyLegend visible={legendVisible} onClose={onCloseLegend} />
        </Panel>
      </ReactFlow>
      {children}
    </div>
  );
}
