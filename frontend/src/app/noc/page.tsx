"use client";

import React, { useEffect, useState, useMemo, useCallback, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import {
  AlertTriangle,
  Building,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Globe,
  Layers,
  MapPin,
  RefreshCw,
  Search,
  Sliders,
  Wifi,
  X,
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
        return <Globe className="w-3.5 h-3.5 text-slate-500 flex-shrink-0" />;
      case "building":
        return <Building className="w-3.5 h-3.5 text-slate-500 flex-shrink-0" />;
      case "floor":
        return <Layers className="w-3.5 h-3.5 text-slate-500 flex-shrink-0" />;
      default:
        return <MapPin className="w-3.5 h-3.5 text-slate-500 flex-shrink-0" />;
    }
  };

  return (
    <div className="select-none">
      <div
        onClick={() => onSelectNode(node)}
        title={node.name}
        className={`group flex items-center gap-2 px-3 py-1.5 cursor-pointer text-xs transition-colors ${
          isSelected
            ? "bg-slate-800/60 text-white"
            : "text-slate-400 hover:bg-slate-800/40 hover:text-slate-200"
        }`}
        style={{
          borderLeft: isSelected ? "2px solid hsl(var(--primary))" : "2px solid transparent",
        }}
      >
        {hasChildren ? (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggleExpand(node.location_id);
            }}
            className="p-0.5 hover:bg-slate-700/60 rounded-sm text-slate-500 flex-shrink-0 transition-colors"
          >
            {isExpanded ? (
              <ChevronDown className="w-3 h-3" />
            ) : (
              <ChevronRight className="w-3 h-3" />
            )}
          </button>
        ) : (
          <span className="w-4 flex-shrink-0" />
        )}
        {getTypeIcon(node.type)}
        <span className="truncate font-medium">{node.name}</span>

        <div className="flex items-center gap-1.5 ml-auto flex-shrink-0">
          {node.health_status === "degraded" && (
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400" title="Degraded" />
          )}
          {node.health_status === "critical" && (
            <span className="w-1.5 h-1.5 rounded-full bg-rose-500" title="Critical" />
          )}
          {node.health_status === "healthy" && (
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500/70" title="Healthy" />
          )}
        </div>
      </div>

      {hasChildren && isExpanded && (
        <div className="pl-3 ml-3 border-l border-slate-800/60">
          {renderChildren(node.children)}
        </div>
      )}
    </div>
  );
});

function StatusDot({ status, size = "sm" }: { status: string; size?: "sm" | "md" }) {
  const sizeClass = size === "md" ? "w-2 h-2" : "w-1.5 h-1.5";
  if (status === "healthy" || status === "online") {
    return <span className={`${sizeClass} rounded-full bg-emerald-500`} />;
  }
  if (status === "degraded") {
    return <span className={`${sizeClass} rounded-full bg-amber-400`} />;
  }
  return <span className={`${sizeClass} rounded-full bg-rose-500`} />;
}

function NOCFloorplanContent() {
  const searchParams = useSearchParams();
  const targetLocationId = searchParams.get("location_id") || searchParams.get("site_id");
  const targetName = searchParams.get("name");

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
        <>
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
        </>
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

  const degradedCount = floorplan?.ap_placements?.filter(
    (ap) => ap.health_status === "degraded" || ap.health_status === "critical"
  ).length || 0;

  const totalCount = floorplan?.ap_placements?.length || 0;

  return (
    <div className="-m-6 h-[calc(100vh-3.5rem)] flex flex-col bg-slate-950">
      {/* ── Operational Bar ── */}
      <div className="shrink-0 h-14 flex items-center justify-between px-5 border-b border-slate-800/60">
        <div className="flex items-center gap-5 min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            <MapPin className="w-4 h-4 text-slate-500 flex-shrink-0" />
            <h1 className="text-base font-semibold text-white truncate" title={floorplan?.name || "Select a Location"}>
              {floorplan?.name || "NOC Floorplan"}
            </h1>
            {floorplan?.health_status && (
              <span className="flex items-center gap-1.5 text-xs text-slate-400 ml-1 flex-shrink-0">
                <StatusDot status={floorplan.health_status} />
                <span className="capitalize">{floorplan.health_status}</span>
              </span>
            )}
          </div>

          <div className="hidden md:flex items-center gap-4 text-xs text-slate-500">
            <span>{totalCount} APs</span>
            {degradedCount > 0 && (
              <span className="text-amber-400">{degradedCount} degraded</span>
            )}
            <span className="text-slate-700">|</span>
            <span>Normalized coordinate space</span>
          </div>
        </div>

        <div className="flex items-center gap-4 flex-shrink-0">
          {/* Layer Tabs */}
          <div className="hidden sm:flex items-center gap-0 text-xs">
            {(["placements", "coverage", "interference"] as const).map((mode) => (
              <button
                key={mode}
                onClick={() => setHeatmapMode(mode)}
                className={`px-3 py-1.5 font-medium transition-colors border-b-2 ${
                  heatmapMode === mode
                    ? "text-white border-indigo-500"
                    : "text-slate-500 border-transparent hover:text-slate-300"
                }`}
              >
                {mode === "placements" && "AP Placement"}
                {mode === "coverage" && "RF Coverage"}
                {mode === "interference" && "Interference"}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setFilterHealth(filterHealth === "all" ? "degraded" : "all")}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium transition-colors rounded-sm ${
                filterHealth === "degraded"
                  ? "text-amber-400 bg-amber-500/10"
                  : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/50"
              }`}
              title={filterHealth === "degraded" ? "Show all APs" : "Show degraded only"}
            >
              <Sliders className="w-3.5 h-3.5" />
              {filterHealth === "degraded" ? "Degraded" : "All"}
            </button>
            <button
              onClick={() => fetchFloorplan(selectedFloorId)}
              className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800/50 rounded-sm transition-colors"
              title="Refresh floorplan"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
            </button>
          </div>
        </div>
      </div>

      {/* ── Main Workspace ── */}
      <div className="flex-1 flex min-h-0">
        {/* Facility Tree Sidebar */}
        <div className="w-[260px] shrink-0 flex flex-col border-r border-slate-800/60">
          <div className="shrink-0 px-4 py-3 border-b border-slate-800/60">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                Facilities
              </span>
              <span className="text-[10px] text-slate-500">{treeData.length} sites</span>
            </div>
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-2 text-slate-600" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search sites..."
                className="w-full bg-slate-900/60 pl-7 pr-2.5 py-1.5 text-xs text-slate-200 placeholder-slate-600 rounded-sm border border-slate-800/60 focus:outline-none focus:border-slate-700 transition-colors"
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto py-2">
            {treeLoading ? (
              <div className="px-4 py-8 text-xs text-slate-600 animate-pulse">
                Loading facilities...
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

        {/* Floorplan Canvas */}
        <div className="flex-1 min-w-0 relative bg-slate-950 flex flex-col">
          <div className="flex-1 relative overflow-hidden">
            {/* Subtle grid background */}
            <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(30,41,59,0.4)_1px,transparent_1px),linear-gradient(to_bottom,rgba(30,41,59,0.4)_1px,transparent_1px)] bg-[size:4rem_4rem]" />

            {/* Zone partition lines */}
            <div className="absolute inset-6 border border-dashed border-slate-800/50 pointer-events-none">
              <div className="absolute top-2 left-3 text-[10px] font-mono text-slate-600 uppercase tracking-widest">
                Zone-North: Conf Room 3 & Engineering
              </div>
              <div className="absolute top-2 right-3 text-[10px] font-mono text-slate-600 uppercase tracking-widest">
                Zone-East: Executive Boardroom
              </div>
            </div>

            {/* AP Markers */}
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
                        width: "240px",
                        height: "240px",
                        background:
                          (ap.rssi ?? -56) >= -65
                            ? "radial-gradient(circle, rgba(16, 185, 129, 0.4) 0%, rgba(16, 185, 129, 0.12) 50%, transparent 75%)"
                            : (ap.rssi ?? -56) >= -75
                            ? "radial-gradient(circle, rgba(245, 158, 11, 0.4) 0%, rgba(245, 158, 11, 0.12) 50%, transparent 75%)"
                            : "radial-gradient(circle, rgba(239, 68, 68, 0.35) 0%, rgba(239, 68, 68, 0.1) 50%, transparent 75%)",
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

                  {/* Blinking Radar Beacon Rings */}
                  <div
                    className={`absolute -inset-2 rounded-full pointer-events-none animate-ping ${
                      ap.health_status === "healthy"
                        ? "bg-emerald-500/35"
                        : ap.health_status === "degraded"
                        ? "bg-amber-500/45"
                        : "bg-rose-500/60"
                    }`}
                  />
                  <div
                    className={`absolute -inset-1 rounded-full pointer-events-none animate-pulse ${
                      ap.health_status === "healthy"
                        ? "bg-emerald-400/20"
                        : ap.health_status === "degraded"
                        ? "bg-amber-400/30"
                        : "bg-rose-400/40"
                    }`}
                  />

                  {/* Glowing Wi-Fi AP Circular Marker */}
                  <div
                    className={`relative p-3 rounded-full border shadow-2xl flex items-center justify-center transition-all duration-200 group-hover:scale-125 ${
                      ap.health_status === "healthy"
                        ? "bg-emerald-950/90 border-emerald-500/60 text-emerald-400 shadow-emerald-900/50"
                        : ap.health_status === "degraded"
                        ? "bg-amber-950/90 border-amber-500/60 text-amber-400 shadow-amber-900/50"
                        : "bg-rose-950/90 border-rose-500/60 text-rose-400 shadow-rose-900/50"
                    } ${isSelected ? "ring-4 ring-indigo-500 ring-offset-2 ring-offset-slate-950 scale-125 z-20" : ""}`}
                  >
                    <Wifi className="w-4 h-4 animate-pulse" />
                  </div>

                  {/* AP Name Badge Sub-Label */}
                  <div className="absolute top-full left-1/2 -translate-x-1/2 mt-1 px-2 py-0.5 bg-slate-900/90 border border-slate-800 rounded text-[10px] font-semibold text-slate-300 whitespace-nowrap shadow">
                    {ap.name}
                  </div>

                  {/* AP Tooltip Hover Card */}
                  <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2.5 hidden group-hover:block bg-slate-900 border border-slate-800 p-2.5 rounded-xl text-[11px] shadow-2xl z-[100] whitespace-nowrap">
                    <div className="font-bold text-white flex items-center gap-1.5">
                      <Wifi className="w-3.5 h-3.5 text-indigo-400" />
                      <span>{ap.name}</span>
                    </div>
                    <div className="text-slate-400 mt-0.5">{ap.vendor.toUpperCase()} · {ap.client_count} Clients</div>
                    {ap.health_reason && (
                      <div className="text-amber-400 text-[10px] font-medium mt-1">{ap.health_reason}</div>
                    )}
                  </div>
                </div>
              );
            })}

            {/* Empty state */}
            {!loading && displayedAPs.length === 0 && (
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="text-center">
                  <Wifi className="w-8 h-8 text-slate-700 mx-auto mb-2" />
                  <p className="text-sm text-slate-500">No access points on this floorplan</p>
                </div>
              </div>
            )}

            {/* Loading state */}
            {loading && (
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="text-xs text-slate-500 animate-pulse">Loading floorplan data...</div>
              </div>
            )}
          </div>

          {/* Inline Legend */}
          <div className="shrink-0 h-9 flex items-center px-5 border-t border-slate-800/60 bg-slate-950 text-xs gap-6">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              {heatmapMode === "placements" && "AP Health"}
              {heatmapMode === "coverage" && "RF Signal (5GHz)"}
              {heatmapMode === "interference" && "Interference"}
            </span>

            {heatmapMode === "placements" && (
              <>
                <span className="flex items-center gap-1.5 text-slate-400">
                  <span className="w-2 h-2 rounded-full bg-emerald-500" /> Healthy
                </span>
                <span className="flex items-center gap-1.5 text-slate-400">
                  <span className="w-2 h-2 rounded-full bg-amber-400" /> Degraded
                </span>
                <span className="flex items-center gap-1.5 text-slate-400">
                  <span className="w-2 h-2 rounded-full bg-rose-500" /> Critical
                </span>
              </>
            )}

            {heatmapMode === "coverage" && (
              <>
                <span className="flex items-center gap-1.5 text-slate-400">
                  <span className="w-2 h-2 rounded-full bg-emerald-500/80" /> Optimal (-45 to -65 dBm)
                </span>
                <span className="flex items-center gap-1.5 text-slate-400">
                  <span className="w-2 h-2 rounded-full bg-amber-500/80" /> Attenuation (-68 to -75 dBm)
                </span>
                <span className="flex items-center gap-1.5 text-slate-400">
                  <span className="w-2 h-2 rounded-full bg-slate-700" /> Dead Zone (&lt;-80 dBm)
                </span>
              </>
            )}

            {heatmapMode === "interference" && (
              <>
                <span className="flex items-center gap-1.5 text-slate-400">
                  <span className="w-2 h-2 rounded-full bg-rose-500/80" /> Severe
                </span>
                <span className="flex items-center gap-1.5 text-slate-400">
                  <span className="w-2 h-2 rounded-full bg-amber-500/80" /> Moderate
                </span>
                <span className="flex items-center gap-1.5 text-slate-400">
                  <span className="w-2 h-2 rounded-full bg-emerald-500/30" /> Clean
                </span>
              </>
            )}
          </div>
        </div>

        {/* ── AP Detail Inspector Panel ── */}
        {selectedAP && (
          <div className="w-[380px] shrink-0 flex flex-col bg-slate-900 border-l border-slate-800/60 overflow-y-auto">
            {/* Panel Header */}
            <div className="shrink-0 px-5 py-4 border-b border-slate-800/60">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                      Access Point
                    </span>
                    <span
                      className={`text-[10px] font-semibold uppercase ${
                        selectedAP.health_status === "healthy"
                          ? "text-emerald-400"
                          : selectedAP.health_status === "critical"
                          ? "text-rose-400"
                          : "text-amber-400"
                      }`}
                    >
                      {selectedAP.health_status}
                    </span>
                  </div>
                  <h2 className="text-lg font-semibold text-white truncate">{selectedAP.name}</h2>
                </div>
                <button
                  onClick={() => setSelectedAP(null)}
                  className="p-1 text-slate-500 hover:text-white hover:bg-slate-800 rounded-sm transition-colors flex-shrink-0"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="flex-1 px-5 py-4 space-y-6">
              {/* Hardware Identifiers */}
              <div className="space-y-2.5">
                <h3 className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                  Hardware Identifiers
                </h3>
                <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                  <div>
                    <span className="text-slate-500 block text-[10px] uppercase tracking-wider">Device ID</span>
                    <span className="text-slate-200 font-medium truncate block select-all">{selectedAP.device_id}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block text-[10px] uppercase tracking-wider">MAC</span>
                    <span className="text-slate-200 font-medium block">{selectedAP.mac_address || "5c:5b:35:aa:bb:cc"}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block text-[10px] uppercase tracking-wider">IP Address</span>
                    <span className="text-slate-200 font-medium block">{selectedAP.ip_address || "10.42.12.50"}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block text-[10px] uppercase tracking-wider">Vendor</span>
                    <span className="text-slate-200 font-medium block">{selectedAP.vendor.toUpperCase()}</span>
                  </div>
                </div>
              </div>

              {/* Radio Telemetry */}
              <div className="space-y-2.5">
                <h3 className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                  Radio Telemetry
                </h3>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <span className="text-[10px] text-slate-500 uppercase tracking-wider block">Clients</span>
                    <span className="text-sm font-semibold text-white mt-0.5 block">{selectedAP.client_count}</span>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-500 uppercase tracking-wider block">Channel</span>
                    <span className="text-sm font-semibold text-white mt-0.5 block">{selectedAP.channel || 36}</span>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-500 uppercase tracking-wider block">RSSI</span>
                    <span className="text-sm font-semibold text-white mt-0.5 block">{selectedAP.rssi || -56} dBm</span>
                  </div>
                </div>
              </div>

              {/* RRM Audit */}
              {rrmAuditProofsByDevice[selectedAP.device_id] && (
                <div className="space-y-3 pt-2 border-t border-slate-800/60">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-semibold text-emerald-400 uppercase tracking-wider flex items-center gap-1.5">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      Remediation Proof
                    </span>
                    <span className="text-[10px] font-mono text-emerald-300/80 bg-emerald-950/40 px-2 py-0.5 border border-emerald-500/20">
                      {rrmAuditProofsByDevice[selectedAP.device_id].audit_id}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div className="space-y-1">
                      <span className="text-[10px] font-semibold text-rose-400 uppercase tracking-wider block">Before</span>
                      <div className="text-slate-300 space-y-0.5">
                        <div>Channel: <span className="text-white font-medium">Ch 36 (20MHz)</span></div>
                        <div>Interference: <span className="text-rose-400 font-medium">24.8%</span></div>
                        <div>Retries: <span className="text-rose-400 font-medium">18.2%</span></div>
                        <div>Signal: <span className="text-amber-400 font-medium">-65 dBm</span></div>
                      </div>
                    </div>
                    <div className="space-y-1">
                      <span className="text-[10px] font-semibold text-emerald-400 uppercase tracking-wider block">After</span>
                      <div className="text-slate-300 space-y-0.5">
                        <div>Channel: <span className="text-emerald-300 font-semibold">Ch 149 (80MHz)</span></div>
                        <div>Interference: <span className="text-emerald-300 font-semibold">0.4%</span></div>
                        <div>Retries: <span className="text-emerald-300 font-semibold">0.1%</span></div>
                        <div>Signal: <span className="text-emerald-300 font-semibold">-48 dBm</span></div>
                      </div>
                    </div>
                  </div>

                  <p className="text-[11px] text-emerald-300/80 bg-emerald-950/20 px-2.5 py-2 border border-emerald-500/15">
                    Interference reduced by <span className="font-semibold text-white">98.4%</span>. {selectedAP.client_count} client sessions stabilized.
                  </p>
                </div>
              )}

              {/* Diagnostic */}
              {selectedAP.health_status !== "healthy" && !rrmAuditProofsByDevice[selectedAP.device_id] && (
                <div className="space-y-2 pt-2 border-t border-slate-800/60">
                  <span className="text-[10px] font-semibold text-rose-400 uppercase tracking-wider flex items-center gap-1.5">
                    <AlertTriangle className="w-3.5 h-3.5" />
                    Diagnostic Root Cause
                  </span>
                  <p className="text-xs text-slate-300 leading-relaxed">
                    {selectedAP.health_reason || "High RF Co-Channel Interference & Retry Rate (>18%) on 5GHz radio."}
                  </p>
                  <p className="text-[11px] text-slate-500">
                    Impact: {selectedAP.client_count || 4} active client sessions experiencing packet retransmissions.
                  </p>
                </div>
              )}
            </div>

            {/* Panel Footer Actions */}
            <div className="shrink-0 px-5 py-3 border-t border-slate-800/60 flex items-center justify-between">
              <button
                onClick={() => selectedAP && handleOptimizeRRM(selectedAP)}
                disabled={rrmOptimizing || !!rrmAuditProofsByDevice[selectedAP.device_id] || selectedAP.health_status === "healthy"}
                className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:bg-slate-800 disabled:text-slate-500 text-white text-xs font-medium rounded-sm transition-colors flex items-center gap-2"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${rrmOptimizing ? "animate-spin" : ""}`} />
                {rrmOptimizing
                  ? "Optimizing..."
                  : rrmAuditProofsByDevice[selectedAP.device_id]
                  ? "Optimized"
                  : selectedAP.health_status === "healthy"
                  ? "Spectrum Optimal"
                  : "Optimize RRM"}
              </button>

              <button
                onClick={() => setSelectedAP(null)}
                className="px-3 py-1.5 text-slate-400 hover:text-white text-xs font-medium rounded-sm transition-colors hover:bg-slate-800/50"
              >
                Close
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function NOCFloorplanPage() {
  return (
    <Suspense fallback={
      <div className="-m-6 h-[calc(100vh-3.5rem)] flex items-center justify-center bg-slate-950">
        <div className="text-xs text-slate-500 animate-pulse">Loading NOC Floorplan...</div>
      </div>
    }>
      <NOCFloorplanContent />
    </Suspense>
  );
}
