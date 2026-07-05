"use client";

import { ChevronDown, ChevronUp, Cloud, Network, RefreshCw, Settings2, ShieldCheck } from "lucide-react";

import { cn, formatTimestamp } from "@/lib/utils";
import type { Integration, IntegrationActionResponse } from "@/types/integration";
import { IntegrationStatusBadge } from "./integration-status";
import { getIntegrationIcon } from "./integration";

interface IntegrationRowProps {
  item: Integration;
  isTesting: boolean;
  isSyncing: boolean;
  isOpen: boolean;
  isCollectorsOpen: boolean;
  onToggleConfigure: (id: string) => void;
  onToggleCollectors: (id: string) => void;
  onTest: (id: string) => Promise<IntegrationActionResponse>;
  onSync: (id: string) => Promise<IntegrationActionResponse>;
}

function HealthBar({ value }: { value: number | null }) {
  const progress = value === null ? 0 : Math.max(0, Math.min(100, value));

  return (
    <div className="flex items-center gap-3">
      <div className="h-2 w-28 overflow-hidden rounded-full bg-border/60 sm:w-36">
        <div
          className={cn(
            "h-full rounded-full transition-all duration-500",
            progress >= 80 ? "bg-success" : progress >= 50 ? "bg-info" : "bg-critical"
          )}
          style={{ width: `${progress}%` }}
        />
      </div>
      <span className="text-sm tabular-nums text-foreground-muted">{value === null ? "—" : `${value}%`}</span>
    </div>
  );
}

export function IntegrationRow({
  item,
  isTesting,
  isSyncing,
  isOpen,
  isCollectorsOpen,
  onToggleConfigure,
  onToggleCollectors,
  onTest,
  onSync,
}: IntegrationRowProps) {
  const icon = getIntegrationIcon(item.id);
  const hasLastSync = Boolean(item.lastSync);
  const primaryActionLabel = item.status === "connected" ? "Re-sync" : "Connect";

  return (
    <div className="group border-b border-border/40 py-5 transition-colors hover:bg-background-elevated/40 last:border-b-0">
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1.3fr)_auto] lg:items-center">
        <div className="flex min-w-0 items-start gap-4">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary ring-1 ring-inset ring-primary/10">
            {icon}
          </div>
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <h3 className="text-base font-semibold text-foreground">{item.name}</h3>
              <span className="text-xs font-medium uppercase tracking-[0.16em] text-foreground-subtle">
                {item.vendor}
              </span>
              {item.comingSoon && (
                <span className="rounded-full border border-border/70 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground-subtle">
                  Coming soon
                </span>
              )}
            </div>
            <p className="max-w-2xl text-sm leading-6 text-foreground-muted">{item.description}</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-x-6 gap-y-3 text-sm">
          <div className="min-w-[8rem]">
            <IntegrationStatusBadge
              status={isTesting ? "testing" : item.status}
              labelOverride={
                !isTesting && item.configured ? "Configured" : undefined
              }
            />
          </div>
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-foreground-subtle">
              Last sync
            </div>
            <div className="mt-1 text-foreground">{hasLastSync ? formatTimestamp(item.lastSync!) : "—"}</div>
          </div>
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-foreground-subtle">
              Health
            </div>
            <div className="mt-2">
              <HealthBar value={item.healthScore} />
            </div>
          </div>
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-foreground-subtle">
              Events
            </div>
            <div className="mt-1 text-foreground tabular-nums">{(item.eventsCollected ?? 0).toLocaleString()}</div>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-start gap-2 lg:justify-end">
          <button
            onClick={() => {
              void onTest(item.id).catch(() => undefined);
            }}
            disabled={isTesting}
            className={cn(
              "inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60",
              item.status === "connected"
                ? "border-border/70 bg-background-elevated/30 text-foreground hover:bg-background-elevated"
                : "border-transparent bg-primary/10 text-primary hover:bg-primary/15"
            )}
          >
            {isTesting ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Cloud className="h-4 w-4" />}
            {isTesting ? "Testing" : primaryActionLabel}
          </button>

          <button
            onClick={() => {
              void onSync(item.id).catch(() => undefined);
            }}
            disabled={isSyncing}
            className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-background-elevated/30 px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-background-elevated disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSyncing ? <RefreshCw className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
            {isSyncing ? "Syncing" : "Re-sync"}
          </button>

          {item.collectors.length > 0 && (
            <button
              onClick={() => onToggleCollectors(item.id)}
              className={cn(
                "inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium transition-colors",
                isCollectorsOpen
                  ? "border-primary/40 bg-primary/10 text-primary"
                  : "border-border/70 bg-transparent text-foreground-subtle hover:border-border hover:bg-background-elevated hover:text-foreground"
              )}
            >
              <Network className="h-4 w-4" />
              Collectors
              <span className="rounded-full bg-foreground/10 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums">
                {item.collectors.length}
              </span>
              {isCollectorsOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </button>
          )}

          <button
            onClick={() => onToggleConfigure(item.id)}
            className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-transparent px-4 py-2 text-sm font-medium text-foreground-subtle transition-colors hover:border-border hover:bg-background-elevated hover:text-foreground"
          >
            <Settings2 className="h-4 w-4" />
            Configure
            {isOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {item.errors.length > 0 && (
        <div className="mt-3 text-sm text-critical">
          {item.errors[0]}
        </div>
      )}
    </div>
  );
}