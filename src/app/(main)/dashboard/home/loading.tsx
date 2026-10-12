import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 md:gap-6" aria-busy="true">
      <span className="sr-only">Loading home</span>
      <div className="flex justify-end">
        <Skeleton className="h-8 w-40" />
      </div>
      <div className="space-y-2">
        <Skeleton className="h-8 w-72" />
        <Skeleton className="h-4 w-full max-w-md" />
      </div>
      <Skeleton className="h-2 w-full" />
      {["a", "b", "c"].map((k) => (
        <Skeleton key={k} className="h-40 rounded-xl" />
      ))}
    </div>
  );
}
