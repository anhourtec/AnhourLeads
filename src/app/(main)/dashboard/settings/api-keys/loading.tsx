import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="flex flex-col gap-4 md:gap-6" aria-busy="true">
      <span className="sr-only">Loading API keys</span>
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-2">
          <Skeleton className="h-7 w-28" />
          <Skeleton className="h-4 w-72 max-w-full" />
        </div>
        <Skeleton className="h-7 w-32" />
      </div>
      <Skeleton className="h-80 rounded-xl" />
    </div>
  );
}
