import { Badge } from "@/components/ui/badge";
import type { IncidentSeverity } from "@/types/incident";
import { cn } from "@/lib/utils";

interface SeverityBadgeProps {
  severity: IncidentSeverity;
  showDot?: boolean;
  className?: string;
}

export function SeverityBadge({ severity, showDot = false, className }: SeverityBadgeProps) {
  const labels: Record<IncidentSeverity, string> = {
    critical: "Critical",
    major: "Major",
    minor: "Minor",
    info: "Info",
  };

  const variants: Record<IncidentSeverity, "critical" | "major" | "minor" | "info"> = {
    critical: "critical",
    major: "major",
    minor: "minor",
    info: "info",
  };

  return (
    <Badge variant={variants[severity]} className={cn("uppercase tracking-wide", className)}>
      {showDot && (
        <span
          className={cn(
            "mr-1.5 h-1.5 w-1.5 rounded-full",
            severity === "critical" && "bg-critical",
            severity === "major" && "bg-major",
            severity === "minor" && "bg-minor",
            severity === "info" && "bg-info"
          )}
        />
      )}
      {labels[severity]}
    </Badge>
  );
}
