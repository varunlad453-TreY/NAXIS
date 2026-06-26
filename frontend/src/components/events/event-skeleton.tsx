import { cn } from "@/lib/utils";

interface EventSkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: "card" | "row";
}

export function EventSkeleton({ variant = "card", className }: EventSkeletonProps) {
  if (variant === "row") {
    return (
      <div className="flex items-center gap-4 px-4 py-3 border-b border-border last:border-b-0">
        <div className={cn("h-4 bg-background-elevated/50 rounded animate-pulse w-24")} />
        <div className={cn("h-4 bg-background-elevated/50 rounded animate-pulse w-32")} />
        <div className={cn("h-4 bg-background-elevated/50 rounded animate-pulse w-24")} />
        <div className={cn("h-4 bg-background-elevated/50 rounded animate-pulse flex-1")} />
        <div className={cn("h-4 bg-background-elevated/50 rounded animate-pulse w-20")} />
      </div>
    );
  }

  return (
    <div
      className={cn(
        "rounded-lg border bg-background-elevated p-4 space-y-3",
        className
      )}
    >
      <div className="flex justify-between items-start gap-4">
        <div className="flex-1 space-y-2">
          <div className="h-5 bg-background-elevated/50 rounded animate-pulse w-3/4" />
          <div className="h-4 bg-background-elevated/50 rounded animate-pulse w-1/2" />
        </div>
        <div className="h-6 bg-background-elevated/50 rounded animate-pulse w-24" />
      </div>
      <div className="flex gap-2">
        <div className="h-6 bg-background-elevated/50 rounded animate-pulse w-20" />
        <div className="h-6 bg-background-elevated/50 rounded animate-pulse w-20" />
      </div>
      <div className="h-4 bg-background-elevated/50 rounded animate-pulse" />
    </div>
  );
}
