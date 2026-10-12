"use client";

import { useState } from "react";

import { ScrollText } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { apiFetch } from "@/lib/api-fetch";
import type { BounceLogEntry } from "@/server/services/sending-policy";

import { Pill } from "../../../_components/pipeline/pills";

interface Response {
  bounce_logs: BounceLogEntry[];
  pagination: { page: number; total_pages: number; total_entries: number };
}

function logLabel(e: BounceLogEntry): string {
  if (e.status === "bounced") return "Bounced";
  return e.policy ? "Held by policy" : "Blocked";
}

/** Bounced and blocked messages, newest first, in a side sheet. */
export function BounceLogsSheet() {
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<BounceLogEntry[] | null>(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function load(nextPage: number) {
    setLoading(true);
    const res = await apiFetch<Response>(`/api/v1/deliverability/bounce_logs?page=${nextPage}&per_page=25`);
    setLoading(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setError(null);
    setPage(nextPage);
    setTotalPages(res.data.pagination.total_pages);
    setEntries((prev) => (nextPage === 1 ? res.data.bounce_logs : [...(prev ?? []), ...res.data.bounce_logs]));
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) void load(1);
      }}
    >
      <SheetTrigger asChild>
        <Button size="sm" variant="outline">
          <ScrollText data-icon="inline-start" aria-hidden="true" />
          View bounce logs
        </Button>
      </SheetTrigger>
      <SheetContent className="w-full gap-0 sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>Bounce logs</SheetTitle>
          <SheetDescription>Messages that bounced or were held back before sending.</SheetDescription>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto px-4 pb-4">
          {error ? (
            <p role="alert" className="text-destructive text-sm">
              {error}
            </p>
          ) : null}
          {entries === null && loading ? (
            <div className="flex flex-col gap-2">
              {["a", "b", "c"].map((k) => (
                <Skeleton key={k} className="h-16" />
              ))}
            </div>
          ) : null}
          {entries && !entries.length ? (
            <p className="text-muted-foreground text-sm">No bounced or blocked messages.</p>
          ) : null}
          {entries?.length ? (
            <ul className="flex flex-col divide-y">
              {entries.map((e) => (
                <li key={e.id} className="flex flex-col gap-1 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="break-all font-mono text-xs">{e.toEmail}</span>
                    <Pill tone={e.status === "bounced" ? "negative" : "attention"}>{logLabel(e)}</Pill>
                  </div>
                  <p className="truncate text-sm">{e.subject}</p>
                  <p className="text-muted-foreground text-xs">{e.reason ?? "No reason recorded."}</p>
                  <p className="text-muted-foreground text-xs">
                    {e.mailboxEmail ? <span className="font-mono">{e.mailboxEmail}</span> : "No mailbox"} ·{" "}
                    <time dateTime={e.at} title={new Date(e.at).toLocaleString()}>
                      {new Date(e.at).toLocaleDateString()}
                    </time>
                  </p>
                </li>
              ))}
            </ul>
          ) : null}
          {entries && page < totalPages ? (
            <Button size="sm" variant="outline" className="mt-2" disabled={loading} onClick={() => load(page + 1)}>
              <ScrollText data-icon="inline-start" aria-hidden="true" />
              {loading ? "Loading…" : "Load more"}
            </Button>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}
