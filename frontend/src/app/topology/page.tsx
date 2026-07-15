"use client";

import { Suspense, useCallback, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, Server, Activity, Search, Wifi, Globe } from "lucide-react";
import { api } from "@/lib/api";
import { TopologyGraph } from "@/components/topology";
import type { TopologyNode } from "@/types/topology";
import { NODE_TYPE_META, HEALTH_STATUS_META } from "@/types/topology";

function TopologyPageFallback() {
  return (
    <div className="min-h-screen px-4 py-10 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="flex flex-col gap-4 border-b border-border/60 pb-8 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="h-3 w-24 animate-pulse rounded bg-surface-elevated" />
            <div className="mt-4 h-8 w-48 animate-pulse rounded bg-surface-elevated" />
            <div className="mt-2 h-4 w-96 animate-pulse rounded bg-surface-elevated" />
          </div>
        </div>
        <div className="flex h-[600px] items-center justify-center rounded-xl border border-border/40 bg-surface/30">
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
            className="w-full rounded-lg border border-border/60 bg-surface py-2 pl-9 pr-3 text-sm text-foreground outline-none placeholder:text-foreground-subtle focus:border-primary/50"
          />
        </div>
        <select
          value={vendorFilter ?? ""}
          onChange={(e) => setVendorFilter(e.target.value || null)}
          className="rounded-lg border border-border/60 bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-primary/50"
        >
          <option value="">All vendors</option>
          {vendors.map((v) => <option key={v} value={v}>{v}</option>)}
        </select>
        <span className="text-xs text-foreground-muted whitespace-nowrap">
          {filtered.length} of {sites.length} sites · {totalDevices} devices
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
        {filtered.map((site) => (
          <SiteCard key={site.node_id} site={site} onClick={() => onSiteSelect(site.site_id)} />
        ))}
      </div>

      {filtered.length === 0 && (
        <div className="flex h-48 items-center justify-center rounded-xl border-2 border-dashed border-border/40">
          <p className="text-sm text-foreground-muted">No sites match your search</p>
        </div>
      )}
    </div>
  );
}

function SiteCard({ site, onClick }: { site: TopologyNode; onClick: () => void }) {
  const hMeta = HEALTH_STATUS_META[site.health_status] ?? HEALTH_STATUS_META.unknown;
  const isMist = site.vendor === "mist";
  const dc = site.device_count ?? 0;

  return (
    <button
      onClick={onClick}
      className="group flex flex-col gap-2 rounded-xl border border-border/40 bg-surface/50 p-4 text-left transition-all hover:border-primary/30 hover:shadow-surface-lg hover:bg-surface"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <div
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-xs font-bold"
            style={{ backgroundColor: isMist ? "#10b981" : "#8b5cf6" }}
          >
            {isMist ? <Wifi className="h-4 w-4 text-white" /> : <Globe className="h-4 w-4 text-white" />}
          </div>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-foreground group-hover:text-primary transition-colors">
              {site.name}
            </div>
            <div className="text-[10px] text-foreground-subtle uppercase tracking-wider">
              {site.vendor}
            </div>
          </div>
        </div>
        <span
          className="relative mt-1 inline-block h-2.5 w-2.5 shrink-0 rounded-full"
          style={{ backgroundColor: hMeta.color }}
          title={hMeta.label}
        />
      </div>
      <div className="flex items-center gap-3 text-xs text-foreground-muted">
        <span className="font-medium text-foreground">{dc}</span>
        <span>device{dc !== 1 ? "s" : ""}</span>
      </div>
    </button>
  );
}

function TopologyPageContent() {
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

  const urlSiteId = useMemo(() => {
    return siteParam?.trim() || undefined;
  }, [siteParam]);

  const [drillDownSiteId, setDrillDownSiteId] = useState<string | null>(null);
  const activeSiteId = urlSiteId ?? drillDownSiteId;

  const handleSiteSelect = useCallback((siteId: string) => {
    setDrillDownSiteId(siteId);
  }, []);

  const handleBackToAll = useCallback(() => {
    setDrillDownSiteId(null);
  }, []);

  const isBackboneMode = !activeSiteId;

  const backboneQuery = useQuery({
    queryKey: ["topology-backbone"],
    queryFn: () => api.getTopologyBackbone(),
    refetchInterval: highlightedNodeIds ? undefined : 60000,
    enabled: isBackboneMode,
  });

  const siteInternalQuery = useQuery({
    queryKey: ["topology-site", activeSiteId],
    queryFn: () => api.getSiteTopology(activeSiteId!),
    refetchInterval: highlightedNodeIds ? undefined : 30000,
    enabled: !isBackboneMode,
  });

  const graphData = isBackboneMode ? backboneQuery.data : siteInternalQuery.data;
  const graphLoading = isBackboneMode ? backboneQuery.isLoading : siteInternalQuery.isLoading;
  const graphError = isBackboneMode ? backboneQuery.error : siteInternalQuery.error;

  const { data: summary } = useQuery({
    queryKey: ["topology-summary"],
    queryFn: () => api.getTopologySummary(),
    refetchInterval: 30000,
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

  return (
    <div className="min-h-screen px-4 py-10 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl space-y-6">
        {/* Header */}
        <div className="flex flex-col gap-4 border-b border-border/60 pb-8 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="flex items-center gap-3">
              {activeSiteId && (
                <button
                  onClick={handleBackToAll}
                  className="inline-flex items-center gap-1 rounded-md border border-border/60 px-2.5 py-1.5 text-xs font-medium text-foreground-muted transition-colors hover:bg-surface hover:text-foreground"
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
                  {isBackboneMode ? "All sites" : urlSiteId ? "Site topology" : "Site topology"}
                </h1>
              </div>
            </div>
            <p className="mt-1 text-sm text-foreground-muted">
              {urlSiteId
                ? <>Filtered to site — <a href="/topology" className="text-primary underline-offset-2 hover:underline">clear filter</a></>
                : isBackboneMode
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
            <div className="flex h-48 items-center justify-center rounded-xl border border-border/40 bg-surface/30">
              <div className="h-8 w-8 animate-pulse rounded-full bg-surface-elevated" />
            </div>
          ) : backboneQuery.error ? (
            <div className="flex h-48 items-center justify-center rounded-xl border border-critical/20 bg-critical/5">
              <p className="text-sm text-critical">Failed to load sites: {(backboneQuery.error as Error).message}</p>
            </div>
          ) : backboneQuery.data?.nodes.length ? (
            <SiteBrowser sites={backboneQuery.data.nodes} onSiteSelect={handleSiteSelect} />
          ) : (
            <div className="flex h-48 items-center justify-center rounded-xl border-2 border-dashed border-border/40">
              <p className="text-sm text-foreground-muted">No sites found</p>
            </div>
          )
        ) : (
          <>
            {typeStats.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {typeStats.map(([type, count]) => {
                  const meta = NODE_TYPE_META[type];
                  const color = meta?.color ?? "#6b7280";
                  return (
                    <div
                      key={type}
                      className="inline-flex items-center gap-2 rounded-md border border-border/40 bg-surface/50 px-3 py-1.5 text-xs"
                    >
                      <span
                        className="h-2.5 w-2.5 rounded-full"
                        style={{ backgroundColor: color }}
                      />
                      <span className="font-medium text-foreground">{count}</span>
                      <span className="text-foreground-muted">{meta?.label ?? type}</span>
                    </div>
                  );
                })}
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
