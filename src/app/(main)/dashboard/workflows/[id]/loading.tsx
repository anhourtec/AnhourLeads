import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true">
      <span className="sr-only">Loading workflow</span>
      <Skeleton className="h-4 w-48" />
      <div className="flex items-center justify-between gap-3">
        <Skeleton className="h-7 w-72 max-w-full" />
        <Skeleton className="h-8 w-40" />
      </div>
      <Skeleton className="h-8 w-72" />
      <Skeleton className="h-[28rem] rounded-xl" />
    </div>
  );
}
