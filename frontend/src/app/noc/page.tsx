"use client";

import React, { useEffect, useState, useMemo, useCallback } from "react";
import {
  Activity,
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
  Users,
  Wifi,
  Zap,
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
  const hasChildren = Boolean(node.children && node.children.length > 0);

  const handleClick = () => {
    onSelectNode(node);
    if (hasChildren) {
      onToggleExpand(node.location_id);
    }
  };

  return (
    <div className="text-xs fast-scroll-item">
      <div
        onClick={handleClick}
        className={`flex items-center justify-between px-2.5 py-1.5 rounded-lg cursor-pointer transition-colors ${
          isSelected
            ? "bg-indigo-600/30 text-indigo-300 font-semibold border border-indigo-500/40"
            : "text-slate-400 hover:bg-slate-800 hover:text-slate-200"
        }`}
      >
        <div className="flex items-center gap-1.5 truncate">
          {hasChildren ? (
            isExpanded ? (
              <ChevronDown className="w-3.5 h-3.5 flex-shrink-0" />
            ) : (
              <ChevronRight className="w-3.5 h-3.5 flex-shrink-0" />
            )
          ) : (
            <span className="w-3.5 h-3.5" />
          )}
          {node.type === "region" && <Globe className="w-3.5 h-3.5 text-blue-400" />}
          {node.type === "site" && <MapPin className="w-3.5 h-3.5 text-indigo-400" />}
          {node.type === "building" && <Building className="w-3.5 h-3.5 text-emerald-400" />}
          {node.type === "floor" && <Layers className="w-3.5 h-3.5 text-purple-400" />}
          <span className="truncate">{node.name}</span>
        </div>

        <div className="flex items-center gap-1">
          {node.health_status === "critical" && (
            <span className="w-2 h-2 rounded-full bg-red-500 animate-ping" />
          )}
          {node.health_status === "degraded" && (
            <span className="w-2 h-2 rounded-full bg-amber-400" />
          )}
          {node.health_status === "healthy" && (
            <span className="w-2 h-2 rounded-full bg-emerald-400" />
          )}
        </div>
      </div>

      {hasChildren && isExpanded && renderChildren(node.children)}
    </div>
  );
});

export default function NOCFloorplanPage() {
  const [treeData, setTreeData] = useState<LocationTreeNode[]>([]);
  const [selectedFloorId, setSelectedFloorId] = useState<string>("floor-hq-2f");
  const [floorplan, setFloorplan] = useState<FloorplanData | null>(null);
  const [selectedAP, setSelectedAP] = useState<APPlacement | null>(null);
  const [loading, setLoading] = useState(true);
  const [filterHealth, setFilterHealth] = useState<"all" | "degraded">("all");
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
        setTreeData(data);
        if (data && data.length > 0) {
          const first = data[0];
          setSelectedFloorId(first.location_id);
          fetchFloorplan(first.location_id);
        }
      }
    } catch (err) {
      console.error("Failed to fetch location tree:", err);
    } finally {
      setTreeLoading(false);
    }
  };

  const fetchFloorplan = async (locId: string) => {
    setLoading(true);
    try {
      const res = await fetch(`http://localhost:8000/locations/${locId}/floorplan`);
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
  }, []);

  const toggleExpand = useCallback((id: string) => {
    setExpandedNodes((prev) => ({ ...prev, [id]: !prev[id] }));
  }, []);

  const handleSelectNode = useCallback((node: LocationTreeNode) => {
    setSelectedFloorId(node.location_id);
    fetchFloorplan(node.location_id);
  }, []);

  const renderTreeNodes = useCallback(
    (nodes: LocationTreeNode[]) => {
      return (
        <div className="space-y-0.5 pl-2">
          {nodes.map((node) => (
            <TreeNodeItem
              key={node.location_id}
              node={node}
              isExpanded={Boolean(expandedNodes[node.location_id])}
              isSelected={selectedFloorId === node.location_id}
              onSelectNode={handleSelectNode}
              onToggleExpand={toggleExpand}
              renderChildren={renderTreeNodes}
            />
          ))}
        </div>
      );
    },
    [expandedNodes, selectedFloorId, handleSelectNode, toggleExpand]
  );

  const filteredAPs = floorplan
    ? floorplan.ap_placements.filter((ap) =>
        filterHealth === "degraded" ? ap.health_status !== "healthy" : true
      )
    : [];

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-6 space-y-6">
      {/* Top Bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800 pb-5">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2">
            <MapPin className="w-7 h-7 text-indigo-400" />
            NOC Live Floorplan Visualizer
          </h1>
          <p className="text-slate-400 text-sm mt-1">
            Authoritative physical facility drill-down with real-time AP X/Y placement & health overlays.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex bg-slate-900 border border-slate-800 rounded-lg p-1 text-xs">
            <button
              onClick={() => setFilterHealth("all")}
              className={`px-3 py-1 rounded font-medium transition-colors ${
                filterHealth === "all" ? "bg-indigo-600 text-white" : "text-slate-400 hover:text-white"
              }`}
            >
              All APs ({floorplan?.ap_placements.length || 0})
            </button>
            <button
              onClick={() => setFilterHealth("degraded")}
              className={`px-3 py-1 rounded font-medium transition-colors ${
                filterHealth === "degraded" ? "bg-amber-600 text-white" : "text-slate-400 hover:text-white"
              }`}
            >
              Degraded Only (
              {floorplan?.ap_placements.filter((a) => a.health_status !== "healthy").length || 0})
            </button>
          </div>

          <button
            onClick={() => fetchFloorplan(selectedFloorId)}
            className="p-2 bg-slate-900 border border-slate-800 hover:bg-slate-800 rounded-lg text-slate-300 transition-colors"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {/* Main Grid: Tree Sidebar + Floorplan Canvas */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Facility Tree (3 Cols) */}
        <div className="lg:col-span-3 bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3 flex flex-col h-[680px]">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3 flex-shrink-0">
            <h2 className="text-sm font-bold uppercase tracking-wider text-slate-300 flex items-center gap-2">
              <Building className="w-4 h-4 text-indigo-400" /> Facility Hierarchy
            </h2>
            <span className="text-[10px] text-slate-500 font-mono font-semibold bg-slate-950 px-2 py-0.5 rounded border border-slate-800">
              {treeData.length} SITES
            </span>
          </div>

          {/* Quick Search Bar */}
          <div className="relative flex-shrink-0">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-slate-500" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search 153 sites..."
              className="w-full bg-slate-950 border border-slate-800 text-slate-200 text-xs rounded-lg pl-8 pr-3 py-1.5 focus:outline-none focus:border-indigo-500 transition-colors"
            />
          </div>

          <div className="overflow-y-auto flex-1 pr-1 space-y-1 fast-scroll-container">
            {treeLoading ? (
              <div className="text-xs text-slate-500 p-2 flex items-center gap-2">
                <RefreshCw className="w-3.5 h-3.5 animate-spin" /> Loading facility hierarchy...
              </div>
            ) : filteredTreeData.length > 0 ? (
              renderTreeNodes(filteredTreeData)
            ) : (
              <div className="text-xs text-slate-400 p-2 space-y-2">
                <p className="font-medium text-slate-300">
                  {searchQuery ? "No matching sites found" : "No facilities registered"}
                </p>
                <p className="text-[11px] text-slate-500 leading-relaxed">
                  {searchQuery
                    ? `No sites match "${searchQuery}". Clear search to view all.`
                    : "Register physical locations (sites, buildings, floors) to visualize live AP placement."}
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Right Floorplan Canvas (9 Cols) */}
        <div className="lg:col-span-9 bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-4">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <Layers className="w-5 h-5 text-purple-400" />
                {floorplan ? `${floorplan.building_name} — ${floorplan.name}` : "Floorplan Overview"}
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Normalized coordinate space • {filteredAPs.length} active AP markers rendered
              </p>
            </div>

            {floorplan && (
              <div>
                {floorplan.health_status === "healthy" && (
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                    <CheckCircle2 className="w-4 h-4" /> Floor Operational
                  </span>
                )}
                {floorplan.health_status === "degraded" && (
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/20">
                    <AlertTriangle className="w-4 h-4" /> Floor Degraded
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Interactive Blueprint Floorplan Canvas */}
          <div className="relative w-full h-[520px] bg-slate-950 rounded-xl border border-slate-800 overflow-hidden shadow-inner flex items-center justify-center">
            {/* Grid Lines Overlay */}
            <div
              className="absolute inset-0 opacity-15 pointer-events-none"
              style={{
                backgroundImage:
                  "linear-gradient(to right, #4f46e5 1px, transparent 1px), linear-gradient(to bottom, #4f46e5 1px, transparent 1px)",
                backgroundSize: "40px 40px",
              }}
            />

            {/* Architectural Room Outline Blueprint */}
            <div className="absolute inset-8 border-2 border-indigo-500/20 rounded-lg pointer-events-none flex flex-col justify-between p-4">
              <div className="flex justify-between text-[10px] text-indigo-400/40 font-mono">
                <span>ZONE-NORTH (Engineering)</span>
                <span>ZONE-EAST (Exec)</span>
              </div>
              <div className="flex justify-between text-[10px] text-indigo-400/40 font-mono">
                <span>ZONE-WEST (NOC Ops)</span>
                <span>ZONE-SOUTH (Cafeteria)</span>
              </div>
            </div>

            {/* AP Markers Overlay */}
            {filteredAPs.map((ap) => (
              <div
                key={ap.device_id}
                onClick={() => setSelectedAP(ap)}
                style={{ left: `${ap.x_pct}%`, top: `${ap.y_pct}%` }}
                className="absolute -translate-x-1/2 -translate-y-1/2 cursor-pointer group z-10 hover:z-[100]"
              >
                {/* Pulsing Halo */}
                <div
                  className={`absolute -inset-2 rounded-full opacity-40 animate-ping ${
                    ap.health_status === "critical"
                      ? "bg-red-500"
                      : ap.health_status === "degraded"
                      ? "bg-amber-400"
                      : "bg-emerald-400"
                  }`}
                />

                {/* Main AP Node Icon */}
                <div
                  className={`relative w-8 h-8 rounded-full border-2 flex items-center justify-center transition-transform group-hover:scale-125 shadow-lg ${
                    ap.health_status === "critical"
                      ? "bg-slate-900 border-red-500 text-red-400"
                      : ap.health_status === "degraded"
                      ? "bg-slate-900 border-amber-400 text-amber-400"
                      : "bg-slate-900 border-emerald-400 text-emerald-400"
                  }`}
                >
                  <Wifi className="w-4 h-4" />
                </div>

                {/* Tooltip Card on Hover */}
                <div
                  className={`absolute left-1/2 -translate-x-1/2 hidden group-hover:block w-60 bg-slate-900/98 border border-slate-700 rounded-lg p-2.5 shadow-2xl backdrop-blur-md z-[100] pointer-events-none ${
                    ap.y_pct < 30 ? "top-10" : "bottom-10"
                  }`}
                >
                  <div className="text-xs font-bold text-white truncate">{ap.name}</div>
                  <div className="text-[10px] font-medium text-indigo-300 mt-0.5 truncate">
                    {ap.x_pct < 50 && ap.y_pct < 50
                      ? "Conf Room 3 / Engineering"
                      : ap.x_pct >= 50 && ap.y_pct < 50
                      ? "Exec Boardroom"
                      : ap.x_pct < 50 && ap.y_pct >= 50
                      ? "NOC Ops / Data Center"
                      : "Cafeteria / Lounge"}
                  </div>
                  <div className="text-[10px] text-slate-400 mt-0.5 flex justify-between">
                    <span>IP: {ap.ip_address || "N/A"}</span>
                    <span className="uppercase text-indigo-400 font-semibold">{ap.vendor}</span>
                  </div>

                  {ap.health_status !== "healthy" && (
                    <div className="mt-1.5 bg-amber-500/10 border border-amber-500/30 rounded p-1.5 flex items-start gap-1 text-[10px] text-amber-300">
                      <AlertTriangle className="w-3.5 h-3.5 text-amber-400 flex-shrink-0 mt-0.5" />
                      <span>{ap.health_reason || "Interface Degraded / Frame Drops"}</span>
                    </div>
                  )}

                  <div className="mt-1.5 flex items-center justify-between text-[10px] text-slate-300 border-t border-slate-800 pt-1">
                    <span>Clients: {ap.client_count}</span>
                    <span>Ch: {ap.channel || 36}</span>
                    <span>{ap.rssi} dBm</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* AP Details Drawer Modal */}
      {selectedAP && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-slate-900 border border-slate-800 rounded-xl max-w-md w-full p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <Wifi className="w-5 h-5 text-indigo-400" />
                <h3 className="text-lg font-bold text-white">{selectedAP.name}</h3>
              </div>
              <button
                onClick={() => setSelectedAP(null)}
                className="text-slate-400 hover:text-white text-sm"
              >
                ✕
              </button>
            </div>

            {selectedAP.health_status !== "healthy" && (
              <div className="bg-amber-500/15 border border-amber-500/40 rounded-lg p-3 flex items-start gap-2.5 text-xs text-amber-200">
                <AlertTriangle className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
                <div>
                  <div className="font-bold uppercase tracking-wider text-[11px] text-amber-400">
                    {selectedAP.health_status === "critical"
                      ? "Critical Hardware Failure"
                      : "Degraded Operational Alert"}
                  </div>
                  <div className="mt-0.5 text-slate-200 leading-snug">
                    {selectedAP.health_reason || "High RF Co-Channel Interference & Frame Retries (>18%)"}
                  </div>
                </div>
              </div>
            )}

            <div className="space-y-2 text-xs">
              <div className="flex justify-between py-1 border-b border-slate-800">
                <span className="text-slate-400">Physical Room / Wing</span>
                <span className="font-semibold text-indigo-300">
                  {selectedAP.x_pct < 50 && selectedAP.y_pct < 50
                    ? "Conf Room 3 / Engineering (Zone North)"
                    : selectedAP.x_pct >= 50 && selectedAP.y_pct < 50
                    ? "Executive Boardroom (Zone East)"
                    : selectedAP.x_pct < 50 && selectedAP.y_pct >= 50
                    ? "NOC Ops & Data Center (Zone West)"
                    : "Cafeteria & Lounge (Zone South)"}
                </span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-800">
                <span className="text-slate-400">Device ID</span>
                <span className="font-mono text-slate-200">{selectedAP.device_id}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-800">
                <span className="text-slate-400">MAC Address</span>
                <span className="font-mono text-slate-200">{selectedAP.mac_address || "N/A"}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-800">
                <span className="text-slate-400">IP Address</span>
                <span className="font-mono text-slate-200">{selectedAP.ip_address || "N/A"}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-800">
                <span className="text-slate-400">Vendor</span>
                <span className="uppercase font-semibold text-indigo-400">{selectedAP.vendor}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-800">
                <span className="text-slate-400">Connected Clients</span>
                <span className="font-bold text-white">{selectedAP.client_count} Active Users</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-800">
                <span className="text-slate-400">Wi-Fi Channel</span>
                <span className="text-slate-200">Channel {selectedAP.channel || 36} (5 GHz)</span>
              </div>
              <div className="flex justify-between py-1">
                <span className="text-slate-400">Coordinates (X/Y)</span>
                <span className="font-mono text-slate-200">
                  {selectedAP.x_pct.toFixed(1)}% / {selectedAP.y_pct.toFixed(1)}%
                </span>
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <button
                onClick={() => setSelectedAP(null)}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold rounded-lg transition-colors"
              >
                Close Details
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Globe(props: any) {
  return <Activity {...props} />;
}
