import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { SequenceView } from "@/server/services/sequences";

import { SequenceStatusPill } from "../../_components/engage/tone-pill";
import { ActiveSwitch } from "./active-switch";
import { count, percent, shortDate } from "./format";
import { StarButton } from "./star-button";

const HEAD = "font-mono text-[11px] uppercase tracking-wider text-muted-foreground";

/** The sequences table: star, name, status with the on/off switch, owner, tags, steps, counts and rates. */
export function SequencesTable({
  sequences,
  canUpdate,
  canLaunch,
}: {
  sequences: SequenceView[];
  canUpdate: boolean;
  canLaunch: boolean;
}) {
  return (
    <div className="overflow-x-auto rounded-xl border bg-card">
      <Table className="min-w-[1100px]">
        <TableHeader className="bg-muted/50">
          <TableRow>
            <TableHead className="w-10 px-2">
              <span className="sr-only">Starred</span>
            </TableHead>
            <TableHead className={HEAD}>Name</TableHead>
            <TableHead className={HEAD}>Status</TableHead>
            <TableHead className={HEAD}>Owner</TableHead>
            <TableHead className={HEAD}>Tags</TableHead>
            <TableHead className={`${HEAD} text-right`}>Steps</TableHead>
            <TableHead className={`${HEAD} text-right`}>Active</TableHead>
            <TableHead className={`${HEAD} text-right`}>Paused</TableHead>
            <TableHead className={`${HEAD} text-right`}>Finished</TableHead>
            <TableHead className={`${HEAD} text-right`}>Bounced</TableHead>
            <TableHead className={`${HEAD} text-right`}>Replied</TableHead>
            <TableHead className={`${HEAD} text-right`}>Open rate</TableHead>
            <TableHead className={`${HEAD} text-right`}>Reply rate</TableHead>
            <TableHead className={`${HEAD} pr-4`}>Created</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sequences.map((s) => (
            <TableRow key={s.id}>
              <TableCell className="px-2">
                <StarButton sequenceId={s.id} name={s.name} starred={s.starred} canEdit={canUpdate} />
              </TableCell>
              <TableCell className="max-w-72">
                <div className="flex min-w-0 flex-col">
                  <Link
                    href={`/dashboard/sequences/${s.id}`}
                    className="truncate font-medium underline-offset-4 hover:underline focus-visible:underline"
                  >
                    {s.name}
                  </Link>
                  <span className="truncate text-muted-foreground text-xs">
                    {s.description ?? (s.mailbox ? <span className="font-mono">{s.mailbox.email}</span> : "No mailbox")}
                  </span>
                </div>
              </TableCell>
              <TableCell>
                <div className="flex items-center gap-2">
                  <ActiveSwitch sequenceId={s.id} name={s.name} status={s.status} canLaunch={canLaunch} />
                  <SequenceStatusPill status={s.status} />
                </div>
              </TableCell>
              <TableCell className="max-w-40 truncate text-sm">{s.owner?.name ?? "—"}</TableCell>
              <TableCell className="max-w-48">
                <div className="flex flex-wrap gap-1">
                  {s.tags.length
                    ? s.tags.slice(0, 3).map((t) => (
                        <Badge key={t} variant="outline" className="font-normal">
                          {t}
                        </Badge>
                      ))
                    : "—"}
                  {s.tags.length > 3 ? (
                    <span className="text-muted-foreground text-xs">+{s.tags.length - 3}</span>
                  ) : null}
                </div>
              </TableCell>
              <TableCell className="text-right font-mono tabular-nums">{count(s.stepCount)}</TableCell>
              <TableCell className="text-right font-mono tabular-nums">{count(s.stats.active)}</TableCell>
              <TableCell className="text-right font-mono tabular-nums">{count(s.stats.paused)}</TableCell>
              <TableCell className="text-right font-mono tabular-nums">{count(s.stats.finished)}</TableCell>
              <TableCell className="text-right font-mono tabular-nums">{count(s.stats.bounced)}</TableCell>
              <TableCell className="text-right font-mono tabular-nums">{count(s.stats.replied)}</TableCell>
              <TableCell className="text-right font-mono tabular-nums">
                {s.trackOpens ? percent(s.stats.openRate) : "—"}
              </TableCell>
              <TableCell className="text-right font-mono tabular-nums">{percent(s.stats.replyRate)}</TableCell>
              <TableCell className="whitespace-nowrap pr-4 text-muted-foreground text-xs">
                {shortDate(s.createdAt)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
