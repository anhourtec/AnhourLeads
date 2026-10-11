import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="grid gap-4 lg:grid-cols-[16rem_minmax(0,1fr)]" aria-busy="true">
      <span className="sr-only">Loading the AI assistant</span>
      <div className="hidden flex-col gap-2 lg:flex">
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-full" />
        <Skeleton className="mt-4 h-4 w-16" />
        {["a", "b", "c"].map((k) => (
          <Skeleton key={k} className="h-7 w-full" />
        ))}
      </div>
      <div className="flex flex-col items-center gap-4 pt-10">
        <Skeleton className="size-10 rounded-lg" />
        <Skeleton className="h-7 w-64" />
        <Skeleton className="h-32 w-full max-w-2xl rounded-xl" />
        <div className="flex flex-wrap justify-center gap-2">
          {["a", "b", "c", "d"].map((k) => (
            <Skeleton key={k} className="h-7 w-44" />
          ))}
        </div>
      </div>
    </div>
  );
}
