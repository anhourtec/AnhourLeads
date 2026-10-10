"use client";

import Link from "next/link";

import { Radar } from "lucide-react";

import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Spinner } from "@/components/ui/spinner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { CrawlJobView } from "@/server/services/research";

import { RelativeTime } from "./relative-time";
import { CrawlStatusPill } from "./status-pill";

function FoundSummary({ job }: { job: CrawlJobView }) {
  if (job.summary) {
    return (
      <span className="font-mono tabular-nums">
        {job.summary.emails} emails · {job.summary.people} people · {job.summary.technologies} tech
      </span>
    );
  }
  if (job.status === "failed") return <span className="text-destructive">{job.error ?? "Failed"}</span>;
  return <>—</>;
}

export function CrawlJobsTable({
  jobs,
  total,
  active,
  refreshError,
  canRun,
}: {
  jobs: CrawlJobView[];
  total: number;
  active: boolean;
  refreshError: boolean;
  canRun: boolean;
}) {
  return (
    <Card className="min-w-0 gap-0 pb-0">
      <CardHeader className="pb-4">
        <CardTitle>Crawl jobs</CardTitle>
        <CardDescription>
          <span className="font-mono tabular-nums">{total.toLocaleString("en")}</span> {total === 1 ? "job" : "jobs"}
          {refreshError ? " · couldn't refresh, retrying" : null}
        </CardDescription>
        {active ? (
          <CardAction>
            <span className="flex items-center gap-2 text-muted-foreground text-xs" aria-live="polite">
              <Spinner className="size-3.5" aria-hidden="true" />
              Updating
            </span>
          </CardAction>
        ) : null}
      </CardHeader>
      <CardContent className="px-0">
        {jobs.length === 0 ? (
          <Empty className="border-t">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Radar aria-hidden="true" />
              </EmptyMedia>
              <EmptyTitle>No crawls yet</EmptyTitle>
              <EmptyDescription>
                {canRun
                  ? "Start a crawl above to research a company's website."
                  : "Crawls started by your team will appear here."}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <div className="overflow-x-auto border-t">
            <Table className="min-w-[720px]">
              <TableHeader className="bg-muted/50">
                <TableRow>
                  <TableHead className="pl-6">Website</TableHead>
                  <TableHead>Company</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Pages</TableHead>
                  <TableHead>Found</TableHead>
                  <TableHead className="pr-6">Started</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {jobs.map((job) => (
                  <TableRow key={job.id}>
                    <TableCell className="max-w-72 pl-6">
                      <Link
                        href={`/dashboard/research/${job.id}`}
                        className="block truncate rounded-sm font-mono text-sm underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        title={job.seedUrl}
                      >
                        {job.seedUrl.replace(/^https?:\/\//, "").replace(/\/$/, "")}
                      </Link>
                    </TableCell>
                    <TableCell className="max-w-48 truncate text-muted-foreground">{job.companyName ?? "—"}</TableCell>
                    <TableCell>
                      <CrawlStatusPill status={job.status} />
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {job.pagesCrawled}/{job.maxPages}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-xs">
                      <FoundSummary job={job} />
                    </TableCell>
                    <TableCell className="pr-6 text-muted-foreground text-xs">
                      <RelativeTime iso={job.startedAt ?? job.createdAt} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
