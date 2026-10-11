"use client";

import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { seriesConfig } from "@/lib/chart-palette";
import type { DataHealth } from "@/server/services/data-health";

import { num } from "./format";

const config = seriesConfig([{ key: "jobs", label: "Jobs" }]);

export function ActivityCard({ activity, className }: { activity: DataHealth["activity"]; className?: string }) {
  const data = activity.days.map((d) => ({
    ...d,
    label: new Date(`${d.date}T00:00:00Z`).toLocaleDateString("en", {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    }),
  }));
  const stats = [
    { label: "Jobs", value: activity.jobs },
    { label: "Rows processed", value: activity.rowsProcessed },
    { label: "Lookups", value: activity.lookups },
    { label: "From cache", value: activity.cacheHits },
  ];
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>Enrichment activity</CardTitle>
        <CardDescription>
          Jobs per day over the last 30 days. Cached lookups are reused, never repeated.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {stats.map((s) => (
            <div key={s.label} className="flex flex-col gap-0.5">
              <dt className="text-muted-foreground text-xs">{s.label}</dt>
              <dd className="font-medium font-mono text-lg tabular-nums">{num(s.value)}</dd>
            </div>
          ))}
        </dl>
        <ChartContainer config={config} className="aspect-auto h-40 w-full" aria-label="Enrichment jobs per day">
          <BarChart data={data} margin={{ left: 0, right: 0, top: 4, bottom: 0 }}>
            <CartesianGrid vertical={false} strokeDasharray="2 4" />
            <XAxis dataKey="label" tickLine={false} axisLine={false} minTickGap={24} fontSize={11} />
            <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={28} fontSize={11} />
            <ChartTooltip cursor={false} content={<ChartTooltipContent />} />
            <Bar dataKey="jobs" fill="var(--color-jobs)" radius={[4, 4, 0, 0]} maxBarSize={14} />
          </BarChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}
