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
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { seriesConfig } from "@/lib/chart-palette";
import { formatMoney, formatNumber, formatPercent } from "@/lib/format-display";
import type { dealAnalytics } from "@/server/services/deals";

type Analytics = Awaited<ReturnType<typeof dealAnalytics>>;

const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
const MONTH = new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" });

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card className="gap-1 py-4">
      <CardHeader className="px-4">
        <CardDescription className="table-head-mono">{label}</CardDescription>
      </CardHeader>
      <CardContent className="px-4">
        <p className="font-medium font-mono text-2xl tabular-nums">{value}</p>
        {hint ? <p className="text-muted-foreground text-xs">{hint}</p> : null}
      </CardContent>
    </Card>
  );
}

/** Deals → Analytics: value by stage, win rate, average size, deals created and won by month, by owner. */
export function DealsAnalytics({ data, pipelineName }: { readonly data: Analytics; readonly pipelineName: string }) {
  const { totals } = data;
  if (totals.deals === 0) {
    return (
      <Empty className="border">
        <EmptyHeader>
          <EmptyTitle>No deals to analyse yet</EmptyTitle>
          <EmptyDescription>
            Create or import deals in {pipelineName} to see value by stage and win rate.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }
  const stageConfig = seriesConfig([{ key: "amount", label: "Value" }]);
  const monthConfig = seriesConfig([
    { key: "created", label: "Created" },
    { key: "won", label: "Won" },
  ]);
  const months = data.byMonth.map((m) => ({ ...m, label: MONTH.format(new Date(`${m.month}-01T00:00:00Z`)) }));

  return (
    <div className="flex flex-col gap-4" data-testid="deals-analytics">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Open pipeline" value={formatMoney(totals.openPipeline)} hint={pipelineName} />
        <Kpi
          label="Win rate"
          value={totals.winRate === null ? "—" : formatPercent(totals.winRate)}
          hint={`${formatNumber(totals.won)} won · ${formatNumber(totals.lost)} lost`}
        />
        <Kpi label="Average deal size" value={formatMoney(totals.averageDealSize)} />
        <Kpi
          label="Won value"
          value={formatMoney(totals.wonAmount)}
          hint={`${formatNumber(totals.deals)} deals in total`}
        />
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Pipeline value by stage</CardTitle>
            <CardDescription>Sum of deal amounts in each stage.</CardDescription>
          </CardHeader>
          <CardContent>
            <ChartContainer
              config={stageConfig}
              className="aspect-auto h-64 w-full"
              aria-label="Pipeline value by stage"
            >
              <BarChart data={data.byStage} layout="vertical" margin={{ left: 8, right: 16 }}>
                <CartesianGrid horizontal={false} strokeOpacity={0.4} />
                <XAxis
                  type="number"
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v: number) => `$${compact.format(v)}`}
                />
                <YAxis type="category" dataKey="name" width={110} tickLine={false} axisLine={false} />
                <ChartTooltip cursor={{ fillOpacity: 0.06 }} content={<ChartTooltipContent />} />
                <Bar dataKey="amount" fill="var(--color-amount)" radius={3} barSize={14} />
              </BarChart>
            </ChartContainer>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Deals created and won</CardTitle>
            <CardDescription>Last 12 months, by creation month.</CardDescription>
          </CardHeader>
          <CardContent>
            <ChartContainer
              config={monthConfig}
              className="aspect-auto h-64 w-full"
              aria-label="Deals created and won by month"
            >
              <BarChart data={months}>
                <CartesianGrid vertical={false} strokeOpacity={0.4} />
                <XAxis dataKey="label" tickLine={false} axisLine={false} />
                <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={32} />
                <ChartTooltip cursor={{ fillOpacity: 0.06 }} content={<ChartTooltipContent />} />
                <ChartLegend content={<ChartLegendContent />} />
                <Bar dataKey="created" fill="var(--color-created)" radius={3} />
                <Bar dataKey="won" fill="var(--color-won)" radius={3} />
              </BarChart>
            </ChartContainer>
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>By owner</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="table-head-mono">Owner</TableHead>
                <TableHead className="table-head-mono text-right">Deals</TableHead>
                <TableHead className="table-head-mono text-right">Won</TableHead>
                <TableHead className="table-head-mono text-right">Open value</TableHead>
                <TableHead className="table-head-mono text-right">Won value</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.byOwner.map((o) => (
                <TableRow key={o.ownerId ?? "none"}>
                  <TableCell className="max-w-48 truncate">{o.name}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{formatNumber(o.count)}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{formatNumber(o.won)}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{formatMoney(o.openAmount)}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{formatMoney(o.wonAmount)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
