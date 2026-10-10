"use client";

import Link from "next/link";

import { ArrowRight } from "lucide-react";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";

import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { type ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { formatMoney, formatNumber } from "@/lib/format-display";

const config = {
  amount: { label: "Value", color: "var(--primary)" },
} satisfies ChartConfig;

export function PipelineCard({
  pipeline,
  openValue,
  openDeals,
  className,
}: {
  readonly pipeline: { stage: string; name: string; count: number; amount: number }[];
  readonly openValue: number;
  readonly openDeals: number;
  readonly className?: string;
}) {
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>Pipeline by stage</CardTitle>
        <CardDescription>
          <span className="font-mono tabular-nums">{formatNumber(openDeals)}</span> open{" "}
          {openDeals === 1 ? "deal" : "deals"} worth{" "}
          <span className="font-mono tabular-nums">{formatMoney(openValue)}</span>
        </CardDescription>
        <CardAction>
          <Button asChild variant="outline" size="sm">
            <Link href="/dashboard/deals">
              <ArrowRight data-icon="inline-start" />
              Deals
            </Link>
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        {openDeals === 0 ? (
          <Empty className="h-64 border">
            <EmptyHeader>
              <EmptyTitle>No open deals</EmptyTitle>
              <EmptyDescription>Deals you add show up here, grouped by stage.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <div className="flex flex-col gap-4">
            <ChartContainer config={config} className="h-64 w-full">
              <BarChart data={pipeline} margin={{ left: 0, right: 0, top: 8, bottom: 0 }}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="name" tickLine={false} axisLine={false} tickMargin={8} />
                <YAxis hide />
                <ChartTooltip
                  cursor={false}
                  content={
                    <ChartTooltipContent
                      hideIndicator
                      formatter={(value, _name, item) => (
                        <div className="flex flex-col gap-0.5">
                          <span className="font-medium font-mono tabular-nums">{formatMoney(Number(value))}</span>
                          <span className="text-muted-foreground">
                            {formatNumber((item.payload as { count: number }).count)} deals
                          </span>
                        </div>
                      )}
                    />
                  }
                />
                <Bar dataKey="amount" fill="var(--color-amount)" radius={[6, 6, 0, 0]} maxBarSize={56} />
              </BarChart>
            </ChartContainer>
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {pipeline.map((s) => (
                <div key={s.stage} className="flex min-w-0 flex-col gap-0.5 rounded-lg border p-2.5">
                  <dt className="truncate text-muted-foreground text-xs">{s.name}</dt>
                  <dd className="truncate font-medium font-mono text-sm tabular-nums">
                    {formatMoney(s.amount, "USD", true)}
                  </dd>
                  <dd className="text-muted-foreground text-xs tabular-nums">
                    {formatNumber(s.count)} {s.count === 1 ? "deal" : "deals"}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
