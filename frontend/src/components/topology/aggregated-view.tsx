import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactFlow, { Background, Controls, type Node, type Edge } from "reactflow";
import "reactflow/dist/style.css";
import { MarkerType } from "reactflow";

import type { TopologyGraphResponse, DeviceCategory, TopologyNode, HealthStatus } from "@/types/topology";
import { AGGREGATED_VIEW_THRESHOLD, HEALTH_STATUS_META, CATEGORY_META } from "@/types/topology";
import { aggregateByCategory, getDeviceCategory } from "@/lib/topology-utils";
import { TypeClusterNode, CLUSTER_NODE_WIDTH, CLUSTER_NODE_HEIGHT } from "./type-cluster-node";
import { DeviceBrowser } from "./device-browser";
import { ContextGraph } from "./context-graph";
import { AlertTriangle, CheckCircle, HelpCircle, Search, X, List, Expand } from "lucide-react";

const nodeTypes = { typeCluster: TypeClusterNode };

interface AggregatedViewProps {
  data: TopologyGraphResponse;
  onContextSelect: (nodeId: string, nodeName: string) => void;
  onFlatView: () => void;
}

const GAP_X = 60;
const GAP_Y = 80;
const START_X = 80;
const START_Y = 60;

function buildClusterLayout(
  clusters: ReturnType<typeof aggregateByCategory>,
  siteNodeName?: string,
) {
  const nodes: Node[] = [];
  const edges: Edge[] = [];

  const totalWidth = clusters.length * CLUSTER_NODE_WIDTH + (clusters.length - 1) * GAP_X;
  const startX = START_X + Math.max(0, (800 - totalWidth) / 2);

  let siteNodeId: string | null = null;
  if (siteNodeName) {
    siteNodeId = "aggregated-site-node";
    const siteX = startX + totalWidth / 2 - 100;
    nodes.push({
      id: siteNodeId,
      type: "default",
      position: { x: siteX, y: START_Y },
      data: { label: siteNodeName },
      style: {
        background: "hsl(var(--surface))",
        border: "2px solid #8b5cf6",
        borderRadius: 12,
        padding: "10px 20px",
        fontSize: 14,
        fontWeight: 600,
        color: "hsl(var(--foreground))",
        width: 200,
        textAlign: "center",
      },
    });
  }

  for (let i = 0; i < clusters.length; i++) {
    const cluster = clusters[i];
    const x = startX + i * (CLUSTER_NODE_WIDTH + GAP_X);
    const y = siteNodeId ? START_Y + 120 : START_Y;
    const id = `cluster-${cluster.category}`;

    nodes.push({
      id,
      type: "typeCluster",
      position: { x, y },
      data: { cluster },
    });

    if (siteNodeId) {
      edges.push({
        id: `edge-site-${cluster.category}`,
        source: siteNodeId,
        target: id,
        type: "smoothstep",
        animated: false,
        style: { stroke: "#6b7280", strokeWidth: 1.5, strokeDasharray: "4 4" },
        markerEnd: { type: MarkerType.ArrowClosed, color: "#6b7280" },
      });
    }
  }

  return { nodes, edges };
}

function healthIcon(status: string, className = "h-3.5 w-3.5") {
  const color = HEALTH_STATUS_META[status]?.color ?? "#888";
  if (status === "critical") return <AlertTriangle className={className} style={{ color }} />;
  if (status === "warning") return <AlertTriangle className={className} style={{ color }} />;
  if (status === "healthy") return <CheckCircle className={className} style={{ color }} />;
  return <HelpCircle className={className} style={{ color }} />;
}

function computeSummary(nodes: TopologyNode[]) {
  const s = { critical: 0, warning: 0, healthy: 0, unknown: 0 };
  for (const n of nodes) {
    const k = n.health_status === "healthy" ? "healthy" : n.health_status === "warning" ? "warning" : n.health_status === "critical" ? "critical" : "unknown";
    s[k]++;
  }
  return s;
}

const SUMMARY_ORDER = [
  { key: "critical" as const, label: "Critical", color: HEALTH_STATUS_META.critical.color },
  { key: "warning" as const, label: "Warning", color: HEALTH_STATUS_META.warning.color },
  { key: "healthy" as const, label: "Healthy", color: HEALTH_STATUS_META.healthy.color },
  { key: "unknown" as const, label: "Unknown", color: HEALTH_STATUS_META.unknown.color },
];

export function AggregatedView({ data, onContextSelect, onFlatView }: AggregatedViewProps) {
  const reactFlowInstance = useRef<any>(null);
  const [selectedCategory, setSelectedCategory] = useState<DeviceCategory | null>(null);
  const [healthFilter, setHealthFilter] = useState<HealthStatus | null>(null);
  const [globalSearch, setGlobalSearch] = useState("");
  const firstFitDone = useRef(false);

  const nonSiteNodes = useMemo(
    () => data.nodes.filter((n) => n.node_type !== "site"),
    [data.nodes],
  );

  const siteNode = useMemo(
    () => data.nodes.find((n) => n.node_type === "site"),
    [data.nodes],
  );

  const clusters = useMemo(() => aggregateByCategory(nonSiteNodes), [nonSiteNodes]);

  const summary = useMemo(() => computeSummary(nonSiteNodes), [nonSiteNodes]);

  const { nodes: layoutNodes, edges: layoutEdges } = useMemo(
    () => buildClusterLayout(clusters, siteNode?.name),
    [clusters, siteNode?.name],
  );

  useEffect(() => {
    if (reactFlowInstance.current && !firstFitDone.current && layoutNodes.length > 0) {
      firstFitDone.current = true;
      setTimeout(() => reactFlowInstance.current.fitView({ padding: 0.3, duration: 300 }), 100);
    }
  }, [layoutNodes.length]);

  // Escape key to close DeviceBrowser
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && selectedCategory) {
        setSelectedCategory(null);
        setHealthFilter(null);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedCategory]);

  const onNodeClick = useCallback(
    (event: React.MouseEvent, node: Node) => {
      if (node.id.startsWith("cluster-")) {
        const category = node.id.replace("cluster-", "") as DeviceCategory;
        // Check if a health badge was clicked inside the node
        const target = event.target as HTMLElement;
        const badgeFilter = target.closest("[data-health-filter]")?.getAttribute("data-health-filter");
        if (badgeFilter) {
          setHealthFilter(badgeFilter as HealthStatus);
        } else {
          setHealthFilter(null);
        }
        setSelectedCategory(category);
      }
    },
    [],
  );

  const selectedCluster = selectedCategory
    ? clusters.find((c) => c.category === selectedCategory)
    : undefined;

  const handleDeviceSelect = useCallback(
    (nodeId: string, nodeName: string) => {
      setSelectedCategory(null);
      setHealthFilter(null);
      onContextSelect(nodeId, nodeName);
    },
    [onContextSelect],
  );

  const handleBack = useCallback(() => {
    setSelectedCategory(null);
    setHealthFilter(null);
  }, []);

  // Global search results
  const globalResults = useMemo(() => {
    if (!globalSearch.trim()) return [];
    const q = globalSearch.toLowerCase();
    return nonSiteNodes
      .filter((n) =>
        (n.name || "").toLowerCase().includes(q) ||
        n.node_id.toLowerCase().includes(q) ||
        (n.ip_address || "").toLowerCase().includes(q),
      )
      .slice(0, 20);
  }, [globalSearch, nonSiteNodes]);

  const handleGlobalResultClick = useCallback((node: TopologyNode) => {
    const cat = getDeviceCategory(node);
    setSelectedCategory(cat);
    setGlobalSearch("");
    // Search for the specific device name within the browser
  }, []);

  return (
    <div className="relative">
      {/* Toolbar */}
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 text-sm text-foreground-muted">
          <List className="h-4 w-4" />
          <span className="whitespace-nowrap">
            Aggregated · {nonSiteNodes.length} devices
          </span>
        </div>

        {/* Health summary badges */}
        <div className="flex items-center gap-2">
          {SUMMARY_ORDER.map((s) =>
            summary[s.key] > 0 ? (
              <span
                key={s.key}
                className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium"
                style={{ backgroundColor: s.color + "12", color: s.color }}
              >
                {summary[s.key]}
                <span className="opacity-70 font-normal">{s.label}</span>
              </span>
            ) : null
          )}
        </div>

        {/* Global search */}
        <div className="relative ml-auto">
          <Search className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-foreground-subtle" />
          <input
            type="text"
            value={globalSearch}
            onChange={(e) => setGlobalSearch(e.target.value)}
            placeholder="Search all devices..."
            className="w-48 rounded-md border border-border/40 bg-surface py-1 pl-7 pr-2 text-[11px] text-foreground outline-none placeholder:text-foreground-subtle focus:w-64 focus:border-primary/50 transition-all"
          />
          {globalResults.length > 0 && (
            <div className="absolute right-0 top-full z-50 mt-1 w-72 rounded-lg border border-border/40 bg-surface shadow-surface-lg">
              {globalResults.map((n) => {
                const cat = getDeviceCategory(n);
                const cMeta = CATEGORY_META[cat];
                return (
                  <button
                    key={n.node_id}
                    onClick={() => handleGlobalResultClick(n)}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-surface-hover first:rounded-t-lg last:rounded-b-lg"
                  >
                    <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: cMeta.color }} />
                    <span className="truncate font-medium text-foreground">{n.name || n.node_id}</span>
                    <span className="ml-auto shrink-0 text-[9px] text-foreground-subtle">{n.node_type}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {nonSiteNodes.length >= AGGREGATED_VIEW_THRESHOLD && (
          <button
            onClick={onFlatView}
            className="inline-flex items-center gap-1 rounded-md border border-border/40 px-2 py-1 text-[11px] font-medium text-foreground-subtle transition-colors hover:bg-surface hover:text-foreground"
          >
            <Expand className="h-3 w-3" />
            Show all
          </button>
        )}
      </div>

      {/* Main area: graph + side panel */}
      <div className="flex gap-4">
        <div className="h-[600px] flex-1">
          {layoutNodes.length > 0 ? (
            <ReactFlow
              nodes={layoutNodes}
              edges={layoutEdges}
              nodeTypes={nodeTypes}
              onInit={(instance) => { reactFlowInstance.current = instance; }}
              onNodeClick={onNodeClick}
              fitView
              onlyRenderVisibleElements
              attributionPosition="bottom-left"
              minZoom={0.3}
              maxZoom={3}
              className="rounded-xl border border-border/40 bg-surface/20"
            >
              <Background color="hsl(var(--border) / 0.3)" gap={20} size={1} />
              <Controls className="!rounded-lg !border-border/60 !bg-surface !shadow-surface" showInteractive={false} />
            </ReactFlow>
          ) : (
            <div className="flex h-full items-center justify-center rounded-xl border-2 border-dashed border-border/40">
              <p className="text-sm text-foreground-muted">No devices to show</p>
            </div>
          )}
        </div>

        {/* Device browser panel */}
        {selectedCategory && selectedCluster && (
          <DeviceBrowser
            nodes={nonSiteNodes.filter((n) => getDeviceCategory(n) === selectedCategory)}
            cluster={selectedCluster}
            onSelect={handleDeviceSelect}
            onClose={handleBack}
            initialHealthFilter={healthFilter ?? undefined}
          />
        )}
      </div>
    </div>
  );
}
