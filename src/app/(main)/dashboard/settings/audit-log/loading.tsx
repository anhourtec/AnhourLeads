import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="flex flex-col gap-4 md:gap-6" aria-busy="true">
      <span className="sr-only">Loading audit log</span>
      <div className="space-y-2">
        <Skeleton className="h-7 w-28" />
        <Skeleton className="h-4 w-full max-w-md" />
      </div>
      <div className="flex flex-wrap gap-2">
        {["a", "b", "c", "d", "e"].map((k) => (
          <Skeleton key={k} className="h-8 w-36" />
        ))}
      </div>
      <Skeleton className="h-[28rem] rounded-xl" />
    </div>
  );
}
