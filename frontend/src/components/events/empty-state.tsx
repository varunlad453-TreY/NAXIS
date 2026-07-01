import { AlertCircle } from "lucide-react";

interface EventEmptyStateProps {
  title?: string;
  description?: string;
}

export function EventEmptyState({
  title = "No events found",
  description = "Try adjusting your filters or check back later.",
}: EventEmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-12 px-4">
      <AlertCircle className="h-12 w-12 text-foreground-muted/50 mb-4" />
      <h3 className="text-lg font-medium text-foreground mb-1">{title}</h3>
      <p className="text-sm text-foreground-muted">{description}</p>
    </div>
  );
}
