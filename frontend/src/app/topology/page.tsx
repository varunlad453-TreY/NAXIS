"use client";

import { Suspense, useCallback, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  Server,
  Activity,
  AlertTriangle,
  CheckCircle,
  HelpCircle,
} from "lucide-react";
import { api } from "@/lib/api";
import { TopologyGraphV2 } from "@/components/topology/topology-graph-v2";
import type { TopologyNode } from "@/types/topology";
import { HEALTH_STATUS_META, NODE_TYPE_META } from "@/types/topology";

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
        <div className="flex h-[640px] items-center justify-center border border-border/40 bg-surface/30">
          <div className="h-12 w-12 animate-pulse rounded-full bg-surface-elevated" />
        </div>
      </div>
    </div>
  );
}

function Breadcrumbs({ siteName, onBack }: { siteName?: string; onBack?: () => void }) {
  return (
    <nav className="flex items-center gap-1.5 text-xs text-foreground-muted">
      {siteName && onBack && (
        <button
          onClick={onBack}
          className="inline-flex items-center gap-1 rounded-md border border-border/60 px-2 py-1 text-[11px] font-medium text-foreground-muted transition-colors hover:bg-surface hover:text-foreground"
        >
          <ArrowLeft className="h-3 w-3" />
          All sites
        </button>
      )}
      <span className="text-[11px] font-semibold uppercase tracking-wider text-foreground-subtle">
        Topology
      </span>
      {siteName && (
        <>
          <span className="text-border">/</span>
          <span className="text-foreground font-medium truncate max-w-[200px]">{siteName}</span>
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
    { count: health.critical_count, label: "Critical", color: HEALTH_STATUS_META.critical.color, Icon: AlertTriangle },
    { count: health.warning_count, label: "Warning", color: HEALTH_STATUS_META.warning.color, Icon: AlertTriangle },
    { count: health.healthy_count, label: "Healthy", color: HEALTH_STATUS_META.healthy.color, Icon: CheckCircle },
    { count: health.unknown_count, label: "Unknown", color: HEALTH_STATUS_META.unknown.color, Icon: HelpCircle },
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

  const incidentId = useMemo(() => incidentParam?.trim() || null, [incidentParam]);
  const activeSiteId = useMemo(() => siteParam?.trim() || undefined, [siteParam]);
  const isBackboneMode = !activeSiteId;

  const handleSiteSelect = useCallback(
    (siteId: string) => {
      router.push(`/topology?site_id=${encodeURIComponent(siteId)}`);
    },
    [router]
  );

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

  const summaryQuery = useQuery({
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
      counts[node.node_type] = (counts[node.node_type] || 0) + 1;
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
        <Breadcrumbs siteName={siteName} onBack={!isBackboneMode ? handleBackToAll : undefined} />

        {/* Header */}
        <div className="flex flex-col gap-4 border-b border-border/60 pb-8 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-foreground-subtle">
              Network topology
            </div>
            <h1 className="mt-1 text-3xl font-semibold tracking-tight text-foreground">
              {isBackboneMode ? "Global Network" : siteName || "Site Topology"}
            </h1>
            <p className="mt-1 text-sm text-foreground-muted">
              {isBackboneMode
                ? `${nodes.length} sites — click a site to drill into its infrastructure`
                : "Device hierarchy and relationships within this site"}
            </p>
          </div>
          <div className="flex gap-8">
            <Stat
              icon={<Server className="h-4 w-4" />}
              value={summaryQuery.data?.node_count ?? nodes.length}
              label="Devices"
              color="text-primary"
            />
            <Stat
              icon={<Activity className="h-4 w-4" />}
              value={summaryQuery.data?.edge_count ?? edges.length}
              label="Links"
              color="text-foreground"
            />
          </div>
        </div>

        {/* Site health summary */}
        {!isBackboneMode && siteSummaryQuery.data?.health && (
          <SiteHealthSummary
            health={{
              critical_count: siteSummaryQuery.data.health.critical_count ?? 0,
              warning_count: siteSummaryQuery.data.health.warning_count ?? 0,
              healthy_count: siteSummaryQuery.data.health.healthy_count ?? 0,
              unknown_count: siteSummaryQuery.data.health.unknown_count ?? 0,
            }}
            total={siteSummaryQuery.data.total_devices ?? 0}
          />
        )}

        {/* Device type stats */}
        {typeStats.length > 0 && (
          <div className="flex flex-wrap gap-3">
            {typeStats.map(([type, count]) => {
              const meta = NODE_TYPE_META[type] ?? { label: type, color: "#6b7280" };
              return (
                <div key={type} className="inline-flex items-center gap-2 text-xs">
                  <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: meta.color }} />
                  <span className="font-medium text-foreground">{count}</span>
                  <span className="text-foreground-muted">{meta.label}</span>
                </div>
              );
            })}
          </div>
        )}

        {/* Main topology graph */}
        <TopologyGraphV2
          data={allData}
          isLoading={graphLoading}
          error={graphError as Error | null}
          highlightedNodeIds={highlightedNodeIds}
          incidentId={incidentId}
          isBackbone={isBackboneMode}
          activeSiteId={activeSiteId}
          siteName={siteName}
          onSiteSelect={handleSiteSelect}
          onBackToBackbone={handleBackToAll}
        />
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
