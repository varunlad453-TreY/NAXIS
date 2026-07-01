import { Badge } from "@/components/ui/badge";
import type { IncidentStatus } from "@/types/incident";
import { getStatusInfo, cn } from "@/lib/utils";

interface StatusBadgeProps {
  status: IncidentStatus;
  className?: string;
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const info = getStatusInfo(status);

  return (
    <Badge variant="outline" className={cn("uppercase tracking-wider", className)}>
      <span className={info.color}>{info.label}</span>
    </Badge>
  );
}
