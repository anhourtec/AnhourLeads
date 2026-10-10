"use client";

import { useState } from "react";

import { useRouter } from "next/navigation";

import { Plus, ShieldBan } from "lucide-react";
import { toast } from "sonner";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { apiFetch } from "@/lib/api-fetch";
import { SUPPRESSION_REASON_LABELS } from "@/lib/pipeline-constants";

const REASONS = ["manual", "unsubscribed", "bounced", "complaint"] as const;

interface CreateResponse {
  created: boolean;
  suppression: { value: string };
  affected: { contacts: number; enrollments: number };
}

export function AddEntryDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});

  async function submit(form: FormData) {
    setPending(true);
    setError(null);
    setFields({});
    const note = String(form.get("note") ?? "").trim();
    const res = await apiFetch<CreateResponse>("/api/v1/suppressions", {
      body: {
        value: String(form.get("value") ?? ""),
        reason: String(form.get("reason")),
        note: note ? note : undefined,
      },
    });
    setPending(false);
    if (!res.ok) {
      setError(res.error);
      setFields(res.fields);
      return;
    }
    const { created, suppression, affected } = res.data;
    if (!created) toast.info(`${suppression.value} is already on the list`);
    else if (affected.contacts) {
      toast.success(
        `Added ${suppression.value}. ${affected.contacts} ${affected.contacts === 1 ? "person" : "people"} marked do not contact.`,
      );
    } else toast.success(`Added ${suppression.value}`);
    setOpen(false);
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !pending && setOpen(next)}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus data-icon="inline-start" />
          Add entry
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add to do not contact</DialogTitle>
          <DialogDescription>Block one email address, or a whole domain such as example.com.</DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void submit(new FormData(event.currentTarget));
          }}
        >
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          <FieldGroup className="gap-4">
            <Field data-invalid={Boolean(fields.value)}>
              <FieldLabel htmlFor="dnc-value">Email or domain</FieldLabel>
              <Input
                id="dnc-value"
                name="value"
                required
                autoComplete="off"
                className="font-mono"
                placeholder="name@example.com or example.com"
                aria-invalid={Boolean(fields.value)}
              />
              {fields.value ? <FieldError>{fields.value}</FieldError> : null}
            </Field>
            <Field>
              <FieldLabel htmlFor="dnc-reason">Reason</FieldLabel>
              <NativeSelect id="dnc-reason" name="reason" defaultValue="manual" className="w-full">
                {REASONS.map((r) => (
                  <NativeSelectOption key={r} value={r}>
                    {SUPPRESSION_REASON_LABELS[r]}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Field>
            <Field>
              <FieldLabel htmlFor="dnc-note">Note</FieldLabel>
              <Input id="dnc-note" name="note" maxLength={500} placeholder="Optional" />
              <FieldDescription>Visible to everyone who can see this list.</FieldDescription>
            </Field>
          </FieldGroup>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline" size="sm" disabled={pending}>
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" size="sm" disabled={pending}>
              <ShieldBan data-icon="inline-start" />
              {pending ? "Adding…" : "Add to list"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
