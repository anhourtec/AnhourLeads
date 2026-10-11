import Link from "next/link";

import { ExternalLink, Inbox } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { MailboxSummary } from "@/server/services/deliverability";

import { Pill, type Tone } from "../../../_components/pipeline/pills";
import { numberFormat, percent } from "./tabs";

const STATUS_TONE: Record<string, Tone> = {
  active: "positive",
  warming: "attention",
  paused: "attention",
  disconnected: "negative",
};
const STATUS_LABEL: Record<string, string> = {
  active: "Active",
  warming: "Warming",
  paused: "Paused",
  disconnected: "Disconnected",
};
const WARMUP: Record<MailboxSummary["warmup"], { tone: Tone; label: string }> = {
  warming: { tone: "attention", label: "Warming up" },
  ramping: { tone: "info", label: "Ramping up" },
  not_started: { tone: "neutral", label: "Not ramping" },
};

/** Summary of every mailbox; changes happen on the mailboxes screen. */
export function MailboxesTab({ mailboxes }: { mailboxes: MailboxSummary[] }) {
  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle>Mailboxes</CardTitle>
        <CardDescription>Daily usage, bounces over the last 30 days, signatures and warm-up.</CardDescription>
        <CardAction>
          <Button size="sm" variant="outline" asChild>
            <Link href="/dashboard/mailboxes">
              <ExternalLink data-icon="inline-start" aria-hidden="true" />
              Manage mailboxes
            </Link>
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        {mailboxes.length ? (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Mailbox</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Sent today</TableHead>
                  <TableHead className="text-right">Bounce rate</TableHead>
                  <TableHead>Signature</TableHead>
                  <TableHead>Warm-up</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {mailboxes.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell className="font-mono text-xs">{m.email}</TableCell>
                    <TableCell>
                      <Pill tone={STATUS_TONE[m.status] ?? "neutral"}>{STATUS_LABEL[m.status] ?? m.status}</Pill>
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {numberFormat.format(m.sentToday)} / {numberFormat.format(m.dailyLimit)}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {percent(m.bounceRate)}
                      <span className="block text-muted-foreground text-xs">
                        {numberFormat.format(m.bounced30)} of {numberFormat.format(m.sent30)}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Pill tone={m.hasSignature ? "positive" : "attention"}>
                        {m.hasSignature ? "Present" : "Missing"}
                      </Pill>
                    </TableCell>
                    <TableCell>
                      <Pill tone={WARMUP[m.warmup].tone}>{WARMUP[m.warmup].label}</Pill>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : (
          <Empty className="border border-dashed">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Inbox aria-hidden="true" />
              </EmptyMedia>
              <EmptyTitle>No mailboxes connected</EmptyTitle>
              <EmptyDescription>Connect the mailbox you send from to see its health here.</EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button size="sm" variant="outline" asChild>
                <Link href="/dashboard/mailboxes">
                  <ExternalLink data-icon="inline-start" aria-hidden="true" />
                  Open mailboxes
                </Link>
              </Button>
            </EmptyContent>
          </Empty>
        )}
      </CardContent>
    </Card>
  );
}
