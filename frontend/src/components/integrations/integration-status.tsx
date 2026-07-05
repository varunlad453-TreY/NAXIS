"use client";

import { cn } from "@/lib/utils";
import { statusConfig } from "./integration";
import type { IntegrationStatus } from "@/types/integration";

interface IntegrationStatusBadgeProps {
  status: IntegrationStatus;
  labelOverride?: string;
}

export function IntegrationStatusBadge({ status, labelOverride }: IntegrationStatusBadgeProps) {
  const config = statusConfig[status];
  const Icon = config.icon;
  const isTesting = status === "testing";

  return (
    <div className={cn("flex items-center gap-1.5 text-sm font-medium", config.text)}>
      <span className={cn("h-2 w-2 rounded-full", config.dot, isTesting && "animate-pulse")} />
      <Icon className={cn("h-3.5 w-3.5", isTesting && "animate-spin")} />
      <span>{labelOverride ?? config.label}</span>
    </div>
  );
}
