/**
 * Topology Toolbar
 *
 * Professional controls for the topology visualization.
 * Only includes functional controls.
 */

import {
  Search,
  LayoutTemplate,
  Filter,
  Maximize,
  RotateCcw,
  ZoomIn,
  ZoomOut,
  Fullscreen,
  Route,
  Info,
  X,
  ChevronDown,
  MapPin,
} from "lucide-react";
import { useState, useRef, useEffect, useCallback } from "react";
import { NODE_TYPE_META, HEALTH_STATUS_META } from "@/types/topology";

export interface TopologyToolbarProps {
  totalNodes: number;
  totalEdges: number;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  searchResults: Array<{ node_id: string; name: string; node_type: string }>;
  onSelectSearchResult: (nodeId: string) => void;
  layoutMode: "hierarchical" | "flat";
  onLayoutModeChange: (mode: "hierarchical" | "flat") => void;
  activeFilters: Set<string>;
  onToggleFilter: (type: string) => void;
  onFitView: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onReset: () => void;
  onRefresh: () => void;
  onPathTrace: () => void;
  pathTraceActive: boolean;
  onToggleLegend: () => void;
  legendVisible: boolean;
  isBackbone: boolean;
  onBackToBackbone?: () => void;
  siteName?: string;
  backboneViewMode?: "regions" | "degraded" | "all";
  onBackboneViewModeChange?: (mode: "regions" | "degraded" | "all") => void;
}


export function TopologyToolbar({
  totalNodes,
  totalEdges,
  searchQuery,
  onSearchChange,
  searchResults,
  onSelectSearchResult,
  layoutMode,
  onLayoutModeChange,
  activeFilters,
  onToggleFilter,
  onFitView,
  onZoomIn,
  onZoomOut,
  onReset,
  onRefresh,
  onPathTrace,
  pathTraceActive,
  onToggleLegend,
  legendVisible,
  isBackbone,
  onBackToBackbone,
  siteName,
  backboneViewMode = "regions",
  onBackboneViewModeChange,
}: TopologyToolbarProps) {

  const [showSearch, setShowSearch] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [showLayoutMenu, setShowLayoutMenu] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (searchRef.current && !searchRef.current.contains(event.target as Node)) {
        setShowSearch(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const allTypes = Object.keys(NODE_TYPE_META);

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      {/* Breadcrumb / back */}
      <div className="flex items-center gap-2 mr-2">
        {isBackbone ? (
          <span className="text-[11px] font-semibold uppercase tracking-wider text-foreground-subtle">
            Global Network
          </span>
        ) : (
          <>
            <button
              onClick={onBackToBackbone}
              className="inline-flex items-center gap-1 rounded-md border border-border/60 px-2 py-1 text-[11px] font-medium text-foreground-muted transition-colors hover:bg-surface hover:text-foreground"
            >
              <MapPin className="h-3 w-3" />
              Global
            </button>
            <span className="text-border">/</span>
            <span className="text-[11px] font-medium text-foreground truncate max-w-[200px]">
              {siteName || "Site"}
            </span>
          </>
        )}
      </div>

      <span className="h-4 w-px bg-border/60" />

      {/* Stats */}
      <span className="text-[11px] text-foreground-muted whitespace-nowrap font-medium">
        {totalNodes}{" "}
        {isBackbone && backboneViewMode === "regions"
          ? "regional hubs"
          : isBackbone && backboneViewMode === "degraded"
            ? "problem sites"
            : "sites"}{" "}
        · {totalEdges} links
      </span>


      {/* Backbone View Mode Switcher */}
      {isBackbone && onBackboneViewModeChange && (
        <>
          <span className="h-4 w-px bg-border/60" />
          <div className="flex items-center gap-1 rounded-lg border border-border/60 bg-surface/80 p-0.5">
            <button
              onClick={() => onBackboneViewModeChange("regions")}
              className={`rounded px-2.5 py-1 text-[11px] font-medium transition-all ${backboneViewMode === "regions"
                  ? "bg-primary text-white shadow-sm"
                  : "text-foreground-muted hover:text-foreground"
                }`}
            >
              Regional Hubs
            </button>
            <button
              onClick={() => onBackboneViewModeChange("degraded")}
              className={`rounded px-2.5 py-1 text-[11px] font-medium transition-all ${backboneViewMode === "degraded"
                  ? "bg-warning/20 text-warning border border-warning/30 font-semibold"
                  : "text-foreground-muted hover:text-foreground"
                }`}
            >
              Problem Sites
            </button>
            <button
              onClick={() => onBackboneViewModeChange("all")}
              className={`rounded px-2.5 py-1 text-[11px] font-medium transition-all ${backboneViewMode === "all"
                  ? "bg-primary text-white shadow-sm"
                  : "text-foreground-muted hover:text-foreground"
                }`}
            >
              All Sites (153)
            </button>
          </div>
        </>
      )}


      <span className="h-4 w-px bg-border/60" />

      {/* Search */}
      <div ref={searchRef} className="relative">
        {showSearch ? (
          <div className="flex items-center gap-1">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Search device, IP, MAC..."
              className="w-48 rounded-md border border-border/60 bg-surface px-2.5 py-1 text-[11px] text-foreground outline-none placeholder:text-foreground-subtle focus:border-primary/50"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setShowSearch(false);
                  onSearchChange("");
                }
                if (e.key === "Enter" && searchResults.length > 0) {
                  onSelectSearchResult(searchResults[0].node_id);
                  setShowSearch(false);
                }
              }}
            />
            <button
              onClick={() => { setShowSearch(false); onSearchChange(""); }}
              className="rounded p-1 text-foreground-muted hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : (
          <button
            onClick={() => setShowSearch(true)}
            className="inline-flex items-center gap-1.5 rounded-md border border-border/60 px-2.5 py-1 text-[11px] font-medium text-foreground-muted transition-colors hover:bg-surface hover:text-foreground"
            title="Search"
          >
            <Search className="h-3.5 w-3.5" />
            Search
          </button>
        )}

        {showSearch && searchResults.length > 0 && searchQuery.trim().length >= 2 && (
          <div className="absolute left-0 top-full z-50 mt-1 w-64 overflow-hidden rounded-lg border border-border/60 bg-surface shadow-lg">
            {searchResults.map((node) => {
              const meta = NODE_TYPE_META[node.node_type] ?? { label: node.node_type, color: "#6b7280" };
              return (
                <button
                  key={node.node_id}
                  onClick={() => { onSelectSearchResult(node.node_id); setShowSearch(false); }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition-colors hover:bg-surface-hover"
                >
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: meta.color }} />
                  <span className="truncate font-medium text-foreground">{node.name || node.node_id}</span>
                  <span className="ml-auto shrink-0 text-[10px] text-foreground-subtle">{meta.label}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Layout mode */}
      <div className="relative">
        <button
          onClick={() => setShowLayoutMenu((v) => !v)}
          className="inline-flex items-center gap-1.5 rounded-md border border-border/60 px-2.5 py-1 text-[11px] font-medium text-foreground-muted transition-colors hover:bg-surface hover:text-foreground"
        >
          <LayoutTemplate className="h-3.5 w-3.5" />
          {layoutMode === "hierarchical" ? "Hierarchical" : "Flat"}
          <ChevronDown className="h-3 w-3" />
        </button>
        {showLayoutMenu && (
          <div className="absolute left-0 top-full z-50 mt-1 w-40 overflow-hidden rounded-lg border border-border/60 bg-surface shadow-lg">
            <button
              onClick={() => { onLayoutModeChange("hierarchical"); setShowLayoutMenu(false); }}
              className={`flex w-full items-center px-3 py-2 text-left text-xs transition-colors hover:bg-surface-hover ${layoutMode === "hierarchical" ? "bg-primary/5 text-primary font-medium" : "text-foreground"}`}
            >
              Hierarchical
            </button>
            <button
              onClick={() => { onLayoutModeChange("flat"); setShowLayoutMenu(false); }}
              className={`flex w-full items-center px-3 py-2 text-left text-xs transition-colors hover:bg-surface-hover ${layoutMode === "flat" ? "bg-primary/5 text-primary font-medium" : "text-foreground"}`}
            >
              Flat
            </button>
          </div>
        )}
      </div>

      {/* Filters */}
      <div className="relative">
        <button
          onClick={() => setShowFilters((v) => !v)}
          className={[
            "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[11px] font-medium transition-colors",
            activeFilters.size < allTypes.length
              ? "border-primary/30 bg-primary/5 text-primary"
              : "border-border/60 text-foreground-muted hover:bg-surface hover:text-foreground",
          ].join(" ")}
        >
          <Filter className="h-3.5 w-3.5" />
          Filters {activeFilters.size < allTypes.length && `(${activeFilters.size})`}
        </button>
        {showFilters && (
          <div className="absolute left-0 top-full z-50 mt-1 w-56 overflow-hidden rounded-lg border border-border/60 bg-surface shadow-lg">
            <div className="border-b border-border/40 px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-foreground-subtle">
              Device Types
            </div>
            <div className="max-h-64 overflow-y-auto p-2">
              {allTypes.map((type) => {
                const meta = NODE_TYPE_META[type];
                const isActive = activeFilters.has(type);
                return (
                  <button
                    key={type}
                    onClick={() => onToggleFilter(type)}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-surface-hover"
                  >
                    <span
                      className={["h-2 w-2 rounded-full", isActive ? "" : "opacity-30"].join(" ")}
                      style={{ backgroundColor: meta.color }}
                    />
                    <span className={isActive ? "text-foreground" : "text-foreground-subtle"}>
                      {meta.label}
                    </span>
                  </button>
                );
              })}
            </div>
            <div className="border-t border-border/40 px-3 py-2">
              <button
                onClick={() => { allTypes.forEach(onToggleFilter); }}
                className="text-[10px] text-primary hover:underline"
              >
                Reset filters
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Path trace */}
      <button
        onClick={onPathTrace}
        className={[
          "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[11px] font-medium transition-colors",
          pathTraceActive
            ? "border-primary/30 bg-primary/5 text-primary"
            : "border-border/60 text-foreground-muted hover:bg-surface hover:text-foreground",
        ].join(" ")}
        title="Path Trace"
      >
        <Route className="h-3.5 w-3.5" />
        Path
      </button>

      <span className="h-4 w-px bg-border/60" />

      {/* Zoom controls */}
      <div className="flex items-center gap-1">
        <button
          onClick={onZoomIn}
          className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border/60 text-foreground-muted transition-colors hover:bg-surface hover:text-foreground"
          title="Zoom in"
        >
          <ZoomIn className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={onZoomOut}
          className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border/60 text-foreground-muted transition-colors hover:bg-surface hover:text-foreground"
          title="Zoom out"
        >
          <ZoomOut className="h-3.5 w-3.5" />
        </button>
      </div>

      <button
        onClick={onFitView}
        className="inline-flex items-center gap-1.5 rounded-md border border-border/60 px-2.5 py-1 text-[11px] font-medium text-foreground-muted transition-colors hover:bg-surface hover:text-foreground"
        title="Fit to view"
      >
        <Maximize className="h-3.5 w-3.5" />
        Fit
      </button>

      <button
        onClick={onReset}
        className="inline-flex items-center gap-1.5 rounded-md border border-border/60 px-2.5 py-1 text-[11px] font-medium text-foreground-muted transition-colors hover:bg-surface hover:text-foreground"
        title="Reset view"
      >
        <RotateCcw className="h-3.5 w-3.5" />
      </button>

      <button
        onClick={onRefresh}
        className="inline-flex items-center gap-1.5 rounded-md border border-border/60 px-2.5 py-1 text-[11px] font-medium text-foreground-muted transition-colors hover:bg-surface hover:text-foreground"
        title="Refresh data"
      >
        <RotateCcw className="h-3.5 w-3.5" />
      </button>

      {/* Legend toggle */}
      <button
        onClick={onToggleLegend}
        className={[
          "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[11px] font-medium transition-colors",
          legendVisible
            ? "border-primary/30 bg-primary/5 text-primary"
            : "border-border/60 text-foreground-muted hover:bg-surface hover:text-foreground",
        ].join(" ")}
        title="Toggle legend"
      >
        <Info className="h-3.5 w-3.5" />
        Legend
      </button>
    </div>
  );
}
