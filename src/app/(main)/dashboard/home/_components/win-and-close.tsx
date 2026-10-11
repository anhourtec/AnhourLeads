import Link from "next/link";

import { format } from "date-fns";
import { CalendarClock, CheckSquare, Inbox, Mail, MessageSquareReply } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DEAL_STAGE_INFO, type DealStage } from "@/lib/pipeline-constants";
import type { EmailStats, FollowUpDeal, MailboxStatus, ReplyCategory, TaskCounts } from "@/server/services/home";

function Stat({ label, value, hint }: { readonly label: string; readonly value: string; readonly hint?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-lg border p-3">
      <dt className="table-head-mono">{label}</dt>
      <dd className="font-heading text-2xl tabular-nums">{value}</dd>
      {hint ? <dd className="text-muted-foreground text-xs">{hint}</dd> : null}
    </div>
  );
}

function pct(value: number | null): string {
  return value === null ? "–" : `${(value * 100).toFixed(1)}%`;
}

export function EmailStatsCard({ stats, canConnect }: { readonly stats: EmailStats; readonly canConnect: boolean }) {
  const since = `From ${format(new Date(stats.since), "MMM d")}`;
  return (
    <Card className="lg:col-span-2">
      <CardHeader>
        <CardTitle>Your email stats</CardTitle>
        <CardDescription>This month, from your mailboxes.</CardDescription>
      </CardHeader>
      <CardContent>
        {stats.hasMailbox ? (
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Stat label="Sent" value={stats.sent.toLocaleString()} hint={since} />
            <Stat label="Delivered" value={stats.delivered.toLocaleString()} hint={since} />
            {stats.opened === null ? (
              <div className="flex min-w-0 flex-col gap-1 rounded-lg border border-dashed p-3">
                <dt className="table-head-mono">Opened</dt>
                <dd className="text-muted-foreground text-xs">
                  Open tracking is off in your sequences. Turn it on in a sequence's settings to count opens.
                </dd>
              </div>
            ) : (
              <Stat label="Opened" value={stats.opened.toLocaleString()} hint={since} />
            )}
            <Stat label="Replied" value={stats.replied.toLocaleString()} hint={since} />
            <Stat label="Interested" value={stats.interested.toLocaleString()} hint={since} />
            <Stat
              label="Bounced"
              value={pct(stats.bounceRate)}
              hint={`${stats.bounced.toLocaleString()} of ${stats.sent.toLocaleString()}`}
            />
          </dl>
        ) : (
          <EmptyWidget
            icon={Mail}
            text="Connect a mailbox to see what you've sent, delivered and received this month."
            action={canConnect ? { label: "Connect mailbox", href: "/dashboard/mailboxes?new=1" } : undefined}
          />
        )}
      </CardContent>
    </Card>
  );
}

const REPLY_LABELS: Record<ReplyCategory, string> = {
  interested: "Interested",
  not_interested: "Not interested",
  unsubscribed: "Unsubscribed",
  uncategorized: "Uncategorized",
};

export function RecentRepliesCard({ replies }: { readonly replies: Record<ReplyCategory, number> }) {
  const total = Object.values(replies).reduce((a, b) => a + b, 0);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent replies</CardTitle>
        <CardDescription>Last 30 days, in your sequences, by the person's stage.</CardDescription>
      </CardHeader>
      <CardContent>
        {total ? (
          <ul className="divide-y" aria-label="Replies by category">
            {(Object.keys(REPLY_LABELS) as ReplyCategory[]).map((key) => (
              <li key={key} className="flex items-center justify-between py-2 text-sm">
                <span>{REPLY_LABELS[key]}</span>
                <span className="font-mono tabular-nums">{replies[key].toLocaleString()}</span>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyWidget icon={MessageSquareReply} text="No replies in the last 30 days." />
        )}
      </CardContent>
    </Card>
  );
}

export function TasksCard({ counts }: { readonly counts: TaskCounts }) {
  const rows: { label: string; value: number; href: string }[] = [
    { label: "All tasks", value: counts.all, href: "/dashboard/tasks" },
    { label: "Calls", value: counts.call, href: "/dashboard/tasks?type=call" },
    { label: "Emails", value: counts.email, href: "/dashboard/tasks?type=email" },
    { label: "LinkedIn", value: counts.linkedin, href: "/dashboard/tasks" },
    { label: "Overdue", value: counts.overdue, href: "/dashboard/tasks" },
  ];
  return (
    <Card>
      <CardHeader>
        <CardTitle>Your tasks</CardTitle>
        <CardDescription>Open tasks assigned to you.</CardDescription>
        <CardAction>
          <Button asChild size="sm" variant="outline">
            <Link prefetch={false} href="/dashboard/tasks">
              <CheckSquare data-icon="inline-start" />
              View tasks
            </Link>
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        <ul className="divide-y" aria-label="Task counts">
          {rows.map((row) => (
            <li key={row.label} className="flex items-center justify-between py-2 text-sm">
              <Link prefetch={false} href={row.href} className="hover:underline">
                {row.label}
              </Link>
              <span
                className={`font-mono tabular-nums ${row.label === "Overdue" && row.value ? "text-destructive" : ""}`}
              >
                {row.value.toLocaleString()}
              </span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

export function DealsFollowUpCard({ deals }: { readonly deals: readonly FollowUpDeal[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Deals for follow-up</CardTitle>
        <CardDescription>Your open deals past their close date or quiet for 14 days.</CardDescription>
      </CardHeader>
      <CardContent>
        {deals.length ? (
          <ul className="divide-y" aria-label="Deals for follow-up">
            {deals.map((deal) => (
              <li key={deal.id} className="flex flex-col gap-1 py-2.5">
                <div className="flex items-center justify-between gap-2">
                  <Link
                    prefetch={false}
                    href="/dashboard/deals"
                    className="truncate font-medium text-sm hover:underline"
                  >
                    {deal.name}
                  </Link>
                  <Badge variant="secondary" className="shrink-0 font-medium">
                    {DEAL_STAGE_INFO[deal.stage as DealStage]?.name ?? deal.stage}
                  </Badge>
                </div>
                <p className="text-muted-foreground text-xs">
                  {[
                    deal.company,
                    deal.amount !== null ? `${deal.currency} ${deal.amount.toLocaleString()}` : null,
                    deal.reason === "close_date_passed" && deal.closeDate
                      ? `Close date passed ${format(new Date(deal.closeDate), "MMM d")}`
                      : "No activity for 14 days",
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyWidget icon={CalendarClock} text="Nothing to chase: none of your open deals is overdue or quiet." />
        )}
      </CardContent>
    </Card>
  );
}

const MAILBOX_STATUS: Record<string, string> = {
  active: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  warming: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  paused: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  disconnected: "bg-destructive/10 text-destructive",
};

export function MailboxCard({
  mailboxes,
  canConnect,
}: {
  readonly mailboxes: readonly MailboxStatus[];
  readonly canConnect: boolean;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Mailbox</CardTitle>
        <CardDescription>Your sending mailboxes and today's volume.</CardDescription>
      </CardHeader>
      <CardContent>
        {mailboxes.length ? (
          <ul className="divide-y" aria-label="Your mailboxes">
            {mailboxes.map((m) => (
              <li key={m.id} className="flex flex-col gap-1 py-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-mono text-sm">{m.email}</span>
                  <Badge
                    variant="secondary"
                    className={`shrink-0 font-medium capitalize ${MAILBOX_STATUS[m.status] ?? ""}`}
                  >
                    {m.status}
                  </Badge>
                </div>
                <p className="font-mono text-muted-foreground text-xs tabular-nums">
                  {m.sentToday} of {m.dailyLimit} sent today
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyWidget
            icon={Inbox}
            text="You haven't connected a mailbox yet."
            action={canConnect ? { label: "Connect mailbox", href: "/dashboard/mailboxes?new=1" } : undefined}
          />
        )}
      </CardContent>
    </Card>
  );
}

function EmptyWidget({
  icon: Icon,
  text,
  action,
}: {
  readonly icon: typeof Mail;
  readonly text: string;
  readonly action?: { label: string; href: string };
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed px-4 py-8 text-center">
      <Icon className="size-5 text-muted-foreground" aria-hidden="true" />
      <p className="max-w-xs text-muted-foreground text-sm">{text}</p>
      {action ? (
        <Button asChild size="sm" variant="outline">
          <Link prefetch={false} href={action.href}>
            {action.label}
          </Link>
        </Button>
      ) : null}
    </div>
  );
}
