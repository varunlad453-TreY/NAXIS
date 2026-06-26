import { Badge } from "@/components/ui/badge";
import type { IncidentStatus } from "@/types/incident";
import { getStatusInfo } from "@/lib/utils";

interface StatusBadgeProps {
  status: IncidentStatus;
  className?: string;
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const info = getStatusInfo(status);

  return (
    <Badge variant="outline" className={className}>
      <span className={info.color}>{info.label}</span>
    </Badge>
  );
}
