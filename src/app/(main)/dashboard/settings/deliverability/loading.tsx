import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="flex flex-col gap-4 md:gap-6" aria-busy="true">
      <span className="sr-only">Loading email setup and health</span>
      <div className="space-y-2">
        <Skeleton className="h-7 w-56" />
        <Skeleton className="h-4 w-full max-w-md" />
      </div>
      <Skeleton className="h-8 w-full max-w-md" />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {["a", "b", "c"].map((k) => (
          <Skeleton key={k} className="h-32 rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-72 rounded-xl" />
    </div>
  );
}
