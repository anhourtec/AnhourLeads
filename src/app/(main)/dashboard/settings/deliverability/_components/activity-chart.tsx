"use client";

import { useState } from "react";

import { ChartLine, TableProperties } from "lucide-react";
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";

import { Button } from "@/components/ui/button";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { seriesConfig } from "@/lib/chart-palette";
import type { SeriesPoint } from "@/server/services/deliverability";

import { numberFormat } from "./tabs";

const SERIES = [
  { key: "sent", label: "Sent" },
  { key: "delivered", label: "Delivered" },
  { key: "bounced", label: "Bounced" },
  { key: "replied", label: "Replied" },
] as const;

const config = seriesConfig(SERIES);

const shortDate = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

/** Daily sent / delivered / bounced / replied, as lines or as a table. */
export function ActivityChart({ points }: { points: SeriesPoint[] }) {
  const [view, setView] = useState<"chart" | "table">("chart");
  const empty = points.every((p) => p.sent === 0 && p.replied === 0);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex justify-end">
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setView(view === "chart" ? "table" : "chart")}
          aria-pressed={view === "table"}
        >
          {view === "chart" ? (
            <TableProperties data-icon="inline-start" aria-hidden="true" />
          ) : (
            <ChartLine data-icon="inline-start" aria-hidden="true" />
          )}
          {view === "chart" ? "Show as table" : "Show as chart"}
        </Button>
      </div>
      {view === "chart" ? (
        <div className="relative">
          <ChartContainer config={config} className="aspect-auto h-64 w-full">
            <LineChart data={points} margin={{ left: 0, right: 12, top: 8 }} accessibilityLayer>
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
                <Line
                  key={s.key}
                  dataKey={s.key}
                  type="monotone"
                  stroke={`var(--color-${s.key})`}
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4 }}
                />
              ))}
            </LineChart>
          </ChartContainer>
          {empty ? (
            <p className="pointer-events-none absolute inset-x-0 top-1/3 text-center text-muted-foreground text-sm">
              Nothing sent in this period yet.
            </p>
          ) : null}
        </div>
      ) : (
        <div className="max-h-72 overflow-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Day</TableHead>
                {SERIES.map((s) => (
                  <TableHead key={s.key} className="text-right">
                    {s.label}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {points.map((p) => (
                <TableRow key={p.date}>
                  <TableCell>{shortDate(p.date)}</TableCell>
                  {SERIES.map((s) => (
                    <TableCell key={s.key} className="text-right font-mono tabular-nums">
                      {numberFormat.format(p[s.key])}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
