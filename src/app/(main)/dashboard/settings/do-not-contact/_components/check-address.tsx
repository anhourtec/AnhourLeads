"use client";

import { useState } from "react";

import { Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { apiFetch } from "@/lib/api-fetch";
import { SUPPRESSION_REASON_LABELS, type SuppressionReason } from "@/lib/pipeline-constants";

import { Pill } from "../../../_components/pipeline/pills";

interface CheckResponse {
  email: string;
  suppressed: boolean;
  matches: { id: string; kind: "email" | "domain"; value: string; reason: SuppressionReason }[];
}

export function CheckAddress() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CheckResponse | null>(null);

  async function check(form: FormData) {
    setPending(true);
    setError(null);
    setResult(null);
    const email = String(form.get("email") ?? "").trim();
    const res = await apiFetch<CheckResponse>(`/api/v1/suppressions/check?email=${encodeURIComponent(email)}`);
    setPending(false);
    if (!res.ok) setError(res.error);
    else setResult(res.data);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Check an address</CardTitle>
        <CardDescription>See whether an email is blocked, by itself or by its domain.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <form
          className="flex flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void check(new FormData(event.currentTarget));
          }}
        >
          <Field data-invalid={Boolean(error)}>
            <FieldLabel htmlFor="dnc-check" className="sr-only">
              Email address
            </FieldLabel>
            <div className="flex gap-2">
              <Input
                id="dnc-check"
                name="email"
                type="email"
                required
                className="font-mono"
                placeholder="name@example.com"
                aria-invalid={Boolean(error)}
              />
              <Button type="submit" size="sm" variant="outline" className="h-8" disabled={pending}>
                <Search data-icon="inline-start" />
                {pending ? "Checking…" : "Check"}
              </Button>
            </div>
            {error ? <FieldError>{error}</FieldError> : null}
          </Field>
        </form>
        {result ? (
          <div className="flex flex-col gap-2 rounded-lg border p-3" aria-live="polite">
            <div className="flex flex-wrap items-center gap-2">
              <span className="min-w-0 break-all font-mono text-sm">{result.email}</span>
              <Pill tone={result.suppressed ? "negative" : "positive"}>
                {result.suppressed ? "Do not contact" : "Not blocked"}
              </Pill>
            </div>
            {result.matches.map((m) => (
              <p key={m.id} className="text-muted-foreground text-xs">
                Matches the {m.kind} <span className="font-mono text-foreground">{m.value}</span> ·{" "}
                {SUPPRESSION_REASON_LABELS[m.reason]}
              </p>
            ))}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
