"use client";

import { useState } from "react";

import { Save } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { apiFetch } from "@/lib/api-fetch";
import type { DiscoverySettings } from "@/server/discovery/settings";

import { KIND_LABEL } from "./tabs";

type Kind = keyof DiscoverySettings["recrawlDays"];

export function SettingsTab({ initial }: { initial: DiscoverySettings }) {
  const [settings, setSettings] = useState(initial);
  const [retention, setRetention] = useState(String(initial.retentionDays));
  const [recrawl, setRecrawl] = useState<Record<string, string>>(
    Object.fromEntries(Object.entries(initial.recrawlDays).map(([k, v]) => [k, String(v)])),
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const recrawlDays: Partial<Record<Kind, number>> = {};
    for (const [k, v] of Object.entries(recrawl)) recrawlDays[k as Kind] = Number(v);
    setSaving(true);
    setErrors({});
    const res = await apiFetch<{ settings: DiscoverySettings }>("/api/v1/platform/crawler/settings", {
      method: "PATCH",
      body: { retentionDays: Number(retention), recrawlDays },
    });
    setSaving(false);
    if (!res.ok) {
      setErrors(Object.keys(res.fields).length ? res.fields : { form: res.error });
      return;
    }
    setSettings(res.data.settings);
    toast.success("Settings saved.");
  }

  const dirty =
    retention !== String(settings.retentionDays) ||
    Object.entries(recrawl).some(([k, v]) => v !== String(settings.recrawlDays[k as Kind]));

  return (
    <form noValidate onSubmit={save} className="flex flex-col gap-4" aria-label="Data pipeline settings">
      <Card>
        <CardHeader>
          <CardTitle>Retention</CardTitle>
          <CardDescription>
            People are marked as no longer listed when their page drops them (a likely job change), and deleted once
            nobody has seen them for this long.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Field className="max-w-xs gap-1.5" data-invalid={Boolean(errors.retentionDays) || undefined}>
            <FieldLabel htmlFor="retention-days">Delete people not seen for (days)</FieldLabel>
            <Input
              id="retention-days"
              type="number"
              inputMode="numeric"
              min={7}
              max={3650}
              value={retention}
              onChange={(e) => setRetention(e.target.value)}
              aria-invalid={Boolean(errors.retentionDays) || undefined}
              className="font-mono tabular-nums"
            />
            {errors.retentionDays ? (
              <FieldError>{errors.retentionDays}</FieldError>
            ) : (
              <FieldDescription>7 to 3650 days. Default 180.</FieldDescription>
            )}
          </Field>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Re-crawl intervals</CardTitle>
          <CardDescription>How many days pass before a page of each kind is fetched again.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {Object.keys(recrawl).map((kind) => {
              const error = errors[`recrawlDays.${kind}`];
              return (
                <Field key={kind} className="gap-1.5" data-invalid={Boolean(error) || undefined}>
                  <FieldLabel htmlFor={`recrawl-${kind}`}>{KIND_LABEL[kind] ?? kind}</FieldLabel>
                  <Input
                    id={`recrawl-${kind}`}
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={365}
                    value={recrawl[kind]}
                    onChange={(e) => setRecrawl((r) => ({ ...r, [kind]: e.target.value }))}
                    aria-invalid={Boolean(error) || undefined}
                    className="font-mono tabular-nums"
                  />
                  {error && <FieldError>{error}</FieldError>}
                </Field>
              );
            })}
          </div>
        </CardContent>
      </Card>
      {errors.form && (
        <p role="alert" className="text-destructive text-sm">
          {errors.form}
        </p>
      )}
      <div>
        <Button type="submit" size="sm" disabled={saving || !dirty}>
          <Save data-icon="inline-start" aria-hidden="true" />
          {saving ? "Saving…" : "Save settings"}
        </Button>
      </div>
    </form>
  );
}
