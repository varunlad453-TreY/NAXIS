/**
 * Topology Toolbar
 *
 * Operational controls — minimal visual noise. No pill buttons, no card
 * containers. Controls grouped by function via whitespace and alignment.
 */

import {
  Search,
  LayoutTemplate,
  Filter,
  Maximize,
  RotateCcw,
  ZoomIn,
  ZoomOut,
  Route,
  Info,
  X,
  ChevronDown,
  MapPin,
} from "lucide-react";
import { useState, useRef, useEffect } from "react";
import { NODE_TYPE_META } from "@/types/topology";

export interface TopologyToolbarProps {
  totalNodes: number;
  totalEdges: number;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  searchResults: Array<{ node_id: string; name: string; node_type: string }>;
  onSelectSearchResult: (nodeId: string) => void;
  layoutMode: "hierarchical" | "readable" | "readable-lr" | "flat";
  onLayoutModeChange: (mode: "hierarchical" | "readable" | "readable-lr" | "flat") => void;
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

const layoutLabels: Record<string, string> = {
  readable: "Layered ↓",
  "readable-lr": "Layered →",
  hierarchical: "Auto",
  flat: "Flat",
};

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
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
      {/* Left: context + stats */}
      <div className="flex items-center gap-3">
        {isBackbone ? (
          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-600">
            Global Network
          </span>
        ) : (
          <>
            <button
              onClick={onBackToBackbone}
              className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-500 transition-colors hover:text-slate-300"
            >
              <MapPin className="h-3 w-3" />
              Global
            </button>
            <span className="text-slate-700">/</span>
            <span className="text-[11px] font-medium text-slate-300 truncate max-w-[200px]">
              {siteName || "Site"}
            </span>
          </>
        )}
        <span className="text-slate-600">
          {totalNodes}{" "}
          {isBackbone
            ? backboneViewMode === "regions"
              ? "hubs"
              : backboneViewMode === "degraded"
                ? "problem sites"
                : "sites"
            : "devices"}
          {" · "}{totalEdges} links
        </span>
      </div>

      {/* Backbone view mode */}
      {isBackbone && onBackboneViewModeChange && (
        <div className="flex items-center gap-0">
          {(["regions", "degraded", "all"] as const).map((mode) => (
            <button
              key={mode}
              onClick={() => onBackboneViewModeChange(mode)}
              className={[
                "px-2 py-1 text-[11px] font-medium transition-colors",
                backboneViewMode === mode
                  ? "text-white"
                  : "text-slate-500 hover:text-slate-300",
              ].join(" ")}
            >
              {mode === "regions" ? "Regional Hubs" : mode === "degraded" ? "Problem Sites" : "All Sites"}
            </button>
          ))}
        </div>
      )}

      {/* Right: tools */}
      <div className="ml-auto flex items-center gap-1">
        {/* Search */}
        <div ref={searchRef} className="relative">
          {showSearch ? (
            <div className="flex items-center gap-1">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => onSearchChange(e.target.value)}
                placeholder="Search device, IP, MAC..."
                className="w-48 bg-transparent border-b border-slate-700 px-1 py-1 text-[11px] text-slate-200 outline-none placeholder:text-slate-600 focus:border-slate-400"
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
                className="p-1 text-slate-600 hover:text-slate-300"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ) : (
            <button
              onClick={() => setShowSearch(true)}
              className="inline-flex items-center gap-1 p-1 text-slate-500 transition-colors hover:text-slate-300"
              title="Search"
            >
              <Search className="h-3.5 w-3.5" />
            </button>
          )}

          {showSearch && searchResults.length > 0 && searchQuery.trim().length >= 2 && (
            <div className="absolute left-0 top-full z-50 mt-1 w-64 overflow-hidden border border-slate-800 bg-slate-950">
              {searchResults.map((node) => {
                const meta = NODE_TYPE_META[node.node_type] ?? { label: node.node_type, color: "#6b7280" };
                return (
                  <button
                    key={node.node_id}
                    onClick={() => { onSelectSearchResult(node.node_id); setShowSearch(false); }}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition-colors hover:bg-slate-900"
                  >
                    <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: meta.color }} />
                    <span className="truncate font-medium text-slate-200">{node.name || node.node_id}</span>
                    <span className="ml-auto shrink-0 text-[10px] text-slate-600">{meta.label}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Layout */}
        <div className="relative">
          <button
            onClick={() => setShowLayoutMenu((v) => !v)}
            className="inline-flex items-center gap-1 p-1 text-[11px] text-slate-500 transition-colors hover:text-slate-300"
          >
            <LayoutTemplate className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">{layoutLabels[layoutMode]}</span>
            <ChevronDown className="h-3 w-3" />
          </button>
          {showLayoutMenu && (
            <div className="absolute right-0 top-full z-50 mt-1 w-40 overflow-hidden border border-slate-800 bg-slate-950">
              {(["readable", "readable-lr", "hierarchical", "flat"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => { onLayoutModeChange(m); setShowLayoutMenu(false); }}
                  className={`flex w-full items-center px-3 py-2 text-left text-xs transition-colors hover:bg-slate-900 ${layoutMode === m ? "text-white font-medium" : "text-slate-400"}`}
                >
                  {layoutLabels[m]}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Path trace */}
        <button
          onClick={onPathTrace}
          className={[
            "p-1 transition-colors",
            pathTraceActive ? "text-indigo-400" : "text-slate-500 hover:text-slate-300",
          ].join(" ")}
          title="Path Trace"
        >
          <Route className="h-3.5 w-3.5" />
        </button>

        <span className="h-3.5 w-px bg-slate-800 mx-1" />

        {/* Zoom */}
        <button
          onClick={onZoomIn}
          className="p-1 text-slate-500 transition-colors hover:text-slate-300"
          title="Zoom in"
        >
          <ZoomIn className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={onZoomOut}
          className="p-1 text-slate-500 transition-colors hover:text-slate-300"
          title="Zoom out"
        >
          <ZoomOut className="h-3.5 w-3.5" />
        </button>

        <button
          onClick={onFitView}
          className="p-1 text-slate-500 transition-colors hover:text-slate-300"
          title="Fit to view"
        >
          <Maximize className="h-3.5 w-3.5" />
        </button>

        <button
          onClick={onReset}
          className="p-1 text-slate-500 transition-colors hover:text-slate-300"
          title="Reset view"
        >
          <RotateCcw className="h-3.5 w-3.5" />
        </button>

        <button
          onClick={onRefresh}
          className="p-1 text-slate-500 transition-colors hover:text-slate-300"
          title="Refresh data"
        >
          <RotateCcw className="h-3.5 w-3.5" />
        </button>

        {/* Legend */}
        <button
          onClick={onToggleLegend}
          className={[
            "p-1 transition-colors",
            legendVisible ? "text-indigo-400" : "text-slate-500 hover:text-slate-300",
          ].join(" ")}
          title="Toggle legend"
        >
          <Info className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
