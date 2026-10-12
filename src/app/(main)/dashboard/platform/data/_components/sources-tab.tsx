"use client";

import { useState, useSyncExternalStore } from "react";

import { Play, Plus, Settings2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { apiFetch } from "@/lib/api-fetch";
import type { SeedKind, SeedSourceView } from "@/server/discovery/seeds";

import { Pill } from "./pill";
import { exactTime, numberFormat, relativeTime } from "./tabs";

const KIND_INFO: Record<SeedKind, { label: string; about: string }> = {
  wikidata: {
    label: "Wikidata",
    about: "Businesses with an official website from Wikidata (CC0), queried politely in pages.",
  },
  domain_list: { label: "Domain list", about: "Homepages from a list of domains you uploaded." },
  manual: { label: "Manual", about: "Domains added by hand." },
  sitemap: { label: "Sitemaps", about: "Reads each indexed company's sitemap.xml for about, team and careers pages." },
  ats_boards: {
    label: "Job boards",
    about: "Public job-board APIs (Greenhouse, Lever, Ashby, Workable) linked from careers pages.",
  },
};

const LIST_KINDS: SeedKind[] = ["domain_list", "manual"];

const subscribeNothing = () => () => undefined;
/** True after hydration. Radix's Switch renders a hidden form input whose inline style differs between server and client. */
function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribeNothing,
    () => true,
    () => false,
  );
}

interface SourceResponse {
  seed_source: SeedSourceView;
}

function statsLine(s: SeedSourceView): string | null {
  const st = s.stats;
  if (!st) return null;
  const n = (k: string) => (typeof st[k] === "number" ? numberFormat.format(st[k] as number) : "0");
  const parts = [`${n("queued")} queued`, `${n("requeued")} re-queued`, `${n("skipped")} skipped`];
  if (s.kind === "wikidata") parts.unshift(`${n("companies")} companies`);
  const errors = Array.isArray(st.errors) ? st.errors.length : 0;
  if (errors) parts.push(`${errors} error${errors === 1 ? "" : "s"}`);
  return parts.join(" · ");
}

/** The config shown for editing: list kinds keep their domains out of the JSON (edited as text). */
function editableConfig(s: SeedSourceView): string {
  const { domains: _domains, ...rest } = s.config;
  return JSON.stringify(LIST_KINDS.includes(s.kind) ? rest : s.config, null, 2);
}

function SourceDialog({
  source,
  open,
  onOpenChange,
  onSaved,
}: {
  source: SeedSourceView | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (s: SeedSourceView) => void;
}) {
  const [kind, setKind] = useState<SeedKind>(source?.kind ?? "manual");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const isList = LIST_KINDS.includes(source?.kind ?? kind);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const name = String(data.get("name") ?? "").trim();
    const text = String(data.get("text") ?? "").trim();
    const rawConfig = String(data.get("config") ?? "").trim();
    let config: Record<string, unknown> | undefined;
    if (rawConfig) {
      try {
        const parsed: unknown = JSON.parse(rawConfig);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
        config = parsed as Record<string, unknown>;
      } catch {
        setErrors({ config: 'Enter a JSON object, like {"maxRows": 500}.' });
        return;
      }
    }
    if (!name) {
      setErrors({ name: "Give the source a name." });
      return;
    }
    setSaving(true);
    setErrors({});
    const body = { name, ...(config ? { config } : {}), ...(text ? { text } : {}) };
    const res = source
      ? await apiFetch<SourceResponse>(`/api/v1/platform/seed_sources/${source.id}`, { method: "PATCH", body })
      : await apiFetch<SourceResponse>("/api/v1/platform/seed_sources", { body: { ...body, kind } });
    setSaving(false);
    if (!res.ok) {
      setErrors(Object.keys(res.fields).length ? res.fields : { form: res.error });
      return;
    }
    onSaved(res.data.seed_source);
    onOpenChange(false);
    toast.success(source ? "Source saved." : "Source added. Enable it, then run it.");
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <form noValidate onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{source ? `Configure ${source.name}` : "Add seed source"}</DialogTitle>
            <DialogDescription>{KIND_INFO[source?.kind ?? kind].about}</DialogDescription>
          </DialogHeader>
          <FieldGroup>
            {!source && (
              <Field className="gap-1.5">
                <FieldLabel htmlFor="source-kind">Kind</FieldLabel>
                <NativeSelect
                  id="source-kind"
                  value={kind}
                  onChange={(e) => setKind(e.target.value as SeedKind)}
                  className="w-full"
                >
                  {(Object.keys(KIND_INFO) as SeedKind[]).map((k) => (
                    <NativeSelectOption key={k} value={k}>
                      {KIND_INFO[k].label}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </Field>
            )}
            <Field className="gap-1.5" data-invalid={Boolean(errors.name) || undefined}>
              <FieldLabel htmlFor="source-name">Name</FieldLabel>
              <Input
                id="source-name"
                name="name"
                defaultValue={source?.name ?? ""}
                aria-invalid={Boolean(errors.name) || undefined}
              />
              {errors.name && <FieldError>{errors.name}</FieldError>}
            </Field>
            {isList && (
              <Field className="gap-1.5">
                <FieldLabel htmlFor="source-text">{source ? "Add domains" : "Domains"}</FieldLabel>
                <Textarea
                  id="source-text"
                  name="text"
                  rows={5}
                  placeholder={"example.com\nhttps://another.example"}
                  className="font-mono text-xs"
                />
                <FieldDescription>
                  One per line, or paste a CSV: anything that looks like a domain or URL is used.
                  {source?.domainCount ? ` The list holds ${numberFormat.format(source.domainCount)} now.` : ""}
                </FieldDescription>
              </Field>
            )}
            <Field className="gap-1.5" data-invalid={Boolean(errors.config) || undefined}>
              <FieldLabel htmlFor="source-config">Configuration (JSON)</FieldLabel>
              <Textarea
                id="source-config"
                name="config"
                rows={6}
                defaultValue={source ? editableConfig(source) : ""}
                placeholder={(source?.kind ?? kind) === "wikidata" ? '{"countries": ["Q16"], "maxRows": 500}' : "{}"}
                aria-invalid={Boolean(errors.config) || undefined}
                className="font-mono text-xs"
              />
              {errors.config ? (
                <FieldError>{errors.config}</FieldError>
              ) : (
                <FieldDescription>Optional. Unknown keys are refused.</FieldDescription>
              )}
            </Field>
          </FieldGroup>
          {errors.form && (
            <p role="alert" className="text-destructive text-sm">
              {errors.form}
            </p>
          )}
          <DialogFooter>
            <Button type="button" size="sm" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={saving}>
              <Settings2 data-icon="inline-start" aria-hidden="true" />
              {saving ? "Saving…" : source ? "Save source" : "Add source"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function SourceCard({ source, onChange }: { source: SeedSourceView; onChange: (s: SeedSourceView) => void }) {
  const [running, setRunning] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [editing, setEditing] = useState(false);
  const switchId = `source-enabled-${source.id}`;
  const hydrated = useHydrated();

  async function toggle(enabled: boolean) {
    setToggling(true);
    const res = await apiFetch<SourceResponse>(`/api/v1/platform/seed_sources/${source.id}`, {
      method: "PATCH",
      body: { enabled },
    });
    setToggling(false);
    if (res.ok) {
      onChange(res.data.seed_source);
      toast.success(`${source.name} ${enabled ? "enabled" : "disabled"}.`);
    } else toast.error(res.error);
  }

  async function run() {
    setRunning(true);
    const res = await apiFetch<SourceResponse>(`/api/v1/platform/seed_sources/${source.id}/run`, { body: {} });
    setRunning(false);
    if (res.ok) {
      onChange(res.data.seed_source);
      toast.success(`${source.name} ran: ${statsLine(res.data.seed_source) ?? "done"}.`);
    } else toast.error(res.error);
  }

  const line = statsLine(source);
  return (
    <Card size="sm" data-testid="seed-source" data-kind={source.kind}>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          <span className="min-w-0 break-words">{source.name}</span>
          <Pill tone="neutral">{KIND_INFO[source.kind].label}</Pill>
          {source.enabled ? <Pill tone="positive">Enabled</Pill> : <Pill tone="neutral">Disabled</Pill>}
        </CardTitle>
        <CardDescription>{KIND_INFO[source.kind].about}</CardDescription>
        <CardAction>
          <div className="flex items-center gap-2">
            <label htmlFor={switchId} className="sr-only">
              Enable {source.name}
            </label>
            {hydrated ? (
              <Switch id={switchId} checked={source.enabled} disabled={toggling} onCheckedChange={toggle} />
            ) : (
              <span className="inline-block h-[1.15rem] w-8" aria-hidden="true" />
            )}
          </div>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-muted-foreground text-xs">
          <span title={exactTime(source.lastRunAt)} suppressHydrationWarning>
            Last run {relativeTime(source.lastRunAt).toLowerCase()}
          </span>
          {line ? ` · ${line}` : ""}
          {source.domainCount !== null ? ` · ${numberFormat.format(source.domainCount)} domains` : ""}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={run} disabled={running}>
            <Play data-icon="inline-start" aria-hidden="true" />
            {running ? "Running…" : "Run now"}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
            <Settings2 data-icon="inline-start" aria-hidden="true" />
            Configure
          </Button>
        </div>
      </CardContent>
      {editing && <SourceDialog source={source} open={editing} onOpenChange={setEditing} onSaved={onChange} />}
    </Card>
  );
}

export function SourcesTab({ initial }: { initial: SeedSourceView[] }) {
  const [sources, setSources] = useState(initial);
  const [adding, setAdding] = useState(false);
  const upsert = (s: SeedSourceView) =>
    setSources((list) => (list.some((x) => x.id === s.id) ? list.map((x) => (x.id === s.id ? s : x)) : [...list, s]));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="max-w-prose text-muted-foreground text-sm">
          Where the crawler gets its starting points. Disabled sources never run on their own; Run now works either way.
        </p>
        <Button size="sm" onClick={() => setAdding(true)}>
          <Plus data-icon="inline-start" aria-hidden="true" />
          Add source
        </Button>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {sources.map((s) => (
          <SourceCard key={s.id} source={s} onChange={upsert} />
        ))}
      </div>
      {adding && <SourceDialog source={null} open={adding} onOpenChange={setAdding} onSaved={upsert} />}
    </div>
  );
}
