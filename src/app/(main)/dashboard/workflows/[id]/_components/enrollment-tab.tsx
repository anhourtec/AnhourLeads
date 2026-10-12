"use client";

import { useCallback, useEffect, useState } from "react";

import { RefreshCw, ScrollText } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { apiFetch } from "@/lib/api-fetch";
import { formatDateTime, formatNumber, relativeTime } from "@/lib/format-display";
import type { RunDto } from "@/server/services/workflows";

import { RunStatusPill } from "../../_components/status-pill";

const LOG_TONE: Record<string, string> = {
  ok: "text-emerald-700 dark:text-emerald-400",
  failed: "text-destructive",
  skipped: "text-amber-700 dark:text-amber-400",
  waiting: "text-amber-700 dark:text-amber-400",
  info: "text-muted-foreground",
};

/** Enrollment: every run with its status, and the step log. */
export function EnrollmentTab({ workflowId }: { readonly workflowId: string }) {
  const [runs, setRuns] = useState<RunDto[] | null>(null);
  const [total, setTotal] = useState(0);
  const [open, setOpen] = useState<RunDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await apiFetch<{ runs: RunDto[]; pagination: { total_entries: number } }>(
      `/api/v1/workflows/${workflowId}/runs?per_page=100`,
    );
    if (!res.ok) {
      setError(res.error);
      setRuns([]);
      return;
    }
    setError(null);
    setRuns(res.data.runs);
    setTotal(res.data.pagination.total_entries);
  }, [workflowId]);

  useEffect(() => {
    void load();
  }, [load]);

  let body: React.ReactNode = <Skeleton className="h-40 rounded-xl" />;
  if (runs?.length) {
    body = (
      <div className="overflow-x-auto rounded-xl border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="table-head-mono pl-4">Record</TableHead>
              <TableHead className="table-head-mono">Status</TableHead>
              <TableHead className="table-head-mono">Started</TableHead>
              <TableHead className="table-head-mono">Next or finished</TableHead>
              <TableHead className="pr-4">
                <span className="sr-only">Log</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {runs.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="max-w-56 truncate pl-4 font-medium">{r.entityName}</TableCell>
                <TableCell>
                  <RunStatusPill status={r.status} />
                </TableCell>
                <TableCell className="text-muted-foreground">
                  <span title={formatDateTime(r.startedAt)}>{relativeTime(r.startedAt)}</span>
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {r.status === "waiting" && r.resumeAt
                    ? `Resumes ${formatDateTime(r.resumeAt)}`
                    : formatDateTime(r.finishedAt)}
                </TableCell>
                <TableCell className="pr-4 text-right">
                  <Button size="sm" variant="ghost" onClick={() => setOpen(r)}>
                    <ScrollText data-icon="inline-start" />
                    View log
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    );
  } else if (runs) {
    body = (
      <Empty className="border">
        <EmptyHeader>
          <EmptyTitle>No one has enrolled yet</EmptyTitle>
          <EmptyDescription>Runs appear here once the workflow is launched and its trigger fires.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-muted-foreground text-sm">
          <span className="font-mono text-foreground tabular-nums">{formatNumber(total)}</span>{" "}
          {total === 1 ? "run" : "runs"}
        </p>
        <Button size="sm" variant="outline" onClick={() => void load()}>
          <RefreshCw data-icon="inline-start" />
          Refresh
        </Button>
      </div>
      {error ? <p className="text-destructive text-sm">{error}</p> : null}
      {body}
      <Dialog open={open !== null} onOpenChange={(o) => !o && setOpen(null)}>
        <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Run log</DialogTitle>
            <DialogDescription>{open?.entityName}</DialogDescription>
          </DialogHeader>
          <ol className="flex flex-col gap-2 text-sm">
            {open?.log.map((l, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: log entries are append-only and have no ids
              <li key={`${l.at}-${i}`} className="flex flex-col rounded-md border p-2">
                <span className={LOG_TONE[l.status] ?? ""}>{l.message}</span>
                <span className="font-mono text-muted-foreground text-xs">
                  {l.type} · {formatDateTime(l.at)}
                </span>
              </li>
            ))}
          </ol>
        </DialogContent>
      </Dialog>
    </div>
  );
}
