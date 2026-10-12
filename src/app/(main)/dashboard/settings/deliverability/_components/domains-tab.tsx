"use client";

import { useState } from "react";

import { Globe, Plus, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiFetch } from "@/lib/api-fetch";
import type { CheckDetail, CheckKey, CheckStatus, SendingDomainView } from "@/server/services/sending-domains";

import { ConfirmDialog } from "../../../_components/pipeline/confirm-dialog";
import { Pill, type Tone } from "../../../_components/pipeline/pills";
import { CopyButton } from "../../domains/_components/copy-button";

const STATUS: Record<CheckStatus, { tone: Tone; label: string }> = {
  pass: { tone: "positive", label: "Pass" },
  fail: { tone: "negative", label: "Fail" },
  missing: { tone: "attention", label: "Missing" },
  unknown: { tone: "neutral", label: "Not checked" },
};

const CHECKS: { key: CheckKey; label: string; what: string }[] = [
  { key: "spf", label: "SPF", what: "Which servers may send for this domain" },
  { key: "dkim", label: "DKIM", what: "A signature proving messages weren't changed" },
  { key: "dmarc", label: "DMARC", what: "What receivers do when SPF or DKIM fail" },
  { key: "mx", label: "MX", what: "Where replies and bounce notices are delivered" },
];

function relative(iso: string | null): string {
  if (!iso) return "Never checked";
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "Checked just now";
  if (mins < 60) return `Checked ${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `Checked ${hours} h ago`;
  return `Checked ${Math.round(hours / 24)} days ago`;
}

function CheckRow({
  label,
  what,
  status,
  detail,
}: {
  label: string;
  what: string;
  status: CheckStatus;
  detail?: CheckDetail;
}) {
  const s = STATUS[status];
  return (
    <li className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-col">
          <span className="font-medium text-sm">{label}</span>
          <span className="text-muted-foreground text-xs">{what}</span>
        </div>
        <Pill tone={s.tone}>
          <span className="sr-only">{label}: </span>
          {s.label}
        </Pill>
      </div>
      {detail ? (
        <div className="flex flex-col gap-1.5 text-xs">
          <p>{detail.message}</p>
          {detail.warning ? <p className="text-amber-700 dark:text-amber-400">{detail.warning}</p> : null}
          {detail.record && status !== "missing" ? (
            <code className="break-all rounded-md bg-muted px-2 py-1 font-mono">{detail.record}</code>
          ) : null}
          {detail.fix ? <p className="text-muted-foreground">{detail.fix}</p> : null}
          {detail.example ? (
            <div className="flex items-start gap-2 rounded-md border bg-muted/40 p-2">
              <dl className="grid min-w-0 flex-1 grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                <dt className="text-muted-foreground">Type</dt>
                <dd className="font-mono">{detail.example.type}</dd>
                <dt className="text-muted-foreground">Name</dt>
                <dd className="break-all font-mono">{detail.example.name}</dd>
                <dt className="text-muted-foreground">Value</dt>
                <dd className="break-all font-mono">{detail.example.value}</dd>
              </dl>
              <CopyButton value={detail.example.value} label={`example ${label} record`} />
            </div>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

function DomainCard({
  domain,
  canManage,
  onChange,
  onRemove,
}: {
  domain: SendingDomainView;
  canManage: boolean;
  onChange: (d: SendingDomainView) => void;
  onRemove: (d: SendingDomainView) => void;
}) {
  const [checking, setChecking] = useState(false);
  async function check() {
    setChecking(true);
    const res = await apiFetch<{ sending_domain: SendingDomainView }>(`/api/v1/sending_domains/${domain.id}/check`, {
      method: "POST",
      body: {},
    });
    setChecking(false);
    if (res.ok) {
      onChange(res.data.sending_domain);
      toast.success(`Checked ${domain.domain}`);
    } else toast.error(res.error);
  }
  return (
    <Card className="min-w-0" data-testid={`sending-domain-${domain.domain}`}>
      <CardHeader>
        <CardTitle className="break-all font-mono text-base">{domain.domain}</CardTitle>
        <CardDescription>
          {domain.mailboxes.length
            ? `Used by ${domain.mailboxes.length === 1 ? domain.mailboxes[0] : `${domain.mailboxes.length} mailboxes`}`
            : "Added by hand"}{" "}
          · {relative(domain.lastCheckedAt)}
        </CardDescription>
        {canManage ? (
          <CardAction className="flex gap-1">
            <Button size="sm" variant="outline" onClick={check} disabled={checking}>
              <RefreshCw data-icon="inline-start" aria-hidden="true" />
              {checking ? "Checking…" : "Check now"}
            </Button>
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label={`Remove ${domain.domain}`}
              onClick={() => onRemove(domain)}
            >
              <Trash2 aria-hidden="true" />
            </Button>
          </CardAction>
        ) : null}
      </CardHeader>
      <CardContent>
        <ul className="flex flex-col divide-y">
          {CHECKS.map((c) => (
            <CheckRow key={c.key} label={c.label} what={c.what} status={domain[c.key]} detail={domain.details[c.key]} />
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

export function DomainsTab({ initial, canManage }: { initial: SendingDomainView[]; canManage: boolean }) {
  const [domains, setDomains] = useState(initial);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<SendingDomainView | null>(null);

  const upsert = (d: SendingDomainView) =>
    setDomains((list) =>
      (list.some((x) => x.id === d.id) ? list.map((x) => (x.id === d.id ? d : x)) : [...list, d]).sort((a, b) =>
        a.domain.localeCompare(b.domain),
      ),
    );

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!value.trim()) {
      setError("Enter a domain like example.com.");
      return;
    }
    setAdding(true);
    const res = await apiFetch<{ sending_domain: SendingDomainView }>("/api/v1/sending_domains", {
      body: { domain: value },
    });
    setAdding(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setError(null);
    setValue("");
    upsert(res.data.sending_domain);
    toast.success(`Added ${res.data.sending_domain.domain}`);
  }

  return (
    <div className="flex flex-col gap-4">
      {canManage ? (
        <form onSubmit={add} className="flex flex-col gap-2 rounded-xl border p-4" noValidate>
          <Label htmlFor="sending-domain">Add a sending domain</Label>
          <p className="text-muted-foreground text-xs">
            Domains your mailboxes send from are listed automatically. Add others you plan to send from.
          </p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              id="sending-domain"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="example.com"
              className="font-mono sm:max-w-sm"
              aria-invalid={Boolean(error)}
              aria-describedby={error ? "sending-domain-error" : undefined}
            />
            <Button type="submit" size="sm" disabled={adding}>
              <Plus data-icon="inline-start" aria-hidden="true" />
              {adding ? "Adding…" : "Add and check"}
            </Button>
          </div>
          {error ? (
            <p id="sending-domain-error" role="alert" className="text-destructive text-xs">
              {error}
            </p>
          ) : null}
        </form>
      ) : null}

      {domains.length ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {domains.map((d) => (
            <DomainCard key={d.id} domain={d} canManage={canManage} onChange={upsert} onRemove={setRemoving} />
          ))}
        </div>
      ) : (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Globe aria-hidden="true" />
            </EmptyMedia>
            <EmptyTitle>No sending domains yet</EmptyTitle>
            <EmptyDescription>
              Connect a mailbox or add the domain you send from to check its SPF, DKIM, DMARC and MX records.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}

      <ConfirmDialog
        open={Boolean(removing)}
        onOpenChange={(open) => !open && setRemoving(null)}
        title={`Remove ${removing?.domain ?? "domain"}?`}
        description="Its checks are deleted. Domains your mailboxes send from come back on the next visit."
        confirmLabel="Remove domain"
        pendingLabel="Removing…"
        icon={<Trash2 data-icon="inline-start" aria-hidden="true" />}
        onConfirm={async () => {
          if (!removing) return true;
          const res = await apiFetch(`/api/v1/sending_domains/${removing.id}`, { method: "DELETE" });
          if (!res.ok) {
            toast.error(res.error);
            return false;
          }
          setDomains((list) => list.filter((x) => x.id !== removing.id));
          toast.success(`Removed ${removing.domain}`);
          return true;
        }}
      />
    </div>
  );
}
