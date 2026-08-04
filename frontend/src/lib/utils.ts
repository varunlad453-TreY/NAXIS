import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import { formatDistanceToNow, format } from "date-fns";
import type { IncidentSeverity, IncidentStatus } from "@/types/incident";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Format timestamp for display
 */
export function formatTimestamp(timestamp: string): string {
  try {
    const date = new Date(timestamp);
    return formatDistanceToNow(date, { addSuffix: true });
  } catch {
    return timestamp;
  }
}

/**
 * Format absolute timestamp
 */
export function formatAbsoluteTimestamp(timestamp: string): string {
  try {
    const date = new Date(timestamp);
    return format(date, "MMM d, yyyy h:mm a");
  } catch {
    return timestamp;
  }
}

/**
 * Get severity color classes
 */
export function getSeverityColors(severity: IncidentSeverity): {
  bg: string;
  text: string;
  border: string;
  dot: string;
} {
  switch (severity) {
    case "critical":
      return {
        bg: "bg-critical-bg",
        text: "text-critical",
        border: "border-critical-border",
        dot: "bg-critical",
      };
    case "major":
      return {
        bg: "bg-major-bg",
        text: "text-major",
        border: "border-major-border",
        dot: "bg-major",
      };
    case "minor":
      return {
        bg: "bg-minor-bg",
        text: "text-minor",
        border: "border-minor-border",
        dot: "bg-minor",
      };
    case "info":
      return {
        bg: "bg-info-bg",
        text: "text-info",
        border: "border-info-border",
        dot: "bg-info",
      };
    default:
      return {
        bg: "bg-background-elevated",
        text: "text-foreground-muted",
        border: "border-border",
        dot: "bg-foreground-subtle",
      };
  }
}

/**
 * Get status display info
 */
export function getStatusInfo(status: IncidentStatus): {
  label: string;
  color: string;
} {
  switch (status) {
    case "open":
      return { label: "Open", color: "text-critical" };
    case "investigating":
      return { label: "Investigating", color: "text-major" };
    case "mitigated":
      return { label: "Mitigated", color: "text-info" };
    case "resolved":
      return { label: "Resolved", color: "text-success" };
    case "closed":
      return { label: "Closed", color: "text-foreground-subtle" };
    case "suppressed":
      return { label: "Suppressed", color: "text-foreground-subtle" };
    default:
      return { label: status, color: "text-foreground-muted" };
  }
}

/**
 * Format confidence score as percentage
 */
export function formatConfidence(score: number): string {
  return `${Math.round(score * 100)}%`;
}

/**
 * Format an active incident's elapsed time as "2h 14m".
 *
 * Used on the Alerts page for "ongoing for 2h 14m".
 */
export function formatElapsed(startIso: string, nowIso = new Date().toISOString()): string {
  const start = new Date(startIso).getTime();
  const now = new Date(nowIso).getTime();
  if (Number.isNaN(start) || Number.isNaN(now)) return "—";
  const totalMinutes = Math.max(0, Math.floor((now - start) / 60000));
  if (totalMinutes < 1) return "just now";
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

/**
 * Get severity sort order (for sorting)
 */
export function getSeverityOrder(severity: IncidentSeverity): number {
  const order: Record<IncidentSeverity, number> = {
    critical: 0,
    major: 1,
    minor: 2,
    info: 3,
  };
  return order[severity] ?? 999;
}
