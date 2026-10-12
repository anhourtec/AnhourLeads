"use client";

import { useId, useMemo, useState } from "react";

import { Plus } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";

import {
  type AnalyticsGroupBy,
  type AnalyticsMetric,
  type Catalogue,
  TIME_GROUPS,
  WIDGET_TYPE_LABELS,
  type Widget,
  type WidgetType,
} from "./widget-format";

type NewWidget = Omit<Widget, "id"> & { id?: string };

/** Pick a metric, a grouping, a date range and how to show it. */
export function WidgetAddDialog({
  catalogue,
  onAdd,
}: {
  catalogue: Catalogue;
  onAdd: (widget: NewWidget) => Promise<string | null>;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [metric, setMetric] = useState<AnalyticsMetric>("emails_sent");
  const [groupBy, setGroupBy] = useState<AnalyticsGroupBy>("day");
  const [type, setType] = useState<WidgetType>("line");
  const [range, setRange] = useState<Widget["range"]>("30d");
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const groupBys = useMemo(
    () => catalogue.metrics.find((m) => m.key === metric)?.groupBys ?? (["none"] as AnalyticsGroupBy[]),
    [catalogue, metric],
  );
  let types: WidgetType[] = ["bar", "table"];
  if (groupBy === "none") types = ["kpi"];
  else if (TIME_GROUPS.has(groupBy)) types = ["line", "bar", "table"];

  function pickMetric(next: AnalyticsMetric) {
    setMetric(next);
    const allowed = catalogue.metrics.find((m) => m.key === next)?.groupBys ?? (["none"] as AnalyticsGroupBy[]);
    if (!allowed.includes(groupBy)) pickGroup(allowed.includes("day") ? "day" : (allowed[0] ?? "none"));
  }

  function pickGroup(next: AnalyticsGroupBy) {
    setGroupBy(next);
    if (next === "none") setType("kpi");
    else if (type === "kpi" || (type === "line" && !TIME_GROUPS.has(next)))
      setType(TIME_GROUPS.has(next) ? "line" : "bar");
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    const label = catalogue.metrics.find((m) => m.key === metric)?.label ?? metric;
    const failure = await onAdd({ type, metric, groupBy, range, title: title.trim() || label });
    setSaving(false);
    if (failure) {
      setError(failure);
      return;
    }
    setOpen(false);
    setTitle("");
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus data-icon="inline-start" aria-hidden="true" />
          Add widget
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Add widget</DialogTitle>
            <DialogDescription>Choose what to measure, how to group it and over which period.</DialogDescription>
          </DialogHeader>
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5 sm:col-span-2">
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
                onChange={(e) => pickGroup(e.target.value as AnalyticsGroupBy)}
              >
                {groupBys.map((g) => (
                  <NativeSelectOption key={g} value={g}>
                    {g === "none" ? "Nothing (single number)" : catalogue.groupByLabels[g]}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${id}-range`}>Date range</Label>
              <NativeSelect
                id={`${id}-range`}
                className="w-full"
                value={range}
                onChange={(e) => setRange(e.target.value as Widget["range"])}
              >
                {catalogue.ranges.map((r) => (
                  <NativeSelectOption key={r.key} value={r.key}>
                    {r.label}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${id}-type`}>Show as</Label>
              <NativeSelect
                id={`${id}-type`}
                className="w-full"
                value={type}
                onChange={(e) => setType(e.target.value as WidgetType)}
              >
                {types.map((t) => (
                  <NativeSelectOption key={t} value={t}>
                    {WIDGET_TYPE_LABELS[t]}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${id}-title`}>Title</Label>
              <Input
                id={`${id}-title`}
                value={title}
                maxLength={120}
                placeholder="Optional"
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" size="sm" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={saving}>
              <Plus data-icon="inline-start" aria-hidden="true" />
              {saving ? "Adding…" : "Add to dashboard"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
