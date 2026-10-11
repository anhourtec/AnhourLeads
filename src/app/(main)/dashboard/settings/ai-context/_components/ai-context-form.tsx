"use client";

import { useState } from "react";

import { Info, Save } from "lucide-react";
import { toast } from "sonner";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { apiFetch } from "@/lib/api-fetch";
import type { AiContextView } from "@/server/services/ai";

type Key = "companyDescription" | "valueProposition" | "targetCustomers" | "tone";

const FIELDS: Array<{ key: Key; label: string; help: string; max: number; placeholder: string }> = [
  {
    key: "companyDescription",
    label: "Company description",
    help: "What your company does, in two or three sentences.",
    max: 2000,
    placeholder: "We build scheduling software for field service teams.",
  },
  {
    key: "valueProposition",
    label: "Value proposition",
    help: "The outcome customers get. Drafts quote its first sentence, so make that one count.",
    max: 2000,
    placeholder: "Dispatchers plan a full day of visits in minutes instead of hours.",
  },
  {
    key: "targetCustomers",
    label: "Target customers",
    help: "Who you sell to: roles, seniority, industries and company size. Used to build audiences.",
    max: 2000,
    placeholder: "Directors and VPs of operations at HVAC and plumbing companies with 50 to 500 employees.",
  },
  {
    key: "tone",
    label: "Tone",
    help: "How emails should sound.",
    max: 500,
    placeholder: "Plain, friendly and brief. No jargon.",
  },
];

function valuesOf(c: AiContextView): Record<Key, string> {
  return {
    companyDescription: c.companyDescription ?? "",
    valueProposition: c.valueProposition ?? "",
    targetCustomers: c.targetCustomers ?? "",
    tone: c.tone ?? "",
  };
}

export function AiContextForm({ initial, canEdit }: { initial: AiContextView; canEdit: boolean }) {
  const [saved, setSaved] = useState(valuesOf(initial));
  const [values, setValues] = useState(saved);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const dirty = FIELDS.some((f) => values[f.key].trim() !== saved[f.key]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setErrors({});
    setFormError(null);
    const body = Object.fromEntries(FIELDS.map((f) => [f.key, values[f.key].trim() || null]));
    const res = await apiFetch<{ context: AiContextView }>("/api/v1/ai/context", { method: "PUT", body });
    setSaving(false);
    if (!res.ok) {
      setErrors(res.fields);
      setFormError(res.error);
      return;
    }
    const next = valuesOf(res.data.context);
    setSaved(next);
    setValues(next);
    toast.success("AI context saved.");
  }

  return (
    <form onSubmit={save} className="max-w-3xl">
      <Card>
        <CardHeader>
          <CardTitle>What the assistant knows about you</CardTitle>
          <CardDescription>
            Leave a field empty rather than guessing. Anything empty here is left out of drafts.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {!canEdit ? (
            <Alert>
              <Info aria-hidden="true" />
              <AlertDescription>Only administrators and owners can change the AI context.</AlertDescription>
            </Alert>
          ) : null}
          {formError ? (
            <Alert variant="destructive">
              <AlertDescription>{formError}</AlertDescription>
            </Alert>
          ) : null}
          <FieldGroup>
            {FIELDS.map((f) => (
              <Field key={f.key} data-invalid={errors[f.key] ? true : undefined}>
                <FieldLabel htmlFor={`ai-${f.key}`}>{f.label}</FieldLabel>
                <Textarea
                  id={`ai-${f.key}`}
                  value={values[f.key]}
                  onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                  readOnly={!canEdit}
                  maxLength={f.max}
                  rows={f.key === "tone" ? 2 : 3}
                  placeholder={canEdit ? f.placeholder : "Not set"}
                  aria-invalid={errors[f.key] ? true : undefined}
                />
                <FieldDescription>{f.help}</FieldDescription>
                {errors[f.key] ? <FieldError>{errors[f.key]}</FieldError> : null}
              </Field>
            ))}
          </FieldGroup>
        </CardContent>
        {canEdit ? (
          <CardFooter className="justify-end">
            <Button type="submit" size="sm" disabled={saving || !dirty}>
              <Save data-icon="inline-start" aria-hidden="true" />
              {saving ? "Saving…" : "Save"}
            </Button>
          </CardFooter>
        ) : null}
      </Card>
    </form>
  );
}
