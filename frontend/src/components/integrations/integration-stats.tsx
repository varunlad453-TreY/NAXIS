"use client";

import { cn } from "@/lib/utils";
import type { Integration } from "@/types/integration";

interface IntegrationStatsProps {
  integrations: Integration[];
}

export function IntegrationStats({ integrations }: IntegrationStatsProps) {
  const connected = integrations.filter((integration) => integration.status === "connected").length;
  const disconnected = integrations.filter((integration) => integration.status === "disconnected").length;
  const notConfigured = integrations.filter((integration) => integration.status === "not_configured").length;
  const totalEvents = integrations.reduce((sum, integration) => sum + (integration.eventsCollected ?? 0), 0);
  const healthValues = integrations.map((integration) => integration.healthScore).filter((value): value is number => value !== null);
  const averageHealth = healthValues.length > 0 ? Math.round(healthValues.reduce((sum, value) => sum + value, 0) / healthValues.length) : null;

  const stats = [
    { label: "Connected", value: connected, color: "text-success" },
    { label: "Disconnected", value: disconnected, color: "text-critical" },
    { label: "Not configured", value: notConfigured, color: "text-foreground-subtle" },
    { label: "Events collected", value: totalEvents, color: "text-foreground" },
    {
      label: "Average health",
      value: averageHealth === null ? "—" : `${averageHealth}%`,
      color: "text-info",
    },
  ];

  return (
    <div className="flex flex-wrap items-end gap-x-8 gap-y-4 border-y border-border/40 py-4">
      {stats.map((stat, index) => (
        <div key={stat.label} className="flex items-end gap-2">
          <div className={cn("text-3xl font-semibold leading-none tabular-nums", stat.color)}>
            {stat.value}
          </div>
          <div className="pb-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-foreground-subtle">
            {stat.label}
          </div>
          {index < stats.length - 1 && <span className="ml-3 hidden h-5 w-px bg-border/60 sm:block" />}
        </div>
      ))}
    </div>
  );
}
