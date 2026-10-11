"use client";

import { useState, useSyncExternalStore } from "react";

import { KeyRound, Play, Plus, Settings2 } from "lucide-react";
import { toast } from "sonner";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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

const KIND_INFO: Record<SeedKind, { label: string; about: string; licence?: string; example?: string }> = {
  wikidata: {
    label: "Wikidata",
    about: "Businesses with an official website from Wikidata (CC0), queried politely in pages.",
    licence: "CC0 1.0",
    example: '{"countries": ["Q16"], "maxRows": 500}',
  },
  domain_list: { label: "Domain list", about: "Homepages from a list of domains you uploaded." },
  manual: { label: "Manual", about: "Domains added by hand." },
  sitemap: { label: "Sitemaps", about: "Reads each indexed company's sitemap.xml for about, team and careers pages." },
  ats_boards: {
    label: "Job boards",
    about: "Public job-board APIs (Greenhouse, Lever, Ashby, Workable) linked from careers pages.",
  },
  companies_house: {
    label: "Companies House",
    about:
      "UK companies and their current officers from the Companies House public data API. Websites come from Wikidata or an indexed company with the same name.",
    licence: "Open Government Licence v3.0",
    example: '{"maxCompanies": 200, "everyDays": 7, "sicCodes": ["62012"]}',
  },
  sec_edgar: {
    label: "SEC EDGAR",
    about:
      "US listed companies and their officers and directors from SEC EDGAR filings (Forms 3 and 4). Websites come from Wikidata, the filing company or an indexed company with the same name.",
    licence: "Public domain (US government work)",
    example: '{"maxCompanies": 300, "everyDays": 7, "formLookbackDays": 730}',
  },
};

const REQUIREMENT_INFO: Record<NonNullable<SeedSourceView["requirement"]>["envVar"], { title: string; hint: string }> =
  {
    COMPANIES_HOUSE_API_KEY: {
      title: "API key missing",
      hint: "a free key from the Companies House developer hub",
    },
    SEC_USER_AGENT: {
      title: "User-Agent not set",
      hint: 'a name and contact email, e.g. "AnhourLeads admin@example.com", as the SEC requires',
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

const REGISTRY_KINDS: SeedKind[] = ["companies_house", "sec_edgar"];

function registryLine(st: Record<string, unknown>): string {
  const n = (k: string) => (typeof st[k] === "number" ? numberFormat.format(st[k] as number) : "0");
  return [
    `${n("companiesAdded")} companies added`,
    `${n("companiesMatched")} matched`,
    `${n("skippedNoWebsite")} skipped without a website`,
    `${n("peopleAdded")} people added`,
  ].join(" · ");
}

function statsLine(s: SeedSourceView): string | null {
  const st = s.stats;
  if (!st) return null;
  const n = (k: string) => (typeof st[k] === "number" ? numberFormat.format(st[k] as number) : "0");
  if (REGISTRY_KINDS.includes(s.kind)) {
    const errors = Array.isArray(st.errors) ? st.errors.length : 0;
    return `${registryLine(st)}${errors ? ` · ${errors} error${errors === 1 ? "" : "s"}` : ""}`;
  }
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
                placeholder={KIND_INFO[source?.kind ?? kind].example ?? "{}"}
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
  const info = KIND_INFO[source.kind];
  const requirement = source.requirement ? REQUIREMENT_INFO[source.requirement.envVar] : null;
  const totals =
    REGISTRY_KINDS.includes(source.kind) && source.stats?.totals && typeof source.stats.totals === "object"
      ? (source.stats.totals as Record<string, unknown>)
      : null;
  const firstError =
    source.stats && Array.isArray(source.stats.errors) && typeof source.stats.errors[0] === "string"
      ? source.stats.errors[0]
      : null;
  const cursor = typeof source.stats?.cursor === "number" ? source.stats.cursor : null;
  const candidates = typeof source.stats?.candidates === "number" ? source.stats.candidates : null;
  return (
    <Card size="sm" data-testid="seed-source" data-kind={source.kind}>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          <span className="min-w-0 break-words">{source.name}</span>
          <Pill tone="neutral">{KIND_INFO[source.kind].label}</Pill>
          {source.enabled ? <Pill tone="positive">Enabled</Pill> : <Pill tone="neutral">Disabled</Pill>}
          {requirement && <Pill tone="attention">{requirement.title}</Pill>}
        </CardTitle>
        <CardDescription>
          {info.about}
          {info.licence && <span className="mt-1 block text-xs">Licence: {info.licence}</span>}
        </CardDescription>
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
        {source.requirement && requirement && (
          <Alert data-testid="source-requirement">
            <KeyRound aria-hidden="true" />
            <AlertTitle>{requirement.title}</AlertTitle>
            <AlertDescription>
              <p>
                Set <code className="break-all font-mono text-xs">{source.requirement.envVar}</code> in the server
                environment ({requirement.hint}), then restart the app and the scheduler.
              </p>
            </AlertDescription>
          </Alert>
        )}
        <p className="text-muted-foreground text-xs">
          <span title={exactTime(source.lastRunAt)} suppressHydrationWarning>
            Last run {relativeTime(source.lastRunAt).toLowerCase()}
          </span>
          {line ? ` · ${line}` : ""}
          {source.domainCount !== null ? ` · ${numberFormat.format(source.domainCount)} domains` : ""}
        </p>
        {totals && (
          <p className="text-muted-foreground text-xs" data-testid="source-totals">
            All runs: {registryLine(totals)}
            {cursor !== null && candidates
              ? ` · next run starts at ${numberFormat.format(cursor)} of ${numberFormat.format(candidates)}`
              : ""}
          </p>
        )}
        {firstError && REGISTRY_KINDS.includes(source.kind) && !source.requirement && (
          <p className="break-words text-destructive text-xs">{firstError}</p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={run} disabled={running || Boolean(source.requirement)}>
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
