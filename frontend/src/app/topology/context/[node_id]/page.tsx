"use client";

import { Suspense } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, AlertTriangle, Route, Zap, Activity } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { NODE_TYPE_META, HEALTH_STATUS_META } from "@/types/topology";
import type { TopologyNode } from "@/types/topology";
import type { EventSummary } from "@/types/event";
import { ContextGraph } from "@/components/topology/context-graph";
import { HealthHistoryChart } from "@/components/topology/health-history-chart";

function ContextPageFallback() {
  return (
    <div className="p-6 space-y-6 max-w-[1600px] mx-auto">
      <div className="h-4 w-32 animate-pulse bg-surface/50 rounded" />
      <div className="h-[500px] animate-pulse bg-surface/20 rounded" />
    </div>
  );
}

function PropRow({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <>
      <span className="text-foreground-subtle text-xs font-medium">{label}</span>
      <span className="font-mono text-xs text-foreground select-all truncate">{value}</span>
    </>
  );
}

function getDiagnosticInfo(node: TopologyNode, primaryEvent?: EventSummary) {
  if (primaryEvent) {
    return {
      title: primaryEvent.title,
      description: primaryEvent.description || "Active telemetry event recorded for this node.",
    };
  }

  const isConnected = node.props?.connected !== false;
  const isAp = node.node_type === "ap" || node.node_type === "wireless";
  const isSwitch = node.node_type.includes("switch");

  if (!isConnected) {
    return {
      title: `${node.vendor ? node.vendor.toUpperCase() : "Device"} Reachability Drop (Heartbeat Offline)`,
      description: `${node.name || node.node_id} has lost communication with the management controller. Upstream switch port link or PoE power should be inspected.`,
    };
  }

  if (node.health_status === "critical") {
    if (isAp) {
      return {
        title: "Wireless Performance Alarm (High Retry & Retransmission Rate)",
        description: `Radio metrics indicate severe 5GHz/2.4GHz channel utilization (>85%) or frame retransmission spike for ${node.name || node.node_id}.`,
      };
    }
    if (isSwitch) {
      return {
        title: "Switch Trunk / Uplink Congestion Alert",
        description: "Uplink interface experiencing packet drops or CRC buffer errors beyond operational thresholds.",
      };
    }
    return {
      title: "Critical Telemetry Anomaly Detected",
      description: "Health metrics breached critical operational limits. Immediate investigation recommended.",
    };
  }

  if (node.health_status === "degraded" || node.health_status === "warning") {
    return {
      title: "Degraded Telemetry Performance",
      description: "Minor latency elevation or RSSI signal attenuation detected on connected interfaces.",
    };
  }

  return {
    title: "Healthy Operational Status",
    description: "All telemetry parameters operating within normal parameters.",
  };
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

  const vendorDeviceId = node?.props?.vendor_device_id as string | undefined;

  // Query events for diagnostic root-cause signals
  const eventsQuery = useQuery({
    queryKey: ["device-events-ctx", nodeId, vendorDeviceId, siteId],
    queryFn: () => api.listEvents({ device_id: vendorDeviceId || nodeId, limit: 5 }),
    enabled: !!node,
  });

  const deviceEvents = eventsQuery.data?.events ?? [];
  const primaryEvent = deviceEvents[0];
  const diagnostic = node ? getDiagnosticInfo(node, primaryEvent) : null;

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

  // Upstream non-site parent for inspecting parent switch blast radius
  const upstreamInfrastructureParent = parents.find(
    (p) => p.node_type !== "site",
  );

  return (
    <div className="p-6 space-y-6 max-w-[1600px] mx-auto">
      {/* Breadcrumb Navigation */}
      <nav className="flex items-center gap-2 text-xs text-foreground-subtle">
        <button
          onClick={handleBack}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-foreground-muted hover:text-foreground transition-colors cursor-pointer"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          {siteId ? "Site topology" : "Back"}
        </button>
        <span>/</span>
        <span className="font-semibold uppercase tracking-wider text-foreground-subtle text-[10px]">Topology</span>
        <span>/</span>
        <span className="text-foreground-muted">Context</span>
        <span>/</span>
        <span className="text-foreground font-medium truncate max-w-[240px]">{nodeName}</span>
      </nav>

      {/* Operational Header */}
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-xl font-bold tracking-tight text-foreground truncate">{nodeName}</h1>
          {node && (
            <div className="flex items-center gap-2 shrink-0">
              <span className="h-2.5 w-2.5 rounded-full animate-pulse" style={{ backgroundColor: hMeta.color }} />
              <span className="text-sm font-semibold capitalize" style={{ color: hMeta.color }}>
                {hMeta.label}
              </span>
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-foreground-muted">
          <span className="font-semibold text-foreground">{meta.label}</span>
          {node?.vendor && <><span className="text-foreground-subtle">·</span><span>{node.vendor}</span></>}
          {node?.model && <><span className="text-foreground-subtle">·</span><span>{node.model}</span></>}
          {node?.site_name && <><span className="text-foreground-subtle">·</span><span>{node.site_name}</span></>}
        </div>
      </div>

      {/* Diagnostic Reason Banner for Degraded/Critical Devices */}
      {node && node.health_status !== "healthy" && diagnostic && (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded border border-rose-500/30 bg-rose-500/10 p-3.5 text-xs">
          <div className="space-y-1">
            <div className="flex items-center gap-2 font-semibold text-rose-400">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span>Diagnostic Reason: {diagnostic.title}</span>
            </div>
            <p className="text-foreground-muted pl-6">
              {diagnostic.description}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0 pl-6 sm:pl-0">
            {/* Show Blast Radius for nodes with downstream children */}
            {children.length > 0 && (
              <button
                onClick={() => {
                  if (siteId) {
                    router.push(`/topology/sites/${encodeURIComponent(siteId)}?highlight=${encodeURIComponent(nodeId)}`);
                  } else {
                    router.push(`/topology?highlight=${encodeURIComponent(nodeId)}`);
                  }
                }}
                className="inline-flex items-center gap-1.5 rounded border border-rose-500/40 bg-rose-500/20 px-2.5 py-1.5 text-xs font-medium text-rose-300 transition-colors hover:bg-rose-500/30 cursor-pointer"
              >
                <Zap className="h-3.5 w-3.5" />
                Blast Radius ({children.length})
              </button>
            )}

            {/* For leaf nodes: allow inspecting upstream switch impact */}
            {children.length === 0 && upstreamInfrastructureParent && (
              <button
                onClick={() => {
                  router.push(`/topology/context/${encodeURIComponent(upstreamInfrastructureParent.node_id)}`);
                }}
                className="inline-flex items-center gap-1.5 rounded border border-amber-500/40 bg-amber-500/20 px-2.5 py-1.5 text-xs font-medium text-amber-300 transition-colors hover:bg-amber-500/30 cursor-pointer"
              >
                <Zap className="h-3.5 w-3.5" />
                Inspect Upstream {upstreamInfrastructureParent.name || "Switch"}
              </button>
            )}

            <button
              onClick={() => {
                const target = node.ip_address || nodeId;
                router.push(`/path-trace?ip=${encodeURIComponent(target)}&device_id=${encodeURIComponent(nodeId)}`);
              }}
              className="inline-flex items-center gap-1.5 rounded border border-border/60 bg-surface px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-surface-hover cursor-pointer"
            >
              <Route className="h-3.5 w-3.5 text-primary" />
              Path Trace
            </button>
          </div>
        </div>
      )}

      <div className="h-px bg-border/40" />

      {/* Main Workspace Layout */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_360px]">
        {/* Topology Graph Canvas */}
        <div className="min-w-0">
          <ContextGraph
            nodeId={nodeId}
            nodeName={nodeName}
            onBack={handleBack}
            onNodeClick={handleNodeClick}
            allNodeIds={allNodeIds}
          />
        </div>

        {/* Sidebar: Single Cohesive Operational Panel */}
        <div className="space-y-6">
          {/* Attributes */}
          <div className="space-y-2">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-foreground-subtle">
              Device Attributes
            </div>
            {nodeQuery.isLoading ? (
              <div className="space-y-2 py-2">
                {[1, 2, 3, 4].map((i) => (
                  <div key={i} className="h-3.5 animate-pulse rounded bg-surface/50" />
                ))}
              </div>
            ) : node ? (
              <div className="grid grid-cols-[100px_1fr] gap-x-3 gap-y-2 py-1 text-xs">
                <PropRow label="IP Address" value={node.ip_address} />
                <PropRow label="Vendor" value={node.vendor} />
                <PropRow label="Model" value={node.model} />
                <PropRow label="Site" value={node.site_name ?? node.site_id} />
                <PropRow label="Node ID" value={node.node_id} />
                <PropRow label="Health" value={node.health_label || hMeta.label} />
                {children.length === 0 && (
                  <PropRow label="Impact Scope" value="Leaf Asset (0 downstream devices)" />
                )}
                {node.props && Object.entries(node.props).slice(0, 5).map(([k, v]) => (
                  <PropRow key={k} label={k} value={String(v)} />
                ))}
              </div>
            ) : (
              <p className="text-xs text-foreground-subtle py-1">No data</p>
            )}
          </div>

          <div className="h-px bg-border/40" />

          {/* Recent Signals & Events */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-foreground-subtle flex items-center gap-1.5">
                <Activity className="h-3 w-3 text-primary" />
                Recent Signals & Events
              </span>
              <span className="text-[10px] font-mono text-foreground-subtle">{deviceEvents.length} events</span>
            </div>
            {eventsQuery.isLoading ? (
              <div className="space-y-2 py-1">
                {[1, 2].map((i) => (
                  <div key={i} className="h-8 animate-pulse rounded bg-surface/50" />
                ))}
              </div>
            ) : deviceEvents.length > 0 ? (
              <div className="space-y-2 py-1">
                {deviceEvents.map((evt) => (
                  <div key={evt.event_id} className="text-xs space-y-0.5 border-l-2 border-primary/50 pl-2 py-0.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-foreground truncate">{evt.title}</span>
                      <span className="shrink-0 text-[10px] font-mono text-foreground-subtle">
                        {new Date(evt.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </span>
                    </div>
                    {evt.description && (
                      <p className="text-[11px] text-foreground-muted line-clamp-2">{evt.description}</p>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-foreground-subtle py-1">No recent events recorded for this device.</p>
            )}
          </div>

          <div className="h-px bg-border/40" />

          {/* Connections */}
          {(parents.length > 0 || children.length > 0) && (
            <div className="space-y-3">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-foreground-subtle">
                Topology Connections
              </div>
              <div className="space-y-3">
                {parents.length > 0 && (
                  <div className="space-y-1.5">
                    <div className="text-[10px] font-semibold uppercase tracking-wider text-primary">
                      Upstream ({parents.length})
                    </div>
                    <div className="space-y-1">
                      {parents.map((p) => {
                        const pm = NODE_TYPE_META[p.node_type] ?? { label: p.node_type, color: "#6b7280" };
                        const ph = HEALTH_STATUS_META[p.health_status] ?? HEALTH_STATUS_META.unknown;
                        return (
                          <button
                            key={p.node_id}
                            onClick={() => handleNodeClick(p.node_id, p.name)}
                            className="flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-xs transition-colors hover:bg-surface/60 cursor-pointer"
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: ph.color }} />
                              <span className="min-w-0 truncate text-foreground">{p.name || p.node_id}</span>
                            </div>
                            <span className="shrink-0 font-mono text-[10px] text-foreground-subtle">{pm.label}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {children.length > 0 && (
                  <div className="space-y-1.5">
                    <div className="text-[10px] font-semibold uppercase tracking-wider text-foreground-subtle">
                      Downstream ({children.length})
                    </div>
                    <div className="space-y-1">
                      {children.slice(0, 8).map((c) => {
                        const cm = NODE_TYPE_META[c.node_type] ?? { label: c.node_type, color: "#6b7280" };
                        const ch2 = HEALTH_STATUS_META[c.health_status] ?? HEALTH_STATUS_META.unknown;
                        return (
                          <button
                            key={c.node_id}
                            onClick={() => handleNodeClick(c.node_id, c.name)}
                            className="flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-xs transition-colors hover:bg-surface/60 cursor-pointer"
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: ch2.color }} />
                              <span className="min-w-0 truncate text-foreground">{c.name || c.node_id}</span>
                            </div>
                            <span className="shrink-0 font-mono text-[10px] text-foreground-subtle">{cm.label}</span>
                          </button>
                        );
                      })}
                      {children.length > 8 && (
                        <p className="px-2 text-[11px] font-medium text-foreground-subtle">+{children.length - 8} more</p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="h-px bg-border/40" />

          {/* Health History */}
          {node && (
            <div className="space-y-2">
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
