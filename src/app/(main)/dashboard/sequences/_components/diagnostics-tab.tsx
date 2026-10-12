import Link from "next/link";

import { ShieldCheck } from "lucide-react";

import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import type { DiagnosticsRow, IssueSeverity } from "@/server/services/sequence-insights";

import { SequenceStatusPill, TonePill } from "../../_components/engage/tone-pill";

const SEVERITY: Record<IssueSeverity, ["negative" | "attention" | "neutral", string]> = {
  critical: ["negative", "Critical"],
  warning: ["attention", "Warning"],
  info: ["neutral", "Info"],
};

export function SeverityPill({ severity }: { severity: IssueSeverity }) {
  const [tone, label] = SEVERITY[severity];
  return <TonePill tone={tone}>{label}</TonePill>;
}

/** Sequences with something to fix, worst first. */
export function DiagnosticsTab({ rows }: { rows: DiagnosticsRow[] }) {
  if (!rows.length) {
    return (
      <Empty className="border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <ShieldCheck aria-hidden="true" />
          </EmptyMedia>
          <EmptyTitle>No problems found</EmptyTitle>
          <EmptyDescription>Mailboxes, bounce rates and steps look healthy across your sequences.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }
  return (
    <ul className="flex flex-col gap-3" aria-label="Sequences with issues">
      {rows.map((r) => (
        <li key={r.id} className="flex flex-col gap-2 rounded-xl border bg-card p-4">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <Link
              href={`/dashboard/sequences/${r.id}?tab=health`}
              className="min-w-0 truncate font-medium underline-offset-4 hover:underline"
            >
              {r.name}
            </Link>
            <SequenceStatusPill status={r.status} />
          </div>
          <ul className="flex flex-col gap-1.5">
            {r.issues.map((i) => (
              <li key={`${i.code}-${i.message}`} className="flex items-start gap-2 text-sm">
                <SeverityPill severity={i.severity} />
                <span className="min-w-0 text-muted-foreground">{i.message}</span>
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
  );
}
