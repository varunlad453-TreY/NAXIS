import { Badge } from "@/components/ui/badge";
import type { EventSeverity } from "@/types/event";
import { cn } from "@/lib/utils";

interface EventSeverityBadgeProps {
  severity: EventSeverity;
  showDot?: boolean;
  className?: string;
}

export function EventSeverityBadge({
  severity,
  showDot = false,
  className,
}: EventSeverityBadgeProps) {
  const labels: Record<EventSeverity, string> = {
    critical: "Critical",
    major: "Major",
    minor: "Minor",
    info: "Info",
  };

  const variants: Record<EventSeverity, "critical" | "major" | "minor" | "info"> = {
    critical: "critical",
    major: "major",
    minor: "minor",
    info: "info",
  };

  return (
    <Badge variant={variants[severity]} className={cn("uppercase tracking-wider", className)}>
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
