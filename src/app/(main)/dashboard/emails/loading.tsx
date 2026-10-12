import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="flex flex-col gap-4 md:gap-6" aria-busy="true">
      <span className="sr-only">Loading emails</span>
      <div className="flex items-start justify-between gap-3">
        <Skeleton className="h-7 w-28" />
        <div className="flex gap-2">
          <Skeleton className="h-7 w-32" />
          <Skeleton className="h-7 w-32" />
        </div>
      </div>
      <Skeleton className="h-8 w-72" />
      <div className="flex flex-wrap gap-2">
        <Skeleton className="h-8 w-36" />
        <Skeleton className="h-8 w-full sm:w-64" />
      </div>
      <Skeleton className="h-8 w-full max-w-xl" />
      <Skeleton className="h-96 rounded-xl" />
    </div>
  );
}
