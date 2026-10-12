"use client";

import { useCallback, useState } from "react";

import { CalendarClock } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { apiFetch } from "@/lib/api-fetch";
import type { AutomationView, EnrichmentJobView } from "@/server/services/enrichment-jobs";

import { exactTime, num, timeAgo } from "./format";
import { JobStatusPill } from "./pills";

export function ScheduledJobsSheet({
  initialJobs,
  automation,
}: {
  initialJobs: EnrichmentJobView[];
  automation: AutomationView;
}) {
  const [jobs, setJobs] = useState(initialJobs);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const res = await apiFetch<{ active_jobs: EnrichmentJobView[] }>("/api/v1/enrichment_automation");
    if (res.ok) {
      setJobs(res.data.active_jobs);
      setError(null);
    } else setError(res.error);
  }, []);

  return (
    <Sheet onOpenChange={(open) => open && void refresh()}>
      <SheetTrigger asChild>
        <Button size="sm" variant="outline">
          <CalendarClock data-icon="inline-start" aria-hidden="true" />
          View scheduled jobs
          <span className="font-mono tabular-nums">{jobs.length}</span>
        </Button>
      </SheetTrigger>
      <SheetContent className="w-full sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Scheduled jobs</SheetTitle>
          <SheetDescription>Enrichment jobs waiting or running now, and your automation schedule.</SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-4 overflow-y-auto px-4 pb-4">
          <section className="flex flex-col gap-1 rounded-lg border p-3 text-sm">
            <h3 className="font-medium">Automation</h3>
            {automation.enabled ? (
              <p className="text-muted-foreground">
                Every {automation.everyDays} days: re-verify emails checked more than {automation.verifyOlderThanDays}{" "}
                days ago and re-crawl companies enriched more than {automation.recrawlOlderThanDays} days ago.
                {automation.nextRunAt ? ` Next run ${timeAgo(automation.nextRunAt)}.` : ""}
              </p>
            ) : (
              <p className="text-muted-foreground">Off. Turn it on with Automate enrichment.</p>
            )}
          </section>
          {error ? <p className="text-destructive text-sm">{error}</p> : null}
          {jobs.length === 0 ? (
            <p className="text-muted-foreground text-sm">No jobs are waiting or running.</p>
          ) : (
            <ul className="flex flex-col divide-y rounded-lg border">
              {jobs.map((j) => (
                <li key={j.id} className="flex flex-col gap-1 p-3 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-medium">{j.label}</span>
                    <JobStatusPill status={j.status} />
                  </div>
                  <span className="text-muted-foreground text-xs">
                    <span className="font-mono tabular-nums">
                      {num(j.processed)} of {num(j.total)}
                    </span>{" "}
                    · queued{" "}
                    <time dateTime={j.createdAt} title={exactTime(j.createdAt)} suppressHydrationWarning>
                      {timeAgo(j.createdAt)}
                    </time>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
