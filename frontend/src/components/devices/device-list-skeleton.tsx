import { Skeleton } from "@/components/ui/skeleton";

export function DeviceListSkeleton() {
  return (
    <div className="rounded-lg border border-border divide-y">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 px-4 py-3">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-6 w-20" />
          <Skeleton className="h-4 w-24" />
          <div className="flex-1 space-y-1">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3 w-24" />
          </div>
          <Skeleton className="h-6 w-24" />
        </div>
      ))}
    </div>
  );
}
