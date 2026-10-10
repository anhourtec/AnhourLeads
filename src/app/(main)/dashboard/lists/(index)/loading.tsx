import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="flex flex-col gap-4 md:gap-6" aria-busy="true">
      <span className="sr-only">Loading lists</span>
      <div className="flex flex-col gap-3 sm:flex-row sm:justify-between">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-7 w-24" />
          <Skeleton className="h-4 w-72 max-w-full" />
        </div>
        <Skeleton className="h-7 w-28" />
      </div>
      <div className="flex flex-col gap-2 rounded-xl border p-4">
        {["a", "b", "c", "d", "e", "f"].map((key) => (
          <Skeleton key={key} className="h-9 w-full" />
        ))}
      </div>
    </div>
  );
}
