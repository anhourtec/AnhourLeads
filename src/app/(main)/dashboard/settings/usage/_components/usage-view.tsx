import { Info } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { UsageCounter, UsageCounts, UsageReport } from "@/server/services/usage";

import { Pill } from "../../../_components/pipeline/pills";

const n = new Intl.NumberFormat("en-US");
const date = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" });
const month = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" });

function Delta({ now, before }: { now: number; before: number }) {
  if (before === 0) return <span>{now === 0 ? "Nothing last month either" : "None last month"}</span>;
  const pct = Math.round(((now - before) / before) * 100);
  return (
    <span>
      <span className="font-mono tabular-nums">
        {pct > 0 ? "+" : ""}
        {pct}%
      </span>{" "}
      vs last month (<span className="font-mono tabular-nums">{n.format(before)}</span>)
    </span>
  );
}

function CounterGrid({
  counts,
  counters,
  label,
}: {
  counts: { thisMonth: UsageCounts; lastMonth: UsageCounts };
  counters: Array<{ key: UsageCounter; label: string }>;
  label: string;
}) {
  return (
    <section aria-label={label} className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {counters.map((c) => (
        <Card key={c.key} className="gap-2">
          <CardHeader>
            <CardDescription>{c.label}</CardDescription>
            <CardTitle className="font-medium font-mono text-2xl tabular-nums">
              {n.format(counts.thisMonth[c.key])}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-muted-foreground text-xs">
            <Delta now={counts.thisMonth[c.key]} before={counts.lastMonth[c.key]} />
          </CardContent>
        </Card>
      ))}
    </section>
  );
}

/** Usage this month vs last month: own usage for everyone, workspace and per-member with audit:read. */
export function UsageView({
  usage,
  counters,
}: {
  usage: UsageReport;
  counters: Array<{ key: UsageCounter; label: string }>;
}) {
  const thisMonth = month.format(new Date(usage.period.thisMonth.from));
  return (
    <div className="flex flex-col gap-4 md:gap-6">
      <Alert>
        <Info aria-hidden="true" />
        <AlertTitle>How usage is counted</AlertTitle>
        <AlertDescription>
          People and company lookups, email verifications and crawled pages run on this installation, so nothing is
          billed per lookup. A result already checked recently is served from cache and counted as a cached lookup. Paid
          data providers you connect bill you directly.
        </AlertDescription>
      </Alert>

      {usage.workspace ? (
        <>
          <h2 className="font-medium text-base">Workspace, {thisMonth}</h2>
          <CounterGrid counts={usage.workspace} counters={counters} label="Workspace usage" />
        </>
      ) : null}

      <h2 className="font-medium text-base">Your usage, {thisMonth}</h2>
      <CounterGrid counts={usage.me} counters={counters} label="Your usage" />

      {usage.users ? (
        <Card>
          <CardHeader>
            <CardTitle>By member</CardTitle>
            <CardDescription>This month, with last month in brackets.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Member</TableHead>
                    {counters.map((c) => (
                      <TableHead key={c.key} className="whitespace-nowrap text-right">
                        {c.label}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {usage.users.map((u) => (
                    <TableRow key={u.userId}>
                      <TableCell>
                        <div className="font-medium">{u.name}</div>
                        <div className="font-mono text-muted-foreground text-xs">{u.email}</div>
                      </TableCell>
                      {counters.map((c) => (
                        <TableCell key={c.key} className="whitespace-nowrap text-right font-mono tabular-nums">
                          {n.format(u.thisMonth[c.key])}{" "}
                          <span className="text-muted-foreground text-xs">({n.format(u.lastMonth[c.key])})</span>
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {usage.dataRequests ? (
        <Card>
          <CardHeader>
            <CardTitle>Data requests</CardTitle>
            <CardDescription>Privacy access and erasure requests handled this month and last month.</CardDescription>
          </CardHeader>
          <CardContent>
            {usage.dataRequests.length ? (
              <ul className="flex flex-col divide-y">
                {usage.dataRequests.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                    <span className="flex items-center gap-2">
                      <Pill tone={r.action === "erase" ? "negative" : "info"}>
                        {r.action === "erase" ? "Erasure" : "Access"}
                      </Pill>
                      <span>{r.actorName ?? "API key or former member"}</span>
                    </span>
                    <time className="text-muted-foreground text-xs" dateTime={r.createdAt}>
                      {date.format(new Date(r.createdAt))} UTC
                    </time>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-muted-foreground text-sm">No data requests in this period.</p>
            )}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
