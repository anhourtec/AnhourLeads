import { CircleCheck } from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import type { SequenceHealth } from "@/server/services/sequence-insights";

import { TonePill } from "../../../_components/engage/tone-pill";
import { SeverityPill } from "../../_components/diagnostics-tab";
import { percent } from "../../_components/format";

/** Deliverability checks for this sequence. */
export function HealthTab({ health }: { health: SequenceHealth }) {
  const { bounce, unsubscribes, mailbox, issues } = health;
  const scale = Math.max(bounce.threshold * 2, 0.1);
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 md:grid-cols-3">
        <Card className="gap-3 py-4">
          <CardHeader className="px-4">
            <CardTitle className="text-sm">Bounce rate</CardTitle>
            <CardDescription className="text-xs">
              Last {bounce.sample.toLocaleString("en-US")} sends · limit {percent(bounce.threshold)}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 px-4">
            <span className="font-medium font-mono text-2xl tabular-nums">
              {bounce.sample ? percent(bounce.rate) : "—"}
            </span>
            <Progress
              value={Math.min(100, (bounce.rate / scale) * 100)}
              aria-label="Bounce rate against the threshold"
              className={bounce.overThreshold ? "[&>[data-slot=progress-indicator]]:bg-destructive" : undefined}
            />
            <p className="text-muted-foreground text-xs">
              {bounce.guardOn
                ? "Bounce guard pauses the sequence above the limit."
                : "Bounce guard is off for this sequence."}
            </p>
          </CardContent>
        </Card>
        <Card className="gap-3 py-4">
          <CardHeader className="px-4">
            <CardTitle className="text-sm">Mailbox</CardTitle>
            <CardDescription className="truncate font-mono text-xs">{mailbox.email ?? "None chosen"}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 px-4">
            {mailbox.email && mailbox.issues.length === 0 ? (
              <TonePill tone="positive">Ready to send</TonePill>
            ) : (
              <TonePill tone="negative">Needs attention</TonePill>
            )}
            <p className="text-muted-foreground text-xs">
              {mailbox.hasSignature ? "Has a signature." : "No signature set."}
            </p>
          </CardContent>
        </Card>
        <Card className="gap-3 py-4">
          <CardHeader className="px-4">
            <CardTitle className="text-sm">Unsubscribes</CardTitle>
            <CardDescription className="text-xs">
              {unsubscribes.unsubscribed.toLocaleString("en-US")} of {unsubscribes.enrolled.toLocaleString("en-US")}{" "}
              contacts
            </CardDescription>
          </CardHeader>
          <CardContent className="px-4">
            <span className="font-medium font-mono text-2xl tabular-nums">{percent(unsubscribes.rate)}</span>
          </CardContent>
        </Card>
      </div>
      <section className="flex flex-col gap-2" aria-labelledby="health-checks">
        <h2 id="health-checks" className="font-medium text-base">
          Checks
        </h2>
        {issues.length ? (
          <ul className="flex flex-col divide-y rounded-xl border bg-card">
            {issues.map((i) => (
              <li key={`${i.code}-${i.message}`} className="flex items-start gap-3 px-4 py-3 text-sm">
                <SeverityPill severity={i.severity} />
                <span className="min-w-0">{i.message}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="flex items-center gap-2 rounded-xl border bg-card px-4 py-3 text-sm">
            <CircleCheck className="size-4 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
            Everything looks healthy.
          </p>
        )}
      </section>
    </div>
  );
}
