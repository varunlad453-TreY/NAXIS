"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  Node,
  Edge,
  ReactFlowInstance,
  Panel,
  ConnectionLineType,
} from "reactflow";
import "reactflow/dist/style.css";

import type { TopologyGraphResponse, TopologyNode } from "@/types/topology";
import { NODE_TYPE_META } from "@/types/topology";
import { api } from "@/lib/api";
import { TopologySidePanel, type PanelMode } from "./topology-side-panel";
import { topologyNodeTypes } from "./topology-node-types";
import { topologyEdgeTypes } from "./topology-edge-types";
import { TopologyToolbar } from "./topology-toolbar";
import { TopologyLegend } from "./topology-legend";
import {
  normalizeTopology,
  tracePath,
  getDownstreamImpact,
} from "./topology-graph-model";
import {
  buildHierarchicalLayout,
  buildFlatLayout,
  buildBackboneLayout,
  buildSiteGroupedLayout,
} from "./topology-layout-engine";

interface TopologyGraphV2Props {
  data: TopologyGraphResponse;
  isLoading?: boolean;
  error?: Error | null;
  highlightedNodeIds?: string[];
  incidentId?: string | null;
  isBackbone?: boolean;
  activeSiteId?: string;
  siteName?: string;
  onSiteSelect?: (siteId: string) => void;
  onBackToBackbone?: () => void;
}

function TopologySkeleton() {
  return (
    <div className="flex h-[640px] items-center justify-center border border-border/40 bg-surface/30">
      <div className="space-y-4 text-center">
        <div className="mx-auto h-12 w-12 animate-pulse rounded-full bg-surface-elevated" />
        <div className="mx-auto h-4 w-48 animate-pulse bg-surface-elevated" />
        <div className="mx-auto h-3 w-32 animate-pulse bg-surface-elevated" />
      </div>
    </div>
  );
}

function TopologyEmptyState({ isBackbone }: { isBackbone?: boolean }) {
  return (
    <div className="flex h-[640px] items-center justify-center border border-dashed border-border/40">
      <div className="max-w-md space-y-4 text-center">
        <h3 className="text-lg font-semibold text-foreground">
          {isBackbone ? "No sites discovered" : "No topology data available"}
        </h3>
        <p className="text-sm text-foreground-muted">
          {isBackbone
            ? "Site topology will appear once the network discovery sync completes."
            : "Topology nodes and edges will appear here once the worker starts collecting network topology from Mist, VeloCloud, or SNMP pollers."}
        </p>
      </div>
    </div>
  );
}

function TopologyErrorState({ error }: { error: Error }) {
  return (
    <div className="flex h-[640px] items-center justify-center border border-critical/20 bg-critical/5">
      <div className="max-w-md space-y-3 text-center">
        <h3 className="font-semibold text-foreground">Failed to load topology</h3>
        <p className="text-sm text-foreground-muted">{error.message}</p>
      </div>
    </div>
  );
}

export function TopologyGraphV2({
  data,
  isLoading,
  error,
  highlightedNodeIds,
  incidentId,
  isBackbone,
  activeSiteId,
  siteName,
  onSiteSelect,
  onBackToBackbone,
}: TopologyGraphV2Props) {
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const [rfInstance, setRfInstance] = useState<ReactFlowInstance | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [panelMode, setPanelMode] = useState<PanelMode>(incidentId ? "incident" : null);
  const [layoutMode, setLayoutMode] = useState<"hierarchical" | "flat">("hierarchical");
  const [activeFilters, setActiveFilters] = useState<Set<string>>(new Set(Object.keys(NODE_TYPE_META)));
  const [searchQuery, setSearchQuery] = useState("");
  const [legendVisible, setLegendVisible] = useState(true);
  const [pathTraceMode, setPathTraceMode] = useState(false);
  const [pathTraceStart, setPathTraceStart] = useState<string | null>(null);
  const [pathTraceEnd, setPathTraceEnd] = useState<string | null>(null);
  const firstFitDone = useRef(false);

  // Incident detail query
  const { data: incidentDetail, isLoading: incidentLoading } = useQuery({
    queryKey: ["incident", incidentId],
    queryFn: () => api.getIncident(incidentId!),
    enabled: panelMode === "incident" && !!incidentId,
  });

  // Blast radius query for graph highlighting
  const { data: blastRadius } = useQuery({
    queryKey: ["blast-radius", incidentId],
    queryFn: () => api.getBlastRadius(incidentId!),
    enabled: !!incidentId,
    staleTime: 30000,
  });

  // Node detail query
  const { data: nodeDetail, isLoading: nodeLoading } = useQuery({
    queryKey: ["topology-node", selectedNodeId],
    queryFn: () => api.getTopologyNode(selectedNodeId!),
    enabled: panelMode === "node" && !!selectedNodeId,
  });

  // Filter nodes by type
  const filteredNodes = useMemo(() => {
    if (activeFilters.size === 0) return [];
    return data.nodes.filter((n) => activeFilters.has(n.node_type));
  }, [data.nodes, activeFilters]);

  // Compute search results
  const searchResults = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (q.length < 2) return [];
    return filteredNodes
      .filter(
        (n) =>
          n.name?.toLowerCase().includes(q) ||
          n.node_id?.toLowerCase().includes(q) ||
          n.ip_address?.toLowerCase().includes(q)
      )
      .slice(0, 20)
      .map((n) => ({ node_id: n.node_id, name: n.name || n.node_id, node_type: n.node_type }));
  }, [searchQuery, filteredNodes]);

  // Compute graph nodes and edges using the layout engine
  const { graphNodes, graphEdges } = useMemo(() => {
    if (filteredNodes.length === 0) return { graphNodes: [], graphEdges: [] };

    const highlightSet = new Set(highlightedNodeIds ?? []);

    if (isBackbone) {
      // Backbone: sites only with inter-site edges
      const siteNodes = filteredNodes.filter((n) => n.node_type === "site");
      const interSiteEdges = data.edges.filter((e) => {
        const src = data.nodes.find((n) => n.node_id === e.src_id);
        const dst = data.nodes.find((n) => n.node_id === e.dst_id);
        return src && dst && src.site_id && dst.site_id && src.site_id !== dst.site_id;
      });
      const result = buildBackboneLayout(siteNodes, interSiteEdges, highlightSet);
      return { graphNodes: result.nodes, graphEdges: result.edges };
    }

    // Site internal view
    if (activeSiteId) {
      // Use site grouped layout when multiple sites present, else hierarchical
      const hasMultipleSites =
        new Set(filteredNodes.filter((n) => n.node_type !== "site").map((n) => n.site_id)).size > 1;

      if (hasMultipleSites) {
        const result = buildSiteGroupedLayout(filteredNodes, data.edges, {
          highlightSet,
          activeTypeFilters: activeFilters,
        });
        return { graphNodes: result.nodes, graphEdges: result.edges };
      }
    }

    // Standard hierarchical or flat layout
    if (layoutMode === "hierarchical") {
      const result = buildHierarchicalLayout(filteredNodes, data.edges, { highlightSet });
      return { graphNodes: result.nodes, graphEdges: result.edges };
    } else {
      const result = buildFlatLayout(filteredNodes, data.edges, highlightSet);
      return { graphNodes: result.nodes, graphEdges: result.edges };
    }
  }, [filteredNodes, data.edges, highlightedNodeIds, isBackbone, layoutMode, activeFilters, activeSiteId]);

  // Apply blast radius root cause / symptom highlighting
  const blastRadiusNodes = useMemo(() => {
    if (!blastRadius) return graphNodes;
    const rootSet = new Set(blastRadius.root_cause_node_ids);
    const symptomSet = new Set(blastRadius.symptom_node_ids);
    return graphNodes.map((n) => ({
      ...n,
      data: {
        ...n.data,
        isRootCause: rootSet.has(n.id),
        isSymptom: symptomSet.has(n.id),
      },
    }));
  }, [graphNodes, blastRadius]);

  // Path trace highlighting
  const { finalNodes, finalEdges } = useMemo(() => {
    if (!pathTraceMode || !pathTraceStart || !pathTraceEnd) {
      return { finalNodes: blastRadiusNodes, finalEdges: graphEdges };
    }

    const normalized = normalizeTopology(
      filteredNodes,
      data.edges,
      { highlightedNodeIds: new Set(highlightedNodeIds ?? []) }
    );

    const pathResult = tracePath(normalized, pathTraceStart, pathTraceEnd);
    if (!pathResult) {
      // Show impact downstream from start if no path to end
      const impact = getDownstreamImpact(normalized, pathTraceStart, 5);
      const nodeIds = impact.nodeIds;
      const edgeIds = impact.edgeIds;

      const nodes = blastRadiusNodes.map((n) => ({
        ...n,
        data: {
          ...n.data,
          isHighlighted: nodeIds.has(n.id),
          isDimmed: !nodeIds.has(n.id),
        },
      }));
      const edges = graphEdges.map((e) => ({
        ...e,
        data: {
          ...e.data,
          isPathTrace: edgeIds.has(e.id),
          isHighlighted: edgeIds.has(e.id),
          isDimmed: !edgeIds.has(e.id),
        },
      }));
      return { finalNodes: nodes, finalEdges: edges };
    }

    const { nodeIds, edgeIds } = pathResult;
    const nodes = blastRadiusNodes.map((n) => ({
      ...n,
      data: {
        ...n.data,
        isHighlighted: nodeIds.has(n.id),
        isDimmed: !nodeIds.has(n.id),
      },
    }));
    const edges = graphEdges.map((e) => ({
      ...e,
      data: {
        ...e.data,
        isPathTrace: edgeIds.has(e.id),
        isHighlighted: edgeIds.has(e.id),
        isDimmed: !edgeIds.has(e.id),
      },
    }));
    return { finalNodes: nodes, finalEdges: edges };
  }, [blastRadiusNodes, graphEdges, pathTraceMode, pathTraceStart, pathTraceEnd, filteredNodes, data.edges, highlightedNodeIds]);

  // Fit view on data change
  useEffect(() => {
    if (rfInstance && finalNodes.length > 0 && !firstFitDone.current) {
      firstFitDone.current = true;
      const timer = setTimeout(() => {
        rfInstance.fitView({ padding: 0.15, duration: 300 });
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [rfInstance, finalNodes.length]);

  // Re-fit when highlighted nodes change
  useEffect(() => {
    if (rfInstance && highlightedNodeIds && highlightedNodeIds.length > 0) {
      const timer = setTimeout(() => {
        rfInstance.fitView({
          padding: 0.2,
          nodes: highlightedNodeIds.map((id) => ({ id })),
          duration: 300,
        });
      }, 150);
      return () => clearTimeout(timer);
    }
  }, [rfInstance, highlightedNodeIds]);

  const handleNodeClick = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      if (node.type === "siteGroup" && onSiteSelect && node.data?.topoNode?.site_id) {
        onSiteSelect(node.data.topoNode.site_id);
        return;
      }

      if (pathTraceMode) {
        if (!pathTraceStart) {
          setPathTraceStart(node.id);
        } else if (!pathTraceEnd && node.id !== pathTraceStart) {
          setPathTraceEnd(node.id);
        } else {
          setPathTraceStart(node.id);
          setPathTraceEnd(null);
        }
        return;
      }

      setSelectedNodeId((prev) => (prev === node.id ? null : node.id));
      setPanelMode((prev) => {
        if (prev === "node" && selectedNodeId === node.id) return incidentId ? "incident" : null;
        return "node";
      });
    },
    [onSiteSelect, pathTraceMode, pathTraceStart, pathTraceEnd, selectedNodeId, incidentId]
  );

  const handlePanelClose = useCallback(() => {
    setPanelMode(incidentId ? "incident" : null);
    setSelectedNodeId(null);
  }, [incidentId]);

  const handleZoomIn = useCallback(() => {
    rfInstance?.zoomIn({ duration: 200 });
  }, [rfInstance]);

  const handleZoomOut = useCallback(() => {
    rfInstance?.zoomOut({ duration: 200 });
  }, [rfInstance]);

  const handleFitView = useCallback(() => {
    rfInstance?.fitView({ padding: 0.15, duration: 300 });
  }, [rfInstance]);

  const handleReset = useCallback(() => {
    setPathTraceMode(false);
    setPathTraceStart(null);
    setPathTraceEnd(null);
    setSelectedNodeId(null);
    setPanelMode(incidentId ? "incident" : null);
    handleFitView();
  }, [incidentId, handleFitView]);

  const handleRefresh = useCallback(() => {
    window.location.reload();
  }, []);

  const handleToggleFilter = useCallback((type: string) => {
    setActiveFilters((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  }, []);

  const handlePathTrace = useCallback(() => {
    if (pathTraceMode) {
      setPathTraceMode(false);
      setPathTraceStart(null);
      setPathTraceEnd(null);
    } else {
      setPathTraceMode(true);
      setPathTraceStart(null);
      setPathTraceEnd(null);
    }
  }, [pathTraceMode]);

  const handleSearchSelect = useCallback(
    (nodeId: string) => {
      setSearchQuery("");
      setSelectedNodeId(nodeId);
      setPanelMode("node");
      if (rfInstance) {
        rfInstance.fitView({ padding: 0.2, nodes: [{ id: nodeId }], duration: 300 });
      }
    },
    [rfInstance]
  );

  if (isLoading) return <TopologySkeleton />;
  if (error) return <TopologyErrorState error={error} />;
  if (!data.nodes.length) return <TopologyEmptyState isBackbone={isBackbone} />;

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <TopologyToolbar
        totalNodes={filteredNodes.length}
        totalEdges={data.edges.length}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        searchResults={searchResults}
        onSelectSearchResult={handleSearchSelect}
        layoutMode={layoutMode}
        onLayoutModeChange={setLayoutMode}
        activeFilters={activeFilters}
        onToggleFilter={handleToggleFilter}
        onFitView={handleFitView}
        onZoomIn={handleZoomIn}
        onZoomOut={handleZoomOut}
        onReset={handleReset}
        onRefresh={handleRefresh}
        onPathTrace={handlePathTrace}
        pathTraceActive={pathTraceMode}
        onToggleLegend={() => setLegendVisible((v) => !v)}
        legendVisible={legendVisible}
        isBackbone={!!isBackbone}
        onBackToBackbone={onBackToBackbone}
        siteName={siteName}
      />

      {/* Path trace instructions */}
      {pathTraceMode && (
        <div className="flex items-center gap-3 rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-xs text-primary">
          <span className="font-medium">Path Trace:</span>
          {!pathTraceStart ? (
            <span>Click a source device</span>
          ) : !pathTraceEnd ? (
            <span>Click a destination device</span>
          ) : (
            <span>Tracing path… Click any device to reset</span>
          )}
          <button
            onClick={() => { setPathTraceMode(false); setPathTraceStart(null); setPathTraceEnd(null); }}
            className="ml-auto rounded p-1 hover:bg-primary/10"
          >
            <span className="text-[10px] font-medium">Cancel</span>
          </button>
        </div>
      )}

      {/* Graph canvas */}
      <div ref={reactFlowWrapper} className="relative h-[640px] w-full">
        <ReactFlow
          nodes={finalNodes}
          edges={finalEdges}
          nodeTypes={topologyNodeTypes}
          edgeTypes={topologyEdgeTypes}
          onInit={setRfInstance}
          onNodeClick={handleNodeClick}
          fitView={false}
          onlyRenderVisibleElements
          attributionPosition="bottom-left"
          connectionLineType={ConnectionLineType.SmoothStep}
          minZoom={0.05}
          maxZoom={4}
          deleteKeyCode={null}
          multiSelectionKeyCode={["Shift", "Control"]}
          className="border border-border/40 bg-surface/20 rounded-lg"
          defaultEdgeOptions={{
            type: "topologyEdge",
            style: { stroke: "#9ca3af", strokeWidth: 1.5 },
          }}
        >
          <Background color="hsl(var(--border) / 0.25)" gap={24} size={1} />
          <Controls
            className="!rounded-lg !border-border/60 !bg-surface !shadow-surface"
            showInteractive={false}
          />
          <MiniMap
            className="!rounded-lg !border-border/60 !bg-surface"
            nodeColor={(node) => {
              const color = (node.data as any)?.deviceColor ?? "#6b7280";
              const health = (node.data as any)?.healthStatus;
              if (health === "critical") return "#ef4444";
              if (health === "warning") return "#eab308";
              return color;
            }}
            maskColor="rgba(0,0,0,0.05)"
            style={{ width: 160, height: 100 }}
          />
          <Panel position="bottom-left" className="!mb-14 !ml-3 z-30 pointer-events-auto">
            <TopologyLegend visible={legendVisible} onClose={() => setLegendVisible(false)} />
          </Panel>

        </ReactFlow>

        {/* Side panel */}
        <TopologySidePanel
          mode={panelMode}
          incidentId={incidentId}
          incidentDetail={incidentDetail ?? null}
          nodeDetail={nodeDetail ?? null}
          onClose={handlePanelClose}
          incidentLoading={incidentLoading}
          nodeLoading={nodeLoading}
        />
      </div>
    </div>
  );
}
