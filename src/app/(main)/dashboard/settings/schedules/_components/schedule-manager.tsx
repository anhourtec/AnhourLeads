"use client";

import { useMemo, useState } from "react";

import { useRouter } from "next/navigation";

import { CalendarClock, Pencil, Plus, Save, Star, Trash2, X } from "lucide-react";
import { toast } from "sonner";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Switch } from "@/components/ui/switch";
import { apiFetch } from "@/lib/api-fetch";
import {
  DEFAULT_SCHEDULE_WINDOWS,
  describeWindows,
  formatClock,
  type ScheduleWindows,
  WEEKDAY_LABELS,
  WEEKDAYS,
  type Weekday,
} from "@/lib/engage-constants";
import type { ScheduleView } from "@/server/services/schedules";

import { TonePill } from "../../../_components/engage/tone-pill";
import { ConfirmDialog } from "../../../_components/pipeline/confirm-dialog";

const START_SLOTS = Array.from(
  { length: 48 },
  (_, i) => `${String(Math.floor(i / 2)).padStart(2, "0")}:${i % 2 ? "30" : "00"}`,
);
const END_SLOTS = [...START_SLOTS.slice(1), "23:59"];
const FALLBACK_ZONES = [
  "UTC",
  "Europe/London",
  "Europe/Berlin",
  "America/New_York",
  "America/Chicago",
  "America/Los_Angeles",
  "Asia/Kolkata",
  "Asia/Singapore",
  "Australia/Sydney",
];

function timeZones(): string[] {
  try {
    return Intl.supportedValuesOf("timeZone");
  } catch {
    return FALLBACK_ZONES;
  }
}

interface Draft {
  name: string;
  timezone: string;
  windows: ScheduleWindows;
  isDefault: boolean;
}

function WindowsEditor({ windows, onChange }: { windows: ScheduleWindows; onChange: (w: ScheduleWindows) => void }) {
  const setDay = (day: Weekday, ranges: [string, string][]) => onChange({ ...windows, [day]: ranges });
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-2 font-medium text-sm">Weekly sending windows</legend>
      {WEEKDAYS.map((day) => {
        const ranges = windows[day] ?? [];
        const on = ranges.length > 0;
        return (
          <div key={day} className="flex flex-col gap-2 rounded-lg border p-2 sm:flex-row sm:items-start">
            <div className="flex w-36 shrink-0 items-center gap-2 pt-1">
              <Switch
                id={`day-${day}`}
                checked={on}
                aria-label={`Send on ${WEEKDAY_LABELS[day]}`}
                onCheckedChange={(v) => setDay(day, v ? [["08:00", "17:00"]] : [])}
              />
              <label htmlFor={`day-${day}`} className="text-sm">
                {WEEKDAY_LABELS[day]}
              </label>
            </div>
            {on ? (
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                {ranges.map(([from, to], i) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: ranges have no identity beyond their position
                  <div key={i} className="flex flex-wrap items-center gap-2">
                    <NativeSelect
                      size="sm"
                      aria-label={`${WEEKDAY_LABELS[day]} window ${i + 1} starts`}
                      value={from}
                      onChange={(e) =>
                        setDay(
                          day,
                          ranges.map((r, j) => (j === i ? [e.target.value, r[1]] : r)),
                        )
                      }
                    >
                      {START_SLOTS.map((t) => (
                        <NativeSelectOption key={t} value={t}>
                          {formatClock(t)}
                        </NativeSelectOption>
                      ))}
                    </NativeSelect>
                    <span className="text-muted-foreground text-xs">to</span>
                    <NativeSelect
                      size="sm"
                      aria-label={`${WEEKDAY_LABELS[day]} window ${i + 1} ends`}
                      value={to}
                      onChange={(e) =>
                        setDay(
                          day,
                          ranges.map((r, j) => (j === i ? [r[0], e.target.value] : r)),
                        )
                      }
                    >
                      {END_SLOTS.map((t) => (
                        <NativeSelectOption key={t} value={t}>
                          {formatClock(t)}
                        </NativeSelectOption>
                      ))}
                    </NativeSelect>
                    {ranges.length > 1 ? (
                      <Button
                        type="button"
                        size="icon-sm"
                        variant="ghost"
                        aria-label={`Remove ${WEEKDAY_LABELS[day]} window ${i + 1}`}
                        onClick={() =>
                          setDay(
                            day,
                            ranges.filter((_, j) => j !== i),
                          )
                        }
                      >
                        <X aria-hidden="true" />
                      </Button>
                    ) : null}
                  </div>
                ))}
                {ranges.length < 4 ? (
                  <div>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => setDay(day, [...ranges, ["18:00", "20:00"]])}
                    >
                      <Plus data-icon="inline-start" aria-hidden="true" />
                      Add window
                    </Button>
                  </div>
                ) : null}
              </div>
            ) : (
              <span className="pt-1 text-muted-foreground text-xs">No sending</span>
            )}
          </div>
        );
      })}
    </fieldset>
  );
}

function ScheduleDialog({
  schedule,
  open,
  onOpenChange,
}: {
  schedule: ScheduleView | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const zones = useMemo(timeZones, []);
  const [draft, setDraft] = useState<Draft>({
    name: "",
    timezone: "UTC",
    windows: DEFAULT_SCHEDULE_WINDOWS,
    isDefault: false,
  });
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [lastKey, setLastKey] = useState<string | null>(null);
  const key = `${open}-${schedule?.id ?? "new"}`;
  if (key !== lastKey) {
    setLastKey(key);
    setDraft({
      name: schedule?.name ?? "",
      timezone: schedule?.timezone ?? "UTC",
      windows: schedule?.windows ?? DEFAULT_SCHEDULE_WINDOWS,
      isDefault: schedule?.isDefault ?? false,
    });
    setError(null);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const windows = Object.fromEntries(
      WEEKDAYS.flatMap((d) => (draft.windows[d]?.length ? [[d, draft.windows[d]]] : [])),
    );
    const body: Record<string, unknown> = { name: draft.name.trim(), timezone: draft.timezone, windows };
    if (!schedule?.isDefault) body.isDefault = draft.isDefault;
    const res = await apiFetch(schedule ? `/api/v1/emailer_schedules/${schedule.id}` : "/api/v1/emailer_schedules", {
      method: schedule ? "PATCH" : "POST",
      body,
    });
    setPending(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    toast.success(schedule ? "Schedule saved." : "Schedule created.");
    onOpenChange(false);
    router.refresh();
  }

  let submitLabel = schedule ? "Save schedule" : "Create schedule";
  if (pending) submitLabel = "Saving…";
  return (
    <Dialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
        <form onSubmit={submit} noValidate className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{schedule ? "Edit schedule" : "New schedule"}</DialogTitle>
            <DialogDescription>
              Automatic emails wait for the next open window. Tasks are created any time.
            </DialogDescription>
          </DialogHeader>
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          <FieldGroup className="gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field className="gap-1.5">
                <FieldLabel htmlFor="schedule-name">Name</FieldLabel>
                <Input
                  id="schedule-name"
                  value={draft.name}
                  maxLength={120}
                  onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                />
              </Field>
              <Field className="gap-1.5">
                <FieldLabel htmlFor="schedule-timezone">Time zone</FieldLabel>
                <NativeSelect
                  id="schedule-timezone"
                  className="w-full"
                  value={draft.timezone}
                  onChange={(e) => setDraft((d) => ({ ...d, timezone: e.target.value }))}
                >
                  {(zones.includes(draft.timezone) ? zones : [draft.timezone, ...zones]).map((z) => (
                    <NativeSelectOption key={z} value={z}>
                      {z}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </Field>
            </div>
            <WindowsEditor windows={draft.windows} onChange={(windows) => setDraft((d) => ({ ...d, windows }))} />
            {schedule?.isDefault ? (
              <p className="text-muted-foreground text-xs">This is the workspace's default schedule.</p>
            ) : (
              <Field orientation="horizontal" className="gap-3">
                <Switch
                  id="schedule-default"
                  checked={draft.isDefault}
                  onCheckedChange={(v) => setDraft((d) => ({ ...d, isDefault: v }))}
                />
                <FieldLabel htmlFor="schedule-default">Make this the default for new sequences</FieldLabel>
              </Field>
            )}
          </FieldGroup>
          <DialogFooter>
            <Button type="button" variant="outline" size="sm" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={pending}>
              {schedule ? (
                <Save data-icon="inline-start" aria-hidden="true" />
              ) : (
                <Plus data-icon="inline-start" aria-hidden="true" />
              )}
              {submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function ScheduleManager({ schedules, canManage }: { schedules: ScheduleView[]; canManage: boolean }) {
  const router = useRouter();
  const [editing, setEditing] = useState<{ open: boolean; schedule: ScheduleView | null }>({
    open: false,
    schedule: null,
  });
  const [toDelete, setToDelete] = useState<ScheduleView | null>(null);

  async function makeDefault(schedule: ScheduleView) {
    const res = await apiFetch(`/api/v1/emailer_schedules/${schedule.id}`, {
      method: "PATCH",
      body: { isDefault: true },
    });
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    toast.success(`${schedule.name} is now the default.`);
    router.refresh();
  }

  return (
    <section className="flex flex-col gap-3" aria-label="Schedules">
      {canManage ? (
        <div className="flex justify-end">
          <Button size="sm" onClick={() => setEditing({ open: true, schedule: null })}>
            <Plus data-icon="inline-start" aria-hidden="true" />
            Create new schedule
          </Button>
        </div>
      ) : null}
      {schedules.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <CalendarClock aria-hidden="true" />
            </EmptyMedia>
            <EmptyTitle>No schedules yet</EmptyTitle>
            <EmptyDescription>
              Sequences without a schedule send inside their mailbox's sending window.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {schedules.map((s) => (
            <Card key={s.id} className="gap-3" data-testid="schedule-card">
              <CardHeader>
                <CardTitle className="flex flex-wrap items-center gap-2">
                  <span className="break-words">{s.name}</span>
                  {s.isDefault ? <TonePill tone="info">Default</TonePill> : null}
                </CardTitle>
                <CardDescription className="font-mono text-xs">
                  {s.timezone} · {s.sequenceCount} sequence{s.sequenceCount === 1 ? "" : "s"}
                </CardDescription>
                {canManage ? (
                  <CardAction className="flex gap-1">
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label={`Edit ${s.name}`}
                      onClick={() => setEditing({ open: true, schedule: s })}
                    >
                      <Pencil aria-hidden="true" />
                    </Button>
                    {s.isDefault ? null : (
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label={`Delete ${s.name}`}
                        onClick={() => setToDelete(s)}
                      >
                        <Trash2 aria-hidden="true" />
                      </Button>
                    )}
                  </CardAction>
                ) : null}
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                  {describeWindows(s.windows).map((row) => (
                    <div key={row.day} className="contents">
                      <dt className="text-muted-foreground">{row.label}</dt>
                      <dd className="font-mono text-xs tabular-nums leading-5">{row.text}</dd>
                    </div>
                  ))}
                </dl>
                {canManage && !s.isDefault ? (
                  <div>
                    <Button size="sm" variant="outline" onClick={() => void makeDefault(s)}>
                      <Star data-icon="inline-start" aria-hidden="true" />
                      Make default
                    </Button>
                  </div>
                ) : null}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      <ScheduleDialog
        schedule={editing.schedule}
        open={editing.open}
        onOpenChange={(open) => setEditing((e) => ({ ...e, open }))}
      />
      <ConfirmDialog
        open={toDelete !== null}
        onOpenChange={(open) => !open && setToDelete(null)}
        title="Delete this schedule?"
        description={`"${toDelete?.name ?? ""}" will be removed. Sequences must use another schedule first.`}
        confirmLabel="Delete schedule"
        pendingLabel="Deleting…"
        icon={<Trash2 data-icon="inline-start" aria-hidden="true" />}
        onConfirm={async () => {
          if (!toDelete) return true;
          const res = await apiFetch(`/api/v1/emailer_schedules/${toDelete.id}`, { method: "DELETE" });
          if (!res.ok) {
            toast.error(res.error);
            return false;
          }
          toast.success("Schedule deleted.");
          router.refresh();
          return true;
        }}
      />
    </section>
  );
}
