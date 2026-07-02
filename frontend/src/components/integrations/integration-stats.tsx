"use client";

import { cn } from "@/lib/utils";
import type { Integration } from "./integration";

interface IntegrationStatsProps {
  integrations: Integration[];
}

export function IntegrationStats({ integrations }: IntegrationStatsProps) {
  const stats = [
    {
      label: "Connected",
      value: integrations.filter((i) => i.status === "connected").length,
      color: "text-success",
    },
    {
      label: "Disconnected",
      value: integrations.filter((i) => i.status === "disconnected").length,
      color: "text-critical",
    },
    {
      label: "Not configured",
      value: integrations.filter((i) => i.status === "not_configured").length,
      color: "text-foreground-subtle",
    },
    {
      label: "Events last hour",
      value: integrations.reduce((s, i) => s + i.eventsLastHour, 0),
      color: "text-foreground",
    },
  ];

  return (
    <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
      {stats.map((stat, index) => (
        <div key={stat.label} className="flex items-baseline gap-2">
          <span className={cn("text-2xl font-semibold tabular-nums", stat.color)}>
            {stat.value}
          </span>
          <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-foreground-subtle">
            {stat.label}
          </span>
          {index < stats.length - 1 && (
            <span className="ml-2 hidden h-4 w-px bg-border sm:block" />
          )}
        </div>
      ))}
    </div>
  );
}
