"use client";

import { Globe, MoreHorizontal, RefreshCw, Settings2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { IntegrationStatusBadge } from "./integration-status";
import { getIntegrationIcon, type Integration } from "./integration";

interface IntegrationRowProps {
  item: Integration;
  isTesting: boolean;
  onTest: (id: string) => void;
}

export function IntegrationRow({ item, isTesting, onTest }: IntegrationRowProps) {
  const icon = getIntegrationIcon(item.id);

  return (
    <div className="group flex flex-col gap-4 border-b border-border/30 py-5 last:border-b-0 lg:flex-row lg:items-center lg:justify-between lg:gap-6">
      {/* Identity */}
      <div className="flex min-w-0 items-start gap-4 lg:w-[34%]">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          {icon}
        </div>
        <div className="min-w-0">
          <h3 className="font-semibold text-foreground">{item.name}</h3>
          <p className="text-xs text-foreground-subtle">{item.vendor}</p>
          <p className="mt-1 hidden text-sm text-foreground-muted lg:block">
            {item.description}
          </p>
        </div>
      </div>

      {/* Status & metrics */}
      <div className="grid grid-cols-3 gap-4 text-sm lg:w-[42%]">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wider text-foreground-subtle">
            Status
          </div>
          <div className="mt-1">
            <IntegrationStatusBadge status={item.status} />
          </div>
        </div>
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wider text-foreground-subtle">
            Last sync
          </div>
          <div className="mt-1 text-foreground">
            {item.lastSync ? new Date(item.lastSync).toLocaleTimeString() : "—"}
          </div>
        </div>
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wider text-foreground-subtle">
            Health score
          </div>
          <div className="mt-1 text-foreground">
            {item.healthScore !== null ? `${item.healthScore}%` : "—"}
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-4 lg:w-[24%] lg:justify-end">
        <button
          onClick={() => onTest(item.id)}
          disabled={isTesting}
          className={cn(
            "inline-flex items-center gap-1.5 text-sm font-medium transition-colors disabled:opacity-60",
            item.status === "connected"
              ? "text-foreground hover:text-primary"
              : "text-primary hover:text-primary-hover"
          )}
        >
          {isTesting ? (
            <RefreshCw className="h-3.5 w-3.5 animate-spin" />
          ) : item.status === "connected" ? (
            <RefreshCw className="h-3.5 w-3.5" />
          ) : (
            <Globe className="h-3.5 w-3.5" />
          )}
          {isTesting ? "Testing..." : item.status === "connected" ? "Re-sync" : "Connect"}
        </button>

        <button className="inline-flex items-center gap-1.5 text-sm font-medium text-foreground-subtle transition-colors hover:text-foreground">
          <Settings2 className="h-3.5 w-3.5" />
          Configure
        </button>

        <button
          className="text-foreground-subtle transition-colors hover:text-foreground"
          aria-label="More options"
        >
          <MoreHorizontal className="h-4 w-4" />
        </button>
      </div>

      {/* Mobile description */}
      <p className="text-sm leading-relaxed text-foreground-muted lg:hidden">
        {item.description}
      </p>
    </div>
  );
}
