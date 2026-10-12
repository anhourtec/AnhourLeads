"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { ListTree, Search } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { apiFetch } from "@/lib/api-fetch";
import type { listFrontier } from "@/server/discovery/admin";

import { Pager, type PaginationInfo } from "./pager";
import { Pill } from "./pill";
import { exactTime, KIND_LABEL, relativeTime, STATUS_LABEL, STATUS_PILL } from "./tabs";

type FrontierRow = Awaited<ReturnType<typeof listFrontier>>["rows"][number];

export function QueueTab() {
  const [status, setStatus] = useState("");
  const [kind, setKind] = useState("");
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<FrontierRow[] | null>(null);
  const [pagination, setPagination] = useState<PaginationInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Only the latest request may update the table: an earlier, slower one (say, the unfiltered first
  // load) must not overwrite a search that answered first.
  const latest = useRef(0);
  const load = useCallback(async () => {
    const request = ++latest.current;
    const params = new URLSearchParams({ page: String(page), per_page: "25" });
    if (status) params.set("status", status);
    if (kind) params.set("kind", kind);
    if (query) params.set("q", query);
    const res = await apiFetch<{ frontier: FrontierRow[]; pagination: PaginationInfo }>(
      `/api/v1/platform/crawler/frontier?${params}`,
    );
    if (request !== latest.current) return;
    if (res.ok) {
      setRows(res.data.frontier);
      setPagination(res.data.pagination);
      setError(null);
    } else setError(res.error);
  }, [page, status, kind, query]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="flex flex-col gap-4">
      <form
        className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center"
        onSubmit={(e) => {
          e.preventDefault();
          setPage(1);
          setQuery(q.trim());
        }}
      >
        <label htmlFor="queue-search" className="sr-only">
          Search URLs
        </label>
        <div className="relative sm:w-72">
          <Search
            className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            id="queue-search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search URLs"
            className="pl-8"
          />
        </div>
        <label htmlFor="queue-status" className="sr-only">
          Status
        </label>
        <NativeSelect
          id="queue-status"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
          className="w-full sm:w-40"
        >
          <NativeSelectOption value="">Any status</NativeSelectOption>
          {Object.entries(STATUS_LABEL).map(([v, l]) => (
            <NativeSelectOption key={v} value={v}>
              {l}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        <label htmlFor="queue-kind" className="sr-only">
          Page kind
        </label>
        <NativeSelect
          id="queue-kind"
          value={kind}
          onChange={(e) => {
            setKind(e.target.value);
            setPage(1);
          }}
          className="w-full sm:w-40"
        >
          <NativeSelectOption value="">Any kind</NativeSelectOption>
          {Object.entries(KIND_LABEL).map(([v, l]) => (
            <NativeSelectOption key={v} value={v}>
              {l}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </form>

      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}

      <Card size="sm">
        <CardContent>
          {rows === null ? (
            <div className="flex flex-col gap-2" aria-busy="true">
              {Array.from({ length: 6 }, (_, i) => (
                <Skeleton key={i} className="h-8" />
              ))}
            </div>
          ) : rows.length === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <ListTree aria-hidden="true" />
                </EmptyMedia>
                <EmptyTitle>Nothing in the queue</EmptyTitle>
                <EmptyDescription>Run a seed source to queue company homepages.</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>URL</TableHead>
                    <TableHead>Kind</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Tries</TableHead>
                    <TableHead>Last fetch</TableHead>
                    <TableHead>Next</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.id} data-testid="frontier-row">
                      <TableCell className="max-w-[22rem]">
                        <span className="block truncate font-mono text-xs" title={r.url}>
                          {r.url}
                        </span>
                      </TableCell>
                      <TableCell className="text-xs">{KIND_LABEL[r.kind] ?? r.kind}</TableCell>
                      <TableCell>
                        <div className="flex flex-col items-start gap-0.5">
                          <Pill tone={STATUS_PILL[r.status] ?? "neutral"}>{STATUS_LABEL[r.status] ?? r.status}</Pill>
                          {r.skippedReason && (
                            <span className="font-mono text-muted-foreground text-xs">
                              {r.skippedReason}
                              {r.lastStatusCode ? ` · ${r.lastStatusCode}` : ""}
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs tabular-nums">{r.attempts}</TableCell>
                      <TableCell
                        className="whitespace-nowrap text-muted-foreground text-xs"
                        title={exactTime(r.fetchedAt)}
                      >
                        {r.fetchedAt ? relativeTime(r.fetchedAt) : "Not yet"}
                      </TableCell>
                      <TableCell
                        className="whitespace-nowrap text-muted-foreground text-xs"
                        title={exactTime(r.nextAttemptAt)}
                      >
                        {r.status === "queued" || r.status === "done" ? relativeTime(r.nextAttemptAt) : "–"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
      <Pager pagination={pagination} onPage={setPage} />
    </div>
  );
}
