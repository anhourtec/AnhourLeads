"use client";

import { useState } from "react";

import { useRouter } from "next/navigation";

import { formatDistanceToNow } from "date-fns";
import { Check, Inbox, Send } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import type { MessageView } from "@/server/services/sending";

import { MessageStatusPill } from "../../../_components/engage/tone-pill";
import { apiRequest } from "../../../_components/records/api-client";

function MessageCard({
  message,
  canLaunch,
  sequenceActive,
  busy,
  onAct,
}: {
  message: MessageView;
  canLaunch: boolean;
  sequenceActive: boolean;
  busy: boolean;
  onAct: (id: string, action: "approve" | "send_now") => void;
}) {
  const reason = message.blockedReason ?? message.error;
  return (
    <Card className="min-w-0 gap-3 py-4">
      <CardHeader className="px-4">
        <CardTitle className="truncate text-sm" title={message.subject}>
          {message.subject}
        </CardTitle>
        <CardDescription className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs">
          <span className="truncate font-mono">{message.toEmail}</span>
          {message.stepPosition ? <span>Step {message.stepPosition}</span> : null}
          <span title={new Date(message.createdAt).toLocaleString()}>
            {formatDistanceToNow(new Date(message.createdAt), { addSuffix: true })}
          </span>
        </CardDescription>
        <CardAction>
          <MessageStatusPill status={message.status} />
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 px-4">
        {reason ? <p className="text-destructive text-xs">{reason}</p> : null}
        <details className="group rounded-lg border bg-muted/30">
          <summary className="cursor-pointer px-3 py-2 text-muted-foreground text-xs">Show message</summary>
          <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words px-3 pb-3 font-sans text-sm">
            {message.body}
          </pre>
        </details>
        {canLaunch && message.status !== "blocked" ? (
          <div className="flex flex-wrap gap-2">
            {message.status === "pending_review" ? (
              <Button size="sm" disabled={busy} onClick={() => onAct(message.id, "approve")}>
                <Check data-icon="inline-start" aria-hidden="true" />
                Approve
              </Button>
            ) : null}
            <Button
              size="sm"
              variant="outline"
              disabled={busy || !sequenceActive}
              title={sequenceActive ? undefined : "Activate the sequence to send"}
              onClick={() => onAct(message.id, "send_now")}
            >
              <Send data-icon="inline-start" aria-hidden="true" />
              {message.status === "failed" ? "Retry now" : "Send now"}
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

/** Messages held for review, plus recent blocked and failed ones with the reason. */
export function ReviewQueue({
  pending,
  pendingTotal,
  attention,
  canLaunch,
  sequenceActive,
}: {
  pending: MessageView[];
  pendingTotal: number;
  attention: MessageView[];
  canLaunch: boolean;
  sequenceActive: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);

  async function act(id: string, action: "approve" | "send_now") {
    setBusy(id);
    const result = await apiRequest<{ emailer_message: MessageView }>(`/api/v1/emailer_messages/${id}/${action}`, {
      method: "POST",
    });
    setBusy(null);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    const status = result.data.emailer_message.status;
    if (action === "approve") toast.success("Approved. It sends at the next run inside the sending window.");
    else if (status === "sent") toast.success("Sent.");
    else toast.error(result.data.emailer_message.blockedReason ?? result.data.emailer_message.error ?? "Not sent.");
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3" aria-labelledby="review-heading">
        <div className="flex flex-col gap-1">
          <h2 id="review-heading" className="font-medium text-base">
            Waiting for review
          </h2>
          <p className="text-muted-foreground text-sm">
            {pendingTotal > pending.length
              ? `Showing the latest ${pending.length} of ${pendingTotal}.`
              : "Approve a message to send it inside the mailbox's window, or send it now."}
          </p>
        </div>
        {pending.length === 0 ? (
          <Empty className="border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Inbox aria-hidden="true" />
              </EmptyMedia>
              <EmptyTitle>Nothing to review</EmptyTitle>
              <EmptyDescription>Messages held by the review mode appear here before they're sent.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <div className="grid gap-3 xl:grid-cols-2">
            {pending.map((m) => (
              <MessageCard
                key={m.id}
                message={m}
                canLaunch={canLaunch}
                sequenceActive={sequenceActive}
                busy={busy === m.id}
                onAct={act}
              />
            ))}
          </div>
        )}
      </section>
      {attention.length ? (
        <section className="flex flex-col gap-3" aria-labelledby="attention-heading">
          <div className="flex flex-col gap-1">
            <h2 id="attention-heading" className="font-medium text-base">
              Blocked or failed
            </h2>
            <p className="text-muted-foreground text-sm">These weren't sent. The reason is shown on each one.</p>
          </div>
          <div className="grid gap-3 xl:grid-cols-2">
            {attention.map((m) => (
              <MessageCard
                key={m.id}
                message={m}
                canLaunch={canLaunch}
                sequenceActive={sequenceActive}
                busy={busy === m.id}
                onAct={act}
              />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
