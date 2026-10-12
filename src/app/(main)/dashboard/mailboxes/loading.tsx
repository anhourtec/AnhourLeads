import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="flex flex-col gap-4 md:gap-6" aria-busy="true">
      <span className="sr-only">Loading mailboxes</span>
      <div className="flex flex-col gap-3 sm:flex-row sm:justify-between">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-7 w-32" />
          <Skeleton className="h-4 w-80 max-w-full" />
        </div>
        <Skeleton className="h-7 w-28" />
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {["a", "b", "c"].map((key) => (
          <Skeleton key={key} className="h-64 w-full rounded-xl" />
        ))}
      </div>
    </div>
  );
}
