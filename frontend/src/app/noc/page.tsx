"use client";

import React, {
  useEffect,
  useState,
  useMemo,
  useCallback,
  useRef,
  Suspense,
} from "react";
import { useSearchParams } from "next/navigation";
import {
  AlertTriangle,
  Building,
  ChevronDown,
  ChevronRight,
  Globe,
  ImageOff,
  Layers,
  MapPin,
  RefreshCw,
  Search,
  Sliders,
  Wifi,
  X,
} from "lucide-react";
import { fetchAPI } from "@/lib/api";
import { useQueryState } from "@/hooks/use-query-state";


interface APPlacement {
  device_id: string;
  name: string;
  mac_address?: string | null;
  ip_address?: string | null;
  vendor: string;
  model?: string | null;
  x_pct: number;
  y_pct: number;
  health_status: string;
  health_reason?: string | null;
  client_count: number;
  channel?: number | null;
  rssi?: number | null;
  channel_util?: number | null;
}

interface FloorplanData {
  location_id: string;
  name: string;
  building_name?: string;
  floor_number?: number | null;
  floorplan_image_url?: string | null;
  floorplan_width?: number | null;
  floorplan_height?: number | null;
  placed_ap_count?: number;
  unplaced_ap_count?: number;
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

type HeatmapMode = "placements" | "coverage" | "interference";
type HealthFilter = "all" | "degraded";

const HEATMAP_MODES = ["placements", "coverage", "interference"] as const;
const HEALTH_FILTERS = ["all", "degraded"] as const;

const GRADIENT_GOOD =
  "radial-gradient(circle, rgba(16, 185, 129, 0.35) 0%, rgba(16, 185, 129, 0.1) 45%, transparent 70%)";
const GRADIENT_WARN =
  "radial-gradient(circle, rgba(245, 158, 11, 0.4) 0%, rgba(245, 158, 11, 0.12) 50%, transparent 70%)";
const GRADIENT_BAD =
  "radial-gradient(circle, rgba(239, 68, 68, 0.35) 0%, rgba(239, 68, 68, 0.1) 50%, transparent 70%)";
const GRADIENT_INTERFERENCE_SEVERE =
  "radial-gradient(circle, rgba(239, 68, 68, 0.45) 0%, rgba(245, 158, 11, 0.2) 50%, transparent 75%)";
const GRADIENT_INTERFERENCE_MODERATE =
  "radial-gradient(circle, rgba(245, 158, 11, 0.4) 0%, rgba(245, 158, 11, 0.15) 50%, transparent 75%)";

function getCoverageGradient(ap: APPlacement): string {
  const rssi = ap.rssi ?? -65;
  if (ap.health_status === "critical" || rssi < -75) return GRADIENT_BAD;
  if (ap.health_status === "degraded" || rssi < -65) return GRADIENT_WARN;
  return GRADIENT_GOOD;
}

function interferenceGradient(ap: APPlacement): string | null {
  if (ap.channel_util == null || ap.channel_util < 20) return null;
  return ap.channel_util < 50
    ? GRADIENT_INTERFERENCE_MODERATE
    : GRADIENT_INTERFERENCE_SEVERE;
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
  const targetName = searchParams.get("name");
  const siteParam = searchParams.get("site_id");

  const [treeData, setTreeData] = useState<LocationTreeNode[]>([]);
  const [selectedFloorId, setSelectedFloorId] = useQueryState<string>("location_id", "");
  const [initialTarget] = useState(() => selectedFloorId || siteParam || "");
  const [floorplan, setFloorplan] = useState<FloorplanData | null>(null);
  const [selectedAP, setSelectedAP] = useState<APPlacement | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filterHealth, setFilterHealth] = useQueryState<HealthFilter>(
    "health",
    "all",
    HEALTH_FILTERS,
  );
  const [heatmapMode, setHeatmapMode] = useQueryState<HeatmapMode>(
    "layer",
    "placements",
    HEATMAP_MODES,
  );
  const [expandedNodes, setExpandedNodes] = useState<Record<string, boolean>>({});
  const [treeLoading, setTreeLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");

  const canvasRef = useRef<HTMLDivElement | null>(null);
  const nodeNamesRef = useRef<Record<string, string>>({});
  const fetchSeqRef = useRef(0);
  // useQueryState's setter is rebuilt on every searchParams change; a ref keeps
  // the tree fetch and the memoized tree rows from re-running on URL writes.
  const selectRef = useRef(setSelectedFloorId);
  useEffect(() => {
    selectRef.current = setSelectedFloorId;
  }, [setSelectedFloorId]);
  const selectLocation = useCallback((id: string) => {
    selectRef.current(id);
  }, []);
  const [canvasSize, setCanvasSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const [planImgError, setPlanImgError] = useState(false);
  const [planImgLoaded, setPlanImgLoaded] = useState(false);
  const [planNaturalSize, setPlanNaturalSize] = useState<{ w: number; h: number } | null>(null);

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

  const { siteCount, floorCount } = useMemo(() => {
    let sites = 0;
    let floors = 0;
    const walk = (nodes: LocationTreeNode[]) => {
      for (const n of nodes) {
        if (n.type === "site") sites += 1;
        else if (n.type === "floor") floors += 1;
        if (Array.isArray(n.children)) walk(n.children);
      }
    };
    walk(treeData);
    return { siteCount: sites, floorCount: floors };
  }, [treeData]);

  const fetchFloorplan = useCallback(
    async (locId: string): Promise<FloorplanData | null> => {
      if (!locId) return null;
      const seq = ++fetchSeqRef.current;
      setLoading(true);
      setLoadError(null);
      try {
        const label = nodeNamesRef.current[locId] || targetName;
        const base = `/locations/${encodeURIComponent(locId)}/floorplan`;
        const endpoint = label ? `${base}?name=${encodeURIComponent(label)}` : base;
        const data = await fetchAPI<FloorplanData>(endpoint);
        if (seq !== fetchSeqRef.current) return data ?? null;
        setFloorplan(data ?? null);
        return data ?? null;
      } catch (err) {
        console.warn("Failed to fetch floorplan:", err);
        if (seq !== fetchSeqRef.current) return null;
        // Keeping the previous floor's APs on screen would attribute them to the
        // location now selected.
        setFloorplan(null);
        setLoadError("Could not load floorplan data for this location.");
        return null;
      } finally {
        if (seq === fetchSeqRef.current) setLoading(false);
      }
    },
    [targetName],
  );

  const fetchTree = useCallback(async () => {
    setTreeLoading(true);
    try {
      const data = await fetchAPI<LocationTreeNode[]>("/locations/tree");
      const nodes = Array.isArray(data) ? data : [];
      setTreeData(nodes);

      const names: Record<string, string> = {};
      const collect = (ns: LocationTreeNode[]) => {
        for (const n of ns) {
          names[n.location_id] = n.name;
          if (Array.isArray(n.children)) collect(n.children);
        }
      };
      collect(nodes);
      nodeNamesRef.current = names;

      if (nodes.length === 0) {
        setLoading(false);
        return;
      }

      const pathTo = (ns: LocationTreeNode[], id: string): LocationTreeNode[] | null => {
        for (const n of ns) {
          if (n.location_id === id) return [n];
          if (Array.isArray(n.children)) {
            const childPath = pathTo(n.children, id);
            if (childPath) return [n, ...childPath];
          }
        }
        return null;
      };

      const search = (ns: LocationTreeNode[]): LocationTreeNode[] | null => {
        for (const n of ns) {
          const idMatch =
            !!initialTarget &&
            (n.location_id === initialTarget ||
              n.location_id.toLowerCase().includes(initialTarget.toLowerCase()));
          const nameMatch =
            !!targetName && n.name.toLowerCase().includes(targetName.toLowerCase());
          if (idMatch || nameMatch) return [n];
          if (Array.isArray(n.children)) {
            const childPath = search(n.children);
            if (childPath) return [n, ...childPath];
          }
        }
        return null;
      };

      // Only floors carry a floorplan image, so an unqualified landing lands on one.
      const firstFloor = (ns: LocationTreeNode[]): LocationTreeNode[] | null => {
        for (const n of ns) {
          if (n.type === "floor") return [n];
          if (Array.isArray(n.children)) {
            const childPath = firstFloor(n.children);
            if (childPath) return [n, ...childPath];
          }
        }
        return null;
      };

      const path =
        (initialTarget ? pathTo(nodes, initialTarget) : null) ??
        search(nodes) ??
        firstFloor(nodes) ??
        [nodes[0]];

      setExpandedNodes(
        path.reduce<Record<string, boolean>>((acc, n) => {
          acc[n.location_id] = true;
          return acc;
        }, {}),
      );
      selectLocation(path[path.length - 1].location_id);
    } catch (err) {
      console.warn("Failed to fetch location tree:", err);
      setLoading(false);
    } finally {
      setTreeLoading(false);
    }
  }, [initialTarget, targetName, selectLocation]);

  useEffect(() => {
    void fetchTree();
  }, [fetchTree]);

  useEffect(() => {
    if (!selectedFloorId) return;
    void fetchFloorplan(selectedFloorId);
  }, [selectedFloorId, fetchFloorplan]);

  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    setCanvasSize({ w: el.clientWidth, h: el.clientHeight });
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect) setCanvasSize({ w: rect.width, h: rect.height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const planUrl = floorplan?.floorplan_image_url || null;

  useEffect(() => {
    setPlanImgError(false);
    setPlanImgLoaded(false);
    setPlanNaturalSize(null);
  }, [planUrl]);

  const handleSelectNode = useCallback(
    (node: LocationTreeNode) => {
      setSelectedAP(null);
      selectLocation(node.location_id);
    },
    [selectLocation],
  );

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

  const placedCount = floorplan?.placed_ap_count ?? floorplan?.ap_placements?.length ?? 0;
  const unplacedCount = floorplan?.unplaced_ap_count ?? 0;

  const hasChannelUtil = useMemo(
    () => (floorplan?.ap_placements ?? []).some((ap) => ap.channel_util != null),
    [floorplan]
  );
  const hasRssi = useMemo(
    () => (floorplan?.ap_placements ?? []).some((ap) => ap.rssi != null),
    [floorplan]
  );
  const modeAvailable = (mode: HeatmapMode) => {
    if (mode === "placements") return true;
    if (mode === "coverage") return hasChannelUtil || hasRssi;
    return hasChannelUtil;
  };
  const activeModeUnavailable = !modeAvailable(heatmapMode);

  const planBox = useMemo(() => {
    const { w: cw, h: ch } = canvasSize;
    if (cw <= 0 || ch <= 0) return null;
    const pad = 24;
    const availW = Math.max(cw - pad * 2, 1);
    const availH = Math.max(ch - pad * 2, 1);
    const iw = floorplan?.floorplan_width ?? planNaturalSize?.w ?? 0;
    const ih = floorplan?.floorplan_height ?? planNaturalSize?.h ?? 0;
    if (iw <= 0 || ih <= 0) {
      return { left: pad, top: pad, width: availW, height: availH };
    }
    const scale = Math.min(availW / iw, availH / ih);
    const width = iw * scale;
    const height = ih * scale;
    return { left: (cw - width) / 2, top: (ch - height) / 2, width, height };
  }, [canvasSize, floorplan?.floorplan_width, floorplan?.floorplan_height, planNaturalSize]);

  // Radius is decorative — FloorplanResponse carries no metres-per-pixel, so it
  // is scaled to the rendered plan instead of a fixed pixel size.
  const ringPx = planBox
    ? Math.max(48, Math.min(planBox.width, planBox.height) * 0.14)
    : 0;

  const showPlanImage = !!planUrl && !planImgError;

  return (
    <div className="h-[calc(100vh-3.5rem)] flex flex-col bg-slate-950">
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
            <span>{placedCount} APs</span>
            {degradedCount > 0 && (
              <span className="text-amber-400">{degradedCount} degraded</span>
            )}
            {unplacedCount > 0 && (
              <>
                <span className="text-slate-700">|</span>
                <span title="APs assigned to this site but with no position on a floorplan">
                  {unplacedCount} not placed on a plan
                </span>
              </>
            )}
          </div>
        </div>

        <div className="flex items-center gap-4 flex-shrink-0">
          {/* Layer Tabs */}
          <div className="hidden sm:flex items-center gap-0 text-xs">
            {HEATMAP_MODES.map((mode) => {
              const available = modeAvailable(mode);
              return (
                <button
                  key={mode}
                  onClick={() => setHeatmapMode(mode)}
                  disabled={!available}
                  title={available ? undefined : "No RF telemetry available for these APs"}
                  className={`px-3 py-1.5 font-medium transition-colors border-b-2 disabled:opacity-40 disabled:cursor-not-allowed ${
                    heatmapMode === mode
                      ? "text-white border-indigo-500"
                      : "text-slate-500 border-transparent hover:text-slate-300"
                  }`}
                >
                  {mode === "placements" && "AP Placement"}
                  {mode === "coverage" && "RF Coverage"}
                  {mode === "interference" && "Interference"}
                </button>
              );
            })}
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
              <span className="text-[10px] text-slate-500">
                {siteCount} sites · {floorCount} floors
              </span>
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
          <div ref={canvasRef} className="flex-1 relative overflow-hidden">
            {(!showPlanImage || !planImgLoaded) && (
              <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(30,41,59,0.4)_1px,transparent_1px),linear-gradient(to_bottom,rgba(30,41,59,0.4)_1px,transparent_1px)] bg-[size:4rem_4rem]" />
            )}

            {planBox && (
              <div
                className="absolute"
                style={{
                  left: `${planBox.left}px`,
                  top: `${planBox.top}px`,
                  width: `${planBox.width}px`,
                  height: `${planBox.height}px`,
                }}
              >
                {showPlanImage && planUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={planUrl}
                    alt={floorplan?.name ? `Floorplan: ${floorplan.name}` : "Floorplan"}
                    draggable={false}
                    onLoad={(e) => {
                      setPlanImgLoaded(true);
                      // Backend dims are authoritative (x/y live in that pixel
                      // space); fall back to the decoded image when they are null.
                      const img = e.currentTarget;
                      if (
                        !floorplan?.floorplan_width &&
                        img.naturalWidth > 0 &&
                        img.naturalHeight > 0
                      ) {
                        setPlanNaturalSize({ w: img.naturalWidth, h: img.naturalHeight });
                      }
                    }}
                    onError={() => setPlanImgError(true)}
                    // object-fill, not contain: the box already carries the map's
                    // aspect, and x_pct/y_pct must land on the same pixel space.
                    className="absolute inset-0 w-full h-full object-fill select-none pointer-events-none"
                  />
                )}

                {displayedAPs.map((ap) => {
                  const isSelected = selectedAP?.device_id === ap.device_id;
                  const covGradient = heatmapMode === "coverage" ? getCoverageGradient(ap) : null;
                  const intfGradient = heatmapMode === "interference" ? interferenceGradient(ap) : null;

                  return (
                    <div
                      key={ap.device_id}
                      onClick={() => setSelectedAP(ap)}
                      style={{ left: `${ap.x_pct}%`, top: `${ap.y_pct}%` }}
                      className="absolute -translate-x-1/2 -translate-y-1/2 cursor-pointer transition-all duration-200 group z-10"
                    >
                      {/* Crisp Enterprise RF Signal Coverage Heatmap Layer (Evaluated by RSSI dBm) */}
                      {covGradient && (
                        <div
                          style={{
                            width: "160px",
                            height: "160px",
                            background: covGradient,
                          }}
                          className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full pointer-events-none animate-pulse"
                        />
                      )}

                      {/* Interference Layer */}
                      {intfGradient && (
                        <div
                          style={{
                            width: "140px",
                            height: "140px",
                            background: intfGradient,
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
                        <div className="text-slate-400 mt-0.5">
                          {ap.vendor.toUpperCase()} · {ap.client_count} Clients
                          {ap.model ? ` · ${ap.model}` : ""}
                        </div>
                        {ap.channel_util != null && (
                          <div className="text-slate-400 text-[10px] mt-0.5">
                            Channel utilization: {ap.channel_util.toFixed(1)}%
                          </div>
                        )}
                        {ap.health_reason && (
                          <div className="text-amber-400 text-[10px] font-medium mt-1">{ap.health_reason}</div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Non-blocking notices */}
            {!loading && (
              <div className="absolute top-3 left-1/2 -translate-x-1/2 z-30 flex flex-col items-center gap-1.5 pointer-events-none">
                {loadError && (
                  <span className="flex items-center gap-1.5 px-2.5 py-1 bg-slate-900/90 border border-slate-800 rounded-sm text-[11px] text-slate-400">
                    <AlertTriangle className="w-3.5 h-3.5 text-rose-400" />
                    {loadError}
                  </span>
                )}
                {planUrl && planImgError && (
                  <span className="flex items-center gap-1.5 px-2.5 py-1 bg-slate-900/90 border border-slate-800 rounded-sm text-[11px] text-slate-400">
                    <ImageOff className="w-3.5 h-3.5 text-amber-400" />
                    Floorplan image could not be loaded
                  </span>
                )}
                {!planUrl && displayedAPs.length > 0 && (
                  <span className="flex items-center gap-1.5 px-2.5 py-1 bg-slate-900/90 border border-slate-800 rounded-sm text-[11px] text-slate-400">
                    <ImageOff className="w-3.5 h-3.5 text-slate-500" />
                    No floorplan image for this location
                  </span>
                )}
                {activeModeUnavailable && displayedAPs.length > 0 && (
                  <span className="flex items-center gap-1.5 px-2.5 py-1 bg-slate-900/90 border border-slate-800 rounded-sm text-[11px] text-slate-400">
                    <AlertTriangle className="w-3.5 h-3.5 text-slate-500" />
                    No RF telemetry for these APs
                  </span>
                )}
              </div>
            )}

            {/* Empty state */}
            {!loading && displayedAPs.length === 0 && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="text-center">
                  {planUrl ? (
                    <Wifi className="w-8 h-8 text-slate-700 mx-auto mb-2" />
                  ) : (
                    <ImageOff className="w-8 h-8 text-slate-700 mx-auto mb-2" />
                  )}
                  <p className="text-sm text-slate-500">
                    {!floorplan
                      ? "Select a floor in the facility tree"
                      : planUrl
                      ? filterHealth === "degraded"
                        ? "No degraded access points on this floorplan"
                        : "No access points placed on this floorplan"
                      : "No floorplan image for this location"}
                  </p>
                  {floorplan && !planUrl && (
                    <p className="text-xs text-slate-600 mt-1">
                      {`${floorplan.name} has no plan image in the source system`}
                    </p>
                  )}
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
              {heatmapMode === "coverage" && "RF Coverage"}
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

            {heatmapMode === "coverage" && hasChannelUtil && (
              <>
                <span className="flex items-center gap-1.5 text-slate-400">
                  <span className="w-2 h-2 rounded-full bg-emerald-500/80" /> Clear (&lt;20% util)
                </span>
                <span className="flex items-center gap-1.5 text-slate-400">
                  <span className="w-2 h-2 rounded-full bg-amber-500/80" /> Busy (20-50% util)
                </span>
                <span className="flex items-center gap-1.5 text-slate-400">
                  <span className="w-2 h-2 rounded-full bg-rose-500/80" /> Saturated (&gt;50% util)
                </span>
              </>
            )}

            {heatmapMode === "coverage" && !hasChannelUtil && hasRssi && (
              <>
                <span className="flex items-center gap-1.5 text-slate-400">
                  <span className="w-2 h-2 rounded-full bg-emerald-500/80" /> &ge; -65 dBm
                </span>
                <span className="flex items-center gap-1.5 text-slate-400">
                  <span className="w-2 h-2 rounded-full bg-amber-500/80" /> -66 to -75 dBm
                </span>
                <span className="flex items-center gap-1.5 text-slate-400">
                  <span className="w-2 h-2 rounded-full bg-rose-500/80" /> &lt; -75 dBm
                </span>
              </>
            )}

            {heatmapMode === "coverage" && !hasChannelUtil && !hasRssi && (
              <span className="text-slate-500">No RF telemetry for these APs</span>
            )}

            {heatmapMode === "interference" && hasChannelUtil && (
              <>
                <span className="flex items-center gap-1.5 text-slate-400">
                  <span className="w-2 h-2 rounded-full bg-rose-500/80" /> Severe (&gt;50% util)
                </span>
                <span className="flex items-center gap-1.5 text-slate-400">
                  <span className="w-2 h-2 rounded-full bg-amber-500/80" /> Moderate (20-50% util)
                </span>
                <span className="text-slate-500">No overlay below 20% util</span>
              </>
            )}

            {heatmapMode === "interference" && !hasChannelUtil && (
              <span className="text-slate-500">No channel utilization telemetry for these APs</span>
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
                    <span className="text-slate-200 font-medium block">{selectedAP.mac_address || "—"}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block text-[10px] uppercase tracking-wider">IP Address</span>
                    <span className="text-slate-200 font-medium block">{selectedAP.ip_address || "—"}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block text-[10px] uppercase tracking-wider">Vendor</span>
                    <span className="text-slate-200 font-medium block">{selectedAP.vendor.toUpperCase()}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block text-[10px] uppercase tracking-wider">Model</span>
                    <span className="text-slate-200 font-medium block">{selectedAP.model || "—"}</span>
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
                    <span className="text-sm font-semibold text-white mt-0.5 block">
                      {selectedAP.channel ?? "—"}
                    </span>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-500 uppercase tracking-wider block">RSSI</span>
                    <span className="text-sm font-semibold text-white mt-0.5 block">
                      {selectedAP.rssi != null ? `${selectedAP.rssi} dBm` : "—"}
                    </span>
                  </div>
                </div>
                <div className="text-xs text-slate-400">
                  Channel utilization:{" "}
                  <span className="text-slate-200 font-medium">
                    {selectedAP.channel_util != null
                      ? `${selectedAP.channel_util.toFixed(1)}%`
                      : "—"}
                  </span>
                </div>
              </div>

              {/* Diagnostic */}
              {selectedAP.health_status !== "healthy" && (
                <div className="space-y-2 pt-2 border-t border-slate-800/60">
                  <span className="text-[10px] font-semibold text-rose-400 uppercase tracking-wider flex items-center gap-1.5">
                    <AlertTriangle className="w-3.5 h-3.5" />
                    Diagnostic Root Cause
                  </span>
                  {selectedAP.health_reason ? (
                    <p className="text-xs text-slate-300 leading-relaxed">{selectedAP.health_reason}</p>
                  ) : (
                    <p className="text-xs text-slate-500 leading-relaxed">No diagnostic detail reported.</p>
                  )}
                  <p className="text-[11px] text-slate-500">
                    Impact: {selectedAP.client_count} active client sessions.
                  </p>
                </div>
              )}
            </div>

            {/* Panel Footer Actions */}
            <div className="shrink-0 px-5 py-3 border-t border-slate-800/60 flex items-center justify-end">
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
      <div className="h-[calc(100vh-3.5rem)] flex items-center justify-center bg-slate-950">
        <div className="text-xs text-slate-500 animate-pulse">Loading NOC Floorplan...</div>
      </div>
    }>
      <NOCFloorplanContent />
    </Suspense>
  );
}
