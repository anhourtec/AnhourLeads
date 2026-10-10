"use client";

import { useState } from "react";

import { Building2, Save } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { PlatformWorkspace } from "@/server/services/platform";

const PILL: Record<PlatformWorkspace["hostnames"][number]["status"], string> = {
  verified: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  pending: "bg-muted text-muted-foreground",
  failing: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
};

const STATUS_LABEL = { verified: "Verified", pending: "Pending", failing: "Failing" } as const;

interface LimitEditorProps {
  idPrefix: string;
  workspace: PlatformWorkspace;
  max: number;
  onSaved: (w: PlatformWorkspace) => void;
}

function LimitEditor({ idPrefix, workspace, max, onSaved }: LimitEditorProps) {
  const [value, setValue] = useState(String(workspace.hostnameLimit));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const id = `${idPrefix}-limit-${workspace.id}`;
  const parsed = Number(value);
  const valid = /^\d+$/.test(value) && parsed >= 0 && parsed <= max;
  const dirty = valid && parsed !== workspace.hostnameLimit;

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!valid) {
      setError(`Enter a whole number from 0 to ${max}.`);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/platform/workspaces/${workspace.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ hostnameLimit: parsed }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        workspace?: PlatformWorkspace;
        error?: string;
        details?: { message: string }[];
      };
      if (!res.ok || !body.workspace) {
        setError(body.details?.[0]?.message ?? body.error ?? "Couldn't save the limit.");
        return;
      }
      onSaved(body.workspace);
      toast.success(`${workspace.name} may now use ${parsed} custom hostname${parsed === 1 ? "" : "s"}.`);
    } catch {
      setError("Couldn't reach the server. Try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form noValidate onSubmit={save} className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <label htmlFor={id} className="sr-only">
          Hostname limit for {workspace.name}
        </label>
        <Input
          id={id}
          type="number"
          inputMode="numeric"
          min={0}
          max={max}
          step={1}
          value={value}
          aria-invalid={Boolean(error) || !valid}
          aria-describedby={error ? `${id}-error` : undefined}
          className="w-20 font-mono tabular-nums"
          onChange={(e) => setValue(e.target.value)}
        />
        <Button type="submit" size="sm" variant="outline" disabled={saving || !dirty}>
          <Save data-icon="inline-start" aria-hidden="true" />
          {saving ? "Saving…" : "Save"}
        </Button>
      </div>
      {error && (
        <p id={`${id}-error`} role="alert" className="text-destructive text-xs">
          {error}
        </p>
      )}
    </form>
  );
}

function Kpi({ label, value }: { label: string; value: number }) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardDescription>{label}</CardDescription>
      </CardHeader>
      <CardContent>
        <span className="font-medium font-mono text-2xl tabular-nums leading-none">{value.toLocaleString("en")}</span>
      </CardContent>
    </Card>
  );
}

export function WorkspacesTable({ initial, maxLimit }: { initial: PlatformWorkspace[]; maxLimit: number }) {
  const [workspaces, setWorkspaces] = useState(initial);
  const members = workspaces.reduce((n, w) => n + w.memberCount, 0);
  const hostnames = workspaces.reduce((n, w) => n + w.hostnamesUsed, 0);

  function saved(next: PlatformWorkspace) {
    setWorkspaces((list) => list.map((w) => (w.id === next.id ? next : w)));
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-3 gap-2 sm:gap-4">
        <Kpi label="Workspaces" value={workspaces.length} />
        <Kpi label="Members" value={members} />
        <Kpi label="Custom hostnames" value={hostnames} />
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Workspaces</CardTitle>
          <CardDescription>
            Lowering a limit removes nothing; the workspace just can't add more. Local development hostnames don't
            count.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {workspaces.length === 0 ? (
            <Empty className="border">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Building2 aria-hidden="true" />
                </EmptyMedia>
                <EmptyTitle>No workspaces yet</EmptyTitle>
                <EmptyDescription>Workspaces appear here when people sign up or are invited.</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <>
              <ul className="flex flex-col gap-3 md:hidden" aria-label="Workspaces">
                {workspaces.map((w) => (
                  <li key={w.id} data-testid="workspace-row" className="flex flex-col gap-3 rounded-lg border p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate font-medium">{w.name}</div>
                        <div className="truncate font-mono text-muted-foreground text-xs">{w.slug}</div>
                      </div>
                      <span className="shrink-0 text-muted-foreground text-xs">
                        <span className="font-mono tabular-nums">{w.memberCount}</span> member
                        {w.memberCount === 1 ? "" : "s"}
                      </span>
                    </div>
                    {w.hostnames.length > 0 && (
                      <ul className="flex flex-col gap-1">
                        {w.hostnames.map((h) => (
                          <li key={h.id} className="flex min-w-0 flex-wrap items-center gap-2">
                            <span className="break-all font-mono text-xs">{h.hostname}</span>
                            <Badge variant="secondary" className={PILL[h.status]}>
                              {STATUS_LABEL[h.status]}
                            </Badge>
                          </li>
                        ))}
                      </ul>
                    )}
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-muted-foreground text-xs">
                        <span className="font-mono tabular-nums">
                          {w.hostnamesUsed} / {w.hostnameLimit}
                        </span>{" "}
                        custom hostnames used
                      </span>
                      <LimitEditor idPrefix="card" workspace={w} max={maxLimit} onSaved={saved} />
                    </div>
                  </li>
                ))}
              </ul>
              <div className="hidden overflow-x-auto rounded-lg border md:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Workspace</TableHead>
                      <TableHead className="text-right">Members</TableHead>
                      <TableHead>Hostnames</TableHead>
                      <TableHead>Used</TableHead>
                      <TableHead>Hostname limit</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {workspaces.map((w) => (
                      <TableRow key={w.id} data-testid="workspace-row">
                        <TableCell className="align-top">
                          <div className="font-medium">{w.name}</div>
                          <div className="font-mono text-muted-foreground text-xs">{w.slug}</div>
                          {w.brandName && w.brandName !== w.name && (
                            <div className="text-muted-foreground text-xs">Shown as {w.brandName}</div>
                          )}
                        </TableCell>
                        <TableCell className="text-right align-top font-mono tabular-nums">{w.memberCount}</TableCell>
                        <TableCell className="align-top">
                          {w.hostnames.length === 0 ? (
                            <span className="text-muted-foreground text-xs">None</span>
                          ) : (
                            <ul className="flex flex-col gap-1">
                              {w.hostnames.map((h) => (
                                <li key={h.id} className="flex items-center gap-2">
                                  <span className="font-mono text-xs">{h.hostname}</span>
                                  <Badge variant="secondary" className={PILL[h.status]}>
                                    {STATUS_LABEL[h.status]}
                                  </Badge>
                                  {h.local && <span className="text-muted-foreground text-xs">local</span>}
                                </li>
                              ))}
                            </ul>
                          )}
                        </TableCell>
                        <TableCell className="align-top font-mono tabular-nums">
                          {w.hostnamesUsed} / {w.hostnameLimit}
                        </TableCell>
                        <TableCell className="align-top">
                          <LimitEditor idPrefix="table" workspace={w} max={maxLimit} onSaved={saved} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
