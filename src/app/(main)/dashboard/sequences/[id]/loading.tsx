import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="flex flex-col gap-4 md:gap-6" aria-busy="true">
      <span className="sr-only">Loading sequence</span>
      <div className="flex flex-col gap-2">
        <Skeleton className="h-3 w-20" />
        <div className="flex flex-col gap-3 sm:flex-row sm:justify-between">
          <div className="flex flex-col gap-2">
            <Skeleton className="h-7 w-64 max-w-full" />
            <Skeleton className="h-5 w-48" />
          </div>
          <Skeleton className="h-7 w-48" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-6">
        {["a", "b", "c", "d", "e", "f"].map((key) => (
          <Skeleton key={key} className="h-20 rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-8 w-full max-w-md" />
      <div className="flex flex-col gap-3">
        {["a", "b"].map((key) => (
          <Skeleton key={key} className="h-48 w-full rounded-xl" />
        ))}
      </div>
    </div>
  );
}
