"use client";

import { Suspense, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import { Server, Activity } from "lucide-react";
import { api } from "@/lib/api";
import { TopologyGraph } from "@/components/topology";
import { NODE_TYPE_META } from "@/types/topology";

export default function TopologyPage() {
  return (
    <Suspense fallback={null}>
      <TopologyPageInner />
    </Suspense>
  );
}

function TopologyPageInner() {
  const searchParams = useSearchParams();
  const highlightParam = searchParams.get("highlight");

  const highlightedNodeIds = useMemo(() => {
    if (!highlightParam) return undefined;
    return highlightParam.split(",").map((id) => id.trim()).filter(Boolean);
  }, [highlightParam]);

  const {
    data: graphData,
    isLoading: graphLoading,
    error: graphError,
  } = useQuery({
    queryKey: ["topology"],
    queryFn: () => api.getTopology(),
    refetchInterval: highlightedNodeIds ? undefined : 30000,
  });

  const { data: summary } = useQuery({
    queryKey: ["topology-summary"],
    queryFn: () => api.getTopologySummary(),
    refetchInterval: 30000,
  });

  const nodes = graphData?.nodes ?? [];
  const edges = graphData?.edges ?? [];

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
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-foreground-subtle">
              Network topology
            </div>
            <h1 className="mt-1 text-3xl font-semibold tracking-tight text-foreground">
              Topology
            </h1>
            <p className="mt-1 text-sm text-foreground-muted">
              Interactive infrastructure graph — drag to pan, scroll to zoom, click nodes to inspect
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

        {/* Type breakdown */}
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

        {/* Topology Graph */}
        <TopologyGraph
          data={graphData ?? { nodes: [], edges: [], total_nodes: 0, total_edges: 0 }}
          isLoading={graphLoading}
          error={graphError as Error | null}
          highlightedNodeIds={highlightedNodeIds}
        />
      </div>
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
