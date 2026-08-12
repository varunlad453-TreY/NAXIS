"use client";

import { Suspense, useCallback, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeft, ArrowUpDown, Server, Activity, Search, Wifi, Globe,
  Layers, AlertTriangle, CheckCircle, HelpCircle,
} from "lucide-react";
import { api } from "@/lib/api";
import { deriveAggregatedHealth } from "@/lib/topology-utils";
import { TopologyGraph } from "@/components/topology";
import type { TopologyNode } from "@/types/topology";
import { NODE_TYPE_META, HEALTH_STATUS_META } from "@/types/topology";

function TopologyPageFallback() {
  return (
    <div className="min-h-screen px-4 py-10 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="flex flex-col gap-4 border-b border-border/60 pb-8 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="h-3 w-24 animate-pulse bg-surface-elevated" />
            <div className="mt-4 h-8 w-48 animate-pulse bg-surface-elevated" />
            <div className="mt-2 h-4 w-96 animate-pulse bg-surface-elevated" />
          </div>
        </div>
        <div className="flex h-[600px] items-center justify-center border border-border/40 bg-surface/30">
          <div className="h-12 w-12 animate-pulse rounded-full bg-surface-elevated" />
        </div>
      </div>
    </div>
  );
}

function SiteBrowser({
  sites,
  onSiteSelect,
}: {
  sites: TopologyNode[];
  onSiteSelect: (id: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [vendorFilter, setVendorFilter] = useState<string | null>(null);

  const vendors = useMemo(
    () => [...new Set(sites.map((s) => s.vendor).filter(Boolean))],
    [sites],
  );

  const filtered = useMemo(() => {
    return sites
      .filter((s) => {
        if (search && !s.name.toLowerCase().includes(search.toLowerCase())) return false;
        if (vendorFilter && s.vendor !== vendorFilter) return false;
        return true;
      })
      .sort((a, b) => (b.device_count ?? 0) - (a.device_count ?? 0));
  }, [sites, search, vendorFilter]);

  const totalDevices = useMemo(
    () => sites.reduce((sum, s) => sum + (s.device_count ?? 0), 0),
    [sites],
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-foreground-subtle" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search sites..."
            className="w-full border border-border/60 bg-surface py-2 pl-9 pr-3 text-sm text-foreground outline-none placeholder:text-foreground-subtle focus:border-primary/50"
          />
        </div>
        <select
          value={vendorFilter ?? ""}
          onChange={(e) => setVendorFilter(e.target.value || null)}
          className="border border-border/60 bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-primary/50"
        >
          <option value="">All vendors</option>
          {vendors.map((v) => <option key={v} value={v}>{v}</option>)}
        </select>
        <span className="text-xs text-foreground-muted whitespace-nowrap">
          {filtered.length} of {sites.length} sites · {totalDevices} devices
        </span>
      </div>

      <div className="border-t border-border/40">
        {filtered.map((site) => (
          <SiteRow key={site.node_id} site={site} onClick={() => onSiteSelect(site.site_id)} />
        ))}
      </div>

      {filtered.length === 0 && (
        <div className="flex h-48 items-center justify-center border border-dashed border-border/40">
          <p className="text-sm text-foreground-muted">No sites match your search</p>
        </div>
      )}
    </div>
  );
}

function SiteRow({ site, onClick }: { site: TopologyNode; onClick: () => void }) {
  const aggHealth = deriveAggregatedHealth(site);
  const isMist = site.vendor === "mist";
  const dc = site.device_count ?? 0;
  const cc = site.critical_count ?? 0;
  const wc = site.warning_count ?? 0;

  return (
    <button
      onClick={onClick}
      className="group flex w-full items-center gap-4 border-b border-border/40 px-3 py-3 text-left transition-colors hover:bg-surface"
    >
      <div
        className="flex h-2 w-2 shrink-0"
        style={{ backgroundColor: aggHealth.color }}
        title={aggHealth.label}
      />

      <span className="min-w-0 shrink text-sm font-semibold text-foreground group-hover:text-primary transition-colors truncate">
        {site.name}
      </span>

      <span className="text-[10px] text-foreground-subtle uppercase tracking-wider">
        {site.vendor}
      </span>

      <span className="text-xs text-foreground-muted whitespace-nowrap">
        {dc} device{dc !== 1 ? "s" : ""}
      </span>

      <div className="ml-auto flex items-center gap-3 shrink-0">
        {cc > 0 && (
          <span className="flex items-center gap-1 text-[10px] font-semibold text-critical">
            <AlertTriangle className="h-3 w-3" />
            {cc}
          </span>
        )}
        {wc > 0 && cc === 0 && (
          <span className="flex items-center gap-1 text-[10px] font-semibold text-warning">
            <AlertTriangle className="h-3 w-3" />
            {wc}
          </span>
        )}
        {isMist ? <Wifi className="h-3.5 w-3.5 text-foreground-subtle" /> : <Globe className="h-3.5 w-3.5 text-foreground-subtle" />}
      </div>
    </button>
  );
}

function Breadcrumbs({ siteName }: { siteName?: string }) {
  return (
    <nav className="flex items-center gap-1.5 text-xs text-foreground-muted">
      <a href="/topology" className="transition-colors hover:text-foreground">
        Topology
      </a>
      {siteName && (
        <>
          <span className="text-border">/</span>
          <span className="text-foreground font-medium truncate max-w-[200px]">
            {siteName}
          </span>
        </>
      )}
    </nav>
  );
}

function SiteHealthSummary({
  health,
  total,
}: {
  health: { critical_count: number; warning_count: number; healthy_count: number; unknown_count: number };
  total: number;
}) {
  const items = [
    { count: health.critical_count, label: "Critical", color: "#ef4444", Icon: AlertTriangle },
    { count: health.warning_count, label: "Warning", color: "#eab308", Icon: AlertTriangle },
    { count: health.healthy_count, label: "Healthy", color: "#22c55e", Icon: CheckCircle },
    { count: health.unknown_count, label: "Unknown", color: "#6b7280", Icon: HelpCircle },
  ];
  return (
    <div className="flex flex-wrap items-center gap-3 text-xs">
      <span className="font-medium text-foreground">{total} devices</span>
      <span className="h-3 w-px bg-border/40" />
      {items.map(({ count, label, color, Icon }) =>
        count > 0 ? (
          <div key={label} className="flex items-center gap-1">
            <Icon className="h-3 w-3" style={{ color }} />
            <span className="font-medium text-foreground">{count}</span>
            <span className="text-foreground-muted">{label}</span>
          </div>
        ) : null
      )}
    </div>
  );
}

function TopologyPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const highlightParam = searchParams.get("highlight");
  const incidentParam = searchParams.get("incident");
  const siteParam = searchParams.get("site_id");

  const highlightedNodeIds = useMemo(() => {
    if (!highlightParam) return undefined;
    return highlightParam.split(",").map((id) => id.trim()).filter(Boolean);
  }, [highlightParam]);

  const incidentId = useMemo(() => {
    return incidentParam?.trim() || null;
  }, [incidentParam]);

  const activeSiteId = useMemo(() => {
    return siteParam?.trim() || undefined;
  }, [siteParam]);

  const isBackboneMode = !activeSiteId;

  const handleSiteSelect = useCallback((siteId: string) => {
    router.push(`/topology?site_id=${encodeURIComponent(siteId)}`);
  }, [router]);

  const handleBackToAll = useCallback(() => {
    router.push("/topology");
  }, [router]);

  const backboneQuery = useQuery({
    queryKey: ["topology-backbone"],
    queryFn: () => api.getTopologyBackbone(),
    refetchInterval: highlightedNodeIds ? undefined : 60000,
    enabled: isBackboneMode,
    staleTime: 30000,
  });

  const siteInternalQuery = useQuery({
    queryKey: ["topology-site", activeSiteId],
    queryFn: () => api.getSiteTopology(activeSiteId!),
    refetchInterval: highlightedNodeIds ? undefined : 30000,
    enabled: !isBackboneMode,
    staleTime: 15000,
    gcTime: 300000,
  });

  const siteSummaryQuery = useQuery({
    queryKey: ["topology-site-summary", activeSiteId],
    queryFn: () => api.getSiteSummary(activeSiteId!),
    enabled: !isBackboneMode,
    staleTime: 30000,
    gcTime: 300000,
  });

  const graphData = isBackboneMode ? backboneQuery.data : siteInternalQuery.data;
  const graphLoading = isBackboneMode ? backboneQuery.isLoading : siteInternalQuery.isLoading;
  const graphError = isBackboneMode ? backboneQuery.error : siteInternalQuery.error;

  const { data: summary } = useQuery({
    queryKey: ["topology-summary"],
    queryFn: () => api.getTopologySummary(),
    refetchInterval: 30000,
    staleTime: 15000,
  });

  const nodes = graphData?.nodes ?? [];
  const edges = graphData?.edges ?? [];

  const allData = useMemo(
    () => ({
      nodes,
      edges,
      total_nodes: nodes.length,
      total_edges: edges.length,
    }),
    [nodes, edges]
  );

  const typeStats = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const node of nodes) {
      const t = node.node_type;
      counts[t] = (counts[t] || 0) + 1;
    }
    return Object.entries(counts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 6);
  }, [nodes]);

  const siteName = useMemo(() => {
    if (!isBackboneMode) {
      const siteNode = nodes.find((n) => n.node_type === "site");
      if (siteNode) return siteNode.name || siteNode.site_id || activeSiteId;
      if (siteSummaryQuery.data?.site_name) return siteSummaryQuery.data.site_name;
      return activeSiteId;
    }
    return undefined;
  }, [isBackboneMode, nodes, activeSiteId, siteSummaryQuery.data?.site_name]);

  return (
    <div className="min-h-screen px-4 py-10 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl space-y-6">
        {/* Breadcrumbs */}
        <Breadcrumbs siteName={siteName} />

        {/* Header */}
        <div className="flex flex-col gap-4 border-b border-border/60 pb-8 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="flex items-center gap-3">
              {activeSiteId && (
                <button
                  onClick={handleBackToAll}
                  className="inline-flex items-center gap-1 border border-border/60 px-2.5 py-1.5 text-xs font-medium text-foreground-muted transition-colors hover:bg-surface hover:text-foreground"
                >
                  <ArrowLeft className="h-3.5 w-3.5" />
                  All sites
                </button>
              )}
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-foreground-subtle">
                  Network topology
                </div>
                <h1 className="mt-1 text-3xl font-semibold tracking-tight text-foreground">
                  {isBackboneMode ? "All sites" : (siteName || "Site topology")}
                </h1>
              </div>
            </div>
            <p className="mt-1 text-sm text-foreground-muted">
              {isBackboneMode
                ? `${nodes.length} sites — click a site to see its internal topology`
                : "Showing devices in this site — click a device for details"}
            </p>
          </div>
          <div className="flex gap-8">
            <Stat
              icon={<Server className="h-4 w-4" />}
              value={summary?.node_count ?? nodes.length}
              label="Devices"
              color="text-primary"
            />
            <Stat
              icon={<Activity className="h-4 w-4" />}
              value={summary?.edge_count ?? edges.length}
              label="Links"
              color="text-foreground"
            />
          </div>
        </div>

        {isBackboneMode ? (
          backboneQuery.isLoading ? (
            <div className="flex h-48 items-center justify-center border border-border/40 bg-surface/30">
              <div className="h-8 w-8 animate-pulse rounded-full bg-surface-elevated" />
            </div>
          ) : backboneQuery.error ? (
            <div className="flex h-48 items-center justify-center border border-critical/20 bg-critical/5">
              <p className="text-sm text-critical">Failed to load sites: {(backboneQuery.error as Error).message}</p>
            </div>
          ) : backboneQuery.data?.nodes.length ? (
            <SiteBrowser sites={backboneQuery.data.nodes} onSiteSelect={handleSiteSelect} />
          ) : (
            <div className="flex h-48 items-center justify-center border border-dashed border-border/40">
              <p className="text-sm text-foreground-muted">No sites found</p>
            </div>
          )
        ) : (
          <>
            {/* Site health summary bar */}
            {siteSummaryQuery.data && (
              <SiteHealthSummary
                health={{
                  critical_count: siteSummaryQuery.data.health.critical_count,
                  warning_count: siteSummaryQuery.data.health.warning_count,
                  healthy_count: siteSummaryQuery.data.health.healthy_count,
                  unknown_count: siteSummaryQuery.data.health.unknown_count,
                }}
                total={siteSummaryQuery.data.total_devices}
              />
            )}

            {/* Device type filter chips */}
            {typeStats.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {typeStats.map(([type, count]) => {
                  const meta = NODE_TYPE_META[type];
                  const color = meta?.color ?? "#6b7280";
                  return (
              <div
                key={type}
                className="inline-flex items-center gap-2 text-xs"
              >
                <span
                  className="h-2.5 w-2.5"
                  style={{ backgroundColor: color }}
                />
                <span className="font-medium text-foreground">{count}</span>
                <span className="text-foreground-muted">{meta?.label ?? type}</span>
              </div>
                  );
                })}
              </div>
            )}

            {/* Vendor breakdown chips */}
            {siteSummaryQuery.data && siteSummaryQuery.data.by_vendor.length > 1 && (
              <div className="flex flex-wrap gap-2">
                {siteSummaryQuery.data.by_vendor.map(({ type, count }) => (
                  <div
                    key={type}
                    className="inline-flex items-center gap-1.5 text-xs text-foreground-muted"
                  >
                    <Layers className="h-3 w-3" />
                    <span className="font-medium text-foreground">{count}</span>
                    <span>{type}</span>
                  </div>
                ))}
              </div>
            )}

            <TopologyGraph
              data={allData}
              isLoading={graphLoading}
              error={graphError as Error | null}
              highlightedNodeIds={highlightedNodeIds}
              incidentId={incidentId}
            />
          </>
        )}
      </div>
    </div>
  );
}

export default function TopologyPage() {
  return (
    <Suspense fallback={<TopologyPageFallback />}>
      <TopologyPageContent />
    </Suspense>
  );
}

function Stat({
  icon,
  value,
  label,
  color,
}: {
  icon: React.ReactNode;
  value: number;
  label: string;
  color: string;
}) {
  return (
    <div className="text-right">
      <div className={`flex items-center justify-end gap-1.5 text-2xl font-semibold ${color}`}>
        {icon}
        {value}
      </div>
      <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-foreground-subtle">
        {label}
      </div>
    </div>
  );
}
