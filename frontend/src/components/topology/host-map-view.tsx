"use client";

/**
 * Host Map View
 *
 * Clean table-based device inventory for large sites. Groups devices by
 * category with collapsible sections, sorted critical-first. Replaces the
 * unreadable tag-cloud tile grid with a spacious table layout matching the
 * Locations Registry and NOC pages.
 */

import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Server, Wifi, Shield, Monitor, Search, CheckCircle2 } from "lucide-react";
import type { TopologyGraphResponse, TopologyNode, DeviceCategory, HealthStatus } from "@/types/topology";
import { HEALTH_STATUS_META, NODE_TYPE_META, CATEGORY_META } from "@/types/topology";
import { aggregateByCategory } from "@/lib/topology-utils";
import { isAlerting, severityWeight } from "@/lib/large-site-utils";

const CATEGORY_ICONS: Record<DeviceCategory, React.ReactNode> = {
  core_network: <Server className="h-4 w-4" />,
  edge_security: <Shield className="h-4 w-4" />,
  wireless: <Wifi className="h-4 w-4" />,
  leaf: <Monitor className="h-4 w-4" />,
};

type HealthFilter = "all" | "alerting" | "critical" | "warning" | "healthy";

function matchesFilter(node: TopologyNode, filter: HealthFilter): boolean {
  switch (filter) {
    case "all":
      return true;
    case "alerting":
      return isAlerting(node);
    case "critical":
    case "warning":
    case "healthy":
      return node.health_status === filter;
  }
}

function StatusCell({ status }: { status: string }) {
  const meta = HEALTH_STATUS_META[status] ?? HEALTH_STATUS_META.unknown;
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase">
      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: meta.color }} />
      <span style={{ color: meta.color }}>{meta.label}</span>
    </span>
  );
}

interface HostMapViewProps {
  data: TopologyGraphResponse;
  onContextSelect: (nodeId: string, nodeName: string) => void;
}

export function HostMapView({ data, onContextSelect }: HostMapViewProps) {
  const [healthFilter, setHealthFilter] = useState<HealthFilter>("alerting");
  const [search, setSearch] = useState("");
  const [collapsedCategories, setCollapsedCategories] = useState<Set<DeviceCategory>>(new Set());

  const deviceNodes = useMemo(
    () => data.nodes.filter((n) => n.node_type !== "site"),
    [data.nodes],
  );

  const counts = useMemo(() => {
    const c = { critical: 0, warning: 0, healthy: 0, unknown: 0, alerting: 0 };
    for (const n of deviceNodes) {
      if (n.health_status === "critical") c.critical++;
      else if (n.health_status === "warning") c.warning++;
      else if (n.health_status === "healthy") c.healthy++;
      else c.unknown++;
    }
    c.alerting = c.critical + c.warning;
    return c;
  }, [deviceNodes]);

  const clusters = useMemo(() => aggregateByCategory(deviceNodes), [deviceNodes]);

  const query = search.trim().toLowerCase();

  const visibleByCategory = useMemo(() => {
    const map = new Map<DeviceCategory, TopologyNode[]>();
    for (const cluster of clusters) {
      const list = cluster.nodeIds
        .map((id) => deviceNodes.find((n) => n.node_id === id)!)
        .filter(Boolean)
        .filter((n) => matchesFilter(n, healthFilter))
        .filter(
          (n) =>
            !query ||
            (n.name || "").toLowerCase().includes(query) ||
            n.node_id.toLowerCase().includes(query) ||
            (n.ip_address || "").toLowerCase().includes(query),
        )
        .sort((a, b) => {
          const sev = severityWeight(b.health_status) - severityWeight(a.health_status);
          return sev !== 0 ? sev : (a.name || a.node_id).localeCompare(b.name || b.node_id);
        });
      map.set(cluster.category, list);
    }
    return map;
  }, [clusters, deviceNodes, healthFilter, query]);

  const totalVisible = useMemo(
    () => Array.from(visibleByCategory.values()).reduce((acc, l) => acc + l.length, 0),
    [visibleByCategory],
  );

  const toggleCategory = (cat: DeviceCategory) => {
    setCollapsedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  };

  const filterChips: { key: HealthFilter; label: string; count: number; color?: string }[] = [
    { key: "alerting", label: "Alerting", count: counts.alerting, color: HEALTH_STATUS_META.critical.color },
    { key: "critical", label: "Critical", count: counts.critical, color: HEALTH_STATUS_META.critical.color },
    { key: "warning", label: "Warning", count: counts.warning, color: HEALTH_STATUS_META.warning.color },
    { key: "all", label: "All", count: deviceNodes.length },
  ];

  return (
    <div className="space-y-4" data-testid="host-map-view">
      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-3 border-b border-slate-800/60 pb-4">
        <div className="flex items-center gap-1">
          {filterChips.map((chip) => (
            <button
              key={chip.key}
              data-testid={`hostmap-filter-${chip.key}`}
              onClick={() => setHealthFilter(chip.key)}
              className={[
                "px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider transition-colors border-b-2 cursor-pointer",
                healthFilter === chip.key
                  ? "text-indigo-400 border-indigo-500"
                  : "text-slate-400 hover:text-slate-200 border-transparent",
              ].join(" ")}
            >
              {chip.label}
              <span className="ml-1 text-[10px] opacity-70">{chip.count}</span>
            </button>
          ))}
        </div>

        <div className="relative ml-auto">
          <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter devices…"
            data-testid="hostmap-search"
            className="w-56 bg-transparent border-b border-slate-800/60 pl-9 pr-3 py-2 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-500 transition-colors"
          />
        </div>

        <span className="text-[11px] text-slate-500" data-testid="hostmap-visible-count">
          {totalVisible} of {deviceNodes.length} shown
        </span>
      </div>

      {/* Category groups */}
      {clusters.map((cluster) => {
        const visible = visibleByCategory.get(cluster.category) ?? [];
        const meta = CATEGORY_META[cluster.category];
        const hd = cluster.healthDistribution;
        const totalCategoryNodes = cluster.nodeIds.length;

        // If category has devices but none match current filter (e.g. switches are all healthy while filtering alerting)
        if (visible.length === 0) {
          if (totalCategoryNodes === 0) return null;
          return (
            <div key={cluster.category} className="py-2 border-t border-slate-800/40">
              <button
                onClick={() => setHealthFilter("all")}
                className="flex items-center gap-2 text-xs text-slate-500 hover:text-slate-300 transition-colors cursor-pointer"
              >
                <span style={{ color: meta.color }}>{CATEGORY_ICONS[cluster.category]}</span>
                <span className="font-semibold text-slate-400">{cluster.label}</span>
                <span className="font-mono text-[11px]">({totalCategoryNodes} devices · {hd.healthy_count} Healthy)</span>
                <span className="inline-flex items-center gap-1 text-[10px] text-indigo-400 underline ml-2">
                  <CheckCircle2 className="h-3 w-3 text-emerald-500" />
                  Show healthy infrastructure
                </span>
              </button>
            </div>
          );
        }

        const collapsed = collapsedCategories.has(cluster.category);
        return (
          <div key={cluster.category} data-testid={`hostmap-group-${cluster.category}`}>
            {/* Category header — no box, just a border-top separator */}
            <button
              onClick={() => toggleCategory(cluster.category)}
              className="flex w-full items-center gap-2 py-2.5 text-left border-t border-slate-800/40 transition-colors hover:text-slate-300 cursor-pointer"
            >
              {collapsed ? (
                <ChevronRight className="h-3.5 w-3.5 text-slate-600" />
              ) : (
                <ChevronDown className="h-3.5 w-3.5 text-slate-600" />
              )}
              <span style={{ color: meta.color }}>{CATEGORY_ICONS[cluster.category]}</span>
              <span className="text-sm font-bold text-white">{cluster.label}</span>
              <span className="text-[11px] text-slate-600 font-mono">{visible.length}</span>
              <span className="ml-auto flex items-center gap-3 text-[11px]">
                {hd.critical_count > 0 && (
                  <span className="font-bold" style={{ color: HEALTH_STATUS_META.critical.color }}>
                    {hd.critical_count} critical
                  </span>
                )}
                {hd.warning_count > 0 && (
                  <span className="font-bold" style={{ color: HEALTH_STATUS_META.warning.color }}>
                    {hd.warning_count} warning
                  </span>
                )}
                {cluster.worstDevice && (
                  <span className="text-slate-600">
                    worst: <span className="text-slate-400">{cluster.worstDevice.name}</span>
                  </span>
                )}
              </span>
            </button>

            {!collapsed && (
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="text-slate-600 text-[10px] uppercase tracking-wider font-bold">
                    <th className="py-1.5 px-1 w-24">Status</th>
                    <th className="py-1.5 px-1">Device Name</th>
                    <th className="py-1.5 px-1 w-28">Type</th>
                    <th className="py-1.5 px-1 w-36">IP Address</th>
                  </tr>
                </thead>
                <tbody className="text-xs">
                  {visible.map((n) => {
                    const typeLabel = NODE_TYPE_META[n.node_type]?.label ?? n.node_type;
                    return (
                      <tr
                        key={n.node_id}
                        onClick={() => onContextSelect(n.node_id, n.name || n.node_id)}
                        data-testid={`hostmap-tile-${n.node_id}`}
                        className="group border-b border-slate-800/20 hover:bg-slate-800/30 transition-colors cursor-pointer"
                      >
                        <td className="py-2 px-1">
                          <StatusCell status={n.health_status} />
                        </td>
                        <td className="py-2 px-1 font-semibold text-slate-200 group-hover:text-white transition-colors">
                          {n.name || n.node_id}
                        </td>
                        <td className="py-2 px-1 text-slate-400 font-mono text-[11px]">{typeLabel}</td>
                        <td className="py-2 px-1 text-slate-400 font-mono text-[11px] select-all">
                          {n.ip_address || "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        );
      })}
    </div>
  );
}
