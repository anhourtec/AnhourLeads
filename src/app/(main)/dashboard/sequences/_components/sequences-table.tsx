import Link from "next/link";

import { Send } from "lucide-react";

import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { SequenceView } from "@/server/services/sequences";

import { SequenceStatusPill } from "../../_components/engage/tone-pill";

const n = (value: number) => value.toLocaleString("en-US");

export function SequencesTable({
  sequences,
  filtered,
  createAction,
}: {
  sequences: SequenceView[];
  filtered: boolean;
  createAction: React.ReactNode;
}) {
  if (sequences.length === 0) {
    return (
      <Empty className="border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Send aria-hidden="true" />
          </EmptyMedia>
          <EmptyTitle>{filtered ? "No matching sequences" : "No sequences yet"}</EmptyTitle>
          <EmptyDescription>
            {filtered
              ? "Try a different search or status."
              : "A sequence sends a series of emails and creates call and task reminders on a schedule."}
          </EmptyDescription>
        </EmptyHeader>
        {!filtered && createAction ? <EmptyContent>{createAction}</EmptyContent> : null}
      </Empty>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      <Table className="min-w-[860px]">
        <TableHeader className="bg-muted/50">
          <TableRow>
            <TableHead className="px-4">Name</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Steps</TableHead>
            <TableHead className="text-right">Enrolled</TableHead>
            <TableHead className="text-right">Active</TableHead>
            <TableHead className="text-right">Sent</TableHead>
            <TableHead className="text-right">Replied</TableHead>
            <TableHead className="px-4 text-right">To review</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sequences.map((s) => (
            <TableRow key={s.id}>
              <TableCell className="max-w-72 px-4">
                <div className="flex min-w-0 flex-col">
                  <Link
                    href={`/dashboard/sequences/${s.id}`}
                    className="truncate font-medium underline-offset-4 hover:underline focus-visible:underline"
                  >
                    {s.name}
                  </Link>
                  <span className="truncate font-mono text-muted-foreground text-xs">
                    {s.mailbox ? s.mailbox.email : "No mailbox"}
                  </span>
                </div>
              </TableCell>
              <TableCell>
                <SequenceStatusPill status={s.status} />
              </TableCell>
              <TableCell className="text-right font-mono tabular-nums">{n(s.stepCount)}</TableCell>
              <TableCell className="text-right font-mono tabular-nums">{n(s.stats.enrolled)}</TableCell>
              <TableCell className="text-right font-mono tabular-nums">{n(s.stats.active)}</TableCell>
              <TableCell className="text-right font-mono tabular-nums">{n(s.stats.sent)}</TableCell>
              <TableCell className="text-right font-mono tabular-nums">{n(s.stats.replied)}</TableCell>
              <TableCell className="px-4 text-right font-mono tabular-nums">{n(s.stats.pendingReview)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
