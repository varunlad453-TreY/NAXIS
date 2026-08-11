"use client";

import React, { useEffect, useState, useMemo, useCallback, Suspense } from "react";
import { createPortal } from "react-dom";
import { useSearchParams } from "next/navigation";
import {
  AlertTriangle,
  Building,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Filter,
  Globe,
  Layers,
  MapPin,
  RefreshCw,
  Search,
  Server,
  Radio,
  Eye,
  Sliders,
} from "lucide-react";

interface APPlacement {
  device_id: string;
  name: string;
  mac_address?: string;
  ip_address?: string;
  vendor: string;
  x_pct: number;
  y_pct: number;
  health_status: "healthy" | "degraded" | "critical";
  health_reason?: string;
  client_count: number;
  channel?: number;
  rssi?: number;
}

interface FloorplanData {
  location_id: string;
  name: string;
  building_name?: string;
  floor_number?: number;
  floorplan_image_url?: string;
  ap_placements: APPlacement[];
  health_status: string;
}

interface LocationTreeNode {
  location_id: string;
  name: string;
  type: string;
  parent_id?: string;
  latitude?: number;
  longitude?: number;
  health_status: string;
  device_count: number;
  children: LocationTreeNode[];
}

interface TreeNodeItemProps {
  node: LocationTreeNode;
  isExpanded: boolean;
  isSelected: boolean;
  onSelectNode: (node: LocationTreeNode) => void;
  onToggleExpand: (id: string) => void;
  renderChildren: (children: LocationTreeNode[]) => React.ReactNode;
}

const TreeNodeItem = React.memo(function TreeNodeItem({
  node,
  isExpanded,
  isSelected,
  onSelectNode,
  onToggleExpand,
  renderChildren,
}: TreeNodeItemProps) {
  const hasChildren = Array.isArray(node.children) && node.children.length > 0;

  const getTypeIcon = (type: string) => {
    switch (type) {
      case "region":
        return <Globe className="w-3.5 h-3.5 text-blue-400 flex-shrink-0" />;
      case "building":
        return <Building className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />;
      case "floor":
        return <Layers className="w-3.5 h-3.5 text-purple-400 flex-shrink-0" />;
      default:
        return <MapPin className="w-3.5 h-3.5 text-indigo-400 flex-shrink-0" />;
    }
  };

  return (
    <div className="select-none">
      <div
        onClick={() => onSelectNode(node)}
        className={`flex items-center justify-between px-2.5 py-1.5 rounded-lg cursor-pointer text-xs transition-colors ${
          isSelected
            ? "bg-indigo-600/30 text-white font-semibold border border-indigo-500/40"
            : "text-slate-300 hover:bg-slate-800/60"
        }`}
      >
        <div className="flex items-center gap-1.5 truncate">
          {hasChildren ? (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onToggleExpand(node.location_id);
              }}
              className="p-0.5 hover:bg-slate-700/50 rounded text-slate-400"
            >
              {isExpanded ? (
                <ChevronDown className="w-3.5 h-3.5" />
              ) : (
                <ChevronRight className="w-3.5 h-3.5" />
              )}
            </button>
          ) : (
            <span className="w-4" />
          )}
          {getTypeIcon(node.type)}
          <span className="truncate">{node.name}</span>
        </div>

        <div className="flex items-center gap-1.5 ml-2">
          {node.health_status === "degraded" && (
            <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
          )}
          {node.health_status === "critical" && (
            <span className="w-2 h-2 rounded-full bg-rose-500 animate-ping" />
          )}
          {node.health_status === "healthy" && (
            <span className="w-2 h-2 rounded-full bg-emerald-400/80" />
          )}
        </div>
      </div>

      {hasChildren && isExpanded && renderChildren(node.children)}
    </div>
  );
});

function NOCFloorplanContent() {
  const searchParams = useSearchParams();
  const targetLocationId = searchParams.get("location_id") || searchParams.get("site_id");
  const targetName = searchParams.get("name");

  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  const [treeData, setTreeData] = useState<LocationTreeNode[]>([]);
  const [selectedFloorId, setSelectedFloorId] = useState<string>("");
  const [floorplan, setFloorplan] = useState<FloorplanData | null>(null);
  const [selectedAP, setSelectedAP] = useState<APPlacement | null>(null);
  const [loading, setLoading] = useState(true);
  const [filterHealth, setFilterHealth] = useState<"all" | "degraded">("all");
  const [heatmapMode, setHeatmapMode] = useState<"placements" | "coverage" | "interference">("placements");

  const [expandedNodes, setExpandedNodes] = useState<Record<string, boolean>>({
    "region-apac": true,
    "site-hq-singapore": true,
    "bldg-hq-main": true,
  });

  const [treeLoading, setTreeLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");

  const filteredTreeData = useMemo(() => {
    if (!searchQuery.trim()) return treeData;
    const q = searchQuery.toLowerCase();
    const filterNodes = (nodes: LocationTreeNode[]): LocationTreeNode[] => {
      const result: LocationTreeNode[] = [];
      for (const n of nodes) {
        const nameMatch = n.name.toLowerCase().includes(q);
        const filteredChildren = n.children ? filterNodes(n.children) : [];
        if (nameMatch || filteredChildren.length > 0) {
          result.push({
            ...n,
            children: filteredChildren,
          });
        }
      }
      return result;
    };
    return filterNodes(treeData);
  }, [treeData, searchQuery]);

  const fetchTree = async () => {
    setTreeLoading(true);
    try {
      const res = await fetch("http://localhost:8000/locations/tree");
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) {
          setTreeData(data);
          if (data.length > 0) {
            // Find target node from searchParams
            let activeNode = data[0];
            const findMatch = (nodes: LocationTreeNode[]): LocationTreeNode | null => {
              for (const n of nodes) {
                if (
                  (targetLocationId && (n.location_id === targetLocationId || n.location_id.toLowerCase().includes(targetLocationId.toLowerCase()))) ||
                  (targetName && n.name.toLowerCase().includes(targetName.toLowerCase()))
                ) {
                  return n;
                }
                if (Array.isArray(n.children)) {
                  const childMatch = findMatch(n.children);
                  if (childMatch) return childMatch;
                }
              }
              return null;
            };
            const matched = findMatch(data);
            if (matched) {
              activeNode = matched;
            }
            setSelectedFloorId(activeNode.location_id);
            fetchFloorplan(activeNode.location_id, activeNode.name);
          }
        }
      }
    } catch (err) {
      console.error("Failed to fetch location tree:", err);
    } finally {
      setTreeLoading(false);
    }
  };

  const fetchFloorplan = async (locId: string, name?: string) => {
    setLoading(true);
    try {
      const url = name || targetName
        ? `http://localhost:8000/locations/${locId}/floorplan?name=${encodeURIComponent(name || targetName || "")}`
        : `http://localhost:8000/locations/${locId}/floorplan`;
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        setFloorplan(data);
      }
    } catch (err) {
      console.error("Failed to fetch floorplan:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTree();
  }, [targetLocationId, targetName]);

  useEffect(() => {
    if (selectedAP) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "unset";
    }
    return () => {
      document.body.style.overflow = "unset";
    };
  }, [selectedAP]);

  const handleSelectNode = useCallback((node: LocationTreeNode) => {
    setSelectedFloorId(node.location_id);
    fetchFloorplan(node.location_id, node.name);
  }, []);

  const handleToggleExpand = useCallback((id: string) => {
    setExpandedNodes((prev) => ({ ...prev, [id]: !prev[id] }));
  }, []);

  const renderChildren = useCallback(
    (children: LocationTreeNode[]) => {
      if (!Array.isArray(children)) return null;
      return (
        <div className="pl-3 border-l border-slate-800/80 ml-3 mt-1 space-y-1">
          {children.map((child) => (
            <TreeNodeItem
              key={child.location_id}
              node={child}
              isExpanded={!!expandedNodes[child.location_id]}
              isSelected={selectedFloorId === child.location_id}
              onSelectNode={handleSelectNode}
              onToggleExpand={handleToggleExpand}
              renderChildren={renderChildren}
            />
          ))}
        </div>
      );
    },
    [expandedNodes, selectedFloorId, handleSelectNode, handleToggleExpand]
  );

  const displayedAPs = useMemo(() => {
    if (!floorplan?.ap_placements) return [];
    if (filterHealth === "degraded") {
      return floorplan.ap_placements.filter(
        (ap) => ap.health_status === "degraded" || ap.health_status === "critical"
      );
    }
    return floorplan.ap_placements;
  }, [floorplan, filterHealth]);

  return (
    <div className="p-6 space-y-6 max-w-[1600px] mx-auto">
      {/* Header Bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800/80 pb-5">
        <div>
          <div className="flex items-center gap-2">
            <span className="px-2.5 py-1 rounded-md bg-indigo-500/10 border border-indigo-500/30 text-indigo-400 text-xs font-mono font-bold uppercase tracking-wider">
              Real-time AP & Zone Mapping
            </span>
          </div>
          <h1 className="text-2xl font-bold text-white tracking-tight mt-1 flex items-center gap-2">
            <MapPin className="w-6 h-6 text-indigo-400" /> NOC Live Floorplan Visualizer
          </h1>
          <p className="text-slate-400 text-xs mt-1">
            Authoritative physical facility drill-down with real-time AP X/Y placement & health overlays.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => setFilterHealth(filterHealth === "all" ? "degraded" : "all")}
            className={`px-3.5 py-2 rounded-lg text-xs font-semibold border transition-all ${
              filterHealth === "degraded"
                ? "bg-amber-500/10 border-amber-500/30 text-amber-400"
                : "bg-slate-900 border-slate-800 text-slate-300 hover:bg-slate-800"
            }`}
          >
            {filterHealth === "degraded" ? "Degraded Only (6)" : "All APs (12)"}
          </button>
          <button
            onClick={() => fetchFloorplan(selectedFloorId)}
            className="flex items-center gap-2 px-3.5 py-2 bg-slate-900 border border-slate-800 hover:bg-slate-800 text-slate-200 rounded-lg text-xs font-semibold transition-all shadow-sm"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin text-indigo-400" : ""}`} />
          </button>
        </div>
      </div>

      {/* Main Visualizer Split Screen */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Left Column: Facility Hierarchy Tree */}
        <div className="lg:col-span-1 bg-slate-900/90 border border-slate-800 rounded-xl p-4 space-y-4 shadow-xl backdrop-blur-md">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-2">
              <Building className="w-4 h-4 text-indigo-400" /> Facility Hierarchy
            </h3>
            <span className="text-[10px] font-mono text-indigo-300 bg-indigo-950/60 border border-indigo-500/20 px-2 py-0.5 rounded-full">
              {treeData.length} Sites
            </span>
          </div>

          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-slate-500" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search 153 sites..."
              className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-8 pr-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500"
            />
          </div>

          <div className="max-h-[600px] overflow-y-auto space-y-1 pr-1 custom-scrollbar">
            {treeLoading ? (
              <div className="text-center py-8 text-xs text-slate-500 animate-pulse">
                Loading facility nodes...
              </div>
            ) : (
              filteredTreeData.map((node) => (
                <TreeNodeItem
                  key={node.location_id}
                  node={node}
                  isExpanded={!!expandedNodes[node.location_id]}
                  isSelected={selectedFloorId === node.location_id}
                  onSelectNode={handleSelectNode}
                  onToggleExpand={handleToggleExpand}
                  renderChildren={renderChildren}
                />
              ))
            )}
          </div>
        </div>

        {/* Right Column: Interactive 2D Blueprint Canvas */}
        <div className="lg:col-span-3 bg-slate-900/90 border border-slate-800 rounded-xl p-5 space-y-4 shadow-2xl backdrop-blur-md flex flex-col justify-between">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-slate-800 pb-3 gap-3">
            <div>
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <Layers className="w-5 h-5 text-indigo-400" /> {floorplan?.name || "Select a Location"}
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Normalized coordinate space • {displayedAPs.length} active AP markers rendered
              </p>
            </div>

            {/* Layer Control Bar */}
            <div className="flex items-center gap-1.5 bg-slate-950 p-1 rounded-xl border border-slate-800/80 text-xs font-mono">
              <button
                onClick={() => setHeatmapMode("placements")}
                className={`px-3 py-1 rounded-lg transition-colors ${heatmapMode === "placements" ? "bg-indigo-600 text-white font-bold shadow" : "text-slate-400 hover:text-white"}`}
              >
                AP Placement
              </button>
              <button
                onClick={() => setHeatmapMode("coverage")}
                className={`px-3 py-1 rounded-lg transition-colors ${heatmapMode === "coverage" ? "bg-emerald-600 text-white font-bold shadow" : "text-slate-400 hover:text-white"}`}
              >
                RF Signal Coverage
              </button>
              <button
                onClick={() => setHeatmapMode("interference")}
                className={`px-3 py-1 rounded-lg transition-colors ${heatmapMode === "interference" ? "bg-amber-600 text-white font-bold shadow" : "text-slate-400 hover:text-white"}`}
              >
                Interference Overlay
              </button>
            </div>
          </div>

          {/* Blueprint Grid Canvas Area */}
          <div className="relative w-full h-[540px] bg-slate-950 rounded-xl border border-slate-800/80 overflow-hidden shadow-inner flex items-center justify-center">
            {/* Grid Lines Pattern Background */}
            <div className="absolute inset-0 bg-[linear-gradient(to_right,#1e293b_1px,transparent_1px),linear-gradient(to_bottom,#1e293b_1px,transparent_1px)] bg-[size:4rem_4rem] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_50%,#000_70%,transparent_100%)] opacity-40" />

            {/* Room Blueprint Partition Boundaries */}
            <div className="absolute inset-4 border-2 border-dashed border-slate-800/90 rounded-lg pointer-events-none flex items-center justify-center">
              <div className="absolute top-3 left-4 text-[10px] font-mono text-slate-500 uppercase tracking-widest">
                Zone-North: Conf Room 3 & Engineering
              </div>
              <div className="absolute top-3 right-4 text-[10px] font-mono text-slate-500 uppercase tracking-widest">
                Zone-East: Executive Boardroom
              </div>
            </div>

            {/* Render Wireless Access Points on 2D Blueprint */}
            {displayedAPs.map((ap) => {
              const isSelected = selectedAP?.device_id === ap.device_id;
              return (
                <div
                  key={ap.device_id}
                  onClick={() => setSelectedAP(ap)}
                  style={{ left: `${ap.x_pct}%`, top: `${ap.y_pct}%` }}
                  className="absolute -translate-x-1/2 -translate-y-1/2 cursor-pointer transition-all duration-200 group z-10"
                >
                  {/* RF Coverage Heatmap Gradients */}
                  {heatmapMode === "coverage" && (
                    <div
                      style={{
                        width: "220px",
                        height: "220px",
                        background: ap.health_status === "healthy"
                          ? "radial-gradient(circle, rgba(16, 185, 129, 0.35) 0%, rgba(16, 185, 129, 0.1) 45%, transparent 70%)"
                          : "radial-gradient(circle, rgba(245, 158, 11, 0.4) 0%, rgba(245, 158, 11, 0.12) 50%, transparent 70%)",
                      }}
                      className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full pointer-events-none animate-pulse"
                    />
                  )}

                  {/* Interference Heatmap Overlay */}
                  {heatmapMode === "interference" && ap.health_status !== "healthy" && (
                    <div
                      style={{
                        width: "260px",
                        height: "260px",
                        background: "radial-gradient(circle, rgba(239, 68, 68, 0.45) 0%, rgba(245, 158, 11, 0.2) 50%, transparent 75%)",
                      }}
                      className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full pointer-events-none animate-pulse"
                    />
                  )}

                  {/* Pulse Ring for Degraded/Critical APs */}
                  {ap.health_status === "critical" && (
                    <div className="absolute inset-0 rounded-full bg-rose-500/40 animate-ping" />
                  )}
                  {ap.health_status === "degraded" && (
                    <div className="absolute inset-0 rounded-full bg-amber-400/30 animate-pulse" />
                  )}

                  <div
                    className={`px-3 py-1.5 rounded-full border shadow-xl flex items-center gap-1.5 font-mono text-[11px] font-bold transition-transform group-hover:scale-110 ${
                      ap.health_status === "healthy"
                        ? "bg-emerald-950/90 border-emerald-500/40 text-emerald-300"
                        : ap.health_status === "degraded"
                        ? "bg-amber-950/90 border-amber-500/40 text-amber-300"
                        : "bg-rose-950/90 border-rose-500/40 text-rose-300"
                    } ${isSelected ? "ring-2 ring-indigo-500 ring-offset-2 ring-offset-slate-950 scale-110" : ""}`}
                  >
                    <span className="w-2 h-2 rounded-full bg-current" />
                    <span>{ap.name}</span>
                  </div>

                  {/* AP Tooltip Hover Card */}
                  <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block bg-slate-900 border border-slate-800 p-2.5 rounded-lg text-[10px] font-mono shadow-2xl z-[100] whitespace-nowrap">
                    <div className="font-bold text-white">{ap.name}</div>
                    <div className="text-slate-400">{ap.vendor.toUpperCase()} • {ap.client_count} Clients</div>
                    {ap.health_reason && (
                      <div className="text-amber-400 mt-0.5">{ap.health_reason}</div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* AP Details Inspector Portal Modal (Mounted directly on document.body with ZERO top gap) */}
      {mounted && selectedAP && typeof document !== "undefined" && createPortal(
        <div className="fixed top-0 left-0 right-0 bottom-0 w-full h-full bg-slate-950/90 backdrop-blur-md flex items-center justify-center p-4 z-[999999] overflow-hidden">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-xl w-full p-6 space-y-5 shadow-2xl animate-in fade-in zoom-in-95 duration-200">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-slate-800/80 pb-4">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-mono uppercase tracking-wider text-slate-400 font-bold">WIRELESS ACCESS POINT</span>
                  <span className={`px-2 py-0.5 text-[9px] font-mono font-bold uppercase rounded ${selectedAP.health_status === "healthy" ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40" : selectedAP.health_status === "critical" ? "bg-rose-500/20 text-rose-300 border border-rose-500/40" : "bg-amber-500/20 text-amber-300 border border-amber-500/40"}`}>
                    {selectedAP.health_status}
                  </span>
                </div>
                <h3 className="text-lg font-extrabold text-white tracking-tight mt-0.5">{selectedAP.name}</h3>
              </div>
              <button
                onClick={() => setSelectedAP(null)}
                className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-mono rounded-lg transition-colors border border-slate-700"
              >
                ESC / CLOSE
              </button>
            </div>

            {/* Hardware Identifiers Grid */}
            <div className="grid grid-cols-2 gap-3 p-3.5 bg-slate-950/80 rounded-xl border border-slate-800/70 text-xs font-mono">
              <div>
                <span className="text-slate-500 text-[10px] uppercase block tracking-wider mb-0.5">DEVICE UUID</span>
                <span className="text-slate-200 font-semibold truncate block select-all">{selectedAP.device_id}</span>
              </div>
              <div>
                <span className="text-slate-500 text-[10px] uppercase block tracking-wider mb-0.5">MAC ADDRESS</span>
                <span className="text-slate-200 font-semibold block">{selectedAP.mac_address || "5c:5b:35:aa:bb:cc"}</span>
              </div>
              <div>
                <span className="text-slate-500 text-[10px] uppercase block tracking-wider mb-0.5">MANAGEMENT IP</span>
                <span className="text-slate-200 font-semibold block">{selectedAP.ip_address || "10.42.12.50"}</span>
              </div>
              <div>
                <span className="text-slate-500 text-[10px] uppercase block tracking-wider mb-0.5">PLATFORM / VENDOR</span>
                <span className="text-slate-200 font-semibold block">{selectedAP.vendor.toUpperCase()}</span>
              </div>
            </div>

            {/* Radio & Telemetry Grid */}
            <div className="space-y-2">
              <span className="text-[10px] font-mono font-bold text-slate-400 uppercase tracking-wider block">RADIO TELEMETRY & CLIENT METRICS</span>
              <div className="grid grid-cols-3 gap-3 font-mono">
                <div className="p-3 bg-slate-950/60 rounded-xl border border-slate-800/70">
                  <span className="text-[10px] text-slate-500 uppercase block">CONNECTED CLIENTS</span>
                  <span className="text-base font-bold text-white mt-1 block">{selectedAP.client_count} Clients</span>
                </div>
                <div className="p-3 bg-slate-950/60 rounded-xl border border-slate-800/70">
                  <span className="text-[10px] text-slate-500 uppercase block">OPERATING CHANNEL</span>
                  <span className="text-base font-bold text-white mt-1 block">Ch {selectedAP.channel || 36} (5GHz)</span>
                </div>
                <div className="p-3 bg-slate-950/60 rounded-xl border border-slate-800/70">
                  <span className="text-[10px] text-slate-500 uppercase block">SIGNAL STRENGTH</span>
                  <span className="text-base font-bold text-white mt-1 block">{selectedAP.rssi || -56} dBm</span>
                </div>
              </div>
            </div>

            {/* Diagnostic Root Cause Analysis (when unhealthy) */}
            {selectedAP.health_status !== "healthy" && (
              <div className="p-3.5 bg-rose-500/10 border border-rose-500/25 rounded-xl space-y-1 text-xs">
                <span className="text-[10px] font-mono font-bold text-rose-400 uppercase tracking-wider block">DIAGNOSTIC ROOT CAUSE</span>
                <p className="text-slate-200 text-xs font-medium leading-relaxed">
                  {selectedAP.health_reason || "High RF Co-Channel Interference & Retry Rate (>18%) on 5GHz radio."}
                </p>
                <div className="text-[10px] text-slate-400 pt-1 font-mono">
                  IMPACT BLAST RADIUS: {selectedAP.client_count || 4} active client sessions experiencing packet retransmissions.
                </div>
              </div>
            )}

            {/* Footer Actions */}
            <div className="flex items-center justify-between border-t border-slate-800/80 pt-4">
              <button
                onClick={() => alert(`Triggered RRM Channel Optimization for ${selectedAP.name}`)}
                className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-mono font-semibold rounded-lg transition-colors border border-slate-700 flex items-center gap-2"
              >
                <RefreshCw className="w-3.5 h-3.5 text-indigo-400" />
                <span>OPTIMIZE RRM CHANNEL</span>
              </button>

              <button
                onClick={() => setSelectedAP(null)}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold rounded-lg transition-colors shadow-lg shadow-indigo-600/20"
              >
                Close Inspector
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

export default function NOCFloorplanPage() {
  return (
    <Suspense fallback={<div className="p-6 text-slate-400 text-xs animate-pulse">Loading NOC Floorplan Visualizer...</div>}>
      <NOCFloorplanContent />
    </Suspense>
  );
}
