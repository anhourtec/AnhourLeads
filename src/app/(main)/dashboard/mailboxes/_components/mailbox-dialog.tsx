"use client";

import { useMemo, useState } from "react";

import { useRouter } from "next/navigation";

import { Pencil, Plus, Save } from "lucide-react";
import { toast } from "sonner";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { Textarea } from "@/components/ui/textarea";

import { apiRequest } from "../../_components/records/api-client";
import { TestConnectionButton } from "./test-connection-button";
import { type Mailbox, PROVIDER_LABELS, SECURITY_LABELS } from "./types";

interface FormState {
  email: string;
  displayName: string;
  provider: Mailbox["provider"];
  status: Mailbox["status"];
  dailyLimit: string;
  sendingWindowStart: string;
  sendingWindowEnd: string;
  timezone: string;
  smtpHost: string;
  smtpPort: string;
  smtpSecure: Mailbox["smtpSecure"];
  smtpUser: string;
  smtpPassword: string;
  clearPassword: boolean;
  postalAddress: string;
  signature: string;
}

function initial(mailbox?: Mailbox): FormState {
  return {
    email: mailbox?.email ?? "",
    displayName: mailbox?.displayName ?? "",
    provider: mailbox?.provider ?? "smtp",
    status: mailbox?.status ?? "active",
    dailyLimit: String(mailbox?.dailyLimit ?? 50),
    sendingWindowStart: mailbox?.sendingWindowStart ?? "09:00",
    sendingWindowEnd: mailbox?.sendingWindowEnd ?? "17:00",
    timezone: mailbox?.timezone ?? "UTC",
    smtpHost: mailbox?.smtpHost ?? "",
    smtpPort: mailbox?.smtpPort ? String(mailbox.smtpPort) : "",
    smtpSecure: mailbox?.smtpSecure ?? "starttls",
    smtpUser: mailbox?.smtpUser ?? "",
    smtpPassword: "",
    clearPassword: false,
    postalAddress: mailbox?.postalAddress ?? "",
    signature: mailbox?.signature ?? "",
  };
}

function timeZones(): string[] {
  try {
    return Intl.supportedValuesOf("timeZone");
  } catch {
    return ["UTC"];
  }
}

/** Add or edit a mailbox. The SMTP password is write-only: it's never shown, only replaced or cleared. */
export function MailboxDialog({
  mode,
  mailbox,
  defaultOpen = false,
}: {
  mode: "create" | "edit";
  mailbox?: Mailbox;
  /** Open on first render (the "Link mailbox" links use /dashboard/mailboxes?new=1). */
  defaultOpen?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(defaultOpen);
  const [form, setForm] = useState<FormState>(() => initial(mailbox));
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const zones = useMemo(timeZones, []);
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((f) => ({ ...f, [key]: value }));
  const submitLabel = mode === "create" ? "Add mailbox" : "Save";
  const idp = mode === "create" ? "new-mailbox" : `mailbox-${mailbox?.id}`;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const body: Record<string, unknown> = {
      email: form.email.trim(),
      displayName: form.displayName.trim() || null,
      provider: form.provider,
      dailyLimit: Number(form.dailyLimit),
      sendingWindowStart: form.sendingWindowStart,
      sendingWindowEnd: form.sendingWindowEnd,
      timezone: form.timezone.trim(),
      smtpHost: form.smtpHost.trim() || null,
      smtpPort: form.smtpPort ? Number(form.smtpPort) : null,
      smtpSecure: form.smtpSecure,
      smtpUser: form.smtpUser.trim() || null,
      postalAddress: form.postalAddress.trim() || null,
      signature: form.signature.trim() || null,
    };
    if (mode === "edit") body.status = form.status;
    if (form.smtpPassword) body.smtpPassword = form.smtpPassword;
    else if (form.clearPassword) body.smtpPassword = null;
    const result = await apiRequest(
      mode === "create" ? "/api/v1/email_accounts" : `/api/v1/email_accounts/${mailbox?.id}`,
      { method: mode === "create" ? "POST" : "PATCH", body },
    );
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    toast.success(mode === "create" ? "Mailbox added." : "Mailbox saved.");
    setOpen(false);
    router.refresh();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setForm(initial(mailbox));
          setError(null);
        }
      }}
    >
      <DialogTrigger asChild>
        {mode === "create" ? (
          <Button size="sm">
            <Plus data-icon="inline-start" aria-hidden="true" />
            Add mailbox
          </Button>
        ) : (
          <Button size="sm" variant="outline">
            <Pencil data-icon="inline-start" aria-hidden="true" />
            Edit
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
        <form onSubmit={submit} noValidate className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{mode === "create" ? "Add mailbox" : "Edit mailbox"}</DialogTitle>
            <DialogDescription>
              Sequences send through this mailbox's SMTP server, inside its sending window and daily limit.
            </DialogDescription>
          </DialogHeader>
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          <FieldGroup className="gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field className="gap-1.5">
                <FieldLabel htmlFor={`${idp}-email`}>Email address</FieldLabel>
                <Input
                  id={`${idp}-email`}
                  type="email"
                  autoComplete="off"
                  className="font-mono"
                  value={form.email}
                  onChange={(e) => set("email", e.target.value)}
                />
              </Field>
              <Field className="gap-1.5">
                <FieldLabel htmlFor={`${idp}-name`}>Sender name</FieldLabel>
                <Input
                  id={`${idp}-name`}
                  value={form.displayName}
                  placeholder="Jordan at Acme"
                  onChange={(e) => set("displayName", e.target.value)}
                />
              </Field>
              <Field className="gap-1.5">
                <FieldLabel htmlFor={`${idp}-provider`}>Provider</FieldLabel>
                <NativeSelect
                  id={`${idp}-provider`}
                  className="w-full"
                  value={form.provider}
                  onChange={(e) => set("provider", e.target.value as Mailbox["provider"])}
                >
                  {(Object.keys(PROVIDER_LABELS) as Mailbox["provider"][]).map((p) => (
                    <NativeSelectOption key={p} value={p}>
                      {PROVIDER_LABELS[p]}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </Field>
              {mode === "edit" ? (
                <Field className="gap-1.5">
                  <FieldLabel htmlFor={`${idp}-status`}>Status</FieldLabel>
                  <NativeSelect
                    id={`${idp}-status`}
                    className="w-full"
                    value={form.status}
                    onChange={(e) => set("status", e.target.value as Mailbox["status"])}
                  >
                    <NativeSelectOption value="active">Active</NativeSelectOption>
                    <NativeSelectOption value="warming">Warming</NativeSelectOption>
                    <NativeSelectOption value="paused">Paused</NativeSelectOption>
                    <NativeSelectOption value="disconnected">Disconnected</NativeSelectOption>
                  </NativeSelect>
                </Field>
              ) : null}
            </div>

            <fieldset className="grid gap-4 sm:grid-cols-2">
              <legend className="mb-2 font-medium text-sm">Sending limits</legend>
              <Field className="gap-1.5">
                <FieldLabel htmlFor={`${idp}-limit`}>Daily limit</FieldLabel>
                <Input
                  id={`${idp}-limit`}
                  type="number"
                  min={1}
                  max={500}
                  inputMode="numeric"
                  className="font-mono"
                  value={form.dailyLimit}
                  onChange={(e) => set("dailyLimit", e.target.value)}
                />
                <FieldDescription className="text-xs">1 to 500 emails a day.</FieldDescription>
              </Field>
              <Field className="gap-1.5">
                <FieldLabel htmlFor={`${idp}-tz`}>Time zone</FieldLabel>
                <Input
                  id={`${idp}-tz`}
                  list={`${idp}-zones`}
                  value={form.timezone}
                  onChange={(e) => set("timezone", e.target.value)}
                />
                <datalist id={`${idp}-zones`}>
                  {zones.map((z) => (
                    <option key={z} value={z} />
                  ))}
                </datalist>
              </Field>
              <Field className="gap-1.5">
                <FieldLabel htmlFor={`${idp}-start`}>Window starts</FieldLabel>
                <Input
                  id={`${idp}-start`}
                  type="time"
                  className="font-mono"
                  value={form.sendingWindowStart}
                  onChange={(e) => set("sendingWindowStart", e.target.value)}
                />
              </Field>
              <Field className="gap-1.5">
                <FieldLabel htmlFor={`${idp}-end`}>Window ends</FieldLabel>
                <Input
                  id={`${idp}-end`}
                  type="time"
                  className="font-mono"
                  value={form.sendingWindowEnd}
                  onChange={(e) => set("sendingWindowEnd", e.target.value)}
                />
              </Field>
            </fieldset>

            <fieldset className="grid gap-4 sm:grid-cols-2">
              <legend className="mb-2 font-medium text-sm">SMTP server</legend>
              <Field className="gap-1.5">
                <FieldLabel htmlFor={`${idp}-host`}>Host</FieldLabel>
                <Input
                  id={`${idp}-host`}
                  className="font-mono"
                  placeholder="smtp.example.com"
                  value={form.smtpHost}
                  onChange={(e) => set("smtpHost", e.target.value)}
                />
              </Field>
              <div className="grid grid-cols-2 gap-4">
                <Field className="gap-1.5">
                  <FieldLabel htmlFor={`${idp}-port`}>Port</FieldLabel>
                  <Input
                    id={`${idp}-port`}
                    type="number"
                    inputMode="numeric"
                    className="font-mono"
                    placeholder="587"
                    value={form.smtpPort}
                    onChange={(e) => set("smtpPort", e.target.value)}
                  />
                </Field>
                <Field className="gap-1.5">
                  <FieldLabel htmlFor={`${idp}-secure`}>Security</FieldLabel>
                  <NativeSelect
                    id={`${idp}-secure`}
                    className="w-full"
                    value={form.smtpSecure}
                    onChange={(e) => set("smtpSecure", e.target.value as Mailbox["smtpSecure"])}
                  >
                    {(Object.keys(SECURITY_LABELS) as Mailbox["smtpSecure"][]).map((s) => (
                      <NativeSelectOption key={s} value={s}>
                        {SECURITY_LABELS[s]}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                </Field>
              </div>
              <Field className="gap-1.5">
                <FieldLabel htmlFor={`${idp}-user`}>Username</FieldLabel>
                <Input
                  id={`${idp}-user`}
                  autoComplete="off"
                  className="font-mono"
                  value={form.smtpUser}
                  onChange={(e) => set("smtpUser", e.target.value)}
                />
              </Field>
              <Field className="gap-1.5">
                <FieldLabel htmlFor={`${idp}-password`}>Password</FieldLabel>
                <Input
                  id={`${idp}-password`}
                  type="password"
                  autoComplete="new-password"
                  value={form.smtpPassword}
                  placeholder={mailbox?.hasPassword ? `Saved, ends in ${mailbox.passwordHint ?? "…"}` : ""}
                  onChange={(e) => set("smtpPassword", e.target.value)}
                />
                <FieldDescription className="text-xs">
                  {mailbox?.hasPassword ? "Leave empty to keep the saved password. " : ""}
                  Stored encrypted and never shown again.
                </FieldDescription>
                {mailbox?.hasPassword ? (
                  <Field orientation="horizontal" className="gap-2">
                    <Checkbox
                      id={`${idp}-clear-password`}
                      checked={form.clearPassword}
                      disabled={Boolean(form.smtpPassword)}
                      onCheckedChange={(v) => set("clearPassword", v === true)}
                    />
                    <FieldLabel htmlFor={`${idp}-clear-password`} className="font-normal text-xs">
                      Remove the saved password
                    </FieldLabel>
                  </Field>
                ) : null}
              </Field>
            </fieldset>

            <Field className="gap-1.5">
              <FieldLabel htmlFor={`${idp}-address`}>Postal address</FieldLabel>
              <Textarea
                id={`${idp}-address`}
                rows={2}
                value={form.postalAddress}
                placeholder="Business name, street, city, postcode, country"
                onChange={(e) => set("postalAddress", e.target.value)}
              />
              <FieldDescription className="text-xs">
                Added to the footer of every message (CAN-SPAM, CASL). Required before an active sequence can use this
                mailbox.
              </FieldDescription>
            </Field>
            <Field className="gap-1.5">
              <FieldLabel htmlFor={`${idp}-signature`}>Signature</FieldLabel>
              <Textarea
                id={`${idp}-signature`}
                rows={3}
                value={form.signature}
                maxLength={2000}
                placeholder={"Jordan Lee\nHead of growth, Acme"}
                onChange={(e) => set("signature", e.target.value)}
              />
              <FieldDescription className="text-xs">
                Plain text added above the footer of every email from this mailbox. Required when the workspace's
                sending protection asks for signatures.
              </FieldDescription>
            </Field>
          </FieldGroup>
          <DialogFooter className="flex-wrap gap-2">
            {mode === "edit" && mailbox ? (
              <TestConnectionButton mailboxId={mailbox.id} disabled={!mailbox.smtpHost} />
            ) : null}
            <Button type="button" variant="outline" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={pending}>
              {mode === "create" ? (
                <Plus data-icon="inline-start" aria-hidden="true" />
              ) : (
                <Save data-icon="inline-start" aria-hidden="true" />
              )}
              {pending ? "Saving…" : submitLabel}
            </Button>
          </DialogFooter>
          {mode === "edit" ? (
            <p className="text-muted-foreground text-xs">
              Test connection uses the saved settings. Save changes first.
            </p>
          ) : null}
        </form>
      </DialogContent>
    </Dialog>
  );
}
