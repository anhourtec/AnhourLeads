"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { Ban, Globe, PlayCircle, Search } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { apiFetch } from "@/lib/api-fetch";
import type { listHosts } from "@/server/discovery/admin";

import { Pager, type PaginationInfo } from "./pager";
import { Pill } from "./pill";
import { exactTime, numberFormat, relativeTime } from "./tabs";

type HostRow = Awaited<ReturnType<typeof listHosts>>["hosts"][number];

export function HostsTab() {
  const [state, setState] = useState("all");
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [hosts, setHosts] = useState<HostRow[] | null>(null);
  const [pagination, setPagination] = useState<PaginationInfo | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [blockHost, setBlockHost] = useState("");

  // Only the latest request may update the table: an earlier, slower one (say, the unfiltered first
  // load) must not overwrite a search that answered first.
  const latest = useRef(0);
  const load = useCallback(async () => {
    const request = ++latest.current;
    const params = new URLSearchParams({ page: String(page), per_page: "25", state });
    if (query) params.set("q", query);
    const res = await apiFetch<{ hosts: HostRow[]; pagination: PaginationInfo }>(
      `/api/v1/platform/crawler/hosts?${params}`,
    );
    if (request !== latest.current) return;
    if (res.ok) {
      setHosts(res.data.hosts);
      setPagination(res.data.pagination);
    } else toast.error(res.error);
  }, [page, state, query]);

  useEffect(() => {
    void load();
  }, [load]);

  async function setBlocked(host: string, blocked: boolean) {
    setBusy(host);
    const res = await apiFetch<{ host: HostRow }>(
      `/api/v1/platform/crawler/hosts/${encodeURIComponent(host)}/${blocked ? "block" : "unblock"}`,
      { body: {} },
    );
    setBusy(null);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    toast.success(blocked ? `${host} is blocked.` : `${host} is unblocked.`);
    setBlockHost("");
    await load();
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
        <form
          className="flex flex-col gap-2 sm:flex-row sm:items-center"
          onSubmit={(e) => {
            e.preventDefault();
            setPage(1);
            setQuery(q.trim());
          }}
        >
          <label htmlFor="hosts-search" className="sr-only">
            Search hosts
          </label>
          <div className="relative sm:w-64">
            <Search
              className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              id="hosts-search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search hosts"
              className="pl-8"
            />
          </div>
          <label htmlFor="hosts-state" className="sr-only">
            State
          </label>
          <NativeSelect
            id="hosts-state"
            value={state}
            onChange={(e) => {
              setState(e.target.value);
              setPage(1);
            }}
            className="w-full sm:w-44"
          >
            <NativeSelectOption value="all">All hosts</NativeSelectOption>
            <NativeSelectOption value="blocked">Blocked</NativeSelectOption>
            <NativeSelectOption value="backoff">Backing off</NativeSelectOption>
          </NativeSelect>
        </form>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (blockHost.trim()) void setBlocked(blockHost.trim().toLowerCase(), true);
          }}
        >
          <label htmlFor="block-host" className="sr-only">
            Host to block
          </label>
          <Input
            id="block-host"
            value={blockHost}
            onChange={(e) => setBlockHost(e.target.value)}
            placeholder="host.example.com"
            className="min-w-0 font-mono sm:w-56"
          />
          <Button type="submit" size="sm" variant="outline" disabled={!blockHost.trim() || busy !== null}>
            <Ban data-icon="inline-start" aria-hidden="true" />
            Block host
          </Button>
        </form>
      </div>

      <Card size="sm">
        <CardContent>
          {hosts === null ? (
            <div className="flex flex-col gap-2" aria-busy="true">
              {Array.from({ length: 5 }, (_, i) => (
                <Skeleton key={i} className="h-8" />
              ))}
            </div>
          ) : hosts.length === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Globe aria-hidden="true" />
                </EmptyMedia>
                <EmptyTitle>No hosts here</EmptyTitle>
                <EmptyDescription>Hosts appear once a URL on them is queued.</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Host</TableHead>
                    <TableHead>State</TableHead>
                    <TableHead className="text-right">Delay</TableHead>
                    <TableHead className="text-right">Errors</TableHead>
                    <TableHead>Next request</TableHead>
                    <TableHead>robots.txt</TableHead>
                    <TableHead>
                      <span className="sr-only">Actions</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {hosts.map((h) => (
                    <TableRow key={h.host} data-testid="host-row">
                      <TableCell className="font-mono text-xs">{h.host}</TableCell>
                      <TableCell>
                        <div className="flex flex-col items-start gap-0.5">
                          {h.blocked ? (
                            <Pill tone="negative">Blocked</Pill>
                          ) : h.errorCount > 0 ? (
                            <Pill tone="attention">Backing off</Pill>
                          ) : (
                            <Pill tone="positive">Polite</Pill>
                          )}
                          {h.blockedReason && <span className="text-muted-foreground text-xs">{h.blockedReason}</span>}
                        </div>
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs tabular-nums">
                        {numberFormat.format(h.crawlDelayMs / 1000)} s
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs tabular-nums">{h.errorCount}</TableCell>
                      <TableCell
                        className="whitespace-nowrap text-muted-foreground text-xs"
                        title={exactTime(h.nextAllowedAt)}
                      >
                        {h.nextAllowedAt ? relativeTime(h.nextAllowedAt) : "Any time"}
                      </TableCell>
                      <TableCell
                        className="whitespace-nowrap text-muted-foreground text-xs"
                        title={exactTime(h.robotsFetchedAt)}
                      >
                        {h.robotsFetchedAt
                          ? `${h.hasRobots ? "Read" : "None"} ${relativeTime(h.robotsFetchedAt)}`
                          : "Not read yet"}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busy === h.host}
                          onClick={() => setBlocked(h.host, !h.blocked)}
                        >
                          {h.blocked ? (
                            <PlayCircle data-icon="inline-start" aria-hidden="true" />
                          ) : (
                            <Ban data-icon="inline-start" aria-hidden="true" />
                          )}
                          {h.blocked ? "Unblock" : "Block"}
                          <span className="sr-only"> {h.host}</span>
                        </Button>
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
