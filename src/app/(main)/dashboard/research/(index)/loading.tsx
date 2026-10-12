import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="flex flex-col gap-4 md:gap-6" role="status" aria-busy="true" aria-label="Loading research">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-7 w-32" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Skeleton className="h-48 rounded-xl lg:col-span-2" />
        <Skeleton className="h-48 rounded-xl" />
      </div>
      <div className="flex flex-col gap-2 rounded-xl border p-4">
        {["a", "b", "c", "d", "e"].map((key) => (
          <Skeleton key={key} className="h-9 w-full" />
        ))}
      </div>
    </div>
  );
}
