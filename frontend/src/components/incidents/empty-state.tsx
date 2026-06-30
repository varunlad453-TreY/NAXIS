import { AlertCircle, CheckCircle } from "lucide-react";

interface EmptyStateProps {
  variant?: "no-incidents" | "no-active";
}

export function EmptyState({ variant = "no-incidents" }: EmptyStateProps) {
  if (variant === "no-active") {
    return (
      <div className="flex flex-col items-start gap-3 border-t border-border/60 py-12">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-success/10 text-success">
          <CheckCircle className="h-5 w-5" />
        </div>
        <div>
          <h3 className="font-semibold text-foreground">No active incidents</h3>
          <p className="mt-1 max-w-sm text-sm text-foreground-muted">
            All systems operational. New incidents will appear here as they're detected.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-start gap-3 border-t border-border/60 py-12">
      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-surface text-foreground-subtle">
        <AlertCircle className="h-5 w-5" />
      </div>
      <div>
        <h3 className="font-semibold text-foreground">No incidents found</h3>
        <p className="mt-1 max-w-sm text-sm text-foreground-muted">
          No incidents match your filters. Try adjusting your search criteria.
        </p>
      </div>
    </div>
  );
}
