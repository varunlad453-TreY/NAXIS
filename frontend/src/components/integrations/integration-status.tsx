"use client";

import { cn } from "@/lib/utils";
import { statusConfig, type IntegrationStatus } from "./integration";

interface IntegrationStatusBadgeProps {
  status: IntegrationStatus;
}

export function IntegrationStatusBadge({ status }: IntegrationStatusBadgeProps) {
  const config = statusConfig[status];
  const Icon = config.icon;

  return (
    <div className={cn("flex items-center gap-1.5 text-sm font-medium", config.text)}>
      <span className={cn("h-2 w-2 rounded-full", config.dot)} />
      <Icon className="h-3.5 w-3.5" />
      <span>{config.label}</span>
    </div>
  );
}
