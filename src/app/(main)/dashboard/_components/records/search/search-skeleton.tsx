import { Skeleton } from "@/components/ui/skeleton";

const ROWS = ["a", "b", "c", "d", "e", "f", "g", "h"];
const RAIL = ["a", "b", "c", "d", "e", "f"];

/** Loading state mirroring the search screen: title, toolbar, filter rail and table. */
export function SearchSkeleton({ label }: { label: string }) {
  return (
    <div className="flex flex-col gap-3" role="status" aria-busy="true" aria-label={label}>
      <div className="flex items-start justify-between gap-3">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-7 w-20" />
      </div>
      <div className="flex flex-wrap gap-2">
        <Skeleton className="h-7 w-28" />
        <Skeleton className="h-7 w-28" />
        <Skeleton className="h-7 w-full sm:w-64" />
      </div>
      <div className="flex flex-wrap justify-end gap-2">
        <Skeleton className="h-7 w-32" />
        <Skeleton className="h-7 w-32" />
        <Skeleton className="h-7 w-36" />
      </div>
      <div className="grid gap-3 lg:grid-cols-[18rem_minmax(0,1fr)]">
        <div className="hidden flex-col gap-3 rounded-xl border p-3 lg:flex">
          <Skeleton className="h-12 w-full" />
          {RAIL.map((k) => (
            <Skeleton key={k} className="h-6 w-full" />
          ))}
        </div>
        <div className="flex min-w-0 flex-col rounded-xl border">
          {ROWS.map((k) => (
            <div key={k} className="flex items-center gap-4 border-b px-3 py-3 last:border-b-0">
              <Skeleton className="size-4" />
              <Skeleton className="h-4 w-36" />
              <Skeleton className="hidden h-4 w-40 sm:block" />
              <Skeleton className="hidden h-4 w-32 md:block" />
              <Skeleton className="h-4 w-44" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
