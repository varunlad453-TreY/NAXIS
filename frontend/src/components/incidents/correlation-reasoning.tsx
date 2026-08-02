"use client";

import { useQuery } from "@tanstack/react-query";
import {
  Network,
  Server,
  Wifi,
  AlertTriangle,
  ArrowRight,
  Layers,
  TrendingUp,
} from "lucide-react";
import type { IncidentDetail } from "@/types/incident";
import { api } from "@/lib/api";
import { ConfidenceBreakdown } from "./confidence-breakdown";
import { Skeleton } from "@/components/ui/skeleton";

const CASCADE_PATTERN = /failure cascading to (\d+) dependent devices/i;

interface CorrelationReasoningProps {
  incident: IncidentDetail;
}

export function CorrelationReasoning({ incident }: CorrelationReasoningProps) {
  const isCascade = CASCADE_PATTERN.test(incident.title);
  const hasRootSymptoms =
    incident.root_device_ids.length > 0 || incident.symptom_device_ids.length > 0;

  // Fetch blast radius for cascade incidents to get topology edge context
  const { data: blastRadius, isLoading: blastLoading } = useQuery({
    queryKey: ["blast-radius", incident.incident_id],
    queryFn: () => api.getBlastRadius(incident.incident_id),
    enabled: isCascade && hasRootSymptoms,
    staleTime: 30_000,
  });

  const rootDevice = blastRadius?.nodes?.find((n) =>
    incident.root_device_ids.includes(n.node_id)
  );
  const symptomDevices =
    blastRadius?.nodes?.filter((n) =>
      incident.symptom_device_ids.includes(n.node_id)
    ) ?? [];

  const edgesUsed =
    blastRadius?.edges?.filter(
      (e) =>
        incident.root_device_ids.includes(e.dst_id) &&
        incident.symptom_device_ids.includes(e.src_id)
    ) ?? [];

  return (
    <section className="rounded-lg border border-border/40 p-5">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
        <Network className="h-4 w-4 text-primary" />
        Correlation Reasoning
        {isCascade && (
          <span className="ml-1 inline-flex items-center gap-1 rounded-full bg-amber/10 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.12em] text-amber">
            <Layers className="h-2.5 w-2.5" />
            Cascade
          </span>
        )}
      </h2>

      <div className="mt-5 space-y-6">
        {/* Root Cause Device */}
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-foreground-subtle">
            <AlertTriangle className="h-3.5 w-3.5 text-critical" />
            Root Cause
          </div>
          {hasRootSymptoms ? (
            <div className="relative space-y-2">
              {incident.root_device_ids.map((devId) => {
                const node = blastRadius?.nodes?.find((n) => n.node_id === devId);
                return (
                  <div
                    key={devId}
                    className="flex items-center gap-3 rounded-lg border border-critical/20 bg-critical/5 p-3"
                  >
                    <Server className="h-5 w-5 shrink-0 text-critical" />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold text-foreground">
                        {node?.name || devId}
                      </div>
                      <div className="text-xs text-foreground-muted">
                        {node?.node_type || "Infrastructure device"}
                        {node?.vendor ? ` · ${node.vendor}` : ""}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-foreground-muted">
              {isCascade
                ? "Loading root cause identification..."
                : "No topology cascade — all events grouped at the same site and time."}
            </p>
          )}
        </div>

        {/* Symptom Devices */}
        {hasRootSymptoms && incident.symptom_device_ids.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-foreground-subtle">
              <Wifi className="h-3.5 w-3.5 text-major" />
              Symptom Devices
              <span className="ml-auto rounded-full bg-major/10 px-2 py-0.5 text-[9px] text-major">
                {incident.symptom_device_ids.length}
              </span>
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {incident.symptom_device_ids.slice(0, 10).map((devId) => {
                const node = blastRadius?.nodes?.find((n) => n.node_id === devId);
                return (
                  <div
                    key={devId}
                    className="flex items-center gap-2 rounded-lg border border-major/10 bg-major/[0.03] p-2.5"
                  >
                    <Wifi className="h-4 w-4 shrink-0 text-major" />
                    <div className="min-w-0">
                      <div className="truncate text-xs font-medium text-foreground">
                        {node?.name || devId}
                      </div>
                      <div className="text-[10px] text-foreground-subtle">
                        {node?.node_type || "leaf device"}
                      </div>
                    </div>
                  </div>
                );
              })}
              {incident.symptom_device_ids.length > 10 && (
                <div className="col-span-full text-center text-[10px] text-foreground-subtle">
                  +{incident.symptom_device_ids.length - 10} more symptom devices
                </div>
              )}
            </div>
          </div>
        )}

        {/* Topology Edges Used (cascade only) */}
        {isCascade && edgesUsed.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-foreground-subtle">
              <Layers className="h-3.5 w-3.5 text-primary" />
              Topology Edges
              <span className="ml-auto text-[10px] font-normal normal-case text-foreground-subtle">
                {edgesUsed.length} connection{edgesUsed.length > 1 ? "s" : ""}
              </span>
            </div>
            <div className="space-y-1.5">
              {edgesUsed.slice(0, 8).map((edge) => {
                const src = blastRadius?.nodes?.find((n) => n.node_id === edge.src_id);
                const dst = blastRadius?.nodes?.find((n) => n.node_id === edge.dst_id);
                return (
                  <div
                    key={`${edge.src_id}-${edge.dst_id}`}
                    className="flex items-center gap-1.5 rounded px-2 py-1 text-xs text-foreground-muted transition-colors hover:bg-surface"
                  >
                    <span className="max-w-[120px] truncate font-medium text-foreground">
                      {src?.name || edge.src_id}
                    </span>
                    <ArrowRight className="h-3 w-3 shrink-0 text-foreground-subtle" />
                    <span className="max-w-[120px] truncate font-medium text-foreground">
                      {dst?.name || edge.dst_id}
                    </span>
                    <span className="ml-auto shrink-0 text-[9px] uppercase tracking-wider text-foreground-subtle">
                      {edge.edge_type}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Confidence Breakdown */}
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-foreground-subtle">
            <TrendingUp className="h-3.5 w-3.5 text-primary" />
            Confidence Breakdown
          </div>
          <ConfidenceBreakdown
            breakdown={incident.confidence_breakdown}
            total={incident.confidence_score}
          />
        </div>
      </div>
    </section>
  );
}
