"use client";

import { useState } from "react";

import { useRouter } from "next/navigation";

import { formatDistanceToNow } from "date-fns";
import { EllipsisVertical, MessageSquareReply, Pause, Play, UserMinus, Users } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { EnrollmentView } from "@/server/services/sequences";

import { EnrollmentStatusPill } from "../../../_components/engage/tone-pill";
import { apiRequest } from "../../../_components/records/api-client";
import { type PaginationInfo, RecordsPagination } from "../../../_components/records/records-pagination";
import { AddPeopleDialog } from "./add-people-dialog";

function relative(iso: string | null): string {
  return iso ? formatDistanceToNow(new Date(iso), { addSuffix: true }) : "—";
}

function nextStepLabel(e: EnrollmentView): string {
  if (e.status !== "active") return "—";
  return e.nextRunAt ? relative(e.nextRunAt) : "Waiting for review";
}

export function EnrolledTab({
  sequenceId,
  enrollments,
  pagination,
  stepCount,
  canLaunch,
}: {
  sequenceId: string;
  enrollments: EnrollmentView[];
  pagination: PaginationInfo;
  stepCount: number;
  canLaunch: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);

  async function act(contactId: string, action: "stop" | "remove" | "finish" | "resume" | "replied") {
    setBusy(contactId);
    let path = "/api/v1/emailer_campaigns/remove_or_stop_contact_ids";
    let body: Record<string, unknown> = { sequenceIds: [sequenceId], contactIds: [contactId], mode: action };
    if (action === "resume" || action === "replied") {
      path = `/api/v1/emailer_campaigns/${sequenceId}/${action === "resume" ? "resume_contact_ids" : "mark_replied"}`;
      body = { contactIds: [contactId] };
    }
    const result = await apiRequest(path, { body });
    setBusy(null);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success("Enrollment updated.");
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-3">
      {canLaunch ? (
        <div className="flex justify-end">
          <AddPeopleDialog sequenceId={sequenceId} />
        </div>
      ) : null}
      {enrollments.length === 0 && pagination.page === 1 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Users aria-hidden="true" />
            </EmptyMedia>
            <EmptyTitle>Nobody is enrolled yet</EmptyTitle>
            <EmptyDescription>
              {canLaunch
                ? "Use Add people to start them on step one. Suppressed, invalid and do-not-contact people are skipped."
                : "People enrolled in this sequence appear here."}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        renderTable()
      )}
    </div>
  );

  function renderTable() {
    return (
      <>
        <div className="overflow-hidden rounded-xl border bg-card">
          <Table className="min-w-[760px]">
            <TableHeader className="bg-muted/50">
              <TableRow>
                <TableHead className="px-4">Person</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Step</TableHead>
                <TableHead>Next step</TableHead>
                <TableHead>Enrolled</TableHead>
                {canLaunch ? <TableHead className="w-12 px-4" /> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {enrollments.map((e) => (
                <TableRow key={e.id}>
                  <TableCell className="max-w-64 px-4">
                    <div className="flex min-w-0 flex-col">
                      <span className="truncate font-medium">{e.contact.name}</span>
                      <span className="truncate font-mono text-muted-foreground text-xs">
                        {e.contact.email ?? "No email"}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <EnrollmentStatusPill status={e.status} />
                  </TableCell>
                  <TableCell className="font-mono text-xs tabular-nums">
                    {Math.min(e.currentStep + 1, Math.max(stepCount, 1))} of {stepCount}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-xs">{nextStepLabel(e)}</TableCell>
                  <TableCell className="text-muted-foreground text-xs">{relative(e.createdAt)}</TableCell>
                  {canLaunch ? (
                    <TableCell className="px-4">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            aria-label={`Actions for ${e.contact.name}`}
                            disabled={busy === e.contact.id}
                          >
                            <EllipsisVertical aria-hidden="true" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-44">
                          <DropdownMenuGroup>
                            {e.status === "active" ? (
                              <DropdownMenuItem onSelect={() => act(e.contact.id, "stop")}>
                                <Pause aria-hidden="true" />
                                Pause
                              </DropdownMenuItem>
                            ) : null}
                            {e.status === "paused" ? (
                              <DropdownMenuItem onSelect={() => act(e.contact.id, "resume")}>
                                <Play aria-hidden="true" />
                                Resume
                              </DropdownMenuItem>
                            ) : null}
                            {e.status === "active" || e.status === "paused" ? (
                              <DropdownMenuItem onSelect={() => act(e.contact.id, "replied")}>
                                <MessageSquareReply aria-hidden="true" />
                                Mark as replied
                              </DropdownMenuItem>
                            ) : null}
                          </DropdownMenuGroup>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem variant="destructive" onSelect={() => act(e.contact.id, "remove")}>
                            <UserMinus aria-hidden="true" />
                            Remove
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  ) : null}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <RecordsPagination pagination={pagination} noun="enrolled" />
      </>
    );
  }
}
