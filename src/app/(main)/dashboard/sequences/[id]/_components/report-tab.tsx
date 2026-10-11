import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { STEP_TYPE_LABELS } from "@/lib/engage-constants";
import type { DetailedStats } from "@/server/services/sequences";

import { count, percent } from "../../_components/format";

const HEAD = "font-mono text-[11px] uppercase tracking-wider text-muted-foreground";

/** Funnel per step (sent → opened → replied, plus bounced and not sent) and per A/B version. */
export function ReportTab({ stats, trackOpens }: { stats: DetailedStats; trackOpens: boolean }) {
  const kpis: [string, string][] = [
    ["Contacts", count(stats.enrolled)],
    ["Emails sent", count(stats.sent)],
    ["Open rate", trackOpens ? percent(stats.openRate) : "—"],
    ["Reply rate", percent(stats.replyRate)],
  ];
  const variants = stats.steps.flatMap((s) => s.variants.map((v) => ({ ...v, position: s.position })));
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {kpis.map(([label, value]) => (
          <div key={label} className="flex flex-col gap-1 rounded-xl border bg-card p-4">
            <span className="text-muted-foreground text-xs">{label}</span>
            <span className="font-medium font-mono text-2xl tabular-nums">{value}</span>
          </div>
        ))}
      </div>
      <section className="flex flex-col gap-2" aria-labelledby="report-steps">
        <h2 id="report-steps" className="font-medium text-base">
          By step
        </h2>
        <div className="overflow-x-auto rounded-xl border bg-card">
          <Table className="min-w-[760px]">
            <TableHeader className="bg-muted/50">
              <TableRow>
                <TableHead className={`${HEAD} pl-4`}>Step</TableHead>
                {["Sent", "Opened", "Clicked", "Replied", "Bounced", "Not sent", "Reply rate"].map((h) => (
                  <TableHead key={h} className={`${HEAD} text-right last:pr-4`}>
                    {h}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {stats.steps.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="py-8 text-center text-muted-foreground text-sm">
                    Add steps to see their results.
                  </TableCell>
                </TableRow>
              ) : null}
              {stats.steps.map((s) => (
                <TableRow key={s.stepId} className={s.enabled ? undefined : "text-muted-foreground"}>
                  <TableCell className="pl-4">
                    Step {s.position}: {STEP_TYPE_LABELS[s.type]}
                    {s.enabled ? null : <span className="text-xs"> (off)</span>}
                  </TableCell>
                  <N v={s.sent} />
                  <TableCell className="text-right font-mono tabular-nums">
                    {trackOpens ? count(s.opened) : "—"}
                  </TableCell>
                  <N v={s.clicked} />
                  <N v={s.replied} />
                  <N v={s.bounced} />
                  <N v={s.blocked} />
                  <TableCell className="pr-4 text-right font-mono tabular-nums">
                    {s.sent ? percent(s.replied / s.sent) : "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </section>
      {variants.length ? (
        <section className="flex flex-col gap-2" aria-labelledby="report-variants">
          <h2 id="report-variants" className="font-medium text-base">
            A/B tests
          </h2>
          <div className="overflow-x-auto rounded-xl border bg-card">
            <Table className="min-w-[560px]">
              <TableHeader className="bg-muted/50">
                <TableRow>
                  <TableHead className={`${HEAD} pl-4`}>Version</TableHead>
                  {["Sent", "Opened", "Replied", "Reply rate"].map((h) => (
                    <TableHead key={h} className={`${HEAD} text-right last:pr-4`}>
                      {h}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {variants.map((v) => (
                  <TableRow key={v.variantId}>
                    <TableCell className="pl-4">
                      Step {v.position} · Version {v.label}
                      {v.active ? null : <span className="text-muted-foreground text-xs"> (inactive)</span>}
                    </TableCell>
                    <N v={v.sent} />
                    <TableCell className="text-right font-mono tabular-nums">
                      {trackOpens ? count(v.opened) : "—"}
                    </TableCell>
                    <N v={v.replied} />
                    <TableCell className="pr-4 text-right font-mono tabular-nums">
                      {v.sent ? percent(v.replied / v.sent) : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </section>
      ) : null}
    </div>
  );
}

function N({ v }: { v: number }) {
  return <TableCell className="text-right font-mono tabular-nums">{count(v)}</TableCell>;
}
