"use client";

import { useState } from "react";

import Link from "next/link";

import { Filter, MailOpen, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatDateTime, relativeTime } from "@/lib/format-display";
import type { MessageGroup, MessageView } from "@/server/services/emails";

import { ListPagination } from "../../_components/pipeline/list-pagination";
import { useUrlFilters } from "../../_components/pipeline/use-url-filters";
import { EmailDetailSheet } from "./email-detail-sheet";
import { MessageStatus } from "./message-status";

const GROUP_LABELS: Record<MessageGroup, string> = {
  scheduled: "Scheduled",
  delivered: "Delivered",
  replied: "Replied",
  bounced: "Bounced",
  not_sent: "Not sent",
  failed: "Failed",
};
const GROUPS = Object.keys(GROUP_LABELS) as MessageGroup[];

interface Option {
  id: string;
  name?: string;
  email?: string;
}

export function EmailsList({
  messages,
  counts,
  allCount,
  pagination,
  mailboxes,
  sequences,
  canLaunch,
  filtered,
  now: nowIso,
}: {
  messages: MessageView[];
  counts: Record<MessageGroup, number>;
  allCount: number;
  pagination: { page: number; total_pages: number; total_entries: number };
  mailboxes: Option[];
  sequences: Option[];
  canLaunch: boolean;
  filtered: boolean;
  /** Server time, so relative times render the same on the server and in the browser. */
  now: string;
}) {
  const filters = useUrlFilters();
  const [query, setQuery] = useState(filters.get("q"));
  const [showFilters, setShowFilters] = useState(Boolean(filters.get("sequence") || filters.get("oneOff")));
  const [openId, setOpenId] = useState<string | null>(null);
  const status = filters.get("status") || "all";
  const now = new Date(nowIso);
  const extraFilters = [filters.get("sequence"), filters.get("oneOff")].filter(Boolean).length;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <NativeSelect
            size="sm"
            aria-label="Mailbox"
            value={filters.get("mailbox")}
            onChange={(e) => filters.set({ mailbox: e.target.value })}
            className="w-full sm:w-56"
          >
            <NativeSelectOption value="">All inboxes</NativeSelectOption>
            {mailboxes.map((m) => (
              <NativeSelectOption key={m.id} value={m.id}>
                {m.email}
              </NativeSelectOption>
            ))}
          </NativeSelect>
          <form
            className="w-full sm:w-64"
            onSubmit={(e) => {
              e.preventDefault();
              filters.set({ q: query.trim() || null });
            }}
          >
            <InputGroup>
              <InputGroupAddon>
                <Search aria-hidden="true" />
              </InputGroupAddon>
              <InputGroupInput
                aria-label="Search emails"
                placeholder="Search recipients and subjects"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </InputGroup>
          </form>
        </div>
        <Button
          size="sm"
          variant={showFilters ? "secondary" : "ghost"}
          aria-expanded={showFilters}
          aria-controls="email-filters"
          onClick={() => setShowFilters((v) => !v)}
          className="self-start lg:self-auto"
        >
          <Filter data-icon="inline-start" aria-hidden="true" />
          {showFilters ? "Hide filters" : "Show filters"}
          {extraFilters ? <span className="font-mono text-xs tabular-nums">{extraFilters}</span> : null}
        </Button>
      </div>

      {showFilters ? (
        <div
          id="email-filters"
          className="flex flex-col gap-3 rounded-xl border bg-card p-3 sm:flex-row sm:items-center"
        >
          <NativeSelect
            size="sm"
            aria-label="Sequence"
            value={filters.get("sequence")}
            onChange={(e) => filters.set({ sequence: e.target.value })}
            className="w-full sm:w-64"
          >
            <NativeSelectOption value="">Any sequence</NativeSelectOption>
            {sequences.map((s) => (
              <NativeSelectOption key={s.id} value={s.id}>
                {s.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
          <div className="flex items-center gap-2">
            <Checkbox
              id="email-one-off"
              checked={filters.get("oneOff") === "true"}
              onCheckedChange={(v) => filters.set({ oneOff: v === true ? "true" : null })}
            />
            <Label htmlFor="email-one-off" className="font-normal text-sm">
              One-off emails only
            </Label>
          </div>
        </div>
      ) : null}

      <div className="-mx-4 overflow-x-auto px-4 md:mx-0 md:px-0">
        <Tabs value={status} onValueChange={(v) => filters.set({ status: v === "all" ? null : v })}>
          <TabsList aria-label="Email status">
            <TabsTrigger value="all">
              All
              <span className="font-mono text-muted-foreground text-xs tabular-nums">{allCount}</span>
            </TabsTrigger>
            {GROUPS.map((g) => (
              <TabsTrigger key={g} value={g}>
                {GROUP_LABELS[g]}
                <span className="font-mono text-muted-foreground text-xs tabular-nums" data-testid={`email-count-${g}`}>
                  {counts[g]}
                </span>
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>

      <div aria-busy={filters.pending} className="flex flex-col gap-3">
        {messages.length === 0 ? (
          <Empty className="border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <MailOpen aria-hidden="true" />
              </EmptyMedia>
              <EmptyTitle>{filtered ? "No emails match this view" : "No emails yet"}</EmptyTitle>
              <EmptyDescription>
                {filtered
                  ? "Try another status or clear the filters."
                  : "Emails from your sequences and one-off sends appear here. Before you start, check that your sending domains are healthy."}
              </EmptyDescription>
            </EmptyHeader>
            {filtered ? null : (
              <EmptyContent className="flex-row flex-wrap justify-center">
                <Button asChild size="sm" variant="outline">
                  <Link href="/dashboard/settings/deliverability">View domain health</Link>
                </Button>
                {canLaunch ? (
                  <Button asChild size="sm">
                    <Link href="/dashboard/emails/new">New email</Link>
                  </Button>
                ) : null}
              </EmptyContent>
            )}
          </Empty>
        ) : (
          <div className="overflow-x-auto rounded-xl border bg-card">
            <Table className="min-w-[880px]">
              <TableHeader className="bg-muted/50">
                <TableRow>
                  <TableHead className="pl-4">To</TableHead>
                  <TableHead>Subject</TableHead>
                  <TableHead>Sequence</TableHead>
                  <TableHead>Mailbox</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="pr-4">Sent</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {messages.map((m) => {
                  const when = m.sentAt ?? m.scheduledAt ?? m.createdAt;
                  return (
                    <TableRow key={m.id} className="cursor-pointer" onClick={() => setOpenId(m.id)}>
                      <TableCell className="max-w-56 pl-4">
                        <button
                          type="button"
                          className="block max-w-full truncate text-left font-medium underline-offset-4 hover:underline focus-visible:underline"
                          onClick={(e) => {
                            e.stopPropagation();
                            setOpenId(m.id);
                          }}
                        >
                          {m.contact?.name ?? m.toEmail}
                        </button>
                        <span className="block truncate font-mono text-muted-foreground text-xs">{m.toEmail}</span>
                      </TableCell>
                      <TableCell className="max-w-72 truncate">{m.subject}</TableCell>
                      <TableCell className="max-w-56">
                        {m.sequence ? (
                          <>
                            <Link
                              href={`/dashboard/sequences/${m.sequence.id}`}
                              className="block truncate underline-offset-4 hover:underline"
                              onClick={(e) => e.stopPropagation()}
                            >
                              {m.sequence.name}
                            </Link>
                            <span className="block text-muted-foreground text-xs">
                              Step {m.stepPosition ?? "?"}
                              {m.variantLabel ? ` · Version ${m.variantLabel}` : ""}
                            </span>
                          </>
                        ) : (
                          <span className="text-muted-foreground">One-off</span>
                        )}
                      </TableCell>
                      <TableCell className="max-w-48 truncate font-mono text-xs">{m.mailbox?.email ?? "—"}</TableCell>
                      <TableCell>
                        <MessageStatus message={m} />
                      </TableCell>
                      <TableCell className="pr-4 text-muted-foreground text-xs">
                        <time dateTime={when} title={formatDateTime(when)}>
                          {relativeTime(when, now)}
                        </time>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
        <ListPagination
          page={pagination.page}
          totalPages={pagination.total_pages}
          total={pagination.total_entries}
          noun={pagination.total_entries === 1 ? "email" : "emails"}
        />
      </div>
      <EmailDetailSheet messageId={openId} onClose={() => setOpenId(null)} canLaunch={canLaunch} />
    </div>
  );
}
