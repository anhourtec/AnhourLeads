"use client";

import { useId, useState } from "react";

import { MailCheck } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

import { apiError } from "./format";
import { EmailStatusPill } from "./status-pill";

interface Verification {
  email: string;
  status: string;
  reason: string;
  cached: boolean;
  checks: { mx: string[]; smtpProbe: string; confirmedBySend: boolean };
}

const REASONS: Record<string, string> = {
  role_address: "A shared inbox such as info@ or sales@, not a person.",
  disposable_domain: "A temporary mailbox service.",
  no_mail_host: "The domain has no mail server.",
  null_mx: "The domain says it doesn't accept email.",
  mx_found_unconfirmed:
    "The domain accepts mail, but the mailbox can't be confirmed without sending. It becomes valid after a successful send.",
  a_record_only: "The domain has no MX record but may accept mail on its own address.",
  dns_error: "The domain's DNS didn't answer. Try again later.",
  smtp_accepted: "The mail server accepted this mailbox.",
  smtp_rejected: "The mail server rejected this mailbox.",
  accepts_all_addresses: "The mail server accepts every address, so this one can't be confirmed.",
  smtp_inconclusive: "The mail server didn't give a clear answer.",
  confirmed_by_send: "A message from this workspace was delivered to it.",
  bounced: "A message from this workspace bounced.",
};

function explain(reason: string): string {
  if (reason.startsWith("syntax")) return "This isn't a valid email address.";
  return REASONS[reason] ?? reason;
}

export function VerifyEmailCard({ className }: { className?: string }) {
  const inputId = useId();
  const [email, setEmail] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Verification | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!email.trim()) {
      setError("Enter an email address.");
      return;
    }
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/email_verifications", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      if (!res.ok) {
        setError(await apiError(res, "The address couldn't be checked."));
        setResult(null);
        return;
      }
      setResult(((await res.json()) as { verification: Verification }).verification);
    } catch {
      setError("The address couldn't be checked. Check your connection and try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>Verify an email</CardTitle>
        <CardDescription>Checks syntax, the domain's mail servers and known disposable services.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <form onSubmit={submit} noValidate className="flex flex-col gap-3">
          <Field>
            <FieldLabel htmlFor={inputId}>Email address</FieldLabel>
            <Input
              id={inputId}
              type="email"
              autoComplete="off"
              placeholder="jane@acme.com"
              className="font-mono"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>
          <div>
            <Button type="submit" size="sm" variant="outline" disabled={pending}>
              <MailCheck data-icon="inline-start" />
              {pending ? "Checking…" : "Verify now"}
            </Button>
          </div>
        </form>
        {error ? (
          <Alert variant="destructive" role="alert">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        {result ? (
          <div className="flex flex-col gap-2 rounded-lg border p-3" aria-live="polite">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="min-w-0 break-all font-mono text-sm">{result.email}</span>
              <EmailStatusPill status={result.status} />
            </div>
            <p className="text-muted-foreground text-sm">{explain(result.reason)}</p>
            {result.checks.mx.length ? (
              <p className="break-all text-muted-foreground text-xs">
                Mail server <span className="font-mono">{result.checks.mx[0]}</span>
              </p>
            ) : null}
            <p className="text-muted-foreground text-xs">
              {result.cached ? "From cache · free" : "Checked now · free"}
            </p>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
