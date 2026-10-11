"use client";

import { Suspense, use, useState } from "react";

import { ChartNoAxesColumn, Table2, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

import { WidgetChart, WidgetTable } from "./widget-chart";
import {
  type AnalyticsMetric,
  type Catalogue,
  formatValue,
  isCurrency,
  type Widget,
  type WidgetData,
} from "./widget-format";

interface WidgetCardProps {
  widget: Widget;
  catalogue: Catalogue;
  onRemove?: () => void;
}

/** One dashboard widget. Its data streams in; until then the card keeps its title and shows a skeleton. */
export function WidgetCard({
  data,
  ...props
}: WidgetCardProps & { data: Promise<WidgetData> | WidgetData | undefined }) {
  if (!(data instanceof Promise)) return <ResolvedWidget {...props} data={data} />;
  return (
    <Suspense fallback={<ResolvedWidget {...props} data={undefined} />}>
      <StreamedWidget {...props} data={data} />
    </Suspense>
  );
}

function StreamedWidget({ data, ...props }: WidgetCardProps & { data: Promise<WidgetData> }) {
  return <ResolvedWidget {...props} data={use(data)} />;
}

/** KPI tile, bar, line or table, with a table view for every chart. */
function ResolvedWidget({ widget, data, catalogue, onRemove }: WidgetCardProps & { data: WidgetData | undefined }) {
  const [asTable, setAsTable] = useState(false);
  const currency = (m: AnalyticsMetric) => isCurrency(catalogue, m);
  const range = catalogue.ranges.find((r) => r.key === widget.range)?.label ?? "";
  const groupLabel = catalogue.groupByLabels[widget.groupBy];
  const allZero = !data || data.rows.every((r) => Object.values(r.values).every((v) => !v));
  const isChart = widget.type === "bar" || widget.type === "line";

  function body() {
    if (!data) {
      return (
        <div aria-busy="true">
          <span className="sr-only">Loading</span>
          <Skeleton className={widget.type === "kpi" ? "h-8 w-24" : "h-48 w-full"} />
        </div>
      );
    }
    if (data.error) return <p className="text-muted-foreground text-sm">{data.error}</p>;
    if (widget.type === "kpi") {
      return (
        <p className="font-medium font-mono text-2xl tabular-nums">
          {formatValue(data.totals[widget.metric] ?? 0, currency(widget.metric))}
        </p>
      );
    }
    if (allZero)
      return <p className="py-8 text-center text-muted-foreground text-sm">No activity in this period yet.</p>;
    if (widget.type === "table" || asTable) {
      return <WidgetTable data={data} groupLabel={groupLabel} currency={currency} />;
    }
    return (
      <WidgetChart
        data={data}
        kind={widget.type === "line" ? "line" : "bar"}
        groupBy={widget.groupBy}
        currency={currency}
        title={`${widget.title}, ${range}`}
      />
    );
  }

  return (
    <Card className={widget.type === "kpi" ? "gap-2" : "sm:col-span-2"} data-testid="widget">
      <CardHeader>
        <CardTitle className="truncate text-sm">{widget.title}</CardTitle>
        <CardDescription className="text-xs">{range}</CardDescription>
        {isChart || onRemove ? (
          <CardAction className="flex gap-1">
            {isChart && !allZero ? (
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                aria-label={asTable ? `Show ${widget.title} as a chart` : `Show ${widget.title} as a table`}
                aria-pressed={asTable}
                onClick={() => setAsTable((v) => !v)}
              >
                {asTable ? <ChartNoAxesColumn aria-hidden="true" /> : <Table2 aria-hidden="true" />}
              </Button>
            ) : null}
            {onRemove ? (
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                aria-label={`Remove ${widget.title}`}
                onClick={onRemove}
              >
                <Trash2 aria-hidden="true" />
              </Button>
            ) : null}
          </CardAction>
        ) : null}
      </CardHeader>
      <CardContent className="min-w-0">{body()}</CardContent>
    </Card>
  );
}
