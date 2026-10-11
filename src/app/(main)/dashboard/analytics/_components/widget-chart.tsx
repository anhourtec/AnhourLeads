"use client";

import { Bar, BarChart, CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";

import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { seriesConfig } from "@/lib/chart-palette";

import {
  type AnalyticsGroupBy,
  type AnalyticsMetric,
  formatValue,
  TIME_GROUPS,
  type WidgetData,
} from "./widget-format";

interface ChartProps {
  data: WidgetData;
  kind: "bar" | "line";
  groupBy: AnalyticsGroupBy;
  currency: (metric: AnalyticsMetric) => boolean;
  /** Accessible name for the figure. */
  title: string;
}

const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });

/** Rows flattened for recharts: one object per bucket / category with a numeric field per metric. */
function chartRows(data: WidgetData) {
  return data.rows.map((r) => ({ label: r.label, ...r.values }));
}

/**
 * Bar or line chart for one widget: one y-axis, thin marks, recessive grid, tooltip on hover and a
 * legend whenever there is more than one series. Categories (rep, sequence…) use horizontal bars so
 * long names stay readable; time uses vertical bars or lines.
 */
export function WidgetChart({ data, kind, groupBy, currency, title }: ChartProps) {
  const config = seriesConfig(data.series.map((s) => ({ key: s.metric, label: s.label })));
  const rows = chartRows(data);
  const multi = data.series.length > 1;
  const anyCurrency = data.series.some((s) => currency(s.metric));
  const tick = (value: number) => (anyCurrency ? `$${compact.format(value)}` : compact.format(value));
  const tooltip = (
    <ChartTooltip
      cursor={kind === "line" ? { strokeWidth: 1 } : { fillOpacity: 0.06 }}
      content={
        <ChartTooltipContent
          indicator={kind === "line" ? "line" : "dot"}
          formatter={(value, name, item) => (
            <div className="flex w-full items-center justify-between gap-3">
              <span className="flex items-center gap-1.5 text-muted-foreground">
                <span className="size-2 shrink-0 rounded-[2px]" style={{ background: item.color }} aria-hidden="true" />
                {config[String(name)]?.label ?? String(name)}
              </span>
              <span className="font-medium font-mono text-foreground tabular-nums">
                {formatValue(Number(value), currency(String(name) as AnalyticsMetric))}
              </span>
            </div>
          )}
        />
      }
    />
  );

  if (kind === "line" || TIME_GROUPS.has(groupBy)) {
    const Chart = kind === "line" ? LineChart : BarChart;
    return (
      <ChartContainer config={config} className="aspect-auto h-56 w-full" role="img" aria-label={title}>
        <Chart data={rows} margin={{ left: 4, right: 8, top: 8, bottom: 0 }} barGap={2}>
          <CartesianGrid vertical={false} strokeOpacity={0.5} />
          <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} minTickGap={24} />
          <YAxis tickLine={false} axisLine={false} width={44} tickFormatter={tick} allowDecimals={false} />
          {tooltip}
          {multi ? <ChartLegend content={<ChartLegendContent />} /> : null}
          {data.series.map((s) =>
            kind === "line" ? (
              <Line
                key={s.metric}
                dataKey={s.metric}
                type="monotone"
                stroke={`var(--color-${s.metric})`}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--background)" }}
              />
            ) : (
              <Bar
                key={s.metric}
                dataKey={s.metric}
                fill={`var(--color-${s.metric})`}
                radius={[4, 4, 0, 0]}
                maxBarSize={28}
              />
            ),
          )}
        </Chart>
      </ChartContainer>
    );
  }

  const height = Math.max(160, Math.min(rows.length, 12) * (multi ? 40 : 30) + 32);
  return (
    <ChartContainer config={config} className="aspect-auto w-full" style={{ height }} role="img" aria-label={title}>
      <BarChart
        data={rows.slice(0, 12)}
        layout="vertical"
        margin={{ left: 4, right: 12, top: 4, bottom: 0 }}
        barGap={2}
      >
        <CartesianGrid horizontal={false} strokeOpacity={0.5} />
        <XAxis type="number" tickLine={false} axisLine={false} tickFormatter={tick} allowDecimals={false} />
        <YAxis
          type="category"
          dataKey="label"
          tickLine={false}
          axisLine={false}
          width={112}
          tickFormatter={(v: string) => (v.length > 16 ? `${v.slice(0, 15)}…` : v)}
        />
        {tooltip}
        {multi ? <ChartLegend content={<ChartLegendContent />} /> : null}
        {data.series.map((s) => (
          <Bar
            key={s.metric}
            dataKey={s.metric}
            fill={`var(--color-${s.metric})`}
            radius={[0, 4, 4, 0]}
            maxBarSize={20}
          />
        ))}
      </BarChart>
    </ChartContainer>
  );
}

/** The same rows as a table (the accessible view of every chart, and the table widget itself). */
export function WidgetTable({
  data,
  groupLabel,
  currency,
}: {
  data: WidgetData;
  groupLabel: string;
  currency: (metric: AnalyticsMetric) => boolean;
}) {
  return (
    <div className="max-h-72 overflow-auto rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="text-xs">{groupLabel}</TableHead>
            {data.series.map((s) => (
              <TableHead key={s.metric} className="text-right text-xs">
                {s.label}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.rows.map((r) => (
            <TableRow key={r.key}>
              <TableCell className="max-w-48 truncate">{r.label}</TableCell>
              {data.series.map((s) => (
                <TableCell key={s.metric} className="text-right font-mono tabular-nums">
                  {formatValue(r.values[s.metric] ?? 0, currency(s.metric))}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
