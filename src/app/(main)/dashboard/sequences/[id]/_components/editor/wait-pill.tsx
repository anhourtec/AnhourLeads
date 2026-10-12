"use client";

import { useState } from "react";

import { Check, Pencil, Timer } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { describeWait, type StepType } from "@/lib/engage-constants";

const clamp = (value: string, max: number) => Math.min(max, Math.max(0, Number.parseInt(value, 10) || 0));

/** Connector pill above a step ("Send email in 30 minutes ✎"); the pencil edits days and minutes. */
export function WaitPill({
  index,
  type,
  waitDays,
  waitMinutes,
  canEdit,
  onChange,
}: {
  index: number;
  type: StepType;
  waitDays: number;
  waitMinutes: number;
  canEdit: boolean;
  onChange: (wait: { waitDays: number; waitMinutes: number }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [days, setDays] = useState(String(waitDays));
  const [minutes, setMinutes] = useState(String(waitMinutes));
  const text = describeWait(waitDays, waitMinutes, index === 0, type);
  const idp = `wait-${index}`;

  const pill = (
    <span className="inline-flex max-w-full items-center gap-1.5 truncate rounded-full border bg-muted px-3 py-1 text-muted-foreground text-xs">
      <Timer className="size-3.5 shrink-0" aria-hidden="true" />
      <span className="truncate">{text}</span>
      {canEdit ? <Pencil className="size-3 shrink-0" aria-hidden="true" /> : null}
    </span>
  );

  return (
    <div className="flex flex-col items-center" data-testid={`wait-pill-${index + 1}`}>
      {canEdit ? (
        <Popover
          open={open}
          onOpenChange={(next) => {
            setOpen(next);
            if (next) {
              setDays(String(waitDays));
              setMinutes(String(waitMinutes));
            }
          }}
        >
          <PopoverTrigger asChild>
            <button
              type="button"
              className="max-w-full rounded-full outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
              aria-label={`Edit wait before step ${index + 1}: ${text}`}
            >
              {pill}
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-64" align="center">
            <form
              className="flex flex-col gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                onChange({ waitDays: clamp(days, 365), waitMinutes: clamp(minutes, 1439) });
                setOpen(false);
              }}
            >
              <p className="font-medium text-sm">
                {index === 0 ? "Wait after enrolling" : "Wait after the previous step"}
              </p>
              <div className="grid grid-cols-2 gap-2">
                <Field className="gap-1.5">
                  <FieldLabel htmlFor={`${idp}-days`} className="text-xs">
                    Days
                  </FieldLabel>
                  <Input
                    id={`${idp}-days`}
                    type="number"
                    min={0}
                    max={365}
                    inputMode="numeric"
                    className="h-8 font-mono"
                    value={days}
                    onChange={(e) => setDays(e.target.value)}
                  />
                </Field>
                <Field className="gap-1.5">
                  <FieldLabel htmlFor={`${idp}-minutes`} className="text-xs">
                    Minutes
                  </FieldLabel>
                  <Input
                    id={`${idp}-minutes`}
                    type="number"
                    min={0}
                    max={1439}
                    inputMode="numeric"
                    className="h-8 font-mono"
                    value={minutes}
                    onChange={(e) => setMinutes(e.target.value)}
                  />
                </Field>
              </div>
              <p className="text-muted-foreground text-xs">Emails still wait for the sequence's sending schedule.</p>
              <Button type="submit" size="sm">
                <Check data-icon="inline-start" aria-hidden="true" />
                Apply
              </Button>
            </form>
          </PopoverContent>
        </Popover>
      ) : (
        pill
      )}
      <span className="h-4 w-px bg-border" aria-hidden="true" />
    </div>
  );
}
