import { Badge } from "@/components/ui/badge";
import type { DeviceReachability } from "@/types/device";
import { cn } from "@/lib/utils";

interface DeviceReachabilityBadgeProps {
  reachability: DeviceReachability;
  showDot?: boolean;
  className?: string;
}

export function DeviceReachabilityBadge({
  reachability,
  showDot = false,
  className,
}: DeviceReachabilityBadgeProps) {
  const labels: Record<DeviceReachability, string> = {
    reachable: "Reachable",
    unreachable: "Unreachable",
    unknown: "Unknown",
  };

  const variants: Record<DeviceReachability, "success" | "critical" | "default"> = {
    reachable: "success",
    unreachable: "critical",
    unknown: "default",
  };

  return (
    <Badge variant={variants[reachability]} className={cn("uppercase tracking-wide", className)}>
      {showDot && (
        <span
          className={cn(
            "mr-1.5 h-1.5 w-1.5 rounded-full",
            reachability === "reachable" && "bg-success",
            reachability === "unreachable" && "bg-critical",
            reachability === "unknown" && "bg-foreground-subtle"
          )}
        />
      )}
      {labels[reachability]}
    </Badge>
  );
}
