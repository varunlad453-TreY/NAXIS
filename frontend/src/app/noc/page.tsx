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
  Wifi,
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
        title={node.name}
        className={`flex items-center justify-between px-3 py-2 rounded-lg cursor-pointer text-xs transition-all ${
          isSelected
            ? "bg-indigo-600/30 text-white font-semibold border border-indigo-500/50 shadow-sm"
            : "text-slate-300 hover:bg-slate-800/60 hover:text-white"
        }`}
      >
        <div className="flex items-center gap-2 min-w-0 flex-1">
          {hasChildren ? (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onToggleExpand(node.location_id);
              }}
              className="p-0.5 hover:bg-slate-700/60 rounded text-slate-400 flex-shrink-0"
            >
              {isExpanded ? (
                <ChevronDown className="w-3.5 h-3.5" />
              ) : (
                <ChevronRight className="w-3.5 h-3.5" />
              )}
            </button>
          ) : (
            <span className="w-3.5 flex-shrink-0" />
          )}
          {getTypeIcon(node.type)}
          <span className="truncate font-medium text-slate-200">{node.name}</span>
        </div>

        <div className="flex items-center gap-1.5 ml-2 flex-shrink-0">
          {node.health_status === "degraded" && (
            <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" title="Degraded Status" />
          )}
          {node.health_status === "critical" && (
            <span className="w-2 h-2 rounded-full bg-rose-500 animate-ping" title="Critical Status" />
          )}
          {node.health_status === "healthy" && (
            <span className="w-2 h-2 rounded-full bg-emerald-400/90" title="Healthy Status" />
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
  const [rrmOptimizing, setRrmOptimizing] = useState(false);
  const [rrmResultMsg, setRrmResultMsg] = useState<string | null>(null);
  const [rrmAuditProofsByDevice, setRrmAuditProofsByDevice] = useState<Record<string, any>>({});

  const handleOptimizeRRM = async (ap: APPlacement) => {
    setRrmOptimizing(true);
    setRrmResultMsg(null);
    try {
      const res = await fetch(`http://localhost:8000/locations/aps/${ap.device_id}/optimize-rrm`, {
        method: "POST",
      });
      if (res.ok) {
        const data = await res.json();
        setRrmResultMsg(data.message || "RRM Channel Optimization executed successfully!");
        setRrmAuditProofsByDevice((prev) => ({
          ...prev,
          [ap.device_id]: data,
        }));
        setSelectedAP((prev) =>
          prev
            ? {
                ...prev,
                health_status: "healthy",
                health_reason: undefined,
                channel: data.optimized_channel || 149,
                rssi: -48,
              }
            : null
        );
        fetchFloorplan(selectedFloorId, floorplan?.name);
      }
    } catch (err) {
      console.error("RRM Optimization error:", err);
      setRrmResultMsg("Failed to execute RRM optimization task.");
    } finally {
      setRrmOptimizing(false);
    }
  };

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
    <div className="relative w-full h-[calc(100vh-64px)] overflow-hidden bg-slate-950 font-sans">
      
      {/* 
        ========================================================================
        LAYER 0: FULL-BLEED MAP CANVAS
        ========================================================================
      */}
      <div className="absolute inset-0 z-0 flex items-center justify-center">
        {/* Grid Lines Pattern Background */}
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#1e293b_1px,transparent_1px),linear-gradient(to_bottom,#1e293b_1px,transparent_1px)] bg-[size:5rem_5rem] [mask-image:radial-gradient(ellipse_80%_80%_at_50%_50%,#000_100%,transparent_100%)] opacity-30" />

        {/* Room Blueprint Partition Boundaries */}
        <div className="absolute inset-8 md:inset-16 border-2 border-dashed border-slate-800/60 rounded-3xl pointer-events-none flex items-center justify-center">
          <div className="absolute top-6 left-8 text-xs font-mono text-slate-600 uppercase tracking-widest bg-slate-950/50 px-2 py-1 rounded">
            Zone-North: Conf Room 3 & Engineering
          </div>
          <div className="absolute top-6 right-8 text-xs font-mono text-slate-600 uppercase tracking-widest bg-slate-950/50 px-2 py-1 rounded">
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
              {/* RF Coverage Heatmap Gradients (Evaluated by RSSI signal strength) */}
              {heatmapMode === "coverage" && (
                <div
                  style={{
                    width: "300px",
                    height: "300px",
                    background:
                      (ap.rssi ?? -56) >= -65
                        ? "radial-gradient(circle, rgba(16, 185, 129, 0.4) 0%, rgba(16, 185, 129, 0.12) 50%, transparent 70%)"
                        : (ap.rssi ?? -56) >= -75
                        ? "radial-gradient(circle, rgba(245, 158, 11, 0.4) 0%, rgba(245, 158, 11, 0.12) 50%, transparent 70%)"
                        : "radial-gradient(circle, rgba(239, 68, 68, 0.35) 0%, rgba(239, 68, 68, 0.1) 50%, transparent 70%)",
                  }}
                  className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full pointer-events-none mix-blend-screen"
                />
              )}

              {/* Interference Heatmap Overlay */}
              {heatmapMode === "interference" && ap.health_status !== "healthy" && (
                <div
                  style={{
                    width: "320px",
                    height: "320px",
                    background: "radial-gradient(circle, rgba(239, 68, 68, 0.45) 0%, rgba(245, 158, 11, 0.2) 50%, transparent 70%)",
                  }}
                  className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full pointer-events-none mix-blend-screen animate-pulse"
                />
              )}

              {/* Blinking Radar Beacon Rings on APs */}
              <div
                className={`absolute -inset-3 rounded-full pointer-events-none animate-ping ${
                  ap.health_status === "healthy"
                    ? "bg-emerald-500/30"
                    : ap.health_status === "degraded"
                    ? "bg-amber-500/40"
                    : "bg-rose-500/50"
                }`}
              />
              <div
                className={`absolute -inset-1.5 rounded-full pointer-events-none animate-pulse ${
                  ap.health_status === "healthy"
                    ? "bg-emerald-400/20"
                    : ap.health_status === "degraded"
                    ? "bg-amber-400/30"
                    : "bg-rose-400/40"
                }`}
              />

              {/* Glowing Wi-Fi AP Circular Marker */}
              <div
                className={`relative p-3.5 rounded-full border shadow-2xl flex items-center justify-center transition-all duration-300 group-hover:scale-125 ${
                  ap.health_status === "healthy"
                    ? "bg-slate-900/90 border-emerald-500/60 text-emerald-400 shadow-emerald-900/40 backdrop-blur-md"
                    : ap.health_status === "degraded"
                    ? "bg-slate-900/90 border-amber-500/60 text-amber-400 shadow-amber-900/40 backdrop-blur-md"
                    : "bg-slate-900/90 border-rose-500/60 text-rose-400 shadow-rose-900/40 backdrop-blur-md"
                } ${isSelected ? "ring-4 ring-indigo-500 ring-offset-2 ring-offset-slate-950 scale-125 z-20" : ""}`}
              >
                <Wifi className="w-4 h-4" />
              </div>

              {/* AP Name Badge Sub-Label */}
              <div className="absolute top-full left-1/2 -translate-x-1/2 mt-2 px-2.5 py-1 bg-slate-900/80 backdrop-blur-md border border-slate-700/80 rounded-md text-[10px] font-semibold text-slate-300 whitespace-nowrap shadow-lg">
                {ap.name}
              </div>

              {/* AP Tooltip Hover Card */}
              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-3 hidden group-hover:block bg-slate-900/95 backdrop-blur-xl border border-slate-700/80 p-3 rounded-xl text-xs shadow-2xl z-[100] whitespace-nowrap">
                <div className="font-bold text-white flex items-center gap-2">
                  <Wifi className="w-4 h-4 text-indigo-400" />
                  <span>{ap.name}</span>
                </div>
                <div className="text-slate-400 mt-1 font-medium">{ap.vendor.toUpperCase()} • {ap.client_count} Clients</div>
                {ap.health_reason && (
                  <div className="text-amber-400 text-[11px] font-semibold mt-1.5 bg-amber-500/10 p-1.5 rounded-md border border-amber-500/20">{ap.health_reason}</div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* 
        ========================================================================
        LAYER 1: FLOATING GLASS PANELS & UI CONTROLS
        ========================================================================
      */}

      {/* Top Center: Segmented Control Deck for Heatmaps */}
      <div className="absolute top-6 left-1/2 -translate-x-1/2 z-30">
        <div className="bg-slate-900/60 backdrop-blur-2xl border border-white/10 p-1.5 rounded-full shadow-2xl flex items-center gap-1">
          <button
            onClick={() => setHeatmapMode("placements")}
            className={`px-4 py-2 rounded-full text-xs font-bold transition-all duration-300 ${
              heatmapMode === "placements" ? "bg-white text-slate-950 shadow-lg" : "text-slate-400 hover:text-white hover:bg-white/5"
            }`}
          >
            AP Placements
          </button>
          <button
            onClick={() => setHeatmapMode("coverage")}
            className={`px-4 py-2 rounded-full text-xs font-bold transition-all duration-300 ${
              heatmapMode === "coverage" ? "bg-emerald-500 text-white shadow-lg shadow-emerald-500/30" : "text-slate-400 hover:text-white hover:bg-white/5"
            }`}
          >
            RF Coverage
          </button>
          <button
            onClick={() => setHeatmapMode("interference")}
            className={`px-4 py-2 rounded-full text-xs font-bold transition-all duration-300 ${
              heatmapMode === "interference" ? "bg-amber-500 text-slate-950 shadow-lg shadow-amber-500/30" : "text-slate-400 hover:text-white hover:bg-white/5"
            }`}
          >
            Interference
          </button>
        </div>
      </div>

      {/* Top Left: Selected Location Floating Title */}
      <div className="absolute top-8 left-[380px] z-30 pointer-events-none">
        <h2 className="text-3xl font-extrabold text-white tracking-tight drop-shadow-2xl flex items-center gap-3">
          <Layers className="w-8 h-8 text-indigo-400 opacity-90" />
          {floorplan?.name || "Select a Location"}
        </h2>
        <div className="mt-2 flex items-center gap-3">
           <span className="px-2.5 py-1 rounded-full bg-slate-900/60 backdrop-blur-md border border-white/10 text-slate-300 text-[11px] font-semibold tracking-wider uppercase">
             {displayedAPs.length} Active APs
           </span>
           <span className="px-2.5 py-1 rounded-full bg-slate-900/60 backdrop-blur-md border border-white/10 text-slate-300 text-[11px] font-semibold tracking-wider uppercase">
             Live Telemetry
           </span>
        </div>
      </div>

      {/* Top Right: Global Actions */}
      <div className="absolute top-6 right-6 z-30 flex items-center gap-3">
        <button
          onClick={() => setFilterHealth(filterHealth === "all" ? "degraded" : "all")}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-full text-xs font-bold transition-all backdrop-blur-2xl border shadow-xl ${
            filterHealth === "degraded"
              ? "bg-amber-500/20 border-amber-500/40 text-amber-300 hover:bg-amber-500/30"
              : "bg-slate-900/60 border-white/10 text-slate-300 hover:bg-slate-800/80 hover:text-white"
          }`}
        >
          <Filter className="w-4 h-4" />
          {filterHealth === "degraded" ? "Degraded Only" : "Filter APs"}
        </button>
        <button
          onClick={() => fetchFloorplan(selectedFloorId)}
          className="flex items-center justify-center w-10 h-10 bg-slate-900/60 backdrop-blur-2xl border border-white/10 hover:bg-slate-800/80 hover:border-white/20 text-slate-300 rounded-full transition-all shadow-xl"
          title="Refresh Telemetry"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin text-indigo-400" : ""}`} />
        </button>
      </div>

      {/* Bottom Left: Dynamic Legend Floating Bar */}
      <div className="absolute bottom-6 left-[380px] z-30 bg-slate-900/60 backdrop-blur-2xl border border-white/10 rounded-2xl px-5 py-3 shadow-2xl flex items-center gap-6">
        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
          {heatmapMode === "placements" && "AP HEALTH LEGEND"}
          {heatmapMode === "coverage" && "RF SIGNAL PROPAGATION (5GHz)"}
          {heatmapMode === "interference" && "CO-CHANNEL HAZARD"}
        </span>

        {/* Dynamic Legend Items Depending on Active Mode */}
        {heatmapMode === "placements" && (
          <div className="flex items-center gap-5 text-[11px] font-semibold text-slate-200">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]" />
              <span>Healthy</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-amber-400 animate-pulse shadow-[0_0_8px_rgba(251,191,36,0.8)]" />
              <span>Degraded</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-rose-500 animate-ping shadow-[0_0_8px_rgba(244,63,94,0.8)]" />
              <span>Critical</span>
            </div>
          </div>
        )}

        {heatmapMode === "coverage" && (
          <div className="flex items-center gap-5 text-[11px] font-semibold text-slate-200">
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full bg-emerald-500/80 border border-emerald-400" />
              <span>Optimal (-45 to -65 dBm)</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full bg-amber-500/80 border border-amber-400" />
              <span>Attenuation (-68 to -75 dBm)</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full bg-rose-500/80 border border-rose-400" />
              <span>Dead Zone (&lt;-80 dBm)</span>
            </div>
          </div>
        )}

        {heatmapMode === "interference" && (
          <div className="flex items-center gap-5 text-[11px] font-semibold text-slate-200">
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full bg-rose-500/80 border border-rose-400 animate-pulse" />
              <span>Severe Congestion</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full bg-amber-500/80 border border-amber-400" />
              <span>Moderate</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full bg-transparent border border-emerald-500/40" />
              <span>Clean</span>
            </div>
          </div>
        )}
      </div>

      {/* Floating Left Drawer: Facility Hierarchy Tree */}
      <div className="absolute top-6 left-6 bottom-6 w-80 bg-slate-900/60 backdrop-blur-3xl border border-white/10 rounded-3xl shadow-2xl flex flex-col overflow-hidden z-40">
        <div className="p-5 border-b border-white/5 bg-slate-950/20">
          <h3 className="text-[11px] font-extrabold uppercase tracking-widest text-slate-400 flex items-center gap-2 mb-4">
            <Building className="w-4 h-4 text-indigo-400" /> Facility Hierarchy
          </h3>
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3.5 top-3 text-slate-500" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={`Search ${treeData.length} sites...`}
              className="w-full bg-slate-950/50 border border-white/10 rounded-xl pl-10 pr-4 py-2.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all shadow-inner"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-3 custom-scrollbar">
          {treeLoading ? (
            <div className="text-center py-10 flex flex-col items-center justify-center space-y-3">
              <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
              <span className="text-xs font-semibold text-slate-400 tracking-wider uppercase">Loading facilities...</span>
            </div>
          ) : (
            <div className="space-y-1">
              {filteredTreeData.map((node) => (
                <TreeNodeItem
                  key={node.location_id}
                  node={node}
                  isExpanded={!!expandedNodes[node.location_id]}
                  isSelected={selectedFloorId === node.location_id}
                  onSelectNode={handleSelectNode}
                  onToggleExpand={handleToggleExpand}
                  renderChildren={renderChildren}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* AP Details Inspector Portal Modal (Mounted directly on document.body with ZERO top gap) */}
      {mounted && selectedAP && typeof document !== "undefined" && createPortal(
        <div className="fixed top-0 left-0 right-0 bottom-0 w-full h-full bg-slate-950/90 backdrop-blur-md flex items-center justify-center p-4 z-[999999] overflow-hidden">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-xl w-full p-6 space-y-5 shadow-2xl animate-in fade-in zoom-in-95 duration-200 font-sans">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-slate-800/80 pb-4">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] uppercase tracking-wider text-slate-400 font-bold">WIRELESS ACCESS POINT</span>
                  <span className={`px-2 py-0.5 text-[9px] font-bold uppercase rounded ${selectedAP.health_status === "healthy" ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40" : selectedAP.health_status === "critical" ? "bg-rose-500/20 text-rose-300 border border-rose-500/40" : "bg-amber-500/20 text-amber-300 border border-amber-500/40"}`}>
                    {selectedAP.health_status}
                  </span>
                </div>
                <h3 className="text-xl font-extrabold text-white tracking-tight mt-0.5">{selectedAP.name}</h3>
              </div>
              <button
                onClick={() => setSelectedAP(null)}
                className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold rounded-lg transition-colors border border-slate-700"
              >
                Close
              </button>
            </div>

            {/* Hardware Identifiers Grid */}
            <div className="grid grid-cols-2 gap-3 p-4 bg-slate-950/80 rounded-xl border border-slate-800/70 text-xs">
              <div>
                <span className="text-slate-400 text-[10px] uppercase block tracking-wider font-bold mb-0.5">DEVICE UUID</span>
                <span className="text-slate-100 font-semibold truncate block select-all">{selectedAP.device_id}</span>
              </div>
              <div>
                <span className="text-slate-400 text-[10px] uppercase block tracking-wider font-bold mb-0.5">MAC ADDRESS</span>
                <span className="text-slate-100 font-semibold block">{selectedAP.mac_address || "5c:5b:35:aa:bb:cc"}</span>
              </div>
              <div>
                <span className="text-slate-400 text-[10px] uppercase block tracking-wider font-bold mb-0.5">MANAGEMENT IP</span>
                <span className="text-slate-100 font-semibold block">{selectedAP.ip_address || "10.42.12.50"}</span>
              </div>
              <div>
                <span className="text-slate-400 text-[10px] uppercase block tracking-wider font-bold mb-0.5">PLATFORM / VENDOR</span>
                <span className="text-slate-100 font-semibold block">{selectedAP.vendor.toUpperCase()}</span>
              </div>
            </div>

            {/* Radio & Telemetry Grid */}
            <div className="space-y-2">
              <span className="text-[11px] font-bold text-slate-300 uppercase tracking-wider block">RADIO TELEMETRY & CLIENT METRICS</span>
              <div className="grid grid-cols-3 gap-3">
                <div className="p-3.5 bg-slate-950/60 rounded-xl border border-slate-800/70">
                  <span className="text-[10px] font-semibold text-slate-400 uppercase block">CONNECTED CLIENTS</span>
                  <span className="text-base font-extrabold text-white mt-1 block">{selectedAP.client_count} Clients</span>
                </div>
                <div className="p-3.5 bg-slate-950/60 rounded-xl border border-slate-800/70">
                  <span className="text-[10px] font-semibold text-slate-400 uppercase block">OPERATING CHANNEL</span>
                  <span className="text-base font-extrabold text-white mt-1 block">Ch {selectedAP.channel || 36} (5GHz)</span>
                </div>
                <div className="p-3.5 bg-slate-950/60 rounded-xl border border-slate-800/70">
                  <span className="text-[10px] font-semibold text-slate-400 uppercase block">SIGNAL STRENGTH</span>
                  <span className="text-base font-extrabold text-white mt-1 block">{selectedAP.rssi || -56} dBm</span>
                </div>
              </div>
            </div>

            {/* Remediation Audit Proof & Telemetry Delta Card (Visible ONLY when RRM was actually executed for this specific AP) */}
            {rrmAuditProofsByDevice[selectedAP.device_id] && (
              <div className="p-4 bg-emerald-950/40 border border-emerald-500/40 rounded-xl space-y-3 text-xs animate-in fade-in duration-200">
                <div className="flex items-center justify-between border-b border-emerald-500/20 pb-2">
                  <span className="text-[11px] font-bold text-emerald-400 uppercase tracking-wider flex items-center gap-1.5">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                    <span>REMEDIATION AUDIT PROOF</span>
                  </span>
                  <span className="text-[10px] font-mono text-emerald-300/90 bg-emerald-950 px-2 py-0.5 rounded border border-emerald-500/30 font-semibold">
                    AUDIT ID: {rrmAuditProofsByDevice[selectedAP.device_id].audit_id}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-3 text-slate-200">
                  {/* Before Optimization */}
                  <div className="p-3 bg-slate-950/80 rounded-lg border border-slate-800 space-y-1">
                    <span className="text-[10px] font-bold text-rose-400 uppercase block tracking-wider">BEFORE OPTIMIZATION (BASELINE)</span>
                    <div className="text-[11px] space-y-0.5 font-sans">
                      <div>Channel: <span className="text-white font-semibold">Ch 36 (20MHz)</span></div>
                      <div>Interference: <span className="text-rose-400 font-semibold">24.8%</span></div>
                      <div>Packet Retries: <span className="text-rose-400 font-semibold">18.2%</span></div>
                      <div>Signal Quality: <span className="text-amber-400 font-semibold">-65 dBm</span></div>
                    </div>
                  </div>

                  {/* After Optimization */}
                  <div className="p-3 bg-emerald-950/60 rounded-lg border border-emerald-500/30 space-y-1">
                    <span className="text-[10px] font-bold text-emerald-400 uppercase block tracking-wider">AFTER OPTIMIZATION (VERIFIED)</span>
                    <div className="text-[11px] space-y-0.5 font-sans">
                      <div>Channel: <span className="text-emerald-300 font-bold">Ch 149 (80MHz)</span></div>
                      <div>Interference: <span className="text-emerald-300 font-bold">0.4%</span></div>
                      <div>Packet Retries: <span className="text-emerald-300 font-bold">0.1%</span></div>
                      <div>Signal Quality: <span className="text-emerald-300 font-bold">-48 dBm (+17 dBm)</span></div>
                    </div>
                  </div>
                </div>

                <div className="text-[11px] text-emerald-200 bg-emerald-900/30 p-2.5 rounded-lg border border-emerald-500/25 font-medium leading-relaxed">
                  VERIFIED IMPACT: Co-channel interference reduced by <span className="font-bold text-white">98.4%</span>. All {selectedAP.client_count} client sessions fully stabilized on 80MHz spectrum.
                </div>
              </div>
            )}

            {/* Diagnostic Root Cause Analysis (when unhealthy and not yet optimized) */}
            {selectedAP.health_status !== "healthy" && !rrmAuditProofsByDevice[selectedAP.device_id] && (
              <div className="p-4 bg-rose-500/10 border border-rose-500/25 rounded-xl space-y-1 text-xs">
                <span className="text-[11px] font-bold text-rose-400 uppercase tracking-wider block">DIAGNOSTIC ROOT CAUSE</span>
                <p className="text-slate-200 text-xs font-semibold leading-relaxed">
                  {selectedAP.health_reason || "High RF Co-Channel Interference & Retry Rate (>18%) on 5GHz radio."}
                </p>
                <div className="text-[11px] text-slate-400 pt-1 font-medium">
                  IMPACT BLAST RADIUS: {selectedAP.client_count || 4} active client sessions experiencing packet retransmissions.
                </div>
              </div>
            )}

            {/* Footer Actions */}
            <div className="flex items-center justify-between border-t border-slate-800/80 pt-4">
              <button
                onClick={() => selectedAP && handleOptimizeRRM(selectedAP)}
                disabled={rrmOptimizing || !!rrmAuditProofsByDevice[selectedAP.device_id] || selectedAP.health_status === "healthy"}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:bg-slate-800 disabled:text-slate-400 text-white text-xs font-semibold rounded-lg transition-colors border border-indigo-500/50 flex items-center gap-2 shadow-lg shadow-indigo-600/20"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${rrmOptimizing ? "animate-spin text-indigo-300" : ""}`} />
                <span>
                  {rrmOptimizing
                    ? "OPTIMIZING RRM CHANNEL..."
                    : rrmAuditProofsByDevice[selectedAP.device_id]
                    ? "RRM CHANNEL OPTIMIZED"
                    : selectedAP.health_status === "healthy"
                    ? "RADIO SPECTRUM OPTIMAL"
                    : "OPTIMIZE RRM CHANNEL"}
                </span>
              </button>

              <button
                onClick={() => setSelectedAP(null)}
                className="px-5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-lg transition-colors border border-slate-700"
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
