"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { type Node, type ReactFlowInstance } from "reactflow";
import { useRouter } from "next/navigation";
import { Zap } from "lucide-react";

import type { TopologyGraphResponse, TopologyNode } from "@/types/topology";
import { NODE_TYPE_META, AGGREGATED_VIEW_THRESHOLD } from "@/types/topology";
import { api } from "@/lib/api";
import { TopologyToolbar } from "./topology-toolbar";
import { TopologySidePanel, type PanelMode } from "./topology-side-panel";
import { TopologyGraphCanvas } from "./topology-graph-canvas";
import { AggregatedView } from "./aggregated-view";
import { SiteContextBanner } from "./site-context-banner";
import { HostMapView } from "./host-map-view";
import { WorstOffendersStrip } from "./worst-offenders-strip";
import {
  computeAlertScope,
  collapseLeafSiblings,
  remapEdgesForCollapsedGroups,
  isAlerting,
} from "@/lib/large-site-utils";
import {
  normalizeTopology,
  tracePath,
  getDownstreamImpact,
  getNodeRank,
} from "./topology-graph-model";
import {
  buildHierarchicalLayout,
  buildReadableHierarchicalLayout,
  buildSiteGroupedLayout,
} from "./topology-layout-engine";

export type SiteViewParam = "auto" | "impact" | "clusters" | "graph";
export type LayoutParam = "readable" | "readable-lr" | "hierarchical" | "flat";
export type ScopeParam = "alerting" | "all";

export interface TopologySiteShellProps {
  siteId: string;
  data: TopologyGraphResponse;
  isLoading: boolean;
  error: Error | null;
  view: SiteViewParam;
  scope: ScopeParam;
  layout: LayoutParam;
  highlightedNodeIds?: string[];
  incidentId?: string | null;
  siteName?: string;
  onViewChange: (v: SiteViewParam) => void;
  onScopeChange: (s: ScopeParam) => void;
  onLayoutChange: (l: LayoutParam) => void;
  onBackToBackbone: () => void;
}

function TopologySkeleton() {
  return (
    <div className="flex h-[640px] items-center justify-center border border-slate-800/60 bg-slate-900/30">
      <div className="space-y-4 text-center">
        <div className="mx-auto h-12 w-12 animate-pulse rounded-full bg-slate-800" />
        <div className="mx-auto h-4 w-48 animate-pulse bg-slate-800" />
        <div className="mx-auto h-3 w-32 animate-pulse bg-slate-800" />
      </div>
    </div>
  );
}

function TopologyEmptyState() {
  return (
    <div className="flex h-[640px] items-center justify-center border border-dashed border-slate-800/60">
      <div className="max-w-md space-y-4 text-center">
        <h3 className="text-lg font-bold text-white">No topology data available</h3>
        <p className="text-sm text-slate-500">
          Topology nodes and edges will appear here once the worker starts collecting network
          topology from Mist, VeloCloud, or SNMP pollers.
        </p>
      </div>
    </div>
  );
}

function TopologyErrorState({ error }: { error: Error }) {
  return (
    <div className="flex h-[640px] items-center justify-center border border-rose-500/20 bg-rose-500/5">
      <div className="max-w-md space-y-3 text-center">
        <h3 className="font-bold text-white">Failed to load topology</h3>
        <p className="text-sm text-slate-500">{error.message}</p>
      </div>
    </div>
  );
}

/** Maps URL param value to internal view mode. */
function paramToViewMode(view: SiteViewParam): "auto" | "hostmap" | "aggregated" | "readable" {
  if (view === "impact") return "hostmap";
  if (view === "clusters") return "aggregated";
  if (view === "graph") return "readable";
  return "auto";
}

/** Maps internal view mode back to URL param. */
function viewModeToParam(mode: "auto" | "hostmap" | "aggregated" | "readable"): SiteViewParam {
  if (mode === "hostmap") return "impact";
  if (mode === "aggregated") return "clusters";
  if (mode === "readable") return "graph";
  return "auto";
}

export function TopologySiteShell({
  siteId,
  data,
  isLoading,
  error,
  view,
  scope,
  layout,
  highlightedNodeIds,
  incidentId,
  siteName,
  onViewChange,
  onScopeChange,
  onLayoutChange,
  onBackToBackbone,
}: TopologySiteShellProps) {
  const router = useRouter();

  const [rfInstance, setRfInstance] = useState<ReactFlowInstance | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [panelMode, setPanelMode] = useState<PanelMode>(incidentId ? "incident" : null);
  const [activeFilters, setActiveFilters] = useState<Set<string>>(new Set(Object.keys(NODE_TYPE_META)));
  const [searchQuery, setSearchQuery] = useState("");
  const [legendVisible, setLegendVisible] = useState(false);
  const [pathTraceMode, setPathTraceMode] = useState(false);
  const [pathTraceStart, setPathTraceStart] = useState<string | null>(null);
  const [pathTraceEnd, setPathTraceEnd] = useState<string | null>(null);
  const [activeBlastFocusId, setActiveBlastFocusId] = useState<string | null>(null);
  const [collapsedRanks, setCollapsedRanks] = useState<Set<number>>(new Set());
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  const siteViewMode = paramToViewMode(view);
  const setSiteViewMode = useCallback(
    (mode: "auto" | "hostmap" | "aggregated" | "readable") => onViewChange(viewModeToParam(mode)),
    [onViewChange],
  );
  const healthScope = scope;
  const setHealthScope = onScopeChange;
  const layoutMode = layout;
  const setLayoutMode = onLayoutChange;

  const isLargeSite = useMemo(() => {
    const nonSiteCount = data.nodes.filter((n) => n.node_type !== "site").length;
    return nonSiteCount >= AGGREGATED_VIEW_THRESHOLD;
  }, [data.nodes]);

  // Smart default collapsed ranks
  useEffect(() => {
    const siteNodes = data.nodes.filter((n) => n.node_type !== "site");
    const counts = new Map<number, number>();
    for (const n of siteNodes) {
      const rank = getNodeRank(n.node_type);
      counts.set(rank, (counts.get(rank) ?? 0) + 1);
    }
    const collapsed = new Set<number>();
    if (!isLargeSite) {
      if ((counts.get(6) ?? 0) > 0) collapsed.add(6);
      if ((counts.get(5) ?? 0) > 30 && healthScope !== "alerting") collapsed.add(5);
    }
    setCollapsedRanks(collapsed);
  }, [data.nodes, isLargeSite, healthScope]);

  const { data: incidentDetail, isLoading: incidentLoading } = useQuery({
    queryKey: ["incident", incidentId],
    queryFn: () => api.getIncident(incidentId!),
    enabled: panelMode === "incident" && !!incidentId,
  });

  const { data: blastRadius } = useQuery({
    queryKey: ["blast-radius", incidentId],
    queryFn: () => api.getBlastRadius(incidentId!),
    enabled: !!incidentId,
    staleTime: 30000,
  });

  const { data: nodeDetail, isLoading: nodeLoading } = useQuery({
    queryKey: ["topology-node", selectedNodeId],
    queryFn: () => api.getTopologyNode(selectedNodeId!),
    enabled: panelMode === "node" && !!selectedNodeId,
  });

  const filteredNodes = useMemo(() => {
    if (activeFilters.size === 0) return [];
    return data.nodes.filter((n) => n.node_type === "site" || activeFilters.has(n.node_type));
  }, [data.nodes, activeFilters]);

  const searchResults = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (q.length < 2) return [];
    return filteredNodes
      .filter(
        (n) =>
          n.name?.toLowerCase().includes(q) ||
          n.node_id?.toLowerCase().includes(q) ||
          n.ip_address?.toLowerCase().includes(q),
      )
      .slice(0, 20)
      .map((n) => ({ node_id: n.node_id, name: n.name || n.node_id, node_type: n.node_type }));
  }, [searchQuery, filteredNodes]);

  const resolvedSiteMode = useMemo(() => {
    if (siteViewMode !== "auto") return siteViewMode;
    return isLargeSite ? "hostmap" : "readable";
  }, [siteViewMode, isLargeSite]);

  const { graphNodes, graphEdges } = useMemo(() => {
    if (filteredNodes.length === 0) return { graphNodes: [], graphEdges: [] };

    const highlightSet = new Set(highlightedNodeIds ?? []);

    const hasMultipleSites =
      new Set(filteredNodes.filter((n) => n.node_type !== "site").map((n) => n.site_id)).size > 1;

    if (hasMultipleSites) {
      const result = buildSiteGroupedLayout(filteredNodes, data.edges, {
        highlightSet,
        activeTypeFilters: activeFilters,
      });
      return { graphNodes: result.nodes, graphEdges: result.edges };
    }

    let layoutNodesInput = filteredNodes;
    let layoutEdgesInput = data.edges;
    const collapsedGroupMap = new Map<string, import("@/lib/large-site-utils").CollapsedLeafGroup>();

    // Apply scope and leaf collapsing for all sites (not just large ones)
    {
      let effectiveScope = healthScope;
      if (effectiveScope === "alerting") {
        const scope = computeAlertScope(filteredNodes, data.edges);
        const scoped = filteredNodes.filter((n) => scope.has(n.node_id));
        if (scoped.some((n) => n.node_type !== "site")) {
          layoutNodesInput = scoped;
        } else {
          effectiveScope = "all";
        }
      }

      if (effectiveScope === "all" && isLargeSite) {
        const collapse = collapseLeafSiblings(filteredNodes, data.edges, {
          minGroupSize: 4,
          expandedGroups,
          getRank: getNodeRank,
        });
        if (collapse.groups.length > 0) {
          const parentSite = new Map(filteredNodes.map((n) => [n.node_id, n.site_id]));
          for (const g of collapse.groups) {
            collapsedGroupMap.set(g.id, g);
          }
          const pseudoNodes: TopologyNode[] = collapse.groups.map((g) => ({
            node_id: g.id,
            node_type: g.children[0]?.node_type ?? "ap",
            name: `${g.children.length} devices`,
            ip_address: "",
            vendor: "",
            model: "",
            site_id: parentSite.get(g.parentId) ?? "",
            site_name: null,
            health_status:
              g.health.critical_count > 0
                ? "critical"
                : g.health.warning_count > 0
                  ? "warning"
                  : g.health.healthy_count > 0
                    ? "healthy"
                    : "unknown",
            health_label: "",
          }));
          layoutNodesInput = [...collapse.keptNodes, ...pseudoNodes];
          layoutEdgesInput = remapEdgesForCollapsedGroups(
            data.edges,
            collapse.hiddenToGroup,
            new Set(collapse.keptNodes.map((n) => n.node_id)),
          );
        }
      }
    }

    let result: ReturnType<typeof buildHierarchicalLayout>;
    if (layoutMode === "hierarchical") {
      result = buildHierarchicalLayout(layoutNodesInput, layoutEdgesInput, { highlightSet });
    } else if (layoutMode === "readable") {
      result = buildReadableHierarchicalLayout(layoutNodesInput, layoutEdgesInput, {
        rankdir: "TB",
        highlightSet,
        collapsedRanks,
        siteView: true,
      });
    } else if (layoutMode === "readable-lr") {
      result = buildReadableHierarchicalLayout(layoutNodesInput, layoutEdgesInput, {
        rankdir: "LR",
        highlightSet,
        collapsedRanks,
        siteView: true,
      });
    } else {
      result = buildHierarchicalLayout(layoutNodesInput, layoutEdgesInput, {
        rankdir: "TB",
        highlightSet,
      });
    }

    if (collapsedGroupMap.size > 0) {
      result = {
        nodes: result.nodes.map((n) =>
          collapsedGroupMap.has(n.id)
            ? { ...n, type: "collapsedGroup", data: { ...n.data, collapsedGroup: collapsedGroupMap.get(n.id) } }
            : n,
        ),
        edges: result.edges,
      };
    }

    return { graphNodes: result.nodes, graphEdges: result.edges };
  }, [filteredNodes, data.edges, highlightedNodeIds, layoutMode, activeFilters, collapsedRanks, isLargeSite, healthScope, expandedGroups]);

  const blastRadiusNodes = useMemo(() => {
    if (!blastRadius) return graphNodes;
    const rootSet = new Set(blastRadius.root_cause_node_ids);
    const symptomSet = new Set(blastRadius.symptom_node_ids);
    return graphNodes.map((n: any) => ({
      ...n,
      data: { ...n.data, isRootCause: rootSet.has(n.id), isSymptom: symptomSet.has(n.id) },
    }));
  }, [graphNodes, blastRadius]);

  const { finalNodes, finalEdges } = useMemo(() => {
    const withSelectionNodes = blastRadiusNodes.map((n: any) => ({
      ...n,
      selected: n.id === selectedNodeId,
      data: {
        ...n.data,
        isSelected: n.id === selectedNodeId,
      },
    }));

    if (activeBlastFocusId) {
      const normalized = normalizeTopology(filteredNodes, data.edges, {
        highlightedNodeIds: new Set(highlightedNodeIds ?? []),
      });
      const impact = getDownstreamImpact(normalized, activeBlastFocusId, 5);
      const nodeIds = impact.nodeIds;
      const edgeIds = impact.edgeIds;

      return {
        finalNodes: withSelectionNodes.map((n: any) => ({
          ...n,
          data: {
            ...n.data,
            isRootCause: n.id === activeBlastFocusId,
            isSymptom: nodeIds.has(n.id) && n.id !== activeBlastFocusId,
            isHighlighted: nodeIds.has(n.id),
            isDimmed: !nodeIds.has(n.id),
          },
        })),
        finalEdges: graphEdges.map((e: any) => ({
          ...e,
          data: {
            ...e.data,
            isPathTrace: edgeIds.has(e.id),
            isHighlighted: edgeIds.has(e.id),
            isDimmed: !edgeIds.has(e.id),
          },
        })),
      };
    }

    if (!pathTraceMode || !pathTraceStart || !pathTraceEnd) {
      return { finalNodes: withSelectionNodes, finalEdges: graphEdges };
    }

    const normalized = normalizeTopology(filteredNodes, data.edges, {
      highlightedNodeIds: new Set(highlightedNodeIds ?? []),
    });
    const pathResult = tracePath(normalized, pathTraceStart, pathTraceEnd);

    if (!pathResult) {
      const impact = getDownstreamImpact(normalized, pathTraceStart, 5);
      const nodeIds = impact.nodeIds;
      const edgeIds = impact.edgeIds;
      return {
        finalNodes: withSelectionNodes.map((n: any) => ({
          ...n,
          data: { ...n.data, isHighlighted: nodeIds.has(n.id), isDimmed: !nodeIds.has(n.id) },
        })),
        finalEdges: graphEdges.map((e: any) => ({
          ...e,
          data: { ...e.data, isPathTrace: edgeIds.has(e.id), isHighlighted: edgeIds.has(e.id), isDimmed: !edgeIds.has(e.id) },
        })),
      };
    }

    const { nodeIds, edgeIds } = pathResult;
    return {
      finalNodes: withSelectionNodes.map((n: any) => ({
        ...n,
        data: { ...n.data, isHighlighted: nodeIds.has(n.id), isDimmed: !nodeIds.has(n.id) },
      })),
      finalEdges: graphEdges.map((e: any) => ({
        ...e,
        data: { ...e.data, isPathTrace: edgeIds.has(e.id), isHighlighted: edgeIds.has(e.id), isDimmed: !edgeIds.has(e.id) },
      })),
    };
  }, [activeBlastFocusId, blastRadiusNodes, graphEdges, pathTraceMode, pathTraceStart, pathTraceEnd, filteredNodes, data.edges, highlightedNodeIds, selectedNodeId]);

  useEffect(() => {
    if (rfInstance && finalNodes.length > 0) {
      const timer = setTimeout(() => rfInstance.fitView({ padding: 0.15, duration: 300 }), 150);
      return () => clearTimeout(timer);
    }
  }, [rfInstance, finalNodes.length, layoutMode]);

  useEffect(() => {
    if (rfInstance && highlightedNodeIds && highlightedNodeIds.length > 0) {
      const timer = setTimeout(
        () => rfInstance.fitView({ padding: 0.2, nodes: highlightedNodeIds.map((id) => ({ id })), duration: 300 }),
        150,
      );
      return () => clearTimeout(timer);
    }
  }, [rfInstance, highlightedNodeIds]);

  const handleNodeClick = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      if (node.type === "collapsedGroup") {
        setExpandedGroups((prev) => new Set(prev).add(node.id));
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
    [pathTraceMode, pathTraceStart, pathTraceEnd, selectedNodeId, incidentId],
  );

  const handlePanelClose = useCallback(() => {
    setPanelMode(incidentId ? "incident" : null);
    setSelectedNodeId(null);
  }, [incidentId]);

  const handleContextSelect = useCallback((nodeId: string, _nodeName: string) => {
    router.push(`/topology/context/${encodeURIComponent(nodeId)}`);
  }, [router]);

  const handleFitView = useCallback(() => rfInstance?.fitView({ padding: 0.15, duration: 300 }), [rfInstance]);
  const handleZoomIn = useCallback(() => rfInstance?.zoomIn({ duration: 200 }), [rfInstance]);
  const handleZoomOut = useCallback(() => rfInstance?.zoomOut({ duration: 200 }), [rfInstance]);

  const handleReset = useCallback(() => {
    setPathTraceMode(false);
    setPathTraceStart(null);
    setPathTraceEnd(null);
    setSelectedNodeId(null);
    setPanelMode(incidentId ? "incident" : null);
    handleFitView();
  }, [incidentId, handleFitView]);

  const handleRefresh = useCallback(() => window.location.reload(), []);

  const handleToggleFilter = useCallback((type: string) => {
    setActiveFilters((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  }, []);

  const handleToggleRank = useCallback((rank: number) => {
    setCollapsedRanks((prev) => {
      const next = new Set(prev);
      if (next.has(rank)) next.delete(rank);
      else next.add(rank);
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
      rfInstance?.fitView({ padding: 0.2, nodes: [{ id: nodeId }], duration: 300 });
    },
    [rfInstance],
  );

  const handleNodePathTrace = useCallback(() => {
    if (!selectedNodeId) return;
    const selectedNode = data.nodes.find((n) => n.node_id === selectedNodeId);
    const target = selectedNode?.ip_address || selectedNodeId;
    router.push(`/path-trace?ip=${encodeURIComponent(target)}&device_id=${encodeURIComponent(selectedNodeId)}`);
  }, [selectedNodeId, data.nodes, router]);

  const handleNodeBlastRadius = useCallback(() => {
    if (!selectedNodeId) return;
    setActiveBlastFocusId(selectedNodeId);
  }, [selectedNodeId]);

  useEffect(() => {
    if (rfInstance && activeBlastFocusId) {
      const normalized = normalizeTopology(filteredNodes, data.edges);
      const impact = getDownstreamImpact(normalized, activeBlastFocusId, 5);
      const targetNodes = Array.from(impact.nodeIds).map((id) => ({ id }));
      if (targetNodes.length > 0) {
        rfInstance.fitView({ padding: 0.3, nodes: targetNodes, duration: 500 });
      }
    }
  }, [rfInstance, activeBlastFocusId, filteredNodes, data.edges]);

  if (isLoading) return <TopologySkeleton />;
  if (error) return <TopologyErrorState error={error} />;
  if (!data.nodes.length) return <TopologyEmptyState />;

  return (
    <div className="space-y-3">
      <TopologyToolbar
        totalNodes={finalNodes.length}
        totalEdges={finalEdges.length}
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
        isBackbone={false}
        onBackToBackbone={onBackToBackbone}
        siteName={siteName}
      />

      {/* View switcher + health scope — show for any site with enough devices to benefit */}
      {data.nodes.filter((n) => n.node_type !== "site").length > 15 && (
        <div className="flex flex-wrap items-center gap-3 text-xs border-b border-slate-800/60 pb-3">
          <span className="text-slate-500 font-mono">
            {data.nodes.filter((n) => n.node_type !== "site").length} devices
          </span>
          <div className="flex items-center gap-1">
            {(
              [
                { key: "hostmap", label: "Impact map" },
                { key: "aggregated", label: "Clusters" },
                { key: "readable", label: "Device graph" },
              ] as const
            ).map((mode) => (
              <button
                key={mode.key}
                onClick={() => setSiteViewMode(mode.key)}
                className={[
                  "px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider transition-colors border-b-2",
                  resolvedSiteMode === mode.key
                    ? "text-indigo-400 border-indigo-500"
                    : "text-slate-400 hover:text-slate-200 border-transparent",
                ].join(" ")}
              >
                {mode.label}
              </button>
            ))}
          </div>

          {resolvedSiteMode !== "hostmap" && (
            <div className="flex items-center gap-1 ml-2">
              {(
                [
                  {
                    key: "alerting",
                    label: "Alerting",
                    count: data.nodes.filter((n) => n.node_type !== "site" && isAlerting(n)).length,
                  },
                  {
                    key: "all",
                    label: "All",
                    count: data.nodes.filter((n) => n.node_type !== "site").length,
                  },
                ] as const
              ).map((s) => (
                <button
                  key={s.key}
                  onClick={() => setHealthScope(s.key)}
                  className={[
                    "px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider transition-colors border-b-2",
                    healthScope === s.key
                      ? "text-rose-400 border-rose-500"
                      : "text-slate-400 hover:text-slate-200 border-transparent",
                  ].join(" ")}
                >
                  {s.label}
                  <span className="ml-1 text-[10px] opacity-70">{s.count}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Site context banner */}
      <SiteContextBanner
        siteName={siteName}
        nodes={data.nodes}
        totalDevices={data.nodes.filter((n) => n.node_type !== "site").length}
      />

      {/* Path trace instructions */}
      {pathTraceMode && (
        <div className="flex items-center gap-2 text-xs text-indigo-400">
          <span className="font-bold">Path trace:</span>
          {!pathTraceStart ? (
            <span className="text-slate-500">Click a source device</span>
          ) : !pathTraceEnd ? (
            <span className="text-slate-500">Click a destination device</span>
          ) : (
            <span className="text-slate-500">Tracing path… click any device to reset</span>
          )}
          <button
            onClick={() => {
              setPathTraceMode(false);
              setPathTraceStart(null);
              setPathTraceEnd(null);
            }}
            className="ml-auto text-[10px] text-slate-500 hover:text-slate-300"
          >
            Cancel
          </button>
        </div>
      )}

      {/* Blast Radius Isolation Banner */}
      {activeBlastFocusId && (
        <div className="flex items-center gap-3 rounded border border-rose-500/40 bg-rose-500/10 px-3.5 py-2 text-xs text-rose-300">
          <span className="font-bold flex items-center gap-1.5">
            <Zap className="h-3.5 w-3.5 text-rose-400 shrink-0" />
            Blast Radius Isolation Mode:
          </span>
          <span className="truncate">Focusing device {activeBlastFocusId} — unrelated graph nodes dimmed by 90% opacity.</span>
          <button
            onClick={() => setActiveBlastFocusId(null)}
            className="ml-auto shrink-0 rounded bg-rose-500/20 px-2.5 py-1 text-[11px] font-semibold text-rose-200 hover:bg-rose-500/30 transition-colors cursor-pointer"
          >
            Clear Isolation
          </button>
        </div>
      )}

      {/* Rank toggle filters — cardless inline metadata with dot separators */}
      {resolvedSiteMode === "readable" && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500 py-1">
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mr-1">
            Filter Layers:
          </span>
          {[
            { rank: 0, label: "Internet" },
            { rank: 1, label: "Edge" },
            { rank: 2, label: "Core" },
            { rank: 3, label: "Distribution" },
            { rank: 4, label: "Access" },
            { rank: 5, label: "Wireless" },
            { rank: 6, label: "Endpoints" },
          ].map(({ rank, label }, i) => {
            const count = data.nodes.filter(
              (n) => getNodeRank(n.node_type) === rank && n.node_type !== "site",
            ).length;
            if (count === 0) return null;
            const collapsed = collapsedRanks.has(rank);
            return (
              <span key={rank} className="inline-flex items-center gap-1.5">
                {i > 0 && <span className="text-slate-700">·</span>}
                <button
                  onClick={() => handleToggleRank(rank)}
                  className={[
                    "inline-flex items-center gap-1 text-[11px] transition-colors cursor-pointer",
                    collapsed ? "text-slate-700 line-through" : "text-slate-300 hover:text-white font-medium",
                  ].join(" ")}
                  title={collapsed ? `Show ${label}` : `Hide ${label}`}
                >
                  <span className={collapsed ? "opacity-50" : ""}>{label}</span>
                  <span className="text-[10px] text-slate-500 font-mono">({count})</span>
                </button>
              </span>
            );
          })}
        </div>
      )}

      {/* Worst offenders */}
      {(
        <WorstOffendersStrip
          nodes={data.nodes}
          edges={data.edges}
          onSelect={handleContextSelect}
        />
      )}

      {/* View content */}
      {resolvedSiteMode === "hostmap" ? (
        <HostMapView data={data} onContextSelect={handleContextSelect} />
      ) : resolvedSiteMode === "aggregated" ? (
        <AggregatedView
          data={data}
          onContextSelect={handleContextSelect}
          onFlatView={() => {
            setSiteViewMode("readable");
            setHealthScope("all");
          }}
        />
      ) : (
        <TopologyGraphCanvas
          nodes={finalNodes}
          edges={finalEdges}
          onNodeClick={handleNodeClick}
          onInit={setRfInstance}
          activeSiteId={siteId}
          legendVisible={legendVisible}
          onCloseLegend={() => setLegendVisible(false)}
        >
          <TopologySidePanel
            mode={panelMode}
            incidentId={incidentId}
            incidentDetail={incidentDetail ?? null}
            nodeDetail={nodeDetail ?? null}
            onClose={handlePanelClose}
            incidentLoading={incidentLoading}
            nodeLoading={nodeLoading}
            onNodePathTrace={handleNodePathTrace}
            onNodeBlastRadius={handleNodeBlastRadius}
          />
        </TopologyGraphCanvas>
      )}
    </div>
  );
}
