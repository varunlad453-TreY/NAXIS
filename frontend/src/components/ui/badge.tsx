import { cn } from "@/lib/utils";

interface BadgeProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: "default" | "critical" | "major" | "minor" | "info" | "success" | "outline";
}

export function Badge({ className, variant = "default", ...props }: BadgeProps) {
  return (
    <div
      className={cn(
        "inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium transition-colors",
        {
          "border-border bg-background-elevated text-foreground-muted": variant === "default",
          "border-critical-border bg-critical-bg text-critical": variant === "critical",
          "border-major-border bg-major-bg text-major": variant === "major",
          "border-minor-border bg-minor-bg text-minor": variant === "minor",
          "border-info-border bg-info-bg text-info": variant === "info",
          "border-success-border bg-success-bg text-success": variant === "success",
          "border-border bg-transparent text-foreground-muted": variant === "outline",
        },
        className
      )}
      {...props}
    />
  );
}
