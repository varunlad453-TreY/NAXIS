"use client";

import { Suspense, useCallback, useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import { api } from "@/lib/api";
import { useQueryState } from "@/hooks/use-query-state";
import { TopologyBackboneView } from "@/components/topology/topology-backbone-view";

const BACKBONE_VIEW_VALUES = ["regions", "degraded", "all"] as const;

function TopologyPageFallback() {
  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="h-3 w-24 animate-pulse bg-slate-800" />
      <div className="mt-4 h-8 w-48 animate-pulse bg-slate-800" />
      <div className="flex h-[640px] items-center justify-center border border-slate-800/60 bg-slate-900/30">
        <div className="h-12 w-12 animate-pulse rounded-full bg-slate-800" />
      </div>
    </div>
  );
}

function TopologyPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Redirect legacy ?site_id= URLs to the new sub-route
  const siteParam = searchParams.get("site_id");
  useEffect(() => {
    if (siteParam) {
      const remaining = new URLSearchParams(Array.from(searchParams.entries()));
      remaining.delete("site_id");
      const qs = remaining.toString();
      router.replace(`/topology/sites/${encodeURIComponent(siteParam)}${qs ? `?${qs}` : ""}`);
    }
  }, [siteParam, searchParams, router]);

  const [backboneView, setBackboneView] = useQueryState<"regions" | "degraded" | "all">(
    "view",
    "regions",
    BACKBONE_VIEW_VALUES,
  );

  const highlightParam = searchParams.get("highlight");
  const incidentParam = searchParams.get("incident");

  const highlightedNodeIds = useMemo(() => {
    if (!highlightParam) return undefined;
    return highlightParam.split(",").map((id) => id.trim()).filter(Boolean);
  }, [highlightParam]);

  const incidentId = useMemo(() => incidentParam?.trim() || null, [incidentParam]);

  const backboneQuery = useQuery({
    queryKey: ["topology", "backbone"],
    queryFn: () => api.getTopologyBackbone(),
    refetchInterval: highlightedNodeIds ? undefined : 60000,
    staleTime: 30000,
  });

  const nodes = backboneQuery.data?.nodes ?? [];

  const handleSiteSelect = useCallback(
    (siteId: string) => router.push(`/topology/sites/${encodeURIComponent(siteId)}`),
    [router],
  );

  const emptyData = useMemo(() => ({ nodes: [], edges: [], total_nodes: 0, total_edges: 0 }), []);
  const data = useMemo(() => {
    const d = backboneQuery.data;
    if (!d) return emptyData;
    return { nodes: d.nodes, edges: d.edges, total_nodes: d.nodes.length, total_edges: d.edges.length };
  }, [backboneQuery.data, emptyData]);

  if (siteParam) return null; // rendering while redirect fires

  return (
    <div className="p-6 space-y-5 max-w-7xl mx-auto">
      <nav className="flex items-center gap-1.5 text-xs text-slate-500">
        <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Topology</span>
      </nav>

      <div>
        <h1 className="text-3xl font-bold tracking-tight text-white">Global Network</h1>
        <p className="mt-1 text-sm text-slate-500">
          {nodes.length > 0 ? `${nodes.length} sites — click a site to drill in` : "Discovering sites…"}
        </p>
      </div>

      <TopologyBackboneView
        data={data}
        isLoading={backboneQuery.isLoading}
        error={backboneQuery.error as Error | null}
        highlightedNodeIds={highlightedNodeIds}
        incidentId={incidentId}
        onSiteSelect={handleSiteSelect}
        backboneViewMode={backboneView}
        onBackboneViewModeChange={setBackboneView}
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
