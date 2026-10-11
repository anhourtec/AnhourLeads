"use client";

import { useState } from "react";

import { RefreshCw, Server } from "lucide-react";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { apiFetch } from "@/lib/api-fetch";
import { seriesConfig } from "@/lib/chart-palette";
import type { CrawlerStats } from "@/server/discovery/admin";

import { Pill } from "./pill";
import { exactTime, numberFormat, relativeTime, STATUS_LABEL, STATUS_PILL, type TabValue } from "./tabs";

const chartConfig = seriesConfig([{ key: "pages", label: "Pages" }]);

const minuteLabel = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

function Kpi({ label, value, hint }: { label: string; value: number; hint?: string }) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardDescription>{label}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-1">
        <span className="font-heading text-2xl tabular-nums leading-none">{numberFormat.format(value)}</span>
        {hint && <span className="text-muted-foreground text-xs">{hint}</span>}
      </CardContent>
    </Card>
  );
}

export function OverviewTab({ initial, onOpenTab }: { initial: CrawlerStats; onOpenTab: (tab: TabValue) => void }) {
  const [stats, setStats] = useState(initial);
  const [loading, setLoading] = useState(false);

  async function refresh() {
    setLoading(true);
    const res = await apiFetch<CrawlerStats>("/api/v1/platform/crawler/stats");
    setLoading(false);
    if (res.ok) setStats(res.data);
    else toast.error(res.error);
  }

  const idle = stats.pagesLastHour === 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-2 sm:gap-4 xl:grid-cols-4">
        <Kpi label="Companies" value={stats.index.companies} />
        <Kpi
          label="People"
          value={stats.index.people}
          hint={`${numberFormat.format(stats.index.peopleGone)} no longer listed`}
        />
        <Kpi label="Job postings" value={stats.index.jobPostings} />
        <Kpi label="News items" value={stats.index.news} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Crawl throughput</CardTitle>
          <CardDescription>
            Pages fetched per minute over the last hour: {numberFormat.format(stats.pagesLastHour)} in total,{" "}
            {stats.pagesPerMinute} a minute on average.
          </CardDescription>
          <CardAction>
            <Button size="sm" variant="outline" onClick={refresh} disabled={loading}>
              <RefreshCw data-icon="inline-start" aria-hidden="true" />
              {loading ? "Refreshing…" : "Refresh"}
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent>
          {idle ? (
            <p className="text-muted-foreground text-sm">No pages fetched in the last hour.</p>
          ) : (
            <ChartContainer config={chartConfig} className="aspect-auto h-56 w-full">
              <BarChart data={stats.throughput} margin={{ left: 0, right: 8, top: 8 }} accessibilityLayer>
                <CartesianGrid vertical={false} strokeDasharray="3 3" />
                <XAxis
                  dataKey="minute"
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                  minTickGap={40}
                  tickFormatter={minuteLabel}
                />
                <YAxis tickLine={false} axisLine={false} width={32} allowDecimals={false} />
                <ChartTooltip content={<ChartTooltipContent labelFormatter={(v) => minuteLabel(String(v))} />} />
                <Bar dataKey="pages" fill="var(--color-pages)" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ChartContainer>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Crawl queue</CardTitle>
            <CardDescription>Every URL the fleet knows, by state.</CardDescription>
            <CardAction>
              <Button size="sm" variant="ghost" onClick={() => onOpenTab("queue")}>
                Open queue
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {Object.entries(stats.frontier).map(([status, n]) => (
                <div key={status} className="flex flex-col gap-1">
                  <dt>
                    <Pill tone={STATUS_PILL[status] ?? "neutral"}>{STATUS_LABEL[status] ?? status}</Pill>
                  </dt>
                  <dd className="font-mono text-sm tabular-nums">{numberFormat.format(n)}</dd>
                </div>
              ))}
              <div className="flex flex-col gap-1">
                <dt>
                  <Pill tone="negative">Hosts blocked</Pill>
                </dt>
                <dd className="font-mono text-sm tabular-nums">{numberFormat.format(stats.hosts.blocked)}</dd>
              </div>
            </dl>
            <p className="mt-3 text-muted-foreground text-xs">
              {numberFormat.format(stats.hosts.total)} hosts, {numberFormat.format(stats.hosts.backingOff)} backing off
              after errors. {numberFormat.format(stats.index.optouts)} opt-outs honoured.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Workers</CardTitle>
            <CardDescription>Crawler containers that reported in the last 90 seconds.</CardDescription>
          </CardHeader>
          <CardContent>
            {stats.workers.length === 0 ? (
              <Empty className="border">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <Server aria-hidden="true" />
                  </EmptyMedia>
                  <EmptyTitle>No workers running</EmptyTitle>
                  <EmptyDescription>
                    Start the crawler service: <code className="font-mono text-xs">docker compose up -d crawler</code>.
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              <ul className="flex flex-col divide-y">
                {stats.workers.map((w) => (
                  <li
                    key={w.id}
                    className="flex flex-wrap items-center justify-between gap-2 py-2 first:pt-0 last:pb-0"
                  >
                    <span className="min-w-0 break-all font-mono text-xs">{w.id}</span>
                    <span
                      className="text-muted-foreground text-xs"
                      title={exactTime(w.lastBeatAt)}
                      suppressHydrationWarning
                    >
                      {numberFormat.format(w.processed)} pages · seen {relativeTime(w.lastBeatAt)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
