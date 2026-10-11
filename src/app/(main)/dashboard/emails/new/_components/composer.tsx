"use client";

import { useRef, useState } from "react";

import Link from "next/link";
import { useRouter } from "next/navigation";

import { CalendarClock, Send, X } from "lucide-react";
import { toast } from "sonner";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { apiFetch } from "@/lib/api-fetch";
import type { MessageView } from "@/server/services/emails";

import { type Association, AssociationPicker } from "../../../_components/engage/association-picker";
import {
  insertAtCursor,
  MergeFieldPicker,
  SnippetPicker,
  TemplatePicker,
} from "../../../_components/engage/insert-pickers";

interface MailboxOption {
  id: string;
  email: string;
  readyToSend: boolean;
  issue: string | null;
}

const NOT_SENT_PREFIX: Record<string, string> = {
  blocked: "The email wasn't sent",
  failed: "Sending failed",
  bounced: "The email bounced",
};

/** One-off email: queued through the API, then sent now or at the chosen time. */
export function Composer({ mailboxes, initialTo }: { mailboxes: MailboxOption[]; initialTo: Association | null }) {
  const router = useRouter();
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const ready = mailboxes.filter((m) => m.readyToSend);
  const [mailboxId, setMailboxId] = useState(ready[0]?.id ?? "");
  const [to, setTo] = useState<Association | null>(initialTo);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [scheduling, setScheduling] = useState(false);
  const [scheduledAt, setScheduledAt] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(mode: "now" | "schedule") {
    setError(null);
    if (!mailboxId) return setError("Pick a mailbox to send from.");
    if (!to) return setError("Choose who to send it to.");
    if (!subject.trim()) return setError("Add a subject.");
    if (!body.trim()) return setError("Write the email.");
    if (mode === "schedule" && !scheduledAt) return setError("Pick when to send it.");
    setPending(true);
    const created = await apiFetch<{ emailer_message: MessageView }>("/api/v1/emailer_messages", {
      body: {
        mailboxId,
        contactId: to.id,
        subject: subject.trim(),
        body,
        ...(mode === "schedule" ? { scheduledAt: new Date(scheduledAt).toISOString() } : {}),
      },
    });
    if (!created.ok) {
      setPending(false);
      setError(created.error);
      return;
    }
    const id = created.data.emailer_message.id;
    if (mode === "schedule") {
      setPending(false);
      toast.success("Email scheduled.");
      router.push("/dashboard/emails?status=scheduled");
      return;
    }
    const sent = await apiFetch<{ emailer_message: MessageView }>(`/api/v1/emailer_messages/${id}/send_now`, {
      body: {},
    });
    setPending(false);
    if (!sent.ok) {
      setError(`${sent.error} The email is saved under Scheduled; you can send or discard it there.`);
      return;
    }
    const message = sent.data.emailer_message;
    if (message.status !== "sent") {
      const why = message.blockedReason ?? message.error ?? "Check the email's details.";
      setError(`${NOT_SENT_PREFIX[message.status] ?? "The email wasn't sent"}: ${why}`);
      return;
    }
    toast.success(`Email sent to ${message.toEmail}.`);
    router.push("/dashboard/emails");
  }

  const insert = (text: string) => {
    const next = insertAtCursor(bodyRef.current, body, text);
    setBody(next.value);
  };

  return (
    <Card className="max-w-3xl">
      <CardContent>
        <form
          noValidate
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void submit(scheduling ? "schedule" : "now");
          }}
        >
          {ready.length === 0 ? (
            <Alert>
              <AlertDescription>
                No mailbox is ready to send.{" "}
                <Link href="/dashboard/mailboxes?new=1" className="font-medium underline underline-offset-4">
                  Link a mailbox
                </Link>{" "}
                first.
              </AlertDescription>
            </Alert>
          ) : null}
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          <FieldGroup className="gap-4">
            <Field className="gap-1.5">
              <FieldLabel htmlFor="compose-from">From</FieldLabel>
              <NativeSelect
                id="compose-from"
                className="w-full"
                value={mailboxId}
                onChange={(e) => setMailboxId(e.target.value)}
              >
                {ready.length === 0 ? <NativeSelectOption value="">No mailbox ready</NativeSelectOption> : null}
                {mailboxes.map((m) => (
                  <NativeSelectOption key={m.id} value={m.id} disabled={!m.readyToSend}>
                    {m.email}
                    {m.readyToSend ? "" : " (needs setup)"}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Field>
            <Field className="gap-1.5">
              <FieldLabel htmlFor="compose-to">To</FieldLabel>
              <AssociationPicker
                id="compose-to"
                value={to}
                onChange={setTo}
                kinds={["contact"]}
                placeholder="Search contacts"
              />
              {to?.detail ? <FieldDescription className="font-mono text-xs">{to.detail}</FieldDescription> : null}
            </Field>
            <Field className="gap-1.5">
              <FieldLabel htmlFor="compose-subject">Subject</FieldLabel>
              <Input
                id="compose-subject"
                value={subject}
                maxLength={300}
                onChange={(e) => setSubject(e.target.value)}
              />
            </Field>
            <Field className="gap-1.5">
              <FieldLabel htmlFor="compose-body">Body</FieldLabel>
              <div className="flex flex-wrap gap-2">
                <MergeFieldPicker onPick={insert} />
                <SnippetPicker onPick={insert} label="Insert snippet" />
                <TemplatePicker
                  onPick={(t) => {
                    if (t.subject) setSubject(t.subject);
                    setBody(t.body);
                  }}
                />
              </div>
              <Textarea
                id="compose-body"
                ref={bodyRef}
                rows={12}
                value={body}
                maxLength={20000}
                onChange={(e) => setBody(e.target.value)}
              />
              <FieldDescription className="text-xs">
                Merge fields fill in for the contact. Your signature, sender details and an unsubscribe link are added
                below the body.
              </FieldDescription>
            </Field>
            {scheduling ? (
              <Field className="gap-1.5">
                <FieldLabel htmlFor="compose-when">Send at</FieldLabel>
                <Input
                  id="compose-when"
                  type="datetime-local"
                  className="w-full sm:w-64"
                  value={scheduledAt}
                  onChange={(e) => setScheduledAt(e.target.value)}
                />
                <FieldDescription className="text-xs">
                  Sent within a minute of this time, as long as the mailbox has room in its daily limit.
                </FieldDescription>
              </Field>
            ) : null}
          </FieldGroup>
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" size="sm" variant="ghost" asChild>
              <Link href="/dashboard/emails">
                <X data-icon="inline-start" aria-hidden="true" />
                Cancel
              </Link>
            </Button>
            {scheduling ? (
              <>
                <Button type="button" size="sm" variant="outline" onClick={() => setScheduling(false)}>
                  Send now instead
                </Button>
                <Button type="submit" size="sm" disabled={pending}>
                  <CalendarClock data-icon="inline-start" aria-hidden="true" />
                  {pending ? "Scheduling…" : "Schedule email"}
                </Button>
              </>
            ) : (
              <>
                <Button type="button" size="sm" variant="outline" onClick={() => setScheduling(true)}>
                  <CalendarClock data-icon="inline-start" aria-hidden="true" />
                  Schedule
                </Button>
                <Button type="submit" size="sm" disabled={pending}>
                  <Send data-icon="inline-start" aria-hidden="true" />
                  {pending ? "Sending…" : "Send now"}
                </Button>
              </>
            )}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
