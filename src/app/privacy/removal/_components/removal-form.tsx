"use client";

import { useState } from "react";

import { Check, Copy, Globe, Mail, RefreshCw, Send } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { apiFetch } from "@/lib/api-fetch";

type Kind = "email" | "domain";

interface CreatedRequest {
  token: string;
  kind: Kind;
  value: string;
  sentTo: string | null;
  txtRecord: string | null;
  expiresAt: string;
}

function DomainProof({ request }: { request: CreatedRequest }) {
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [copied, setCopied] = useState(false);

  async function copy() {
    if (!request.txtRecord) return;
    try {
      await navigator.clipboard.writeText(request.txtRecord);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  async function check() {
    setChecking(true);
    setError(null);
    const res = await apiFetch<{ confirmed: boolean }>("/privacy/removal/verify", {
      body: { token: request.token, method: "dns" },
    });
    setChecking(false);
    if (res.ok) setDone(true);
    else setError(res.error);
  }

  if (done) {
    return (
      <Alert>
        <Check aria-hidden="true" />
        <AlertTitle>{request.value} is removed</AlertTitle>
        <AlertDescription>It has been deleted from the index and won't be added again.</AlertDescription>
      </Alert>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Prove you control {request.value}</CardTitle>
        <CardDescription>
          {request.sentTo
            ? `A confirmation link was sent to ${request.sentTo}. Following it is enough. Or add this DNS record:`
            : "Add this TXT record to the domain's DNS, then check it here. The request is valid for 7 days."}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex min-w-0 items-center gap-2 rounded-md border bg-muted/40 p-2">
          <code className="min-w-0 flex-1 break-all font-mono text-xs" data-testid="txt-record">
            {request.txtRecord}
          </code>
          <Button type="button" size="sm" variant="ghost" onClick={copy} aria-label="Copy the TXT record">
            {copied ? (
              <Check data-icon="inline-start" aria-hidden="true" />
            ) : (
              <Copy data-icon="inline-start" aria-hidden="true" />
            )}
            {copied ? "Copied" : "Copy"}
          </Button>
        </div>
        {error && (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        )}
        <div>
          <Button type="button" size="sm" variant="outline" onClick={check} disabled={checking}>
            <RefreshCw data-icon="inline-start" aria-hidden="true" />
            {checking ? "Checking…" : "Check DNS now"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export function RemovalForm() {
  const [kind, setKind] = useState<Kind>("email");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [created, setCreated] = useState<CreatedRequest | null>(null);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const value = String(data.get("value") ?? "").trim();
    const reason = String(data.get("reason") ?? "").trim();
    const contactEmail = String(data.get("contactEmail") ?? "").trim();
    if (!value) {
      setFields({ value: kind === "email" ? "Enter your email address." : "Enter a domain such as example.com." });
      return;
    }
    setPending(true);
    setError(null);
    setFields({});
    const res = await apiFetch<{ request: CreatedRequest }>("/privacy/removal/submit", {
      body: {
        kind,
        value,
        ...(reason ? { reason } : {}),
        ...(kind === "domain" && contactEmail ? { contactEmail } : {}),
      },
    });
    setPending(false);
    if (res.ok) setCreated(res.data.request);
    else {
      setFields(res.fields);
      if (!Object.keys(res.fields).length) setError(res.error);
    }
  }

  if (created?.kind === "email") {
    return (
      <Alert>
        <Mail aria-hidden="true" />
        <AlertTitle>Check your inbox</AlertTitle>
        <AlertDescription>
          A confirmation link was sent to {created.sentTo}. Nothing is removed until you follow it; it works for 7 days.
        </AlertDescription>
      </Alert>
    );
  }
  if (created) return <DomainProof request={created} />;

  return (
    <form noValidate onSubmit={onSubmit} className="flex flex-col gap-5" aria-label="Removal request">
      <FieldGroup>
        <Field className="gap-1.5">
          <FieldLabel id="kind-label">What should be removed?</FieldLabel>
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            value={kind}
            onValueChange={(v) => {
              if (v === "email" || v === "domain") {
                setKind(v);
                setFields({});
              }
            }}
            aria-labelledby="kind-label"
            className="w-full sm:w-fit"
          >
            <ToggleGroupItem value="email" className="flex-1 sm:flex-none">
              <Mail data-icon="inline-start" aria-hidden="true" />
              An email address
            </ToggleGroupItem>
            <ToggleGroupItem value="domain" className="flex-1 sm:flex-none">
              <Globe data-icon="inline-start" aria-hidden="true" />A whole domain
            </ToggleGroupItem>
          </ToggleGroup>
        </Field>
        <Field className="gap-1.5" data-invalid={Boolean(fields.value) || undefined}>
          <FieldLabel htmlFor="removal-value">{kind === "email" ? "Email address" : "Domain"}</FieldLabel>
          <Input
            id="removal-value"
            name="value"
            key={kind}
            type={kind === "email" ? "email" : "text"}
            inputMode={kind === "email" ? "email" : "url"}
            autoComplete={kind === "email" ? "email" : "off"}
            placeholder={kind === "email" ? "you@example.com" : "example.com"}
            aria-invalid={Boolean(fields.value) || undefined}
            aria-describedby={fields.value ? "removal-value-error" : undefined}
            className="font-mono"
          />
          {fields.value && <FieldError id="removal-value-error">{fields.value}</FieldError>}
        </Field>
        {kind === "domain" && (
          <Field className="gap-1.5" data-invalid={Boolean(fields.contactEmail) || undefined}>
            <FieldLabel htmlFor="removal-contact">An address at that domain (optional)</FieldLabel>
            <Input
              id="removal-contact"
              name="contactEmail"
              type="email"
              autoComplete="email"
              placeholder="admin@example.com"
              aria-invalid={Boolean(fields.contactEmail) || undefined}
              aria-describedby="removal-contact-help"
              className="font-mono"
            />
            <FieldDescription id="removal-contact-help">
              A confirmation link is sent there. Without one, you confirm with a DNS TXT record instead.
            </FieldDescription>
            {fields.contactEmail && <FieldError>{fields.contactEmail}</FieldError>}
          </Field>
        )}
        <Field className="gap-1.5">
          <FieldLabel htmlFor="removal-reason">Reason (optional)</FieldLabel>
          <Textarea id="removal-reason" name="reason" rows={3} maxLength={1000} />
        </Field>
      </FieldGroup>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <div>
        <Button type="submit" size="sm" disabled={pending}>
          <Send data-icon="inline-start" aria-hidden="true" />
          {pending ? "Sending…" : "Send removal request"}
        </Button>
      </div>
    </form>
  );
}
