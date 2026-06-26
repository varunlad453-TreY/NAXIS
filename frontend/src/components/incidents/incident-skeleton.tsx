import { Skeleton } from "@/components/ui/skeleton";

export function IncidentCardSkeleton() {
  return (
    <div className="rounded-lg border border-border bg-background-elevated p-5">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="flex-1 space-y-2">
          <Skeleton className="h-5 w-3/4" />
          <div className="flex gap-2">
            <Skeleton className="h-5 w-16" />
            <Skeleton className="h-5 w-20" />
          </div>
        </div>
        <div className="text-right">
          <Skeleton className="h-3 w-12 mb-1" />
          <Skeleton className="h-4 w-10" />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4 pt-3 border-t border-border/50">
        {[1, 2, 3].map((i) => (
          <div key={i} className="flex items-center gap-2">
            <Skeleton className="h-3.5 w-3.5 rounded" />
            <div className="space-y-1">
              <Skeleton className="h-2 w-8" />
              <Skeleton className="h-3 w-6" />
            </div>
          </div>
        ))}
      </div>

      <div className="mt-3 pt-3 border-t border-border/50 flex items-center justify-between">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-3 w-20" />
      </div>
    </div>
  );
}

export function IncidentListSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: count }).map((_, i) => (
        <IncidentCardSkeleton key={i} />
      ))}
    </div>
  );
}
