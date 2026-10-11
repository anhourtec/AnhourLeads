"use client";

import { useState, useTransition } from "react";

import Link from "next/link";

import {
  ArrowRight,
  CircleAlert,
  Info,
  Lightbulb,
  MailCheck,
  MessageSquareReply,
  MousePointerClick,
  UserPlus,
  X,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { apiFetch } from "@/lib/api-fetch";
import type { DeliverabilityOverview, PeriodStats, Recommendation } from "@/server/services/deliverability";

import { Pill, type Tone } from "../../../_components/pipeline/pills";
import { ActivityChart } from "./activity-chart";
import { numberFormat, percent } from "./tabs";

const SEVERITY: Record<Recommendation["severity"], { tone: Tone; label: string }> = {
  critical: { tone: "negative", label: "Fix now" },
  warning: { tone: "attention", label: "Recommended" },
  info: { tone: "info", label: "Tip" },
};

function Delta({ now, before }: { now: number | null; before: number | null }) {
  if (now === null || before === null) return <span className="text-muted-foreground text-xs">No data last month</span>;
  const diff = Math.round((now - before) * 1000) / 10;
  const sign = diff > 0 ? "+" : "";
  return (
    <span className="text-muted-foreground text-xs">
      <span className="font-mono tabular-nums">
        {sign}
        {diff}
      </span>{" "}
      points vs last month
    </span>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex flex-col">
      <span className="text-muted-foreground text-xs">{label}</span>
      <span className="font-mono text-sm tabular-nums">{numberFormat.format(value)}</span>
    </div>
  );
}

function PerformanceCard({
  title,
  icon,
  rate,
  before,
  metrics,
  note,
}: {
  title: string;
  icon: React.ReactNode;
  rate: number | null;
  before: number | null;
  metrics: { label: string; value: number }[];
  note?: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardDescription className="flex items-center gap-2">
          {icon}
          {title}
        </CardDescription>
        <CardTitle className="font-medium font-mono text-2xl tabular-nums">{percent(rate)}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {note ? <p className="text-muted-foreground text-xs">{note}</p> : <Delta now={rate} before={before} />}
        <div className="flex flex-wrap gap-x-6 gap-y-2">
          {metrics.map((m) => (
            <Metric key={m.label} {...m} />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function PerformanceCards({ now, before, trackingOn }: { now: PeriodStats; before: PeriodStats; trackingOn: boolean }) {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      <PerformanceCard
        title="Emails sent successfully"
        icon={<MailCheck className="size-4" aria-hidden="true" />}
        rate={now.deliveredRate}
        before={before.deliveredRate}
        metrics={[
          { label: "Delivered", value: now.delivered },
          { label: "Bounced", value: now.bounced },
        ]}
      />
      <PerformanceCard
        title="Open rate"
        icon={<MousePointerClick className="size-4" aria-hidden="true" />}
        rate={trackingOn ? now.openRate : null}
        before={trackingOn ? before.openRate : null}
        metrics={trackingOn ? [{ label: "Opened", value: now.opened }] : []}
        note={trackingOn ? undefined : "Open tracking is off for these sequences, so opens aren't measured."}
      />
      <PerformanceCard
        title="Reply rate"
        icon={<MessageSquareReply className="size-4" aria-hidden="true" />}
        rate={now.replyRate}
        before={before.replyRate}
        metrics={[
          { label: "Replies", value: now.replies },
          { label: "Positive replies", value: now.positive },
        ]}
      />
    </div>
  );
}

function RecommendationAction({ rec, onOpenTab }: { rec: Recommendation; onOpenTab: (tab: string) => void }) {
  if (!rec.href || !rec.action) return null;
  const tab = rec.href.match(/[?&]tab=([a-z]+)/)?.[1];
  if (tab) {
    return (
      <Button size="sm" variant="ghost" onClick={() => onOpenTab(tab)}>
        <ArrowRight data-icon="inline-start" aria-hidden="true" />
        {rec.action}
      </Button>
    );
  }
  return (
    <Button size="sm" variant="ghost" asChild>
      <Link href={rec.href}>
        <ArrowRight data-icon="inline-start" aria-hidden="true" />
        {rec.action}
      </Link>
    </Button>
  );
}

export function OverviewTab({
  initial,
  canInvite,
  onOpenTab,
}: {
  initial: DeliverabilityOverview;
  canInvite: boolean;
  onOpenTab: (tab: string) => void;
}) {
  const [data, setData] = useState(initial);
  const [mailboxId, setMailboxId] = useState<string>("");
  const [days, setDays] = useState<7 | 30>(7);
  const [error, setError] = useState<string | null>(null);
  const [tipOpen, setTipOpen] = useState(true);
  const [showAllRecs, setShowAllRecs] = useState(false);
  const recs = showAllRecs ? data.recommendations : data.recommendations.slice(0, 6);
  const [pending, startTransition] = useTransition();

  function load(nextMailbox: string, nextDays: 7 | 30) {
    setMailboxId(nextMailbox);
    setDays(nextDays);
    startTransition(async () => {
      const params = new URLSearchParams({ days: String(nextDays) });
      if (nextMailbox) params.set("mailboxId", nextMailbox);
      const res = await apiFetch<{ overview: DeliverabilityOverview }>(`/api/v1/deliverability/overview?${params}`);
      if (res.ok) {
        setData(res.data.overview);
        setError(null);
      } else setError(res.error);
    });
  }

  return (
    <div className="flex flex-col gap-4 md:gap-6" aria-busy={pending}>
      {tipOpen ? (
        <div className="flex items-start gap-3 rounded-xl border bg-muted/40 p-4">
          <Lightbulb className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm">
              Someone else manages your DNS? Invite them so they can add the SPF, DKIM and DMARC records for your
              sending domains.
            </p>
            {canInvite ? (
              <Button size="sm" variant="outline" asChild>
                <Link href="/dashboard/settings/members">
                  <UserPlus data-icon="inline-start" aria-hidden="true" />
                  Invite teammate
                </Link>
              </Button>
            ) : null}
          </div>
          <Button size="icon-sm" variant="ghost" aria-label="Dismiss tip" onClick={() => setTipOpen(false)}>
            <X aria-hidden="true" />
          </Button>
        </div>
      ) : null}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="deliverability-mailbox" className="font-medium text-sm">
            Mailbox performance
          </label>
          <NativeSelect
            id="deliverability-mailbox"
            value={mailboxId}
            onChange={(e) => load(e.target.value, days)}
            className="w-full sm:w-72"
          >
            <NativeSelectOption value="">All mailboxes</NativeSelectOption>
            {data.mailboxes.map((m) => (
              <NativeSelectOption key={m.id} value={m.id}>
                {m.email}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
        <p className="text-muted-foreground text-xs">This month so far, compared with last month.</p>
      </div>

      {error ? (
        <p role="alert" className="flex items-center gap-2 text-destructive text-sm">
          <CircleAlert className="size-4" aria-hidden="true" />
          {error}
        </p>
      ) : null}

      <PerformanceCards now={data.thisMonth} before={data.lastMonth} trackingOn={data.trackingOn} />

      <Card>
        <CardHeader>
          <CardTitle>Deliverability and activity</CardTitle>
          <CardDescription>Sent, delivered, bounced and replied, per day (UTC).</CardDescription>
          <CardAction>
            <ToggleGroup
              type="single"
              size="sm"
              variant="outline"
              value={String(days)}
              onValueChange={(v) => {
                if (v === "7" || v === "30") load(mailboxId, v === "7" ? 7 : 30);
              }}
              aria-label="Period"
            >
              <ToggleGroupItem value="7">Last 7 days</ToggleGroupItem>
              <ToggleGroupItem value="30">Last 30 days</ToggleGroupItem>
            </ToggleGroup>
          </CardAction>
        </CardHeader>
        <CardContent>
          <ActivityChart points={data.series} />
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card className="min-w-0">
          <CardHeader>
            <CardTitle>Top performing sequences</CardTitle>
            <CardDescription>Last 30 days, by reply rate.</CardDescription>
          </CardHeader>
          <CardContent>
            {data.topSequences.length ? (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Sequence</TableHead>
                      <TableHead className="text-right">Sent</TableHead>
                      <TableHead className="text-right">Reply rate</TableHead>
                      <TableHead className="text-right">Bounce rate</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.topSequences.map((s) => (
                      <TableRow key={s.id}>
                        <TableCell className="max-w-48 truncate">
                          <Link href={`/dashboard/sequences/${s.id}`} className="hover:underline">
                            {s.name}
                          </Link>
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums">
                          {numberFormat.format(s.sent)}
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums">{percent(s.replyRate)}</TableCell>
                        <TableCell className="text-right font-mono tabular-nums">{percent(s.bounceRate)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <Empty className="border border-dashed">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <Info aria-hidden="true" />
                  </EmptyMedia>
                  <EmptyTitle>No sequence sends yet</EmptyTitle>
                  <EmptyDescription>Sequences that sent email in the last 30 days are ranked here.</EmptyDescription>
                </EmptyHeader>
              </Empty>
            )}
          </CardContent>
        </Card>

        <Card className="min-w-0">
          <CardHeader>
            <CardTitle>Recommendations</CardTitle>
            <CardDescription>Computed from your domains, mailboxes and recent sends.</CardDescription>
            <CardAction>
              <Badge variant="outline" className="font-mono tabular-nums">
                {data.recommendations.length}
              </Badge>
            </CardAction>
          </CardHeader>
          <CardContent>
            {data.recommendations.length ? (
              <ul className="flex flex-col divide-y">
                {recs.map((r) => {
                  return (
                    <li key={r.id} className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-start">
                      <div className="flex min-w-0 flex-1 flex-col gap-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <Pill tone={SEVERITY[r.severity].tone}>{SEVERITY[r.severity].label}</Pill>
                          <span className="font-medium text-sm">{r.title}</span>
                        </div>
                        <p className="text-muted-foreground text-xs">{r.detail}</p>
                      </div>
                      <RecommendationAction rec={r} onOpenTab={onOpenTab} />
                    </li>
                  );
                })}
              </ul>
            ) : null}
            {data.recommendations.length > 6 ? (
              <Button size="sm" variant="ghost" className="mt-2" onClick={() => setShowAllRecs(!showAllRecs)}>
                <ArrowRight data-icon="inline-start" aria-hidden="true" />
                {showAllRecs ? "Show fewer" : `Show all ${data.recommendations.length}`}
              </Button>
            ) : null}
            {data.recommendations.length ? null : (
              <p className="text-muted-foreground text-sm">Nothing to fix right now.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
