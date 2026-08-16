"use client";

import { Suspense, useCallback, useMemo } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { api } from "@/lib/api";
import { NODE_TYPE_META } from "@/types/topology";
import { useQueryState } from "@/hooks/use-query-state";
import { TopologySiteShell, type SiteViewParam, type ScopeParam, type LayoutParam } from "@/components/topology/topology-site-shell";

const VIEW_VALUES = ["auto", "impact", "clusters", "graph"] as const;
const SCOPE_VALUES = ["alerting", "all"] as const;
const LAYOUT_VALUES = ["readable", "readable-lr", "hierarchical", "flat"] as const;

function SitePageFallback() {
  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex flex-col gap-4 border-b border-slate-800/80 pb-5">
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
  return <span className="text-xs text-slate-500">{parts.join(" · ")}</span>;
}

function SitePageContent() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const siteId = params.site_id as string;

  const [view, setView] = useQueryState<SiteViewParam>("view", "auto", VIEW_VALUES);
  const [scope, setScope] = useQueryState<ScopeParam>("scope", "alerting", SCOPE_VALUES);
  const [layout, setLayout] = useQueryState<LayoutParam>("layout", "readable", LAYOUT_VALUES);

  const highlightParam = searchParams.get("highlight");
  const incidentParam = searchParams.get("incident");

  const highlightedNodeIds = useMemo(() => {
    if (!highlightParam) return undefined;
    return highlightParam.split(",").map((id) => id.trim()).filter(Boolean);
  }, [highlightParam]);

  const incidentId = useMemo(() => incidentParam?.trim() || null, [incidentParam]);

  const siteQuery = useQuery({
    queryKey: ["topology", "sites", siteId],
    queryFn: () => api.getSiteTopology(siteId),
    refetchInterval: highlightedNodeIds ? undefined : 30000,
    staleTime: 15000,
    gcTime: 300000,
  });

  const summaryQuery = useQuery({
    queryKey: ["topology", "sites", siteId, "summary"],
    queryFn: () => api.getSiteSummary(siteId),
    staleTime: 30000,
    gcTime: 300000,
  });

  const nodes = siteQuery.data?.nodes ?? [];

  const siteName = useMemo(() => {
    const siteNode = nodes.find((n) => n.node_type === "site");
    if (siteNode) return siteNode.name || siteNode.site_id || siteId;
    if (summaryQuery.data?.site_name) return summaryQuery.data.site_name;
    return siteId;
  }, [nodes, siteId, summaryQuery.data?.site_name]);

  const typeStats = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const node of nodes) {
      if (node.node_type === "site") continue;
      counts[node.node_type] = (counts[node.node_type] || 0) + 1;
    }
    return Object.entries(counts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 6);
  }, [nodes]);

  const handleBackToBackbone = useCallback(() => router.push("/topology"), [router]);

  const emptyData = useMemo(() => ({ nodes: [], edges: [], total_nodes: 0, total_edges: 0 }), []);
  const data = useMemo(() => {
    const d = siteQuery.data;
    if (!d) return emptyData;
    return { nodes: d.nodes, edges: d.edges, total_nodes: d.nodes.length, total_edges: d.edges.length };
  }, [siteQuery.data, emptyData]);

  return (
    <div className="p-6 space-y-5 max-w-7xl mx-auto">
      {/* Breadcrumbs */}
      <nav className="flex items-center gap-1.5 text-xs text-slate-500">
        <button
          onClick={handleBackToBackbone}
          className="inline-flex items-center gap-1 rounded-sm border border-slate-800 px-2 py-1 text-[11px] font-medium text-slate-400 transition-colors hover:bg-slate-900 hover:text-slate-200"
        >
          <ArrowLeft className="h-3 w-3" />
          All sites
        </button>
        <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Topology</span>
        <span className="text-slate-700">/</span>
        <span className="text-white font-medium truncate max-w-[200px]">{siteName}</span>
      </nav>

      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-white">{siteName || "Site Topology"}</h1>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          {summaryQuery.data?.health && (
            <SiteHealthSummary
              health={{
                critical_count: summaryQuery.data.health.critical_count ?? 0,
                warning_count: summaryQuery.data.health.warning_count ?? 0,
                healthy_count: summaryQuery.data.health.healthy_count ?? 0,
                unknown_count: summaryQuery.data.health.unknown_count ?? 0,
              }}
              total={summaryQuery.data.total_devices ?? 0}
            />
          )}
          {typeStats.length > 0 && (
            <span className="text-slate-600">
              {typeStats.map(([type, count], i) => {
                const meta = NODE_TYPE_META[type] ?? { label: type, color: "#6b7280" };
                return (
                  <span key={type} className="inline-flex items-center gap-1">
                    {i > 0 && <span className="text-slate-700 mx-1">·</span>}
                    <span className="h-2 w-2 rounded-sm" style={{ backgroundColor: meta.color }} />
                    <span className="text-slate-400">
                      {count} {meta.label}
                    </span>
                  </span>
                );
              })}
            </span>
          )}
        </div>
      </div>

      <TopologySiteShell
        siteId={siteId}
        data={data}
        isLoading={siteQuery.isLoading}
        error={siteQuery.error as Error | null}
        view={view}
        scope={scope}
        layout={layout}
        highlightedNodeIds={highlightedNodeIds}
        incidentId={incidentId}
        siteName={siteName}
        onViewChange={setView}
        onScopeChange={setScope}
        onLayoutChange={setLayout}
        onBackToBackbone={handleBackToBackbone}
      />
    </div>
  );
}

export default function TopologySitePage() {
  return (
    <Suspense fallback={<SitePageFallback />}>
      <SitePageContent />
    </Suspense>
  );
}
