import { cn } from "@/lib/utils";

interface BadgeProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: "default" | "critical" | "major" | "minor" | "info" | "success" | "outline";
}

export function Badge({ className, variant = "default", ...props }: BadgeProps) {
  return (
    <div
      className={cn(
        "inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider transition-colors",
        {
          "border-border bg-surface-subtle text-foreground-muted": variant === "default",
          "border-critical-border bg-critical-bg text-critical": variant === "critical",
          "border-major-border bg-major-bg text-major": variant === "major",
          "border-minor-border bg-minor-bg text-minor": variant === "minor",
          "border-info-border bg-info-bg text-info": variant === "info",
          "border-success-border bg-success-bg text-success": variant === "success",
          "border-border/70 bg-transparent text-foreground-subtle": variant === "outline",
        },
        className
      )}
      {...props}
    />
  );
}
