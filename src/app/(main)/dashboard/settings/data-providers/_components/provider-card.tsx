"use client";

import { type FormEvent, useId, useState } from "react";

import { useRouter } from "next/navigation";

import { ExternalLink, KeyRound, PlugZap, Save, Trash2, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { apiFetch } from "@/lib/api-fetch";
import { formatDateTime, relativeTime } from "@/lib/format-display";
import type { DataProviderDto } from "@/server/services/data-providers";

import { ConfirmDialog } from "../../../_components/pipeline/confirm-dialog";
import { Pill } from "../../../_components/pipeline/pills";
import type { ProviderInfo } from "./provider-catalog";

function StatusPill({ connection }: { connection: DataProviderDto | null }) {
  if (!connection) return <Pill tone="neutral">Not connected</Pill>;
  if (connection.lastError) return <Pill tone="negative">Needs attention</Pill>;
  if (!connection.enabled) return <Pill tone="neutral">Off</Pill>;
  return <Pill tone="positive">On</Pill>;
}

export function ProviderCard({
  info,
  connection,
  now,
}: {
  readonly info: ProviderInfo;
  readonly connection: DataProviderDto | null;
  readonly now: string;
}) {
  const router = useRouter();
  const inputId = useId();
  const switchId = useId();
  const [apiKey, setApiKey] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const showForm = !connection || editing;

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setFieldError(null);
    const res = await apiFetch(`/api/v1/data_providers`, {
      method: "POST",
      body: { provider: info.id, apiKey, enabled: connection?.enabled ?? true },
    });
    setSaving(false);
    if (!res.ok) {
      setFieldError("apiKey" in res.fields ? res.fields.apiKey : res.error);
      return;
    }
    setApiKey("");
    setEditing(false);
    toast.success(`${info.name} key saved. Only its last four characters are shown from now on.`);
    router.refresh();
  }

  async function test() {
    if (!connection) return;
    setTesting(true);
    const res = await apiFetch<{ ok: boolean; error: string | null }>(`/api/v1/data_providers/${connection.id}/test`, {
      method: "POST",
    });
    setTesting(false);
    if (!res.ok) toast.error(res.error);
    else if (res.data.ok) toast.success(`${info.name} accepted the key.`);
    else toast.error(res.data.error ?? "The connection test failed.");
    router.refresh();
  }

  async function toggle(enabled: boolean) {
    if (!connection) return;
    setToggling(true);
    const res = await apiFetch(`/api/v1/data_providers/${connection.id}`, { method: "PATCH", body: { enabled } });
    setToggling(false);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    toast.success(enabled ? `${info.name} is used during enrichment.` : `${info.name} is turned off.`);
    router.refresh();
  }

  async function remove(): Promise<boolean> {
    if (!connection) return true;
    const res = await apiFetch(`/api/v1/data_providers/${connection.id}`, { method: "DELETE" });
    if (!res.ok) {
      toast.error(res.error);
      return false;
    }
    toast.success(`${info.name} removed`);
    router.refresh();
    return true;
  }

  return (
    <Card className="min-w-0" data-testid={`provider-${info.id}`}>
      <CardHeader>
        <CardTitle>{info.name}</CardTitle>
        <CardDescription>{info.adds}</CardDescription>
        <CardAction>
          <StatusPill connection={connection} />
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
          <a
            href={info.pricingUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline"
          >
            Pricing
            <ExternalLink className="size-3.5" aria-hidden="true" />
            <span className="sr-only">(opens in a new tab)</span>
          </a>
          <a
            href={info.docsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline"
          >
            API docs
            <ExternalLink className="size-3.5" aria-hidden="true" />
            <span className="sr-only">(opens in a new tab)</span>
          </a>
        </div>

        {connection ? (
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
            <dt className="text-muted-foreground">Key</dt>
            <dd className="min-w-0 font-mono text-xs leading-5" data-testid="key-hint">
              {connection.keyHint ? `ends in ${connection.keyHint}` : "saved"}
            </dd>
            <dt className="text-muted-foreground">Last used</dt>
            <dd className="text-xs leading-5">
              {connection.lastUsedAt ? (
                <time dateTime={connection.lastUsedAt} title={formatDateTime(connection.lastUsedAt)}>
                  {relativeTime(connection.lastUsedAt, new Date(now))}
                </time>
              ) : (
                "Not used yet"
              )}
            </dd>
            {connection.lastError ? (
              <>
                <dt className="text-muted-foreground">Last error</dt>
                <dd className="min-w-0 break-words text-destructive text-xs leading-5" role="status">
                  {connection.lastError}
                </dd>
              </>
            ) : null}
          </dl>
        ) : null}

        {connection ? (
          <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
            <div className="flex min-w-0 flex-col gap-0.5">
              <Label htmlFor={switchId}>Use during enrichment</Label>
              <span className="text-muted-foreground text-xs">Lookups spend this account's credits.</span>
            </div>
            <Switch
              id={switchId}
              checked={connection.enabled}
              disabled={toggling}
              onCheckedChange={(checked) => void toggle(checked)}
            />
          </div>
        ) : null}

        {showForm ? (
          <form onSubmit={save} className="flex flex-col gap-2" noValidate>
            <Label htmlFor={inputId}>{connection ? "New API key" : "API key"}</Label>
            <Input
              id={inputId}
              type="password"
              autoComplete="off"
              spellCheck={false}
              className="font-mono"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              aria-invalid={fieldError ? true : undefined}
              aria-describedby={`${inputId}-help`}
            />
            <p
              id={`${inputId}-help`}
              className={fieldError ? "text-destructive text-xs" : "text-muted-foreground text-xs"}
            >
              {fieldError ?? "Stored encrypted. After saving, only the last four characters are shown."}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" size="sm" disabled={saving || !apiKey.trim()}>
                <Save data-icon="inline-start" />
                {saving ? "Saving…" : "Save key"}
              </Button>
              {connection ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setEditing(false);
                    setApiKey("");
                    setFieldError(null);
                  }}
                >
                  <X data-icon="inline-start" />
                  Cancel
                </Button>
              ) : null}
            </div>
          </form>
        ) : null}
        <p className="text-muted-foreground text-xs">{info.test}</p>
      </CardContent>
      {connection ? (
        <CardFooter className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => void test()} disabled={testing}>
            <PlugZap data-icon="inline-start" />
            {testing ? "Testing…" : "Test connection"}
          </Button>
          {editing ? null : (
            <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
              <KeyRound data-icon="inline-start" />
              Replace key
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="text-destructive hover:text-destructive"
            onClick={() => setConfirmRemove(true)}
          >
            <Trash2 data-icon="inline-start" />
            Remove
          </Button>
        </CardFooter>
      ) : null}
      <ConfirmDialog
        open={confirmRemove}
        onOpenChange={setConfirmRemove}
        title={`Remove ${info.name}?`}
        description="The stored key is deleted and enrichment stops using this provider. Values it already filled stay on your records."
        confirmLabel="Remove provider"
        pendingLabel="Removing…"
        icon={<Trash2 data-icon="inline-start" />}
        onConfirm={remove}
      />
    </Card>
  );
}
