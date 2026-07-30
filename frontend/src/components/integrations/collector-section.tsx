"use client";

import Link from "next/link";
import { AlertCircle, CheckCircle2, Clock, ExternalLink, Eye, Loader2, MinusCircle, PauseCircle } from "lucide-react";

import { cn, formatTimestamp } from "@/lib/utils";
import type { IntegrationCollectorSummary, CollectorOperationalStatus, IntegrationStatus } from "@/types/integration";

function collectorTargetUrl(integrationId: string, collectorId: string): string {
  const vendor = integrationId.toLowerCase();
  if (vendor === "mist") return "/mist";
  if (vendor === "velocloud") return "/sdwan";
  if (collectorId.includes("events")) return `/events?source=${vendor.replace("_", "")}`;
  return `/devices?platform=${vendor.replace("-", "_")}`;
}

interface CollectorSectionProps {
  collectors: IntegrationCollectorSummary[];
  isOpen: boolean;
  integrationId: string;
}

const opStatusConfig: Record<CollectorOperationalStatus, { label: string; icon: typeof CheckCircle2; color: string; dot: string }> = {
  active: { label: "Active", icon: CheckCircle2, color: "text-success", dot: "bg-success" },
  working: { label: "Working", icon: Clock, color: "text-info", dot: "bg-info" },
  inactive: { label: "Inactive", icon: PauseCircle, color: "text-critical", dot: "bg-critical" },
  notConfigured: { label: "Not configured", icon: MinusCircle, color: "text-foreground-subtle", dot: "bg-foreground-subtle" },
};

const statusDot: Record<IntegrationStatus, string> = {
  connected: "bg-success",
  disconnected: "bg-critical",
  not_configured: "bg-foreground-subtle",
  testing: "bg-info",
  error: "bg-critical",
};

function CollectorRow({ collector, integrationId }: { collector: IntegrationCollectorSummary; integrationId: string }) {
  const op = opStatusConfig[collector.operationalStatus] ?? opStatusConfig["notConfigured"];
  const OpIcon = op.icon;
  const targetUrl = collectorTargetUrl(integrationId, collector.id);

  return (
    <Link
      href={targetUrl}
      className="group/collector block rounded-2xl border border-border/40 bg-background/40 px-4 py-3 transition-colors hover:bg-background-elevated/30"
    >
      <div className="flex items-start justify-between gap-4">
        {/* Left: collector info */}
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-center gap-2">
            <div className={cn("h-2 w-2 rounded-full", statusDot[collector.status])} />
            <span className="text-sm font-medium text-foreground">{collector.label}</span>
            <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em]", op.color, "bg-opacity-10")}>
              <OpIcon className="h-3 w-3" />
              {op.label}
            </span>
            <ExternalLink className="ml-auto h-3 w-3 shrink-0 text-foreground-subtle opacity-0 transition-opacity group-hover/collector:opacity-100" />
          </div>

          {collector.purpose && (
            <p className="text-xs leading-5 text-foreground-muted">{collector.purpose}</p>
          )}

          {/* What it collects */}
          {collector.collects.length > 0 && (
            <div className="flex flex-wrap gap-1 pt-0.5">
              {collector.collects.map((item) => (
                <span
                  key={item}
                  className="inline-block rounded-full border border-border/50 bg-background-elevated/40 px-2 py-0.5 text-[10px] font-medium text-foreground-subtle"
                >
                  {item}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Right: metrics */}
        <div className="flex shrink-0 items-center gap-4 text-right">
          <div className="space-y-0.5">
            <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground-subtle">Health</div>
            <div className="text-sm tabular-nums text-foreground">
              {collector.healthScore === null ? "—" : `${collector.healthScore}%`}
            </div>
          </div>
          <div className="space-y-0.5">
            <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground-subtle">Last sync</div>
            <div className="text-xs text-foreground-muted">
              {collector.lastSync ? formatTimestamp(collector.lastSync) : "Never"}
            </div>
          </div>
        </div>
      </div>

      {/* Error message */}
      {collector.message && (
        <div className="mt-2 flex items-start gap-2 rounded-xl bg-critical/5 px-3 py-2 text-xs text-critical">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{collector.message}</span>
        </div>
      )}

      {/* Output info */}
      {collector.output && (
        <div className="mt-2 flex items-center gap-1.5 text-[10px] text-foreground-subtle">
          <Eye className="h-3 w-3" />
          <span>Output: {collector.output}</span>
        </div>
      )}
    </Link>
  );
}

export function CollectorSection({ collectors, isOpen, integrationId }: CollectorSectionProps) {
  if (!isOpen || collectors.length === 0) {
    return null;
  }

  const activeCount = collectors.filter((c) => c.operationalStatus === "active" || c.operationalStatus === "working").length;
  const errorCount = collectors.filter((c) => c.status === "error" || c.status === "disconnected").length;

  return (
    <div className="border-b border-border/40 bg-background-elevated/20 px-4 py-4 lg:px-6">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.14em] text-foreground-subtle">
          <span className="inline-flex h-2 w-2 rounded-full bg-primary" aria-hidden />
          Collector status ({activeCount}/{collectors.length} active)
        </div>
        {errorCount > 0 && (
          <span className="rounded-full bg-critical/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-critical">
            {errorCount} failing
          </span>
        )}
      </div>

      <div className="space-y-2">
        {collectors.map((collector) => (
          <CollectorRow key={collector.id} collector={collector} integrationId={integrationId} />
        ))}
      </div>
    </div>
  );
}
