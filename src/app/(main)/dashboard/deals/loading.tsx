import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="flex flex-col gap-4 md:gap-6" aria-busy="true">
      <span className="sr-only">Loading deals</span>
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-2">
          <Skeleton className="h-7 w-24" />
          <Skeleton className="h-4 w-64 max-w-full" />
        </div>
        <Skeleton className="h-7 w-24" />
      </div>
      <div className="flex flex-wrap gap-2">
        <Skeleton className="h-8 w-full sm:w-64" />
        <Skeleton className="h-8 w-40" />
      </div>
      <div className="flex gap-3 overflow-hidden">
        {["a", "b", "c", "d"].map((k) => (
          <Skeleton key={k} className="h-96 w-72 shrink-0 rounded-xl" />
        ))}
      </div>
    </div>
  );
}
