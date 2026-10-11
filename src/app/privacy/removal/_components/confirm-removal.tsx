"use client";

import { useState } from "react";

import Link from "next/link";

import { Check, Trash2 } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/api-fetch";

export function ConfirmRemoval({
  token,
  secret,
  kind,
  value,
}: {
  token: string;
  secret: string;
  kind: "email" | "domain";
  value: string;
}) {
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setPending(true);
    setError(null);
    const res = await apiFetch<{ confirmed: boolean }>("/privacy/removal/verify", {
      body: { token, secret, method: "link" },
    });
    setPending(false);
    if (res.ok) setDone(true);
    else setError(res.error);
  }

  if (done) {
    return (
      <Alert>
        <Check aria-hidden="true" />
        <AlertTitle>Removed</AlertTitle>
        <AlertDescription>
          {value} has been deleted from the index and won't be added again. You don't need to do anything else.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm leading-relaxed">
        Remove {kind === "email" ? "the address" : "the domain"}{" "}
        <span className="break-all font-medium font-mono">{value}</span> from this installation's business index?
        {kind === "domain" ? " Every company, person, job posting and news item under it is deleted." : ""}
      </p>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>
            {error} <Link href="/privacy/removal">Start a new request</Link>.
          </AlertDescription>
        </Alert>
      )}
      <div>
        <Button type="button" size="sm" onClick={confirm} disabled={pending}>
          <Trash2 data-icon="inline-start" aria-hidden="true" />
          {pending ? "Removing…" : "Confirm removal"}
        </Button>
      </div>
    </div>
  );
}
