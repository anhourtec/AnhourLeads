import { CircleCheck, Handshake, MailCheck, Send, Users } from "lucide-react";

import { Card, CardAction, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { formatMoney, formatNumber, formatPercent } from "@/lib/format-display";
import type { OverviewDto } from "@/server/services/overview";

function Kpi({
  label,
  value,
  detail,
  icon: Icon,
}: {
  label: string;
  value: string;
  detail: React.ReactNode;
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
}) {
  return (
    <Card>
      <CardHeader>
        <CardDescription>{label}</CardDescription>
        <CardAction>
          <Icon className="size-4 text-muted-foreground" aria-hidden={true} />
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-1.5">
        <span className="font-medium font-mono text-2xl tabular-nums leading-none">{value}</span>
        <p className="text-muted-foreground text-xs">{detail}</p>
      </CardContent>
    </Card>
  );
}

export function KpiCards({ overview }: { readonly overview: OverviewDto }) {
  return (
    <section aria-label="Key numbers" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <Kpi
        label="People"
        value={formatNumber(overview.contacts)}
        icon={Users}
        detail={
          <>
            across <span className="font-mono tabular-nums">{formatNumber(overview.companies)}</span> companies
          </>
        }
      />
      <Kpi
        label="Verified emails"
        value={formatPercent(overview.verifiedEmailRate)}
        icon={MailCheck}
        detail={
          overview.contactsWithEmail ? (
            <>
              <span className="font-mono tabular-nums">{formatNumber(overview.verifiedEmails)}</span> of{" "}
              <span className="font-mono tabular-nums">{formatNumber(overview.contactsWithEmail)}</span> addresses valid
            </>
          ) : (
            "No email addresses yet"
          )
        }
      />
      <Kpi
        label="Emails sent, last 7 days"
        value={formatNumber(overview.emailsSentLast7Days)}
        icon={Send}
        detail={
          <>
            <span className="font-mono tabular-nums">{formatNumber(overview.activeSequences)}</span> active{" "}
            {overview.activeSequences === 1 ? "sequence" : "sequences"}
          </>
        }
      />
      <Kpi
        label="Open pipeline"
        value={formatMoney(overview.openPipelineValue, "USD", overview.openPipelineValue >= 1_000_000)}
        icon={overview.dealsWonThisMonth.count ? CircleCheck : Handshake}
        detail={
          <>
            <span className="font-mono tabular-nums">{formatNumber(overview.dealsWonThisMonth.count)}</span> won this
            month ·{" "}
            <span className="font-mono tabular-nums">
              {formatMoney(overview.dealsWonThisMonth.amount, "USD", true)}
            </span>
          </>
        }
      />
    </section>
  );
}
