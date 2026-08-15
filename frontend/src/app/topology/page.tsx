"use client";

import { Suspense, useCallback, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeft,
} from "lucide-react";
import { api } from "@/lib/api";
import { TopologyGraphV2 } from "@/components/topology/topology-graph-v2";
import type { TopologyNode } from "@/types/topology";
import { NODE_TYPE_META } from "@/types/topology";

function TopologyPageFallback() {
  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex flex-col gap-4 border-b border-slate-800/80 pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="h-3 w-24 animate-pulse bg-slate-800" />
          <div className="mt-4 h-8 w-48 animate-pulse bg-slate-800" />
          <div className="mt-2 h-4 w-96 animate-pulse bg-slate-800" />
        </div>
      </div>
      <div className="flex h-[640px] items-center justify-center border border-slate-800/60 bg-slate-900/30">
        <div className="h-12 w-12 animate-pulse rounded-full bg-slate-800" />
      </div>
    </div>
  );
}

function Breadcrumbs({ siteName, onBack }: { siteName?: string; onBack?: () => void }) {
  return (
    <nav className="flex items-center gap-1.5 text-xs text-slate-500">
      {siteName && onBack && (
        <button
          onClick={onBack}
          className="inline-flex items-center gap-1 rounded-sm border border-slate-800 px-2 py-1 text-[11px] font-medium text-slate-400 transition-colors hover:bg-slate-900 hover:text-slate-200"
        >
          <ArrowLeft className="h-3 w-3" />
          All sites
        </button>
      )}
      <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
        Topology
      </span>
      {siteName && (
        <>
          <span className="text-slate-700">/</span>
          <span className="text-white font-medium truncate max-w-[200px]">{siteName}</span>
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
  const parts: string[] = [`${total} devices`];
  if (health.critical_count > 0) parts.push(`${health.critical_count} Critical`);
  if (health.warning_count > 0) parts.push(`${health.warning_count} Warning`);
  if (health.healthy_count > 0) parts.push(`${health.healthy_count} Healthy`);
  if (health.unknown_count > 0) parts.push(`${health.unknown_count} Unknown`);
  return (
    <span className="text-xs text-slate-500">
      {parts.join(" · ")}
    </span>
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
    <div className="p-6 space-y-5 max-w-7xl mx-auto">
      {/* Breadcrumbs */}
      <Breadcrumbs siteName={siteName} onBack={!isBackboneMode ? handleBackToAll : undefined} />

      {/* Header: title + inline metadata */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-white">
          {isBackboneMode ? "Global Network" : siteName || "Site Topology"}
        </h1>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
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
          {isBackboneMode && (
            <span className="text-slate-500">
              {nodes.length} sites — click a site to drill into its infrastructure
            </span>
          )}
          {typeStats.length > 0 && (
            <span className="text-slate-600">
              {typeStats.map(([type, count], i) => {
                const meta = NODE_TYPE_META[type] ?? { label: type, color: "#6b7280" };
                return (
                  <span key={type} className="inline-flex items-center gap-1">
                    {i > 0 && <span className="text-slate-700 mx-1">·</span>}
                    <span className="h-2 w-2 rounded-sm" style={{ backgroundColor: meta.color }} />
                    <span className="text-slate-400">{count} {meta.label}</span>
                  </span>
                );
              })}
            </span>
          )}
        </div>
      </div>

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
  );
}

export default function TopologyPage() {
  return (
    <Suspense fallback={<TopologyPageFallback />}>
      <TopologyPageContent />
    </Suspense>
  );
}
