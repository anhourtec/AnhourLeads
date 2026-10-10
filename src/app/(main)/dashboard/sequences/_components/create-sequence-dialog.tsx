"use client";

import { useState } from "react";

import { useRouter } from "next/navigation";

import { Plus } from "lucide-react";
import { toast } from "sonner";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";

import { apiRequest } from "../../_components/records/api-client";

export interface MailboxOption {
  id: string;
  email: string;
  readyToSend: boolean;
}

/** Create a draft sequence with a first email step to edit. */
export function CreateSequenceDialog({ mailboxes }: { mailboxes: MailboxOption[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [mailboxId, setMailboxId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim()) {
      setError("Name the sequence.");
      return;
    }
    setPending(true);
    setError(null);
    const result = await apiRequest<{ emailer_campaign: { id: string } }>("/api/v1/emailer_campaigns", {
      body: {
        name: name.trim(),
        mailboxId: mailboxId || null,
        steps: [
          {
            type: "auto_email",
            waitDays: 0,
            subject: "Quick question, {{first_name}}",
            body: "Hi {{first_name}},\n\n",
          },
        ],
      },
    });
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setOpen(false);
    toast.success("Sequence created as a draft.");
    router.push(`/dashboard/sequences/${result.data.emailer_campaign.id}`);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setName("");
          setMailboxId(mailboxes.find((m) => m.readyToSend)?.id ?? "");
          setError(null);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus data-icon="inline-start" aria-hidden="true" />
          Create sequence
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} noValidate className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Create sequence</DialogTitle>
            <DialogDescription>
              It starts as a draft with one email step. Nothing sends until you activate it.
            </DialogDescription>
          </DialogHeader>
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          <FieldGroup className="gap-4">
            <Field className="gap-1.5">
              <FieldLabel htmlFor="sequence-name">Name</FieldLabel>
              <Input
                id="sequence-name"
                value={name}
                maxLength={120}
                onChange={(e) => setName(e.target.value)}
                autoFocus
              />
            </Field>
            <Field className="gap-1.5">
              <FieldLabel htmlFor="sequence-mailbox">Send from</FieldLabel>
              <NativeSelect
                id="sequence-mailbox"
                className="w-full"
                value={mailboxId}
                onChange={(e) => setMailboxId(e.target.value)}
              >
                <NativeSelectOption value="">Choose later</NativeSelectOption>
                {mailboxes.map((m) => (
                  <NativeSelectOption key={m.id} value={m.id}>
                    {m.email}
                    {m.readyToSend ? "" : " (needs setup)"}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
              <FieldDescription className="text-xs">
                Every message is held for review until you change the review mode in settings.
              </FieldDescription>
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button type="button" variant="outline" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={pending}>
              <Plus data-icon="inline-start" aria-hidden="true" />
              {pending ? "Creating…" : "Create sequence"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
