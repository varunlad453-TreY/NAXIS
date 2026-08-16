"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { type Node, type ReactFlowInstance } from "reactflow";

import type { TopologyGraphResponse, TopologyNode } from "@/types/topology";
import { NODE_TYPE_META } from "@/types/topology";
import { api } from "@/lib/api";
import { TopologyToolbar } from "./topology-toolbar";
import { AllSitesGrid, healthColor } from "./all-sites-grid";
import { TopologySidePanel, type PanelMode } from "./topology-side-panel";
import { TopologyGraphCanvas } from "./topology-graph-canvas";
import {
  buildBackboneLayout,
  buildRegionClustersLayout,
} from "./topology-layout-engine";
import { normalizeTopology, tracePath, getDownstreamImpact } from "./topology-graph-model";

interface RegionHubInfo {
  name: string;
  sites: TopologyNode[];
  criticalCount: number;
  warningCount: number;
  deviceCount: number;
}

export interface TopologyBackboneViewProps {
  data: TopologyGraphResponse;
  isLoading: boolean;
  error: Error | null;
  highlightedNodeIds?: string[];
  incidentId?: string | null;
  onSiteSelect: (siteId: string) => void;
  backboneViewMode: "regions" | "degraded" | "all";
  onBackboneViewModeChange: (mode: "regions" | "degraded" | "all") => void;
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
        <h3 className="text-lg font-bold text-white">No sites discovered</h3>
        <p className="text-sm text-slate-500">
          Site topology will appear once the network discovery sync completes.
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

export function TopologyBackboneView({
  data,
  isLoading,
  error,
  highlightedNodeIds,
  incidentId,
  onSiteSelect,
  backboneViewMode,
  onBackboneViewModeChange,
}: TopologyBackboneViewProps) {
  const router = useRouter();
  const [rfInstance, setRfInstance] = useState<ReactFlowInstance | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [panelMode, setPanelMode] = useState<PanelMode>(incidentId ? "incident" : null);
  const [legendVisible, setLegendVisible] = useState(false);
  const [activeFilters, setActiveFilters] = useState<Set<string>>(new Set(Object.keys(NODE_TYPE_META)));
  const [searchQuery, setSearchQuery] = useState("");
  const [hubRegionFilter, setHubRegionFilter] = useState<string | undefined>(undefined);
  const [selectedRegionHub, setSelectedRegionHub] = useState<RegionHubInfo | null>(null);

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

  const handleNodePathTrace = useCallback(() => {
    if (!selectedNodeId) return;
    const selectedNode = nodeDetail?.node;
    const target = selectedNode?.ip_address || selectedNodeId;
    router.push(`/path-trace?ip=${encodeURIComponent(target)}&device_id=${encodeURIComponent(selectedNodeId)}`);
  }, [selectedNodeId, nodeDetail, router]);

  const handleNodeBlastRadius = useCallback(() => {
    if (!selectedNodeId) return;
    const siteId = nodeDetail?.node?.site_id || selectedNodeId;
    if (onSiteSelect && siteId) {
      onSiteSelect(siteId);
    }
  }, [selectedNodeId, nodeDetail, onSiteSelect]);

  useEffect(() => {
    if (backboneViewMode !== "all") setHubRegionFilter(undefined);
  }, [backboneViewMode]);

  const siteNodes = useMemo(
    () => data.nodes.filter((n) => n.node_type === "site"),
    [data.nodes],
  );

  const interSiteEdges = useMemo(
    () =>
      data.edges.filter((e) => {
        const src = data.nodes.find((n) => n.node_id === e.src_id);
        const dst = data.nodes.find((n) => n.node_id === e.dst_id);
        return src && dst && src.site_id && dst.site_id && src.site_id !== dst.site_id;
      }),
    [data.nodes, data.edges],
  );

  const searchResults = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (q.length < 2) return [];
    return siteNodes
      .filter(
        (n) =>
          n.name?.toLowerCase().includes(q) ||
          n.node_id?.toLowerCase().includes(q),
      )
      .slice(0, 20)
      .map((n) => ({ node_id: n.node_id, name: n.name || n.node_id, node_type: n.node_type }));
  }, [searchQuery, siteNodes]);

  const { graphNodes, graphEdges } = useMemo(() => {
    const highlightSet = new Set(highlightedNodeIds ?? []);

    if (backboneViewMode === "regions") {
      const result = buildRegionClustersLayout(siteNodes, highlightSet);
      return { graphNodes: result.nodes, graphEdges: result.edges };
    }

    if (backboneViewMode === "degraded") {
      const degradedSites = siteNodes.filter(
        (s) =>
          s.health_status === "critical" ||
          s.health_status === "warning" ||
          s.health_status === "degraded" ||
          (s as any).critical_count > 0 ||
          (s as any).warning_count > 0,
      );

      if (degradedSites.length === 0) {
        const healthyBannerNode: any = {
          id: "all-healthy-banner",
          type: "statusBanner",
          position: { x: 320, y: 160 },
          data: {
            topoNode: {
              node_id: "all-healthy-banner",
              node_type: "site",
              name: "All Enterprise Sites Operating Normally",
              ip_address: "",
              vendor: "system",
              model: "Zero Active Incidents",
              site_id: "none",
              site_name: "All Healthy",
              health_status: "healthy",
              health_label: "0 Active Alerts",
              device_count: 0,
            },
            label: "All Enterprise Sites Operating Normally",
            nodeType: "site",
            healthStatus: "healthy",
            healthColor: "#10b981",
            deviceColor: "#10b981",
            deviceLabel: "Healthy",
            rank: 0,
            isHighlighted: false,
            isDimmed: false,
            isRootCause: false,
            isSymptom: false,
            isSelected: false,
            isSiteGroup: true,
            childCount: siteNodes.length,
            crossSiteEdgeCount: 0,
          },
          width: 380,
          height: 100,
        };
        return { graphNodes: [healthyBannerNode], graphEdges: [] };
      }

      const result = buildBackboneLayout(degradedSites, interSiteEdges, highlightSet);
      return { graphNodes: result.nodes, graphEdges: result.edges };
    }

    const result = buildBackboneLayout(siteNodes, interSiteEdges, highlightSet);
    return { graphNodes: result.nodes, graphEdges: result.edges };
  }, [siteNodes, interSiteEdges, highlightedNodeIds, backboneViewMode]);

  const finalNodes = useMemo(() => {
    if (!blastRadius) return graphNodes;
    const rootSet = new Set(blastRadius.root_cause_node_ids);
    const symptomSet = new Set(blastRadius.symptom_node_ids);
    return graphNodes.map((n: any) => ({
      ...n,
      data: { ...n.data, isRootCause: rootSet.has(n.id), isSymptom: symptomSet.has(n.id) },
    }));
  }, [graphNodes, blastRadius]);

  useEffect(() => {
    if (rfInstance && finalNodes.length > 0) {
      const timer = setTimeout(() => rfInstance.fitView({ padding: 0.15, duration: 300 }), 150);
      return () => clearTimeout(timer);
    }
  }, [rfInstance, finalNodes.length, backboneViewMode]);

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
      if (node.type === "regionalHub") {
        const sites = node.data?.regionSites as TopologyNode[] | undefined;
        const topoNode = node.data?.topoNode as any;
        if (sites && sites.length > 0) {
          setSelectedRegionHub({
            name: topoNode?.name || node.data?.label || "Regional Hub",
            sites,
            criticalCount: sites.filter((s) => s.health_status === "critical").length,
            warningCount: sites.filter(
              (s) => s.health_status === "warning" || s.health_status === "degraded",
            ).length,
            deviceCount: sites.reduce((acc, s) => acc + ((s as any).device_count ?? 1), 0),
          });
        }
        return;
      }

      const isGroupNode =
        node.type === "siteGroup" || node.type === "site" || node.type === "statusBanner";
      if (isGroupNode) {
        const targetSiteId =
          node.data?.topoNode?.site_id || node.data?.topoNode?.node_id;
        if (
          targetSiteId &&
          targetSiteId !== "none" &&
          !targetSiteId.startsWith("all-") &&
          !targetSiteId.startsWith("region-")
        ) {
          onSiteSelect(targetSiteId);
        }
        return;
      }

      setSelectedNodeId((prev) => (prev === node.id ? null : node.id));
      setPanelMode((prev) => {
        if (prev === "node" && selectedNodeId === node.id) return incidentId ? "incident" : null;
        return "node";
      });
    },
    [onSiteSelect, selectedNodeId, incidentId],
  );

  const handlePanelClose = useCallback(() => {
    setPanelMode(incidentId ? "incident" : null);
    setSelectedNodeId(null);
  }, [incidentId]);

  const handleFitView = useCallback(() => rfInstance?.fitView({ padding: 0.15, duration: 300 }), [rfInstance]);
  const handleZoomIn = useCallback(() => rfInstance?.zoomIn({ duration: 200 }), [rfInstance]);
  const handleZoomOut = useCallback(() => rfInstance?.zoomOut({ duration: 200 }), [rfInstance]);
  const handleReset = useCallback(() => {
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

  const handleSearchSelect = useCallback(
    (nodeId: string) => {
      setSearchQuery("");
      setSelectedNodeId(nodeId);
      setPanelMode("node");
      rfInstance?.fitView({ padding: 0.2, nodes: [{ id: nodeId }], duration: 300 });
    },
    [rfInstance],
  );

  if (isLoading) return <TopologySkeleton />;
  if (error) return <TopologyErrorState error={error} />;
  if (!data.nodes.length) return <TopologyEmptyState />;

  return (
    <div className="space-y-3">
      <TopologyToolbar
        totalNodes={finalNodes.length}
        totalEdges={graphEdges.length}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        searchResults={searchResults}
        onSelectSearchResult={handleSearchSelect}
        layoutMode="readable"
        onLayoutModeChange={() => {}}
        activeFilters={activeFilters}
        onToggleFilter={handleToggleFilter}
        onFitView={handleFitView}
        onZoomIn={handleZoomIn}
        onZoomOut={handleZoomOut}
        onReset={handleReset}
        onRefresh={handleRefresh}
        onPathTrace={() => {}}
        pathTraceActive={false}
        onToggleLegend={() => setLegendVisible((v) => !v)}
        legendVisible={legendVisible}
        isBackbone
        backboneViewMode={backboneViewMode}
        onBackboneViewModeChange={onBackboneViewModeChange}
      />

      {backboneViewMode === "all" ? (
        <AllSitesGrid
          sites={siteNodes}
          onSiteClick={onSiteSelect}
          defaultRegion={hubRegionFilter}
        />
      ) : (
        <TopologyGraphCanvas
          nodes={finalNodes}
          edges={graphEdges}
          onNodeClick={handleNodeClick}
          onInit={setRfInstance}
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

          {selectedRegionHub && (
            <div className="absolute right-0 top-0 h-full w-[380px] bg-slate-950 border-l border-slate-800 flex flex-col z-40">
              <div className="shrink-0 px-5 py-4 border-b border-slate-800/60">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-indigo-400">
                      Regional Hub
                    </span>
                    <h2 className="text-lg font-semibold text-white truncate mt-0.5">
                      {selectedRegionHub.name}
                    </h2>
                  </div>
                  <button
                    onClick={() => setSelectedRegionHub(null)}
                    className="p-1 text-slate-500 hover:text-white hover:bg-slate-800 rounded-sm transition-colors flex-shrink-0"
                  >
                    ✕
                  </button>
                </div>
                <div className="flex items-baseline gap-x-6 gap-y-2 mt-3 text-xs">
                  <div className="flex items-baseline gap-1.5">
                    <span className="text-slate-500 uppercase tracking-wider">Sites</span>
                    <span className="font-semibold text-white font-mono">{selectedRegionHub.sites.length}</span>
                  </div>
                  <span className="text-slate-700">|</span>
                  <div className="flex items-baseline gap-1.5">
                    <span className="text-slate-500 uppercase tracking-wider">Devices</span>
                    <span className="font-semibold text-white font-mono">{selectedRegionHub.deviceCount}</span>
                  </div>
                  <span className="text-slate-700">|</span>
                  {selectedRegionHub.criticalCount > 0 && (
                    <div className="flex items-baseline gap-1.5">
                      <span className="text-slate-500 uppercase tracking-wider">Critical</span>
                      <span className="font-semibold text-rose-400 font-mono">{selectedRegionHub.criticalCount}</span>
                    </div>
                  )}
                  {selectedRegionHub.warningCount > 0 && (
                    <>
                      <span className="text-slate-700">|</span>
                      <div className="flex items-baseline gap-1.5">
                        <span className="text-slate-500 uppercase tracking-wider">Degraded</span>
                        <span className="font-semibold text-amber-400 font-mono">{selectedRegionHub.warningCount}</span>
                      </div>
                    </>
                  )}
                </div>
              </div>
              <div className="flex-1 overflow-y-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-800/60 text-slate-500 text-[10px] uppercase tracking-wider font-semibold">
                      <th className="py-2 px-4">Site</th>
                      <th className="py-2 px-3 text-center">Devices</th>
                      <th className="py-2 px-3 text-center">Alerts</th>
                      <th className="py-2 px-3 text-right">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/40 text-xs">
                    {selectedRegionHub.sites.map((site) => {
                      const color = healthColor(site.health_status);
                      const alertCount =
                        ((site as any).critical_count ?? 0) + ((site as any).warning_count ?? 0);
                      return (
                        <tr
                          key={site.node_id}
                          onClick={() => {
                            onSiteSelect(site.site_id || site.node_id);
                            setSelectedRegionHub(null);
                          }}
                          className="hover:bg-slate-800/30 cursor-pointer transition-colors"
                        >
                          <td className="py-2 px-4 font-medium text-white truncate max-w-[180px]">
                            {site.name || site.site_name || site.site_id || site.node_id}
                          </td>
                          <td className="py-2 px-3 text-center font-mono text-slate-300">
                            {(site as any).device_count ?? 0}
                          </td>
                          <td className="py-2 px-3 text-center font-mono">
                            <span className={alertCount > 0 ? "text-amber-400 font-semibold" : "text-slate-500"}>
                              {alertCount}
                            </span>
                          </td>
                          <td className="py-2 px-3 text-right">
                            <span className="flex items-center justify-end gap-1.5">
                              <span
                                className="w-1.5 h-1.5 rounded-full shrink-0"
                                style={{ background: color }}
                              />
                              <span className="capitalize" style={{ color }}>
                                {site.health_status === "healthy" ? "Operational" : site.health_status}
                              </span>
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </TopologyGraphCanvas>
      )}
    </div>
  );
}
