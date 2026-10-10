"use client";

import { useState } from "react";

import { Globe } from "lucide-react";
import { toast } from "sonner";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Progress } from "@/components/ui/progress";
import type { DomainsView, DomainView } from "@/server/services/domains";

import { AddHostnameForm } from "./add-hostname-form";
import { DomainCard } from "./domain-card";

interface ApiError {
  error?: string;
  details?: { path: string; message: string }[];
}

async function call<T>(url: string, init?: RequestInit): Promise<{ data: T | null; error: string | null }> {
  try {
    const res = await fetch(url, { ...init, headers: { "content-type": "application/json", ...init?.headers } });
    const body = (await res.json().catch(() => ({}))) as T & ApiError;
    if (!res.ok) return { data: null, error: body.details?.[0]?.message ?? body.error ?? "Something went wrong." };
    return { data: body, error: null };
  } catch {
    return { data: null, error: "Couldn't reach the server. Check your connection and try again." };
  }
}

interface DomainsManagerProps {
  initial: DomainsView;
  canManage: boolean;
  protocol: string;
}

export function DomainsManager({ initial, canManage, protocol }: DomainsManagerProps) {
  const [view, setView] = useState(initial);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function reload() {
    const { data } = await call<DomainsView>("/api/v1/domains");
    if (data) setView(data);
  }

  async function add(hostname: string): Promise<string | null> {
    const { data, error } = await call<{ domain: DomainView; warning: string | null }>("/api/v1/domains", {
      method: "POST",
      body: JSON.stringify({ hostname }),
    });
    if (error || !data) return error;
    toast.success(
      data.domain.status === "verified"
        ? `${data.domain.hostname} is verified and serves this workspace.`
        : `${data.domain.hostname} added. Add its DNS records, then select Verify now.`,
    );
    if (data.warning) toast.warning(data.warning);
    await reload();
    return null;
  }

  async function verify(d: DomainView) {
    setBusyId(d.id);
    const { data, error } = await call<{ ok: boolean; error: string | null; domain: DomainView }>(
      `/api/v1/domains/${d.id}/verify`,
      { method: "POST" },
    );
    setBusyId(null);
    if (error || !data) {
      toast.error(error ?? "Couldn't check the hostname.");
      return;
    }
    if (data.ok) toast.success(`${d.hostname} is verified.`);
    else toast.message(data.error ?? "Not verified yet.");
    await reload();
  }

  async function remove(d: DomainView) {
    setBusyId(d.id);
    const { error } = await call(`/api/v1/domains/${d.id}`, { method: "DELETE" });
    setBusyId(null);
    if (error) {
      toast.error(error);
      return;
    }
    toast.success(`${d.hostname} removed.`);
    await reload();
  }

  const atLimit = view.used >= view.limit;
  const percent = view.limit > 0 ? Math.min(100, Math.round((view.used / view.limit) * 100)) : 100;

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Custom hostnames</CardTitle>
          <CardDescription>
            Point a hostname at <span className="font-mono text-foreground">{view.target}</span> and prove you own it
            with a TXT record.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <p className="text-sm" data-testid="hostname-usage">
              <span className="font-mono tabular-nums">{view.used}</span> of{" "}
              <span className="font-mono tabular-nums">{view.limit}</span> hostname{view.limit === 1 ? "" : "s"} used
            </p>
            <Progress value={percent} aria-label="Custom hostnames used" className="max-w-sm" />
            {view.localUsed > 0 && (
              <p className="text-muted-foreground text-xs">
                Local development hostnames don't count ({view.localUsed} of {view.localLimit}).
              </p>
            )}
          </div>
          {canManage &&
            (atLimit && view.limit === 0 ? (
              <p className="text-muted-foreground text-sm">
                Custom hostnames aren't included for this workspace. Ask your platform administrator to add one.
              </p>
            ) : (
              <>
                {atLimit && (
                  <p className="text-muted-foreground text-sm">
                    You've used all {view.limit} of your custom hostnames. Remove one, or ask your platform
                    administrator to add more.
                  </p>
                )}
                <AddHostnameForm disabled={false} onAdd={add} />
              </>
            ))}
          {!canManage && (
            <p className="text-muted-foreground text-sm">
              You can see hostnames and their DNS records. Administrators add and verify them.
            </p>
          )}
        </CardContent>
      </Card>

      {view.domains.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Globe aria-hidden="true" />
            </EmptyMedia>
            <EmptyTitle>No hostnames yet</EmptyTitle>
            <EmptyDescription>
              {canManage
                ? "Add a hostname above to serve this workspace on your own address."
                : "An administrator can add a hostname for this workspace."}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ul className="flex flex-col gap-4" aria-label="Hostnames">
          {view.domains.map((d) => (
            <li key={d.id}>
              <DomainCard
                domain={d}
                provider={view.provider}
                target={view.target}
                protocol={protocol}
                canManage={canManage}
                busy={busyId === d.id}
                onVerify={verify}
                onRemove={remove}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
