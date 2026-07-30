import { useMemo, useState } from "react";
import { Search, X, AlertTriangle, CheckCircle, HelpCircle, Layers, Monitor, Server, Wifi, Globe } from "lucide-react";
import type { TopologyNode, DeviceCategoryCluster, HealthStatus } from "@/types/topology";
import { HEALTH_STATUS_META } from "@/types/topology";
import { CATEGORY_META } from "@/types/topology";

interface DeviceBrowserProps {
  nodes: TopologyNode[];
  cluster: DeviceCategoryCluster;
  onSelect: (nodeId: string, nodeName: string) => void;
  onClose: () => void;
  initialHealthFilter?: HealthStatus;
}

const healthFilterArr: { key: HealthStatus | "all"; label: string }[] = [
  { key: "all", label: "All" },
  { key: "critical", label: "Critical" },
  { key: "warning", label: "Warning" },
  { key: "healthy", label: "Healthy" },
  { key: "unknown", label: "Unknown" },
];

const SORT_OPTIONS = [
  { key: "name", label: "Name" },
  { key: "health", label: "Health" },
  { key: "vendor", label: "Vendor" },
  { key: "type", label: "Type" },
] as const;

function healthSortWeight(status: string): number {
  if (status === "critical") return 0;
  if (status === "warning") return 1;
  if (status === "unknown") return 2;
  return 3;
}

export function DeviceBrowser({ nodes, cluster, onSelect, onClose, initialHealthFilter }: DeviceBrowserProps) {
  const [search, setSearch] = useState("");
  const [healthFilter, setHealthFilter] = useState<HealthStatus | "all">(initialHealthFilter ?? "all");
  const [vendorFilter, setVendorFilter] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<"name" | "health" | "vendor" | "type">("name");

  const vendors = useMemo(
    () => [...new Set(nodes.map((n) => n.vendor).filter(Boolean))].sort(),
    [nodes],
  );

  const filtered = useMemo(() => {
    let result = nodes;

    if (search) {
      const q = search.toLowerCase();
      result = result.filter(
        (n) =>
          n.name?.toLowerCase().includes(q) ||
          n.node_id?.toLowerCase().includes(q) ||
          n.ip_address?.toLowerCase().includes(q),
      );
    }

    if (healthFilter !== "all") {
      result = result.filter((n) => n.health_status === healthFilter);
    }

    if (vendorFilter) {
      result = result.filter((n) => n.vendor === vendorFilter);
    }

    result = [...result].sort((a, b) => {
      if (sortBy === "health") return healthSortWeight(a.health_status) - healthSortWeight(b.health_status);
      if (sortBy === "vendor") return (a.vendor || "").localeCompare(b.vendor || "");
      if (sortBy === "type") return (a.node_type || "").localeCompare(b.node_type || "");
      return (a.name || a.node_id).localeCompare(b.name || b.node_id);
    });

    return result;
  }, [nodes, search, healthFilter, vendorFilter, sortBy]);

  const catMeta = CATEGORY_META[cluster.category];

  return (
    <div className="w-80 shrink-0 rounded-xl border border-border/40 bg-surface shadow-surface-lg">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border/30 px-4 py-3">
        <div className="flex items-center gap-2">
          <div
            className="flex h-7 w-7 items-center justify-center rounded-md text-xs font-bold text-white"
            style={{ backgroundColor: catMeta.color }}
          >
            {cluster.count}
          </div>
          <div>
            <div className="text-sm font-semibold text-foreground">{catMeta.label}</div>
            <div className="text-[10px] text-foreground-subtle uppercase tracking-wider">
              {cluster.count} device{cluster.count !== 1 ? "s" : ""}
            </div>
          </div>
        </div>
        <button
          onClick={onClose}
          className="rounded p-1 text-foreground-muted transition-colors hover:bg-surface-hover hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Search */}
      <div className="border-b border-border/30 px-4 py-2.5">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-foreground-subtle" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, ID, IP..."
            className="w-full rounded-md border border-border/60 bg-surface py-1.5 pl-8 pr-2.5 text-xs text-foreground outline-none placeholder:text-foreground-subtle focus:border-primary/50"
          />
        </div>
      </div>

      {/* Filters */}
      <div className="border-b border-border/30 px-4 py-2">
        <div className="flex flex-wrap gap-1.5">
          {healthFilterArr.map((f) => {
            const isActive = healthFilter === f.key;
            const hMeta = f.key !== "all" ? HEALTH_STATUS_META[f.key] : null;
            return (
              <button
                key={f.key}
                onClick={() => setHealthFilter(f.key)}
                className="rounded-md px-2 py-0.5 text-[10px] font-medium transition-all"
                style={{
                  backgroundColor: isActive && hMeta ? hMeta.color + "18" : isActive ? "hsl(var(--primary) / 0.1)" : undefined,
                  color: isActive && hMeta ? hMeta.color : isActive ? "hsl(var(--primary))" : "hsl(var(--foreground-muted))",
                }}
              >
                {f.label}
              </button>
            );
          })}
        </div>
        {vendors.length > 1 && (
          <select
            value={vendorFilter ?? ""}
            onChange={(e) => setVendorFilter(e.target.value || null)}
            className="mt-2 w-full rounded-md border border-border/60 bg-surface px-2 py-1 text-[10px] text-foreground outline-none"
          >
            <option value="">All vendors</option>
            {vendors.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
        )}
        <div className="mt-2 flex items-center gap-2">
          <span className="text-[10px] text-foreground-subtle">Sort:</span>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
            className="flex-1 rounded-md border border-border/60 bg-surface px-2 py-0.5 text-[10px] text-foreground outline-none"
          >
            {SORT_OPTIONS.map((o) => (
              <option key={o.key} value={o.key}>{o.label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Device list */}
      <div className="max-h-[calc(600px-220px)] overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="flex items-center justify-center px-4 py-12 text-xs text-foreground-muted">
            No matching devices
          </div>
        ) : (
          <div className="divide-y divide-border/20">
            {filtered.map((node) => {
              const hMeta = HEALTH_STATUS_META[node.health_status] ?? HEALTH_STATUS_META.unknown;
              const HealthIcon =
                node.health_status === "critical" || node.health_status === "warning"
                  ? AlertTriangle
                  : node.health_status === "healthy"
                  ? CheckCircle
                  : HelpCircle;
              return (
                <button
                  key={node.node_id}
                  onClick={() => onSelect(node.node_id, node.name || node.node_id)}
                  className="group flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-surface-hover"
                >
                  {/* Health bar — colored left border */}
                  <div className="h-8 w-0.5 shrink-0 rounded-full" style={{ backgroundColor: hMeta.color }} />

                  <HealthIcon className="h-3.5 w-3.5 shrink-0" style={{ color: hMeta.color }} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs font-medium text-foreground">
                      {node.name || node.node_id}
                    </div>
                    <div className="flex items-center gap-2 text-[10px] text-foreground-muted">
                      <span className="rounded bg-surface-elevated/30 px-1 py-0.5 text-[9px] uppercase tracking-wide">{node.node_type}</span>
                      {node.vendor && (
                        <>
                          <span>·</span>
                          <span>{node.vendor}</span>
                        </>
                      )}
                      {node.ip_address && (
                        <>
                          <span>·</span>
                          <span className="font-mono">{node.ip_address}</span>
                        </>
                      )}
                    </div>
                  </div>
                  <Layers className="h-3 w-3 shrink-0 text-foreground-subtle opacity-0 transition-opacity group-hover:opacity-100" />
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="border-t border-border/30 px-4 py-2 text-[10px] text-foreground-muted">
        {filtered.length} of {cluster.count} devices
      </div>
    </div>
  );
}
