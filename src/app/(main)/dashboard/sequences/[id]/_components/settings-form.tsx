"use client";

import { useState } from "react";

import { useRouter } from "next/navigation";

import { Save } from "lucide-react";
import { toast } from "sonner";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Field, FieldContent, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Switch } from "@/components/ui/switch";
import type { MailboxView } from "@/server/services/mailboxes";
import type { SequenceView } from "@/server/services/sequences";

import { apiRequest } from "../../../_components/records/api-client";

const REVIEW_MODES = {
  all: "Review every message",
  first_step: "Review the first email only",
  none: "Send without review",
} as const;

type ReviewMode = keyof typeof REVIEW_MODES;

export function SettingsForm({
  sequence,
  mailboxes,
  canEdit,
}: {
  sequence: SequenceView;
  mailboxes: MailboxView[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [name, setName] = useState(sequence.name);
  const [mailboxId, setMailboxId] = useState(sequence.mailboxId ?? "");
  const [reviewMode, setReviewMode] = useState<ReviewMode>(sequence.reviewMode);
  const [stopOnReply, setStopOnReply] = useState(sequence.stopOnReply);
  const [trackOpens, setTrackOpens] = useState(sequence.trackOpens);
  const [trackClicks, setTrackClicks] = useState(sequence.trackClicks);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const current = sequence.mailbox
    ? [{ id: sequence.mailbox.id, email: sequence.mailbox.email, readyToSend: sequence.mailbox.readyToSend }]
    : [];
  const options = mailboxes.length ? mailboxes : current;

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    const result = await apiRequest(`/api/v1/emailer_campaigns/${sequence.id}`, {
      method: "PATCH",
      body: { name: name.trim(), mailboxId: mailboxId || null, reviewMode, stopOnReply, trackOpens, trackClicks },
    });
    setSaving(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    toast.success("Settings saved.");
    router.refresh();
  }

  return (
    <form onSubmit={save} noValidate className="max-w-2xl">
      <Card>
        <CardContent className="flex flex-col gap-5">
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          <FieldGroup className="gap-5">
            <Field className="gap-1.5">
              <FieldLabel htmlFor="settings-name">Name</FieldLabel>
              <Input
                id="settings-name"
                value={name}
                maxLength={120}
                disabled={!canEdit}
                onChange={(e) => setName(e.target.value)}
              />
            </Field>
            <Field className="gap-1.5">
              <FieldLabel htmlFor="settings-mailbox">Send from</FieldLabel>
              <NativeSelect
                id="settings-mailbox"
                className="w-full"
                value={mailboxId}
                disabled={!canEdit}
                onChange={(e) => setMailboxId(e.target.value)}
              >
                <NativeSelectOption value="">No mailbox</NativeSelectOption>
                {options.map((m) => (
                  <NativeSelectOption key={m.id} value={m.id}>
                    {m.email}
                    {m.readyToSend ? "" : " (needs setup)"}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
              <FieldDescription className="text-xs">
                Active sequences need a mailbox with SMTP settings and a postal address.
              </FieldDescription>
            </Field>
            <Field className="gap-1.5">
              <FieldLabel htmlFor="settings-review">Review mode</FieldLabel>
              <NativeSelect
                id="settings-review"
                className="w-full"
                value={reviewMode}
                disabled={!canEdit}
                onChange={(e) => setReviewMode(e.target.value as ReviewMode)}
              >
                {(Object.keys(REVIEW_MODES) as ReviewMode[]).map((m) => (
                  <NativeSelectOption key={m} value={m}>
                    {REVIEW_MODES[m]}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
              <FieldDescription className="text-xs">
                Held messages wait in the review queue until someone approves them.
              </FieldDescription>
            </Field>
            <Field orientation="horizontal">
              <FieldContent>
                <FieldLabel htmlFor="settings-stop">Stop on reply</FieldLabel>
                <FieldDescription className="text-xs">
                  When someone replies, they leave the sequence and unsent messages are held back.
                </FieldDescription>
              </FieldContent>
              <Switch id="settings-stop" checked={stopOnReply} disabled={!canEdit} onCheckedChange={setStopOnReply} />
            </Field>
            <Field orientation="horizontal">
              <FieldContent>
                <FieldLabel htmlFor="settings-opens">Track opens</FieldLabel>
                <FieldDescription className="text-xs">
                  Off by default. Open tracking adds a pixel and hurts deliverability.
                </FieldDescription>
              </FieldContent>
              <Switch id="settings-opens" checked={trackOpens} disabled={!canEdit} onCheckedChange={setTrackOpens} />
            </Field>
            <Field orientation="horizontal">
              <FieldContent>
                <FieldLabel htmlFor="settings-clicks">Track clicks</FieldLabel>
                <FieldDescription className="text-xs">Off by default. Click tracking rewrites links.</FieldDescription>
              </FieldContent>
              <Switch id="settings-clicks" checked={trackClicks} disabled={!canEdit} onCheckedChange={setTrackClicks} />
            </Field>
          </FieldGroup>
        </CardContent>
        {canEdit ? (
          <CardFooter className="justify-end">
            <Button type="submit" size="sm" disabled={saving}>
              <Save data-icon="inline-start" aria-hidden="true" />
              {saving ? "Saving…" : "Save settings"}
            </Button>
          </CardFooter>
        ) : null}
      </Card>
    </form>
  );
}
