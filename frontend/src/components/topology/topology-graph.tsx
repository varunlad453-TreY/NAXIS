"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ReactFlow,
  Background,
  Controls,
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
import { Search, X, Layers, Download } from "lucide-react";

import type { TopologyGraphResponse, DeviceCategory } from "@/types/topology";
import { NODE_TYPE_META, HEALTH_STATUS_META, AGGREGATED_VIEW_THRESHOLD } from "@/types/topology";
import { NODE_WIDTH, NODE_HEIGHT } from "./layout";
import { useTopologyLayout } from "./use-topology-layout";
import { api } from "@/lib/api";
import { TopologySidePanel, type PanelMode } from "./topology-side-panel";
import { AggregatedView } from "./aggregated-view";
import { ContextGraph } from "./context-graph";

interface TopologyGraphProps {
  data: TopologyGraphResponse;
  isLoading?: boolean;
  error?: Error | null;
  highlightedNodeIds?: string[];
  incidentId?: string | null;
  onSiteSelect?: (siteId: string) => void;
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
  const meta = deviceTypeMeta(data.node_type as string);
  const hMeta = healthMeta(data.health_status as string);
  const isHighlighted = data.highlighted === true;
  const isRootCause = data.rootCause === true;
  const deviceCount = (data.device_count as number) ?? 0;

  return (
    <div
      className={[
        "group cursor-pointer rounded-lg border-2 bg-surface px-4 py-3 shadow-surface transition-all hover:shadow-surface-lg",
        isRootCause ? "animate-pulse" : "",
        data.node_type === "site" ? "hover:border-primary/50" : "",
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
            <span
              className="relative inline-block h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: hMeta.color }}
              title={hMeta.label}
            >
              <span
                className="absolute inset-0 animate-ping rounded-full opacity-30"
                style={{ backgroundColor: hMeta.color }}
              />
            </span>
          </div>
          <div className="flex items-center gap-2 text-[10px] text-foreground-subtle">
            <span>{meta.label}</span>
            {deviceCount > 0 && (
              <>
                <span className="text-border">·</span>
                <span>{deviceCount} devices</span>
              </>
            )}
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

function SiteGroupNode({ data }: NodeProps) {
  const hMeta = healthMeta((data.health_status as string) ?? "unknown");
  const isExpanded = data.isExpanded === true;
  const count = (data.child_count as number) ?? 0;
  const crossCount = (data.crossSiteEdgeCount as number) ?? 0;

  const siteMeta = NODE_TYPE_META.site ?? {
    label: "Site",
    category: "infrastructure" as const,
    color: "#8b5cf6",
  };

  return (
    <div
      className={[
        "relative h-full w-full rounded-xl border-2 transition-all",
        isExpanded
          ? "border-border/40 bg-surface/10"
          : "border-violet-400/30 bg-violet-500/5 hover:border-violet-400/60",
      ].join(" ")}
    >
      <div
        className={[
          "flex items-center gap-3 rounded-t-xl px-4",
          isExpanded ? "border-b border-border/30 bg-surface/40 py-2" : "py-3",
        ].join(" ")}
      >
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-violet-500 text-xs font-bold text-white">
          SI
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-semibold text-foreground">
              {data.label as string}
            </span>
            <span
              className="inline-block h-2 w-2 shrink-0 rounded-full"
              style={{ backgroundColor: hMeta.color }}
              title={hMeta.label}
            />
          </div>
          <div className="flex items-center gap-2 text-[10px] text-foreground-subtle">
            <span>{siteMeta.label}</span>
            {!isExpanded && (
              <>
                <span className="text-border">·</span>
                <span>{count} devices</span>
                {crossCount > 0 && (
                  <>
                    <span className="text-border">·</span>
                    <span className="text-primary">{crossCount} cross-site</span>
                  </>
                )}
              </>
            )}
            {isExpanded && (
              <span>{count} devices</span>
            )}
          </div>
        </div>
        <span className="text-lg text-foreground-muted transition-transform duration-200">
          {isExpanded ? "▾" : "▸"}
        </span>
      </div>
    </div>
  );
}

const nodeTypes: NodeTypes = {
  topologyNode: TopologyNodeComponent,
  siteGroup: SiteGroupNode,
};

function TopologySkeleton() {
  return (
    <div className="flex h-[600px] items-center justify-center border border-border/40 bg-surface/30">
      <div className="space-y-4 text-center">
        <div className="mx-auto h-12 w-12 animate-pulse rounded-full bg-surface-elevated" />
        <div className="mx-auto h-4 w-48 animate-pulse bg-surface-elevated" />
        <div className="mx-auto h-3 w-32 animate-pulse bg-surface-elevated" />
      </div>
    </div>
  );
}

function TopologyEmptyState() {
  return (
    <div className="flex h-[600px] items-center justify-center border border-dashed border-border/40">
      <div className="max-w-md space-y-4 text-center">
        <h3 className="text-lg font-semibold text-foreground">No topology data</h3>
        <p className="text-sm text-foreground-muted">
          Topology nodes and edges will appear here once the worker starts
          collecting network topology from Mist, VeloCloud, or SNMP pollers.
        </p>
      </div>
    </div>
  );
}

const ALL_TYPES = new Set(["ap", "switch", "site"]);

export function TopologyGraph({
  data,
  isLoading,
  error,
  highlightedNodeIds,
  incidentId,
  onSiteSelect,
}: TopologyGraphProps) {
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const [reactFlowInstance, setReactFlowInstance] = useState<ReactFlowInstance | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [fitViewKey, setFitViewKey] = useState(0);
  const [panelMode, setPanelMode] = useState<PanelMode>(incidentId ? "incident" : null);
  const [expandedSites, setExpandedSites] = useState<Set<string>>(new Set());

  const siteNames = useMemo(() => {
    const m = new Map<string, string>();
    for (const n of data.nodes) {
      if (n.node_type === "site" && n.site_id && n.name) m.set(n.site_id, n.name);
    }
    return m;
  }, [data.nodes]);

  const jumpToSite = useCallback((siteId: string) => {
    setExpandedSites((prev) => {
      if (prev.has(siteId)) return prev;
      const next = new Set(prev);
      next.add(siteId);
      setTimeout(() => {
        reactFlowInstance?.fitView({ padding: 0.3, duration: 300, nodes: [{ id: siteId }] });
      }, 200);
      return next;
    });
  }, [reactFlowInstance]);
  const [activeTypeFilters, setActiveTypeFilters] = useState<Set<string>>(
    () => new Set(Object.keys(NODE_TYPE_META)),
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [showSearch, setShowSearch] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);
  const firstFitDone = useRef(false);

  const largeSite = data.nodes.length - data.nodes.filter((n) => n.node_type === "site").length >= AGGREGATED_VIEW_THRESHOLD;
  const [viewMode, setViewMode] = useState<"auto" | "aggregated" | "flat" | "context">("auto");
  const [contextNode, setContextNode] = useState<{ id: string; name: string } | null>(null);

  const resolvedMode = useMemo(() => {
    if (contextNode) return "context";
    if (viewMode === "flat") return "flat";
    if (viewMode === "aggregated") return "aggregated";
    if (viewMode === "auto" && largeSite) return "aggregated";
    return "flat";
  }, [viewMode, contextNode, largeSite]);

  const handleContextSelect = useCallback((nodeId: string, nodeName: string) => {
    setContextNode({ id: nodeId, name: nodeName });
  }, []);

  const handleContextBack = useCallback(() => {
    setContextNode(null);
  }, []);

  const handleFlatView = useCallback(() => {
    setViewMode("flat");
  }, []);

  const singleSite = useMemo(() => {
    const nonSite = data.nodes.filter((n) => n.node_type !== "site");
    if (nonSite.length === 0) return false;
    const siteIds = new Set(nonSite.map((n) => n.site_id).filter(Boolean));
    return siteIds.size <= 1;
  }, [data.nodes]);

  const allSiteIds = useMemo(() => {
    return data.nodes.filter((n) => n.node_type === "site" && n.site_id).map((n) => n.site_id!);
  }, [data.nodes]);

  const highlightSet = useMemo(
    () => new Set(highlightedNodeIds ?? []),
    [highlightedNodeIds]
  );

  const { layoutNodes: initialNodes, layoutEdges: initialEdges, isComputing } = useTopologyLayout({
    nodes: data.nodes,
    edges: data.edges,
    highlightSet,
    expandedSites,
    activeTypeFilters,
    grouped: !singleSite,
  });

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  const {
    data: incidentDetail,
    isLoading: incidentLoading,
  } = useQuery({
    queryKey: ["incident", incidentId],
    queryFn: () => api.getIncident(incidentId!),
    enabled: panelMode === "incident" && !!incidentId,
  });

  const {
    data: nodeDetail,
    isLoading: nodeLoading,
  } = useQuery({
    queryKey: ["topology-node", selectedNodeId],
    queryFn: () => api.getTopologyNode(selectedNodeId!),
    enabled: panelMode === "node" && !!selectedNodeId,
  });

  useEffect(() => {
    if (incidentId) {
      setPanelMode("incident");
    }
  }, [incidentId]);

  useEffect(() => {
    setNodes(initialNodes);
    setEdges(initialEdges);
    setFitViewKey((k) => k + 1);
  }, [initialNodes, initialEdges, setNodes, setEdges]);

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

  const toggleSite = useCallback((siteId: string) => {
    setExpandedSites((prev) => {
      const next = new Set(prev);
      const wasCollapsed = !next.has(siteId);
      if (wasCollapsed) {
        next.add(siteId);
        // Auto fitView after expanding a site
        setTimeout(() => {
          reactFlowInstance?.fitView({ padding: 0.3, duration: 300 });
        }, 200);
      } else {
        next.delete(siteId);
      }
      return next;
    });
  }, [reactFlowInstance]);

  const expandAll = useCallback(() => {
    setExpandedSites(new Set(allSiteIds));
  }, [allSiteIds]);

  const collapseAll = useCallback(() => {
    setExpandedSites(new Set());
  }, []);

  const toggleTypeFilter = useCallback((type: string) => {
    setActiveTypeFilters((prev) => {
      const next = new Set(prev);
      if (next.has(type)) {
        next.delete(type);
      } else {
        next.add(type);
      }
      return next;
    });
  }, []);

  const searchResults = useMemo(() => {
    if (!searchQuery.trim() || searchQuery.trim().length < 2) return [];
    const q = searchQuery.trim().toLowerCase();
    return data.nodes
      .filter((n) => n.name?.toLowerCase().includes(q) || n.node_id?.toLowerCase().includes(q))
      .slice(0, 20);
  }, [searchQuery, data.nodes]);

  const handleSelectSearchResult = useCallback((node: (typeof data.nodes)[0]) => {
    setSearchQuery("");
    setShowSearch(false);

    if (node.node_type === "site" && node.site_id) {
      toggleSite(node.site_id);
    } else if (node.site_id) {
      setExpandedSites((prev) => {
        const next = new Set(prev);
        next.add(node.site_id!);
        return next;
      });
    }

    setTimeout(() => {
      if (reactFlowInstance) {
        reactFlowInstance.fitView({
          padding: 0.3,
          nodes: [{ id: node.node_id }],
          duration: 300,
        });
      }
    }, 50);
  }, [reactFlowInstance, toggleSite]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (searchRef.current && !searchRef.current.contains(event.target as unknown as globalThis.Node)) {
        setShowSearch(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    if (reactFlowInstance && !isComputing && initialNodes.length > 0 && !firstFitDone.current) {
      firstFitDone.current = true;
      const timer = setTimeout(() => {
        reactFlowInstance.fitView({ padding: 0.2, duration: 300 });
      }, 150);
      return () => clearTimeout(timer);
    }
  }, [reactFlowInstance, isComputing, initialNodes.length]);

  const onNodeClickHandler = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      if (node.type === "siteGroup") {
        const siteId = (node.data as Record<string, unknown>)?.site_id as string;
        if (siteId) toggleSite(siteId);
        return;
      }

      if (node.type === "topologyNode") {
        const nodeData = node.data as Record<string, unknown>;
        if (nodeData.node_type === "site") {
          const siteId = (nodeData.site_id as string) || node.id;
          if (siteId && onSiteSelect) {
            onSiteSelect(siteId);
            return;
          }
        }
      }

      const id = node.id;
      setSelectedNodeId((prev) => (prev === id ? null : id));
      setPanelMode((prev) => {
        if (prev === "node" && selectedNodeId === id) return incidentId ? "incident" : null;
        return "node";
      });
    },
    [selectedNodeId, incidentId, toggleSite, onSiteSelect]
  );

  const onPanelClose = useCallback(() => {
    setPanelMode(incidentId ? "incident" : null);
    setSelectedNodeId(null);
  }, [incidentId]);

  const onFitView = useCallback(() => {
    reactFlowInstance?.fitView({ padding: 0.2 });
  }, [reactFlowInstance]);

const onExportPng = useCallback(async () => {
    if (!reactFlowInstance) return;
    try {
      const dataUrl = (reactFlowInstance as ReactFlowInstance & {
        toImage: () => string | Promise<string>;
      }).toImage();
      const link = document.createElement("a");
      link.download = `topology-${new Date().toISOString().slice(0, 19).replace(/[:-]/g, "")}.png`;
      link.href = await dataUrl;
      link.click();
    } catch {
      // toImage may fail if canvas is tainted — silently ignore
    }
  }, [reactFlowInstance]);

  if (isLoading || (isComputing && initialNodes.length === 0)) return <TopologySkeleton />;
  if (error) {
    const errorMsg =
      error instanceof Error
        ? error.message
        : typeof error === "string"
        ? error
        : "Failed to load topology data";
    return (
      <div className="flex h-[600px] items-center justify-center border border-critical/20 bg-critical/5">
        <div className="max-w-md space-y-3 text-center">
          <h3 className="font-semibold text-foreground">Failed to load topology</h3>
          <p className="text-sm text-foreground-muted">{errorMsg}</p>
        </div>
      </div>
    );
  }

  if (!data.nodes.length) return <TopologyEmptyState />;

  if (resolvedMode === "context" && contextNode) {
    return (
      <ContextGraph
        nodeId={contextNode.id}
        nodeName={contextNode.name}
        onBack={handleContextBack}
        onNodeClick={handleContextSelect}
        allNodeIds={data.nodes.map((n) => n.node_id)}
      />
    );
  }

  if (resolvedMode === "aggregated") {
    return (
      <AggregatedView
        data={data}
        onContextSelect={handleContextSelect}
        onFlatView={handleFlatView}
      />
    );
  }

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        {/* Left group: stats + type filters + search + blast radius */}
        <div className="flex items-center gap-3 text-sm text-foreground-muted">
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-primary" />
            {data.total_nodes} nodes
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-0.5 w-4 rounded bg-foreground-subtle" />
            {data.total_edges} links
          </span>

          <span className="h-4 w-px bg-border/60" />

          {/* Type filter toggles */}
          {Array.from(ALL_TYPES).map((type) => {
            const meta = deviceTypeMeta(type);
            const isActive = activeTypeFilters.has(type);
            return (
              <button
                key={type}
                onClick={() => toggleTypeFilter(type)}
                className={[
                  "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition-all",
                  isActive
                    ? "border-current bg-current/10 text-current"
                    : "border-border/40 text-foreground-subtle opacity-40 hover:opacity-70",
                ].join(" ")}
                style={isActive ? { color: meta.color } : undefined}
              >
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: meta.color }} />
                {meta.label}
              </button>
            );
          })}

          <span className="h-4 w-px bg-border/60" />

          {/* Search */}
          <div ref={searchRef} className="relative">
            {showSearch ? (
              <div className="flex items-center gap-1">
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search nodes..."
                  className="w-40 rounded-md border border-border/60 bg-surface px-2.5 py-1 text-xs text-foreground outline-none placeholder:text-foreground-subtle focus:border-primary/50"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === "Escape") {
                      setShowSearch(false);
                      setSearchQuery("");
                    }
                    if (e.key === "Enter" && searchResults.length > 0) {
                      handleSelectSearchResult(searchResults[0]);
                    }
                  }}
                />
                <button
                  onClick={() => {
                    setShowSearch(false);
                    setSearchQuery("");
                  }}
                  className="rounded p-1 text-foreground-muted hover:text-foreground"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ) : (
              <button
                onClick={() => setShowSearch(true)}
                className="inline-flex items-center gap-1.5 rounded-md border border-border/60 px-2.5 py-1 text-xs font-medium text-foreground-muted transition-colors hover:bg-surface hover:text-foreground"
              >
                <Search className="h-3.5 w-3.5" />
                Search
              </button>
            )}

            {/* Keyboard shortcuts */}
            <div className="relative">
              <button
                onClick={() => setShowShortcuts((v) => !v)}
                className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border/60 text-xs font-medium text-foreground-muted transition-colors hover:bg-surface hover:text-foreground"
                title="Keyboard shortcuts"
              >
                ?
              </button>
              {showShortcuts && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowShortcuts(false)} />
                  <div className="absolute left-0 top-full z-50 mt-1 w-56 overflow-hidden rounded-lg border border-border/60 bg-surface shadow-surface-lg">
                    <div className="border-b border-border/40 px-3 py-2 text-xs font-semibold text-foreground">
                      Keyboard Shortcuts
                    </div>
                    <div className="divide-y divide-border/30">
                      {[
                        ["/", "Search nodes"],
                        ["Esc", "Close search / panel"],
                        ["+", "Zoom in"],
                        ["-", "Zoom out"],
                        ["0", "Fit view"],
                        ["F", "Toggle flat view"],
                      ].map(([key, desc]) => (
                        <div key={key} className="flex items-center justify-between px-3 py-1.5 text-xs">
                          <span className="text-foreground-muted">{desc}</span>
                          <kbd className="rounded border border-border/60 bg-surface-elevated px-1.5 py-0.5 font-mono text-[10px] text-foreground-subtle">
                            {key}
                          </kbd>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* Search results dropdown */}
            {showSearch && searchResults.length > 0 && (
              <div className="absolute left-0 top-full z-50 mt-1 w-64 overflow-hidden rounded-lg border border-border/60 bg-surface shadow-surface-lg">
                {searchResults.map((node) => {
                  const meta = deviceTypeMeta(node.node_type);
                  return (
                    <button
                      key={node.node_id}
                      onClick={() => handleSelectSearchResult(node)}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition-colors hover:bg-surface-hover"
                    >
                      <span
                        className="h-2 w-2 shrink-0 rounded-full"
                        style={{ backgroundColor: meta.color }}
                      />
                      <span className="truncate font-medium text-foreground">
                        {node.name || node.node_id}
                      </span>
                      {node.device_count != null && node.device_count > 0 && (
                        <span className="shrink-0 text-foreground-subtle">{node.device_count} dev</span>
                      )}
                      <span className="shrink-0 text-foreground-subtle">{meta.label}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {incidentId && (
            <button
              onClick={() => setPanelMode(panelMode === "incident" ? null : "incident")}
              className="inline-flex items-center gap-1.5 rounded-md border border-primary/30 bg-primary/5 px-3 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-primary/10"
            >
              <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
              Blast Radius
            </button>
          )}
        </div>

        {/* Right group: site jump, expand/collapse (multi-site only) + fit view */}
        <div className="flex items-center gap-2">
          {!singleSite && allSiteIds.length > 0 && (
            <select
              value=""
              onChange={(e) => { const v = e.target.value; if (v) jumpToSite(v); }}
              className="max-w-[140px] truncate rounded-md border border-border/60 bg-surface px-2 py-1.5 text-xs text-foreground-muted transition-colors hover:bg-surface-hover"
            >
              <option value="">Jump to site…</option>
              {allSiteIds.map((id) => (
                <option key={id} value={id}>{siteNames.get(id) || id}</option>
              ))}
            </select>
          )}
          {!singleSite && (
            <>
              <span className="text-xs text-foreground-subtle">
                {expandedSites.size === 0
                  ? "All sites collapsed"
                  : `${expandedSites.size}/${allSiteIds.length} sites expanded`}
              </span>
              <button
                onClick={collapseAll}
                disabled={expandedSites.size === 0}
                className="inline-flex items-center gap-1.5 rounded-md border border-border/60 px-2.5 py-1.5 text-xs font-medium text-foreground-muted transition-colors hover:bg-surface hover:text-foreground disabled:cursor-not-allowed disabled:opacity-30"
              >
                Collapse all
              </button>
              <button
                onClick={expandAll}
                disabled={expandedSites.size === allSiteIds.length}
                className="inline-flex items-center gap-1.5 rounded-md border border-border/60 px-2.5 py-1.5 text-xs font-medium text-foreground-muted transition-colors hover:bg-surface hover:text-foreground disabled:cursor-not-allowed disabled:opacity-30"
              >
                Expand all
              </button>
            </>
          )}
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
          <button
            onClick={onExportPng}
            className="inline-flex items-center gap-1.5 rounded-md border border-border/60 px-3 py-1.5 text-xs font-medium text-foreground-muted transition-colors hover:bg-surface hover:text-foreground"
            title="Export as PNG"
          >
            <Download className="h-3.5 w-3.5" />
            Export
          </button>
        </div>
      </div>

      {/* Graph */}
      <div className="relative">
        {isComputing && initialNodes.length > 0 && (
          <div className="absolute left-0 right-0 top-0 z-20 h-0.5 animate-pulse rounded-full bg-primary/50" />
        )}
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
            onlyRenderVisibleElements
            attributionPosition="bottom-left"
            connectionLineType={ConnectionLineType.SmoothStep}
            minZoom={0.1}
            maxZoom={4}
            deleteKeyCode={null}
            className="border border-border/40 bg-surface/20"
          >
            <Background color="hsl(var(--border) / 0.3)" gap={20} size={1} />
            <Controls
              className="!rounded-lg !border-border/60 !bg-surface !shadow-surface"
              showInteractive={false}
            />
          </ReactFlow>
        </div>
        <TopologySidePanel
          mode={panelMode}
          incidentId={incidentId}
          incidentDetail={incidentDetail ?? null}
          nodeDetail={nodeDetail ?? null}
          onClose={onPanelClose}
          incidentLoading={incidentLoading}
          nodeLoading={nodeLoading}
        />
      </div>
    </div>
  );
}
