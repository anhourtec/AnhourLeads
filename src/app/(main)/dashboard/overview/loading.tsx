import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="flex flex-col gap-4 md:gap-6" aria-busy="true">
      <span className="sr-only">Loading overview</span>
      <div className="space-y-2">
        <Skeleton className="h-7 w-56" />
        <Skeleton className="h-4 w-full max-w-xs" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {["a", "b", "c", "d"].map((k) => (
          <Skeleton key={k} className="h-32 rounded-xl" />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 md:gap-6 xl:grid-cols-12">
        <Skeleton className="h-80 rounded-xl xl:col-span-7" />
        <Skeleton className="h-80 rounded-xl xl:col-span-5" />
      </div>
      <Skeleton className="h-64 rounded-xl" />
    </div>
  );
}
