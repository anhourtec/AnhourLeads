import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true">
      <span className="sr-only">Loading workflows</span>
      <div className="flex items-start justify-between gap-3">
        <Skeleton className="h-7 w-32" />
        <Skeleton className="h-7 w-56" />
      </div>
      <Skeleton className="h-8 w-56" />
      <Skeleton className="h-80 rounded-xl" />
    </div>
  );
}
