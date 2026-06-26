import { AlertCircle, CheckCircle } from "lucide-react";

interface EmptyStateProps {
  variant?: "no-incidents" | "no-active";
}

export function EmptyState({ variant = "no-incidents" }: EmptyStateProps) {
  if (variant === "no-active") {
    return (
      <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
        <div className="rounded-full bg-success-bg p-4 mb-4">
          <CheckCircle className="h-8 w-8 text-success" />
        </div>
        <h3 className="text-lg font-medium text-foreground mb-2">
          No active incidents
        </h3>
        <p className="text-sm text-foreground-muted max-w-sm">
          All systems operational. You'll see new incidents here as they're detected by the correlation engine.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
      <div className="rounded-full bg-background-elevated p-4 mb-4 border border-border">
        <AlertCircle className="h-8 w-8 text-foreground-subtle" />
      </div>
      <h3 className="text-lg font-medium text-foreground mb-2">
        No incidents found
      </h3>
      <p className="text-sm text-foreground-muted max-w-sm">
        No incidents match your filters. Try adjusting your search criteria.
      </p>
    </div>
  );
}
