import { Skeleton } from "@/components/ui/skeleton";

export function IncidentCardSkeleton() {
  return (
    <div className="grid grid-cols-12 items-center gap-4 px-2 py-4">
      <div className="col-span-12 flex items-start gap-3 lg:col-span-5">
        <Skeleton className="mt-2 h-2 w-2 rounded-full" />
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex gap-2">
            <Skeleton className="h-5 w-16" />
            <Skeleton className="h-5 w-20" />
          </div>
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-3 w-32" />
        </div>
      </div>

      <div className="col-span-12 flex items-center gap-5 pl-5 lg:col-span-4 lg:pl-0">
        <Skeleton className="h-5 w-16" />
        <Skeleton className="h-5 w-16" />
        <Skeleton className="h-5 w-16" />
      </div>

      <div className="col-span-6 pl-5 lg:col-span-2 lg:pl-0">
        <Skeleton className="mb-1 h-3 w-16" />
        <Skeleton className="h-4 w-10" />
      </div>

      <div className="col-span-6 lg:col-span-1">
        <Skeleton className="ml-auto h-3 w-16" />
      </div>
    </div>
  );
}

export function IncidentListSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="border-t border-border/60">
      <div className="hidden grid-cols-12 gap-4 border-b border-border/60 px-2 py-2 lg:grid">
        <div className="col-span-5"><Skeleton className="h-3 w-16" /></div>
        <div className="col-span-4"><Skeleton className="h-3 w-16" /></div>
        <div className="col-span-2"><Skeleton className="h-3 w-16" /></div>
        <div className="col-span-1"><Skeleton className="ml-auto h-3 w-10" /></div>
      </div>
      <div className="divide-y divide-border/60">
        {Array.from({ length: count }).map((_, i) => (
          <IncidentCardSkeleton key={i} />
        ))}
      </div>
    </div>
  );
}
