import { Badge } from "@/components/ui/badge";
import type { IncidentSeverity } from "@/types/incident";
import { cn } from "@/lib/utils";

interface SeverityBadgeProps {
  severity: IncidentSeverity;
  label?: string;
  showDot?: boolean;
  showDescription?: boolean;
  className?: string;
}

const LABELS: Record<IncidentSeverity, string> = {
  critical: "Outage",
  major: "Degraded",
  minor: "Attention",
  info: "Info",
};

const DESCRIPTIONS: Record<IncidentSeverity, string> = {
  critical: "Service unavailable — users are directly impacted. Immediate action required.",
  major: "Performance degraded — some users affected. Investigate promptly.",
  minor: "Anomaly detected — not yet impacting users. Monitor closely.",
  info: "Informational — no action required.",
};

const variants: Record<IncidentSeverity, "critical" | "major" | "minor" | "info"> = {
  critical: "critical",
  major: "major",
  minor: "minor",
  info: "info",
};

export function SeverityBadge({ severity, label, showDot = false, showDescription = false, className }: SeverityBadgeProps) {
  const displayLabel = label ?? LABELS[severity] ?? severity;

  return (
    <span className="group/badge relative inline-flex">
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
        {displayLabel}
      </Badge>
      {showDescription && (
        <div className="absolute left-0 top-full z-50 mt-1.5 w-64 rounded-lg border border-border/60 bg-surface p-3 text-xs text-foreground-muted opacity-0 shadow-lg transition-opacity group-hover/badge:opacity-100 pointer-events-none">
          {DESCRIPTIONS[severity] ?? "No description available."}
        </div>
      )}
    </span>
  );
}
