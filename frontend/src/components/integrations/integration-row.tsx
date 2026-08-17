"use client";

import { useEffect, useState } from "react";
import { AlertCircle, CheckCircle2, ChevronDown, ChevronUp, Cloud, Network, RefreshCw, Settings2, ShieldCheck } from "lucide-react";

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
  const color = progress >= 80 ? "bg-success" : progress >= 50 ? "bg-info" : "bg-critical";

  return (
    <div className="flex items-center gap-3">
      <div className="h-1 w-28 bg-border/60 sm:w-36">
        <div
          className={cn("h-full transition-all duration-500", color)}
          style={{ width: `${progress}%` }}
        />
      </div>
      <span className={cn("text-sm tabular-nums", progress >= 80 ? "text-success" : progress >= 50 ? "text-info" : "text-critical")}>
        {value === null ? "—" : `${value}%`}
      </span>
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
  const isConnected = item.status === "connected";
  const [actionFeedback, setActionFeedback] = useState<{ ok: boolean; message: string } | null>(null);

  useEffect(() => {
    if (!actionFeedback) return;
    const timer = setTimeout(() => setActionFeedback(null), 6000);
    return () => clearTimeout(timer);
  }, [actionFeedback]);

  const runSync = async () => {
    try {
      const result = await onSync(item.id);
      setActionFeedback({ ok: result.success, message: result.message });
    } catch (err) {
      setActionFeedback({
        ok: false,
        message: err instanceof Error ? err.message : "Sync failed",
      });
    }
  };

  const runTest = async () => {
    try {
      const result = await onTest(item.id);
      setActionFeedback({ ok: result.success, message: result.message });
    } catch (err) {
      setActionFeedback({
        ok: false,
        message: err instanceof Error ? err.message : "Connection test failed",
      });
    }
  };

  return (
    <div className="group border-b border-border/40 py-5 transition-colors hover:bg-background-elevated/40 last:border-b-0">
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1.3fr)_auto] lg:items-center">
        <div className="flex min-w-0 items-start gap-3">
          <div className="mt-0.5 shrink-0 text-primary">
            {icon}
          </div>
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <h3 className="text-base font-semibold text-foreground">{item.name}</h3>
              <span className="text-xs font-medium uppercase tracking-[0.16em] text-foreground-subtle">
                {item.vendor}
              </span>
              {item.comingSoon && (
                <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground-subtle">
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

        <div className="flex flex-wrap items-center justify-start gap-3 lg:justify-end">
          <button
            onClick={() => {
              void runSync();
            }}
            disabled={isSyncing || !isConnected}
            title={!isConnected ? "Connect the integration before syncing" : undefined}
            className={cn(
              "inline-flex items-center gap-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60",
              isConnected
                ? "text-foreground hover:text-primary"
                : "text-primary hover:text-primary-hover"
            )}
          >
            {isSyncing ? <RefreshCw className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
            {isSyncing ? "Syncing" : "Re-sync"}
          </button>

          <button
            onClick={() => {
              void runTest();
            }}
            disabled={isTesting}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-foreground transition-colors hover:text-primary disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isTesting ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Cloud className="h-4 w-4" />}
            {isTesting ? "Testing" : "Test connection"}
          </button>

          {item.collectors.length > 0 && (
            <button
              onClick={() => onToggleCollectors(item.id)}
              className={cn(
                "inline-flex items-center gap-1.5 text-sm font-medium transition-colors",
                isCollectorsOpen
                  ? "text-primary"
                  : "text-foreground-subtle hover:text-foreground"
              )}
            >
              <Network className="h-4 w-4" />
              Collectors
              <span className="text-[10px] font-semibold tabular-nums">
                {item.collectors.length}
              </span>
              {isCollectorsOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </button>
          )}

          <button
            onClick={() => onToggleConfigure(item.id)}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-foreground-subtle transition-colors hover:text-foreground"
          >
            <Settings2 className="h-4 w-4" />
            Configure
            {isOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {actionFeedback && (
        <div
          className={cn(
            "mt-3 flex items-start gap-2 rounded-lg border px-3 py-2 text-sm",
            actionFeedback.ok
              ? "border-success/30 bg-success/5 text-success"
              : "border-critical/30 bg-critical/5 text-critical"
          )}
        >
          {actionFeedback.ok ? (
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
          ) : (
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          )}
          <span>{actionFeedback.message}</span>
        </div>
      )}

      {item.errors.length > 0 && (
        <div className="mt-3 text-sm text-critical">
          {item.errors[0]}
        </div>
      )}
    </div>
  );
}