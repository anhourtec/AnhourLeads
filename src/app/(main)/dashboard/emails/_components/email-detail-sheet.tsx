"use client";

import { useCallback, useEffect, useState } from "react";

import Link from "next/link";
import { useRouter } from "next/navigation";

import { Check, Send, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { apiFetch } from "@/lib/api-fetch";
import { formatDateTime } from "@/lib/format-display";
import type { MessageDetail } from "@/server/services/emails";

import { MessageStatus } from "./message-status";

/** Right-hand drawer with the rendered email, its headers and its timeline. */
export function EmailDetailSheet({
  messageId,
  onClose,
  canLaunch,
}: {
  messageId: string | null;
  onClose: () => void;
  canLaunch: boolean;
}) {
  const router = useRouter();
  const [detail, setDetail] = useState<MessageDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (id: string, isCancelled: () => boolean = () => false) => {
    const res = await apiFetch<{ emailer_message: MessageDetail }>(`/api/v1/emailer_messages/${id}`);
    if (isCancelled()) return;
    if (res.ok) setDetail(res.data.emailer_message);
    else setError(res.error);
  }, []);

  useEffect(() => {
    if (!messageId) return;
    let cancelled = false;
    setDetail(null);
    setError(null);
    void load(messageId, () => cancelled);
    return () => {
      cancelled = true;
    };
  }, [messageId, load]);

  async function act(path: string, method: "POST" | "DELETE", done: string) {
    if (!detail) return;
    setBusy(true);
    const res = await apiFetch(`/api/v1/emailer_messages/${detail.id}${path}`, { method });
    setBusy(false);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    toast.success(done);
    router.refresh();
    if (method === "DELETE") onClose();
    else void load(detail.id);
  }

  const unsent = detail ? ["pending_review", "queued", "failed"].includes(detail.status) : false;

  return (
    <Sheet open={messageId !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full gap-0 overflow-y-auto sm:max-w-xl">
        <SheetHeader className="border-b">
          <SheetTitle className="break-words pr-6">{detail?.subject ?? "Email"}</SheetTitle>
          <SheetDescription className="font-mono text-xs">{detail?.toEmail ?? "Loading…"}</SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-4 p-4">
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          {!detail && !error ? (
            <div className="flex flex-col gap-2">
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-40 w-full" />
            </div>
          ) : null}
          {detail ? (
            <>
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <MessageStatus message={detail} />
                {detail.sequence ? (
                  <Link
                    href={`/dashboard/sequences/${detail.sequence.id}`}
                    className="text-muted-foreground underline-offset-4 hover:underline"
                  >
                    {detail.sequence.name} · step {detail.stepPosition ?? "?"}
                    {detail.variantLabel ? ` · version ${detail.variantLabel}` : ""}
                  </Link>
                ) : (
                  <span className="text-muted-foreground">One-off email</span>
                )}
              </div>
              {detail.blockedReason ? (
                <Alert>
                  <AlertDescription>{detail.blockedReason}</AlertDescription>
                </Alert>
              ) : null}
              {detail.error ? (
                <Alert variant="destructive">
                  <AlertDescription>{detail.error}</AlertDescription>
                </Alert>
              ) : null}
              {canLaunch && unsent ? (
                <div className="flex flex-wrap gap-2">
                  {detail.status === "pending_review" ? (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() => void act("/approve", "POST", "Approved")}
                    >
                      <Check data-icon="inline-start" aria-hidden="true" />
                      Approve
                    </Button>
                  ) : null}
                  <Button size="sm" disabled={busy} onClick={() => void act("/send_now", "POST", "Send attempted")}>
                    <Send data-icon="inline-start" aria-hidden="true" />
                    Send now
                  </Button>
                  {detail.sequence ? null : (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      onClick={() => void act("", "DELETE", "Email discarded")}
                    >
                      <Trash2 data-icon="inline-start" aria-hidden="true" />
                      Discard
                    </Button>
                  )}
                </div>
              ) : null}
              <section aria-label="Message" className="flex flex-col gap-2">
                <h3 className="font-medium text-sm">Message</h3>
                <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-lg border bg-muted/40 p-3 font-sans text-sm">
                  {detail.body}
                </pre>
              </section>
              <Separator />
              <section aria-label="Headers" className="flex flex-col gap-2">
                <h3 className="font-medium text-sm">Headers</h3>
                <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
                  {detail.headers.map((h) => (
                    <div key={h.name} className="contents">
                      <dt className="text-muted-foreground">{h.name}</dt>
                      <dd className="break-all font-mono">{h.value}</dd>
                    </div>
                  ))}
                </dl>
              </section>
              <Separator />
              <section aria-label="Timeline" className="flex flex-col gap-2">
                <h3 className="font-medium text-sm">Timeline</h3>
                <ol className="flex flex-col gap-2 border-l pl-3">
                  {detail.events.map((e) => (
                    <li key={e.id} className="flex flex-col">
                      <span className="text-sm">{e.summary}</span>
                      <time className="text-muted-foreground text-xs" dateTime={e.occurredAt}>
                        {formatDateTime(e.occurredAt)}
                      </time>
                    </li>
                  ))}
                </ol>
              </section>
            </>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}
