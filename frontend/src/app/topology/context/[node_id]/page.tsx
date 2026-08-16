"use client";

import { Suspense } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { NODE_TYPE_META, HEALTH_STATUS_META } from "@/types/topology";
import { ContextGraph } from "@/components/topology/context-graph";
import { HealthHistoryChart } from "@/components/topology/health-history-chart";

function ContextPageFallback() {
  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="h-3 w-24 animate-pulse bg-slate-800" />
      <div className="h-[500px] animate-pulse bg-slate-900/30 rounded-xl border border-slate-800/60" />
    </div>
  );
}

function PropRow({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <div className="flex items-baseline gap-2 py-1.5 border-b border-slate-800/40 last:border-0">
      <span className="w-28 shrink-0 text-[10px] font-semibold uppercase tracking-wider text-slate-500">{label}</span>
      <span className="font-mono text-xs text-slate-200 break-all">{value}</span>
    </div>
  );
}

function ContextPageContent() {
  const params = useParams();
  const router = useRouter();
  const nodeId = params.node_id as string;

  const nodeQuery = useQuery({
    queryKey: ["topology-node-ctx", nodeId],
    queryFn: () => api.getTopologyNode(nodeId),
    staleTime: 30000,
  });

  const node = nodeQuery.data?.node;
  const parents = nodeQuery.data?.parents ?? [];
  const children = nodeQuery.data?.children ?? [];

  const nodeName = node?.name || node?.node_id || nodeId;
  const siteId = node?.site_id;

  const meta = NODE_TYPE_META[node?.node_type ?? ""] ?? { label: node?.node_type ?? "Device", color: "#6b7280" };
  const hMeta = HEALTH_STATUS_META[node?.health_status ?? "unknown"] ?? HEALTH_STATUS_META.unknown;

  const handleBack = () => {
    if (siteId) router.push(`/topology/sites/${encodeURIComponent(siteId)}`);
    else router.back();
  };

  const handleNodeClick = (clickedNodeId: string, _nodeName: string) => {
    router.push(`/topology/context/${encodeURIComponent(clickedNodeId)}`);
  };

  const allNodeIds = nodeQuery.data
    ? [nodeId, ...parents.map((n) => n.node_id), ...children.map((n) => n.node_id)]
    : [nodeId];

  return (
    <div className="p-6 space-y-5 max-w-7xl mx-auto">
      {/* Breadcrumbs */}
      <nav className="flex items-center gap-1.5 text-xs text-slate-500">
        <button
          onClick={handleBack}
          className="inline-flex items-center gap-1 rounded-sm border border-slate-800 px-2 py-1 text-[11px] font-medium text-slate-400 transition-colors hover:bg-slate-900 hover:text-slate-200"
        >
          <ArrowLeft className="h-3 w-3" />
          {siteId ? "Site topology" : "Back"}
        </button>
        <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Topology</span>
        <span className="text-slate-700">/</span>
        <span className="text-slate-500">Context</span>
        <span className="text-slate-700">/</span>
        <span className="text-white font-medium truncate max-w-[200px]">{nodeName}</span>
      </nav>

      {/* Page header */}
      <div className="flex items-start gap-4">
        <div
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-white text-xs font-bold"
          style={{ backgroundColor: meta.color }}
        >
          {meta.label.slice(0, 2).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-bold tracking-tight text-white break-all">{nodeName}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-400">
            <span>{meta.label}</span>
            {node?.vendor && <><span className="text-slate-700">·</span><span>{node.vendor}</span></>}
            {node?.model && <><span className="text-slate-700">·</span><span>{node.model}</span></>}
            {node?.site_name && <><span className="text-slate-700">·</span><span className="text-slate-500">{node.site_name}</span></>}
          </div>
        </div>
        {node && (
          <div
            className="shrink-0 flex items-center gap-2 rounded-lg px-3 py-2 border text-sm font-semibold"
            style={{ color: hMeta.color, borderColor: `${hMeta.color}40`, backgroundColor: hMeta.bgColor }}
          >
            <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: hMeta.color }} />
            {hMeta.label}
          </div>
        )}
      </div>

      {/* Main layout: graph left, detail right */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_340px]">
        {/* Graph */}
        <div className="min-w-0">
          <ContextGraph
            nodeId={nodeId}
            nodeName={nodeName}
            onBack={handleBack}
            onNodeClick={handleNodeClick}
            allNodeIds={allNodeIds}
          />
        </div>

        {/* Detail panel */}
        <div className="space-y-4">
          <div className="rounded-lg border border-slate-800/60 bg-slate-900/40 p-4">
            <h3 className="mb-3 text-xs font-bold uppercase tracking-wider text-slate-400">Device Info</h3>
            {nodeQuery.isLoading ? (
              <div className="space-y-2">
                {[1, 2, 3, 4].map((i) => <div key={i} className="h-4 animate-pulse rounded bg-slate-800" />)}
              </div>
            ) : node ? (
              <div>
                <PropRow label="IP Address" value={node.ip_address} />
                <PropRow label="Vendor" value={node.vendor} />
                <PropRow label="Model" value={node.model} />
                <PropRow label="Site" value={node.site_name ?? node.site_id} />
                <PropRow label="Node ID" value={node.node_id} />
                <PropRow label="Health" value={node.health_label || hMeta.label} />
                {node.props && Object.entries(node.props).slice(0, 5).map(([k, v]) => (
                  <PropRow key={k} label={k} value={String(v)} />
                ))}
              </div>
            ) : (
              <p className="text-xs text-slate-500">No data</p>
            )}
          </div>

          {(parents.length > 0 || children.length > 0) && (
            <div className="rounded-lg border border-slate-800/60 bg-slate-900/40 p-4">
              <h3 className="mb-3 text-xs font-bold uppercase tracking-wider text-slate-400">Connections</h3>
              <div className="space-y-3">
                {parents.length > 0 && (
                  <div>
                    <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-indigo-400">
                      <span className="inline-block h-px w-3 border-t border-dashed border-indigo-500" />
                      Upstream ({parents.length})
                    </div>
                    <div className="space-y-1.5">
                      {parents.map((p) => {
                        const pm = NODE_TYPE_META[p.node_type] ?? { label: p.node_type, color: "#6b7280" };
                        const ph = HEALTH_STATUS_META[p.health_status] ?? HEALTH_STATUS_META.unknown;
                        return (
                          <button
                            key={p.node_id}
                            onClick={() => handleNodeClick(p.node_id, p.name)}
                            className="flex w-full items-center gap-2 rounded-md border border-slate-800/60 px-2.5 py-2 text-left transition-colors hover:bg-slate-800/50"
                          >
                            <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: ph.color }} />
                            <span className="min-w-0 flex-1 truncate text-xs text-slate-200">{p.name || p.node_id}</span>
                            <span className="shrink-0 text-[10px] text-slate-500">{pm.label}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
                {children.length > 0 && (
                  <div>
                    <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                      <span className="inline-block h-px w-3 border-t border-slate-500" />
                      Downstream ({children.length})
                    </div>
                    <div className="space-y-1.5">
                      {children.slice(0, 8).map((c) => {
                        const cm = NODE_TYPE_META[c.node_type] ?? { label: c.node_type, color: "#6b7280" };
                        const ch2 = HEALTH_STATUS_META[c.health_status] ?? HEALTH_STATUS_META.unknown;
                        return (
                          <button
                            key={c.node_id}
                            onClick={() => handleNodeClick(c.node_id, c.name)}
                            className="flex w-full items-center gap-2 rounded-md border border-slate-800/60 px-2.5 py-2 text-left transition-colors hover:bg-slate-800/50"
                          >
                            <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: ch2.color }} />
                            <span className="min-w-0 flex-1 truncate text-xs text-slate-200">{c.name || c.node_id}</span>
                            <span className="shrink-0 text-[10px] text-slate-500">{cm.label}</span>
                          </button>
                        );
                      })}
                      {children.length > 8 && (
                        <p className="px-2.5 text-[10px] text-slate-600">+{children.length - 8} more</p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {node && (
            <div className="rounded-lg border border-slate-800/60 bg-slate-900/40 p-4">
              <h3 className="mb-3 text-xs font-bold uppercase tracking-wider text-slate-400">Health History</h3>
              <HealthHistoryChart nodeId={nodeId} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function TopologyContextPage() {
  return (
    <Suspense fallback={<ContextPageFallback />}>
      <ContextPageContent />
    </Suspense>
  );
}
