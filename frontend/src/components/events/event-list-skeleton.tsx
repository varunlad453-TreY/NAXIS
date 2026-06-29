import { Skeleton } from "@/components/ui/skeleton";

export function EventListSkeleton() {
  return (
    <div className="divide-y divide-border/60">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="grid grid-cols-12 items-center gap-4 px-2 py-3.5">
          <div className="col-span-12 flex flex-col gap-1.5 sm:col-span-3 lg:col-span-2">
            <Skeleton className="h-5 w-16" />
            <Skeleton className="h-3 w-20" />
          </div>
          <div className="col-span-12 space-y-1.5 sm:col-span-9 lg:col-span-5">
            <Skeleton className="h-5 w-16" />
            <Skeleton className="h-4 w-3/4" />
          </div>
          <div className="col-span-12 space-y-1 lg:col-span-3">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-4 w-28" />
          </div>
          <div className="col-span-12 lg:col-span-2">
            <Skeleton className="h-5 w-20" />
          </div>
        </div>
      ))}
    </div>
  );
}
