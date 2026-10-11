import { Skeleton } from "@/components/ui/skeleton";

const CARDS = ["contact", "record", "account", "notes"];
const ROWS = ["a", "b", "c", "d", "e"];

export default function Loading() {
  return (
    <div className="flex flex-col gap-4 md:gap-6" role="status" aria-busy="true" aria-label="Loading person">
      <Skeleton className="h-3 w-32" />
      <div className="flex flex-col gap-4 xl:flex-row xl:justify-between">
        <div className="flex items-start gap-3">
          <Skeleton className="size-11 rounded-full" />
          <div className="flex flex-col gap-2">
            <Skeleton className="h-7 w-56" />
            <Skeleton className="h-4 w-72" />
            <Skeleton className="h-4 w-40" />
          </div>
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-7 w-7" />
          <Skeleton className="h-7 w-7" />
          <Skeleton className="h-7 w-24" />
          <Skeleton className="h-7 w-32" />
        </div>
      </div>
      <div className="grid gap-4 md:gap-6 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
        <div className="flex flex-col gap-4">
          {CARDS.map((key) => (
            <div key={key} className="flex flex-col gap-3 rounded-xl border p-4">
              <Skeleton className="h-4 w-36" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-2/3" />
            </div>
          ))}
        </div>
        <div className="flex flex-col gap-4">
          <Skeleton className="h-8 w-80 max-w-full" />
          <div className="flex flex-col gap-3 rounded-xl border p-4">
            {ROWS.map((key) => (
              <Skeleton key={key} className="h-4 w-full" />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
