import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

const SKELETON_KEYS = ["a", "b", "c", "d", "e", "f", "g", "h"];

export default function Loading() {
  return (
    <div className="flex flex-col gap-4 md:gap-6" role="status" aria-busy="true" aria-label="Loading people">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-7 w-28" />
          <Skeleton className="h-4 w-56" />
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-7 w-24" />
          <Skeleton className="h-7 w-20" />
          <Skeleton className="h-7 w-24" />
        </div>
      </div>
      <div className="grid gap-4 lg:grid-cols-[16rem_minmax(0,1fr)] lg:gap-6">
        <Card className="hidden gap-4 p-4 lg:flex">
          {SKELETON_KEYS.slice(0, 4).map((key) => (
            <div key={key} className="flex flex-col gap-2">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-4 w-36" />
              <Skeleton className="h-4 w-32" />
            </div>
          ))}
        </Card>
        <Card className="min-w-0 gap-4 py-4">
          <div className="px-4">
            <Skeleton className="h-7 w-full sm:w-64" />
          </div>
          <div className="flex flex-col">
            {SKELETON_KEYS.slice(0, 8).map((key) => (
              <div key={key} className="flex items-center gap-4 border-t px-4 py-3">
                <Skeleton className="h-4 w-4" />
                <Skeleton className="h-4 w-32" />
                <Skeleton className="hidden h-4 w-40 sm:block" />
                <Skeleton className="hidden h-4 w-28 md:block" />
                <Skeleton className="h-4 w-44" />
                <Skeleton className="hidden h-5 w-16 rounded-full md:block" />
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
