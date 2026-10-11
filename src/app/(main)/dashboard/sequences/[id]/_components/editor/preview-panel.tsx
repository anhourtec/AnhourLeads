"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { cn } from "cn";
import { Monitor, RefreshCw, Smartphone } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

import { apiRequest } from "../../../../_components/records/api-client";

interface ContactOption {
  id: string;
  name: string;
  email: string | null;
}

interface Preview {
  subject: string;
  body: string;
  signature: string | null;
  from: string | null;
  to: string | null;
  missing: string[];
}

async function enrolledContacts(sequenceId: string): Promise<ContactOption[]> {
  const res = await apiRequest<{ enrollments: { contact: ContactOption }[] }>(
    `/api/v1/emailer_campaigns/${sequenceId}/enrollments?per_page=50`,
  );
  return res.ok ? res.data.enrollments.map((e) => e.contact) : [];
}

/** "Preview for a contact": renders the subject and body with a real contact's merge values. */
export function PreviewPanel({
  sequenceId,
  subject,
  body,
  stepLabel,
}: {
  sequenceId: string;
  subject: string;
  body: string;
  stepLabel: string;
}) {
  const [contacts, setContacts] = useState<ContactOption[] | null>(null);
  const [contactId, setContactId] = useState("");
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // The latest text, read on refresh so typing doesn't re-render the preview on every keystroke.
  const text = useRef({ subject, body });
  text.current = { subject, body };

  useEffect(() => {
    let cancelled = false;
    void enrolledContacts(sequenceId).then((list) => {
      if (cancelled) return;
      setContacts(list);
      setContactId((current) => current || list[0]?.id || "");
    });
    return () => {
      cancelled = true;
    };
  }, [sequenceId]);

  const refresh = useCallback(async () => {
    if (!contactId) return;
    setLoading(true);
    setError(null);
    const res = await apiRequest<{ preview: Preview }>(`/api/v1/emailer_campaigns/${sequenceId}/preview`, {
      body: { contactId, subject: text.current.subject, body: text.current.body },
    });
    setLoading(false);
    if (res.ok) setPreview(res.data.preview);
    else setError(res.error);
  }, [sequenceId, contactId]);

  // Render again when the contact changes; edits refresh on demand.
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const selectId = `preview-contact-${stepLabel.replace(/\W+/g, "-")}`;
  return (
    <section
      aria-label={`Preview for a contact, ${stepLabel}`}
      className="flex min-w-0 flex-col gap-3 rounded-xl border bg-muted/40 p-3"
    >
      <h4 className="font-medium text-sm">Preview for a contact</h4>
      <div className="flex flex-wrap items-end gap-2">
        <Field className="min-w-0 flex-1 gap-1.5">
          <FieldLabel htmlFor={selectId} className="text-xs">
            Contact
          </FieldLabel>
          <NativeSelect
            id={selectId}
            size="sm"
            className="w-full"
            value={contactId}
            disabled={!contacts?.length}
            onChange={(e) => setContactId(e.target.value)}
          >
            {contacts?.length ? null : <NativeSelectOption value="">No contacts yet</NativeSelectOption>}
            {contacts?.map((c) => (
              <NativeSelectOption key={c.id} value={c.id}>
                {c.name}
                {c.email ? ` (${c.email})` : ""}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Field>
        <Button size="sm" variant="outline" onClick={() => void refresh()} disabled={!contactId || loading}>
          <RefreshCw data-icon="inline-start" aria-hidden="true" />
          {loading ? "Refreshing…" : "Refresh"}
        </Button>
        <ToggleGroup
          type="single"
          size="sm"
          variant="outline"
          spacing={0}
          value={device}
          onValueChange={(v) => v && setDevice(v as "desktop" | "mobile")}
          aria-label="Preview width"
        >
          <ToggleGroupItem value="desktop" aria-label="Desktop width">
            <Monitor aria-hidden="true" />
          </ToggleGroupItem>
          <ToggleGroupItem value="mobile" aria-label="Mobile width">
            <Smartphone aria-hidden="true" />
          </ToggleGroupItem>
        </ToggleGroup>
      </div>
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {contacts && !contacts.length ? (
        <p className="py-6 text-center text-muted-foreground text-sm">
          Add contacts to the sequence to preview how emails read for real people.
        </p>
      ) : null}
      {preview ? (
        <div
          data-testid="email-preview"
          className={cn(
            "mx-auto flex w-full min-w-0 flex-col gap-2 rounded-lg border bg-card p-3 text-sm",
            device === "mobile" && "max-w-[22rem]",
          )}
        >
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 gap-y-0.5 text-xs">
            <dt className="text-muted-foreground">From</dt>
            <dd className="truncate font-mono">{preview.from ?? "No mailbox yet"}</dd>
            <dt className="text-muted-foreground">To</dt>
            <dd className="truncate font-mono">{preview.to ?? "No email"}</dd>
          </dl>
          <p className="break-words font-medium">{preview.subject || "(no subject)"}</p>
          <p className="whitespace-pre-wrap break-words">{preview.body}</p>
          {preview.signature ? (
            <p className="whitespace-pre-wrap break-words text-muted-foreground">{preview.signature}</p>
          ) : null}
          {preview.missing.length ? (
            <p className="text-amber-700 text-xs dark:text-amber-400">
              This contact has no value for {preview.missing.map((m) => `{{${m}}}`).join(", ")}, so the email would be
              held back.
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
