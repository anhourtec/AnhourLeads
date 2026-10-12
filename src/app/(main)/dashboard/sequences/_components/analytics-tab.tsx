"use client";

import { Fragment, useState } from "react";

import Link from "next/link";

import { cn } from "cn";
import { BarChart3, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { STEP_TYPE_LABELS, type StepType } from "@/lib/engage-constants";
import type { SequenceAnalyticsRow } from "@/server/services/sequence-insights";

import { SequenceStatusPill } from "../../_components/engage/tone-pill";
import { count, percent } from "./format";

const HEAD = "font-mono text-[11px] uppercase tracking-wider text-muted-foreground";

/** Per sequence (and per step when expanded): sent, delivered, bounced, replied, interested, unsubscribed, opened. */
export function AnalyticsTab({ rows }: { rows: SequenceAnalyticsRow[] }) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  if (!rows.length) {
    return (
      <Empty className="border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <BarChart3 aria-hidden="true" />
          </EmptyMedia>
          <EmptyTitle>No numbers yet</EmptyTitle>
          <EmptyDescription>Once sequences start sending, their results show here.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }
  const total = rows.reduce(
    (a, r) => ({ sent: a.sent + r.sent, bounced: a.bounced + r.bounced, replied: a.replied + r.replied }),
    { sent: 0, bounced: 0, replied: 0 },
  );
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-3">
        {[
          ["Emails sent", count(total.sent)],
          ["Bounce rate", total.sent ? percent(total.bounced / total.sent) : "—"],
          ["Replies", count(total.replied)],
        ].map(([label, value]) => (
          <div key={label} className="flex flex-col gap-1 rounded-xl border bg-card p-4">
            <span className="text-muted-foreground text-xs">{label}</span>
            <span className="font-medium font-mono text-2xl tabular-nums">{value}</span>
          </div>
        ))}
      </div>
      <div className="overflow-x-auto rounded-xl border bg-card">
        <Table className="min-w-[900px]">
          <TableHeader className="bg-muted/50">
            <TableRow>
              <TableHead className={`${HEAD} pl-4`}>Sequence</TableHead>
              {["Sent", "Delivered", "Bounced", "Replied", "Interested", "Unsubscribed", "Opened"].map((h) => (
                <TableHead key={h} className={`${HEAD} text-right last:pr-4`}>
                  {h}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => {
              const expanded = open.has(r.id);
              return (
                <Fragment key={r.id}>
                  <TableRow>
                    <TableCell className="max-w-80 pl-2">
                      <div className="flex min-w-0 items-center gap-1">
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          aria-expanded={expanded}
                          aria-label={`${expanded ? "Hide" : "Show"} steps for ${r.name}`}
                          disabled={!r.steps.length}
                          onClick={() =>
                            setOpen((s) => {
                              const next = new Set(s);
                              if (next.has(r.id)) next.delete(r.id);
                              else next.add(r.id);
                              return next;
                            })
                          }
                        >
                          <ChevronRight
                            aria-hidden="true"
                            className={cn("transition-transform", expanded && "rotate-90")}
                          />
                        </Button>
                        <Link
                          href={`/dashboard/sequences/${r.id}?tab=report`}
                          className="truncate font-medium underline-offset-4 hover:underline"
                        >
                          {r.name}
                        </Link>
                        <SequenceStatusPill status={r.status} />
                      </div>
                    </TableCell>
                    <Num value={r.sent} />
                    <Num value={r.delivered} />
                    <Num value={r.bounced} />
                    <Num value={r.replied} />
                    <Num value={r.interested} />
                    <Num value={r.unsubscribed} />
                    <TableCell className="pr-4 text-right font-mono tabular-nums">
                      {r.opened === null ? "—" : count(r.opened)}
                    </TableCell>
                  </TableRow>
                  {expanded
                    ? r.steps.map((s) => (
                        <TableRow key={`${r.id}-${s.position}`} className="bg-muted/20">
                          <TableCell className="pl-12 text-muted-foreground text-xs">
                            Step {s.position}: {STEP_TYPE_LABELS[s.type as StepType] ?? s.type}
                          </TableCell>
                          <Num value={s.sent} muted />
                          <Num value={s.sent - s.bounced} muted />
                          <Num value={s.bounced} muted />
                          <TableCell colSpan={3} className="text-right text-muted-foreground text-xs">
                            {s.notSent ? `${count(s.notSent)} not sent` : ""}
                          </TableCell>
                          <TableCell className="pr-4" />
                        </TableRow>
                      ))
                    : null}
                </Fragment>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function Num({ value, muted }: { value: number; muted?: boolean }) {
  return (
    <TableCell className={cn("text-right font-mono tabular-nums", muted && "text-muted-foreground text-xs")}>
      {count(value)}
    </TableCell>
  );
}
