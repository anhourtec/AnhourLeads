"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";

import { Download, Play } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Skeleton } from "@/components/ui/skeleton";
import { apiFetch } from "@/lib/api-fetch";

import { WidgetChart, WidgetTable } from "./widget-chart";
import {
  type AnalyticsGroupBy,
  type AnalyticsMetric,
  type Catalogue,
  formatValue,
  isCurrency,
  TIME_GROUPS,
  type WidgetData,
} from "./widget-format";

interface Option {
  id: string;
  name: string;
}

export interface FilterOptions {
  reps: Option[];
  sequences: Option[];
  mailboxes: Option[];
}

interface QueryResult {
  result: {
    metric: AnalyticsMetric;
    label: string;
    groupBy: AnalyticsGroupBy;
    rows: Array<{ key: string; label: string; value: number }>;
    total: number;
  };
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Report builder: one metric, a grouping, optional filters and a date range; chart, table and CSV export. */
export function ReportBuilder({
  catalogue,
  options,
  today,
}: {
  catalogue: Catalogue;
  options: FilterOptions;
  /** Server "today" (ISO date) so the default range doesn't differ between server and browser. */
  today: string;
}) {
  const id = useId();
  const [metric, setMetric] = useState<AnalyticsMetric>("emails_sent");
  const [groupBy, setGroupBy] = useState<AnalyticsGroupBy>("rep");
  const [from, setFrom] = useState(() => iso(new Date(Date.parse(today) - 29 * 864e5)));
  const [to, setTo] = useState(today);
  const [userId, setUserId] = useState("");
  const [sequenceId, setSequenceId] = useState("");
  const [mailboxId, setMailboxId] = useState("");
  const [data, setData] = useState<QueryResult["result"] | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** "auto" for the first run on open (the button stays usable), "manual" when you press Run report. */
  const [running, setRunning] = useState<"auto" | "manual" | null>(null);
  const latest = useRef(0);

  const groupBys = useMemo(
    () => catalogue.metrics.find((m) => m.key === metric)?.groupBys ?? (["none"] as AnalyticsGroupBy[]),
    [catalogue, metric],
  );
  const usesMessages = groupBys.includes("sequence");
  const usesRep = groupBys.includes("rep");

  const params = useMemo(() => {
    const p = new URLSearchParams({ metric, groupBy, from, to });
    if (userId && usesRep) p.set("userId", userId);
    if (sequenceId && usesMessages) p.set("sequenceId", sequenceId);
    if (mailboxId && usesMessages) p.set("mailboxId", mailboxId);
    return p;
  }, [metric, groupBy, from, to, userId, sequenceId, mailboxId, usesRep, usesMessages]);

  async function run(query: URLSearchParams, mode: "auto" | "manual") {
    const ticket = ++latest.current;
    setRunning(mode);
    setError(null);
    const res = await apiFetch<QueryResult>(`/api/v1/analytics/query?${query.toString()}`);
    // A newer run started meanwhile: its answer wins.
    if (ticket !== latest.current) return;
    setRunning(null);
    if (!res.ok) {
      setError(res.error);
      setData(null);
      return;
    }
    setData(res.data.result);
  }

  // Run once on open with the defaults.
  // biome-ignore lint/correctness/useExhaustiveDependencies: initial run only
  useEffect(() => {
    void run(params, "auto");
  }, []);

  function pickMetric(next: AnalyticsMetric) {
    setMetric(next);
    const allowed = catalogue.metrics.find((m) => m.key === next)?.groupBys ?? (["none"] as AnalyticsGroupBy[]);
    if (!allowed.includes(groupBy)) setGroupBy(allowed.includes("rep") ? "rep" : (allowed[0] ?? "none"));
  }

  const currency = (m: AnalyticsMetric) => isCurrency(catalogue, m);
  const widgetData: WidgetData | null = data
    ? {
        series: [{ metric: data.metric, label: data.label }],
        rows: data.rows.map((r) => ({ key: r.key, label: r.label, values: { [data.metric]: r.value } })),
        totals: { [data.metric]: data.total },
        from,
        to,
        error: null,
      }
    : null;
  const allZero = !data || data.rows.every((r) => !r.value);
  const exportUrl = `/api/v1/analytics/query?${new URLSearchParams({ ...Object.fromEntries(params), format: "csv" }).toString()}`;

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Report builder</CardTitle>
          <CardDescription>
            Aggregated workspace data only. Individual records stay in their own screens.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
            onSubmit={(e) => {
              e.preventDefault();
              void run(params, "manual");
            }}
          >
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${id}-metric`}>Metric</Label>
              <NativeSelect
                id={`${id}-metric`}
                className="w-full"
                value={metric}
                onChange={(e) => pickMetric(e.target.value as AnalyticsMetric)}
              >
                {catalogue.metrics.map((m) => (
                  <NativeSelectOption key={m.key} value={m.key}>
                    {m.label}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${id}-group`}>Group by</Label>
              <NativeSelect
                id={`${id}-group`}
                className="w-full"
                value={groupBy}
                onChange={(e) => setGroupBy(e.target.value as AnalyticsGroupBy)}
              >
                {groupBys.map((g) => (
                  <NativeSelectOption key={g} value={g}>
                    {g === "none" ? "Nothing (total)" : catalogue.groupByLabels[g]}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${id}-from`}>From</Label>
              <Input id={`${id}-from`} type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${id}-to`}>To</Label>
              <Input id={`${id}-to`} type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${id}-rep`}>Rep</Label>
              <NativeSelect
                id={`${id}-rep`}
                className="w-full"
                value={userId}
                disabled={!usesRep}
                onChange={(e) => setUserId(e.target.value)}
              >
                <NativeSelectOption value="">All reps</NativeSelectOption>
                {options.reps.map((o) => (
                  <NativeSelectOption key={o.id} value={o.id}>
                    {o.name}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${id}-sequence`}>Sequence</Label>
              <NativeSelect
                id={`${id}-sequence`}
                className="w-full"
                value={sequenceId}
                disabled={!usesMessages}
                onChange={(e) => setSequenceId(e.target.value)}
              >
                <NativeSelectOption value="">All sequences</NativeSelectOption>
                {options.sequences.map((o) => (
                  <NativeSelectOption key={o.id} value={o.id}>
                    {o.name}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${id}-mailbox`}>Mailbox</Label>
              <NativeSelect
                id={`${id}-mailbox`}
                className="w-full"
                value={mailboxId}
                disabled={!usesMessages}
                onChange={(e) => setMailboxId(e.target.value)}
              >
                <NativeSelectOption value="">All mailboxes</NativeSelectOption>
                {options.mailboxes.map((o) => (
                  <NativeSelectOption key={o.id} value={o.id}>
                    {o.name}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </div>
            <div className="flex items-end">
              <Button type="submit" size="sm" disabled={running === "manual"}>
                <Play data-icon="inline-start" aria-hidden="true" />
                {running === "manual" ? "Running…" : "Run report"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {running && !data ? (
        <Card aria-busy="true">
          <CardHeader>
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-4 w-24" />
          </CardHeader>
          <CardContent>
            <span className="sr-only">Running the report</span>
            <Skeleton className="h-48 w-full" />
          </CardContent>
        </Card>
      ) : null}

      {data && widgetData ? (
        <Card aria-busy={running !== null}>
          <CardHeader>
            <CardTitle>{data.label}</CardTitle>
            <CardDescription>
              Total{" "}
              <span className="font-mono text-foreground tabular-nums">
                {formatValue(data.total, currency(data.metric))}
              </span>
            </CardDescription>
            <CardAction>
              <Button asChild size="sm" variant="outline">
                <a href={exportUrl} download>
                  <Download data-icon="inline-start" aria-hidden="true" />
                  Export CSV
                </a>
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent className="flex min-w-0 flex-col gap-4">
            {allZero ? (
              <p className="py-8 text-center text-muted-foreground text-sm">No activity matches this report yet.</p>
            ) : null}
            {!allZero && data.groupBy !== "none" ? (
              <WidgetChart
                data={widgetData}
                kind={TIME_GROUPS.has(data.groupBy) ? "line" : "bar"}
                groupBy={data.groupBy}
                currency={currency}
                title={data.label}
              />
            ) : null}
            {!allZero ? (
              <WidgetTable data={widgetData} groupLabel={catalogue.groupByLabels[data.groupBy]} currency={currency} />
            ) : null}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
