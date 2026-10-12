"use client";

import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { seriesConfig } from "@/lib/chart-palette";
import { formatNumber, formatPercent } from "@/lib/format-display";
import type { EmailAnalytics } from "@/server/services/emails";

import { useUrlFilters } from "../../_components/pipeline/use-url-filters";

const SERIES = [
  { key: "sent", label: "Sent" },
  { key: "bounced", label: "Bounced" },
  { key: "replied", label: "Replied" },
] as const;
const config = seriesConfig(SERIES);

const shortDate = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

const PERIODS = [7, 30, 90] as const;

/** Sent / delivered / bounced / replied over time, for all inboxes or one. */
export function EmailAnalyticsView({
  analytics,
  mailboxes,
}: {
  analytics: EmailAnalytics;
  mailboxes: { id: string; email: string }[];
}) {
  const filters = useUrlFilters();
  const t = analytics.totals;
  const tiles = [
    { label: "Sent", value: t.sent },
    { label: "Delivered", value: t.delivered },
    { label: "Bounced", value: t.bounced },
    { label: "Replied", value: t.replied },
    { label: "Not sent", value: t.notSent },
  ];
  const empty = analytics.series.every((p) => p.sent === 0 && p.replied === 0);

  return (
    <div className="flex flex-col gap-4" aria-busy={filters.pending}>
      <div className="flex flex-col gap-2 sm:flex-row">
        <NativeSelect
          size="sm"
          aria-label="Mailbox"
          value={filters.get("mailbox")}
          onChange={(e) => filters.set({ mailbox: e.target.value })}
          className="w-full sm:w-56"
        >
          <NativeSelectOption value="">All inboxes</NativeSelectOption>
          {mailboxes.map((m) => (
            <NativeSelectOption key={m.id} value={m.id}>
              {m.email}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        <NativeSelect
          size="sm"
          aria-label="Period"
          value={String(analytics.days)}
          onChange={(e) => filters.set({ days: e.target.value === "30" ? null : e.target.value })}
          className="w-full sm:w-40"
        >
          {PERIODS.map((d) => (
            <NativeSelectOption key={d} value={String(d)}>
              Last {d} days
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </div>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-5">
        {tiles.map((tile) => (
          <Card key={tile.label} className="gap-1 py-4">
            <CardHeader className="px-4">
              <CardDescription>{tile.label}</CardDescription>
              <CardTitle className="font-medium font-mono text-2xl tabular-nums">{formatNumber(tile.value)}</CardTitle>
            </CardHeader>
          </Card>
        ))}
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Emails per day</CardTitle>
          <CardDescription>Sent includes bounced emails. Replies are recorded on the day they arrive.</CardDescription>
        </CardHeader>
        <CardContent className="relative">
          <ChartContainer config={config} className="aspect-auto h-64 w-full">
            <BarChart data={analytics.series} margin={{ left: 0, right: 12, top: 8 }} accessibilityLayer>
              <CartesianGrid vertical={false} strokeDasharray="3 3" />
              <XAxis
                dataKey="date"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                tickFormatter={shortDate}
                minTickGap={24}
              />
              <YAxis tickLine={false} axisLine={false} width={32} allowDecimals={false} />
              <ChartTooltip content={<ChartTooltipContent labelFormatter={(v) => shortDate(String(v))} />} />
              <ChartLegend content={<ChartLegendContent />} />
              {SERIES.map((s) => (
                <Bar key={s.key} dataKey={s.key} fill={`var(--color-${s.key})`} radius={2} />
              ))}
            </BarChart>
          </ChartContainer>
          {empty ? (
            <p className="pointer-events-none absolute inset-x-0 top-1/3 text-center text-muted-foreground text-sm">
              Nothing sent in this period yet.
            </p>
          ) : null}
        </CardContent>
      </Card>
      <Card className="gap-3">
        <CardHeader>
          <CardTitle>By mailbox</CardTitle>
        </CardHeader>
        <CardContent className="px-0">
          <div className="overflow-x-auto">
            <Table className="min-w-[560px]">
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-6">Mailbox</TableHead>
                  <TableHead className="text-right">Sent</TableHead>
                  <TableHead className="text-right">Bounced</TableHead>
                  <TableHead className="text-right">Bounce rate</TableHead>
                  <TableHead className="pr-6 text-right">Replied</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {analytics.mailboxes.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="py-6 text-center text-muted-foreground">
                      No mailboxes yet.
                    </TableCell>
                  </TableRow>
                ) : (
                  analytics.mailboxes.map((m) => (
                    <TableRow key={m.id}>
                      <TableCell className="max-w-64 truncate pl-6 font-mono text-xs">{m.email}</TableCell>
                      <TableCell className="text-right font-mono tabular-nums">{formatNumber(m.sent)}</TableCell>
                      <TableCell className="text-right font-mono tabular-nums">{formatNumber(m.bounced)}</TableCell>
                      <TableCell className="text-right font-mono tabular-nums">{formatPercent(m.bounceRate)}</TableCell>
                      <TableCell className="pr-6 text-right font-mono tabular-nums">
                        {formatNumber(m.replied)}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
