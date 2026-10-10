"use client";

import { useState } from "react";

import { useRouter } from "next/navigation";

import { Archive, Pause, Play, Zap } from "lucide-react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

import { apiRequest } from "../../../_components/records/api-client";
import { ConfirmDeleteDialog } from "../../../_components/records/confirm-delete-dialog";

interface RunResult {
  ran: boolean;
  note?: string;
  sent: number;
  failed: number;
  blocked: number;
  pendingReview: number;
  tasks: number;
  limited: number;
  outsideWindow: number;
}

function describeRun(run: RunResult): string {
  if (!run.ran) return run.note ?? "Nothing to do.";
  const parts = [
    run.sent && `${run.sent} sent`,
    run.pendingReview && `${run.pendingReview} waiting for review`,
    run.tasks && `${run.tasks} tasks created`,
    run.blocked && `${run.blocked} blocked`,
    run.failed && `${run.failed} failed`,
    run.limited && `${run.limited} held by the daily limit`,
    run.outsideWindow && `${run.outsideWindow} waiting for the sending window`,
  ].filter(Boolean);
  return parts.length ? `${parts.join(", ")}.` : "Nothing was due.";
}

export function LifecycleActions({
  sequenceId,
  sequenceName,
  status,
  canLaunch,
  canDelete,
}: {
  sequenceId: string;
  sequenceName: string;
  status: "draft" | "active" | "paused" | "archived";
  canLaunch: boolean;
  canDelete: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);

  async function call(action: "approve" | "abort" | "archive" | "run_now", done: string) {
    setPending(action);
    const result = await apiRequest<{ run?: RunResult }>(`/api/v1/emailer_campaigns/${sequenceId}/${action}`, {
      method: "POST",
    });
    setPending(null);
    if (!result.ok) {
      toast.error(result.error);
      return false;
    }
    toast.success(result.data.run ? describeRun(result.data.run) : done);
    router.refresh();
    return true;
  }

  if (!canLaunch && !canDelete) return null;
  return (
    <>
      {canLaunch && status === "active" ? (
        <>
          <Button size="sm" variant="outline" disabled={pending !== null} onClick={() => call("run_now", "Done.")}>
            <Zap data-icon="inline-start" aria-hidden="true" />
            {pending === "run_now" ? "Running…" : "Run now"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={pending !== null}
            onClick={() => call("abort", "Sequence paused.")}
          >
            <Pause data-icon="inline-start" aria-hidden="true" />
            {pending === "abort" ? "Pausing…" : "Pause"}
          </Button>
        </>
      ) : null}
      {canLaunch && (status === "draft" || status === "paused") ? (
        <Button size="sm" disabled={pending !== null} onClick={() => call("approve", "Sequence activated.")}>
          <Play data-icon="inline-start" aria-hidden="true" />
          {pending === "approve" ? "Activating…" : "Activate"}
        </Button>
      ) : null}
      {canLaunch && status !== "archived" ? (
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button size="sm" variant="ghost" disabled={pending !== null}>
              <Archive data-icon="inline-start" aria-hidden="true" />
              Archive
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Archive this sequence?</AlertDialogTitle>
              <AlertDialogDescription>
                Sending stops and everyone still in it is marked finished. Messages waiting for review won't be sent.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel size="sm">Cancel</AlertDialogCancel>
              <Button size="sm" onClick={() => call("archive", "Sequence archived.")}>
                <Archive data-icon="inline-start" aria-hidden="true" />
                Archive
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      ) : null}
      {canDelete ? (
        <ConfirmDeleteDialog
          title="Delete this sequence?"
          description={`"${sequenceName}", its steps and enrollments are deleted. Sent messages stay in the outbound log.`}
          onConfirm={async () => {
            const result = await apiRequest(`/api/v1/emailer_campaigns/${sequenceId}`, { method: "DELETE" });
            if (!result.ok) return result.error;
            toast.success("Sequence deleted.");
            router.push("/dashboard/sequences");
            router.refresh();
            return null;
          }}
        />
      ) : null}
    </>
  );
}
