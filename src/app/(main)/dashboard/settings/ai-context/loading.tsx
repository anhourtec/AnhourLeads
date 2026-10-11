import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="flex flex-col gap-4 md:gap-6" aria-busy="true">
      <span className="sr-only">Loading the AI context center</span>
      <div className="space-y-2">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-4 w-full max-w-md" />
      </div>
      <Skeleton className="h-[32rem] max-w-3xl rounded-xl" />
    </div>
  );
}
