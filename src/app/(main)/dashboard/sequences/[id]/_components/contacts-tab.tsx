"use client";

import { useState } from "react";

import { useRouter } from "next/navigation";

import { formatDistanceToNow } from "date-fns";
import { CircleCheck, MessageSquareReply, Pause, Play, UserMinus, Users } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { EnrollmentView } from "@/server/services/sequences";

import { EnrollmentStatusPill, TonePill } from "../../../_components/engage/tone-pill";
import { apiRequest } from "../../../_components/records/api-client";
import { type PaginationInfo, RecordsPagination } from "../../../_components/records/records-pagination";
import { SearchBox } from "../../../_components/records/search-box";
import { useUrlParams } from "../../../_components/records/use-url-params";

export const CONTACT_FILTERS = [
  ["all", "All"],
  ["active", "Active"],
  ["paused", "Paused"],
  ["finished", "Finished"],
  ["bounced", "Bounced"],
  ["replied", "Replied"],
  ["unsubscribed", "Unsubscribed"],
  ["not_sent", "Not sent"],
] as const;

type Action = "stop" | "remove" | "finish" | "resume" | "replied";

const HEAD = "font-mono text-[11px] uppercase tracking-wider text-muted-foreground";

function relative(iso: string | null): string {
  return iso ? formatDistanceToNow(new Date(iso), { addSuffix: true }) : "—";
}

function nextStep(e: EnrollmentView): string {
  if (e.status !== "active") return "—";
  return e.nextRunAt ? relative(e.nextRunAt) : "Waiting for review";
}

/** Contacts in the sequence by status, with bulk actions. */
export function ContactsTab({
  sequenceId,
  enrollments,
  counts,
  status,
  pagination,
  stepCount,
  canLaunch,
}: {
  sequenceId: string;
  enrollments: EnrollmentView[];
  counts: Record<string, number>;
  status: string;
  pagination: PaginationInfo;
  stepCount: number;
  canLaunch: boolean;
}) {
  const router = useRouter();
  const { setParams } = useUrlParams();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const all = Object.entries(counts)
    .filter(([k]) => k !== "removed" && k !== "not_sent")
    .reduce((a, [, n]) => a + n, 0);
  const allSelected = enrollments.length > 0 && enrollments.every((e) => selected.has(e.contact.id));

  async function act(action: Action) {
    const contactIds = [...selected];
    if (!contactIds.length) return;
    setBusy(true);
    let path = "/api/v1/emailer_campaigns/remove_or_stop_contact_ids";
    let body: Record<string, unknown> = { sequenceIds: [sequenceId], contactIds, mode: action };
    if (action === "resume" || action === "replied") {
      path = `/api/v1/emailer_campaigns/${sequenceId}/${action === "resume" ? "resume_contact_ids" : "mark_replied"}`;
      body = { contactIds };
    }
    const result = await apiRequest<{ updated: number }>(path, { body });
    setBusy(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(`${result.data.updated} ${result.data.updated === 1 ? "contact" : "contacts"} updated.`);
    setSelected(new Set());
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="-mx-4 overflow-x-auto px-4 md:mx-0 md:px-0">
        <Tabs
          value={status}
          onValueChange={(next) => setParams({ status: next === "all" ? null : next, tab: "contacts" })}
        >
          <TabsList>
            {CONTACT_FILTERS.map(([value, label]) => (
              <TabsTrigger key={value} value={value}>
                {label}
                <span className="font-mono text-muted-foreground text-xs tabular-nums">
                  {(value === "all" ? all : (counts[value] ?? 0)).toLocaleString("en-US")}
                </span>
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <SearchBox placeholder="Search contacts" label="Search contacts" />
        {canLaunch && selected.size ? (
          <div className="flex flex-wrap items-center gap-2" role="toolbar" aria-label="Bulk actions">
            <span className="text-muted-foreground text-xs">
              <span className="font-mono tabular-nums">{selected.size}</span> selected
            </span>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => act("stop")}>
              <Pause data-icon="inline-start" aria-hidden="true" />
              Pause
            </Button>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => act("resume")}>
              <Play data-icon="inline-start" aria-hidden="true" />
              Resume
            </Button>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => act("finish")}>
              <CircleCheck data-icon="inline-start" aria-hidden="true" />
              Finish
            </Button>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => act("replied")}>
              <MessageSquareReply data-icon="inline-start" aria-hidden="true" />
              Mark replied
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => act("remove")}>
              <UserMinus data-icon="inline-start" aria-hidden="true" />
              Remove
            </Button>
          </div>
        ) : null}
      </div>
      {enrollments.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Users aria-hidden="true" />
            </EmptyMedia>
            <EmptyTitle>{status !== "all" || all ? "No contacts here" : "Nobody is in this sequence yet"}</EmptyTitle>
            <EmptyDescription>
              {canLaunch
                ? "Use Add contacts to start people on the first step. Suppressed, invalid and do-not-contact people are skipped."
                : "Contacts in this sequence appear here."}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <>
          <div className="overflow-x-auto rounded-xl border bg-card">
            <Table className="min-w-[820px]">
              <TableHeader className="bg-muted/50">
                <TableRow>
                  {canLaunch ? (
                    <TableHead className="w-10 pl-4">
                      <Checkbox
                        aria-label="Select all on this page"
                        checked={allSelected}
                        onCheckedChange={(v) =>
                          setSelected(v === true ? new Set(enrollments.map((e) => e.contact.id)) : new Set())
                        }
                      />
                    </TableHead>
                  ) : null}
                  <TableHead className={`${HEAD} ${canLaunch ? "" : "pl-4"}`}>Contact</TableHead>
                  <TableHead className={HEAD}>Status</TableHead>
                  <TableHead className={HEAD}>Step</TableHead>
                  <TableHead className={HEAD}>Next step</TableHead>
                  <TableHead className={`${HEAD} pr-4`}>Added</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {enrollments.map((e) => (
                  <TableRow key={e.id} data-state={selected.has(e.contact.id) ? "selected" : undefined}>
                    {canLaunch ? (
                      <TableCell className="pl-4">
                        <Checkbox
                          aria-label={`Select ${e.contact.name}`}
                          checked={selected.has(e.contact.id)}
                          onCheckedChange={(v) =>
                            setSelected((current) => {
                              const next = new Set(current);
                              if (v === true) next.add(e.contact.id);
                              else next.delete(e.contact.id);
                              return next;
                            })
                          }
                        />
                      </TableCell>
                    ) : null}
                    <TableCell className={`max-w-72 ${canLaunch ? "" : "pl-4"}`}>
                      <div className="flex min-w-0 flex-col">
                        <span className="truncate font-medium">{e.contact.name}</span>
                        <span className="truncate font-mono text-muted-foreground text-xs">
                          {e.contact.email ?? "No email"}
                          {e.contact.companyName ? ` · ${e.contact.companyName}` : ""}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col items-start gap-1">
                        {e.notSentReason ? (
                          <TonePill tone="negative">Not sent</TonePill>
                        ) : (
                          <EnrollmentStatusPill status={e.status} />
                        )}
                        {e.notSentReason ? (
                          <span className="max-w-64 text-muted-foreground text-xs">{e.notSentReason}</span>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell className="font-mono text-xs tabular-nums">
                      {Math.min(e.currentStep + 1, Math.max(stepCount, 1))} of {stepCount}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-xs">{nextStep(e)}</TableCell>
                    <TableCell className="pr-4 text-muted-foreground text-xs">{relative(e.createdAt)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <RecordsPagination pagination={pagination} noun="contacts" />
        </>
      )}
    </div>
  );
}
