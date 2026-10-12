"use client";

import { useState } from "react";

import { formatDistanceToNow } from "date-fns";
import { ExternalLink, RefreshCw, Trash2 } from "lucide-react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { DomainsView, DomainView } from "@/server/services/domains";

import { DnsRecords } from "./dns-records";
import { SetupSteps, stepsFor } from "./setup-steps";
import { StatusPill } from "./status-pill";

const dateFmt = new Intl.DateTimeFormat("en", { dateStyle: "medium" });

function Ago({ iso, prefix }: { iso: string; prefix: string }) {
  const date = new Date(iso);
  return (
    <time dateTime={iso} title={date.toLocaleString()} suppressHydrationWarning>
      {prefix} {formatDistanceToNow(date, { addSuffix: true })}
    </time>
  );
}

interface DomainCardProps {
  domain: DomainView;
  provider: DomainsView["provider"];
  target: string;
  protocol: string;
  canManage: boolean;
  busy: boolean;
  onVerify: (d: DomainView) => void;
  onRemove: (d: DomainView) => void;
}

export function DomainCard({
  domain: d,
  provider,
  target,
  protocol,
  canManage,
  busy,
  onVerify,
  onRemove,
}: DomainCardProps) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const steps = stepsFor(d, provider, target);
  const live = steps.every((s) => s.state === "done" || s.state === "skip");

  return (
    <Card data-testid="domain-card" aria-labelledby={`domain-${d.id}`}>
      <CardHeader>
        <CardTitle className="flex min-w-0 flex-wrap items-center gap-2">
          <span id={`domain-${d.id}`} className="min-w-0 break-all font-mono text-sm">
            {d.hostname}
          </span>
          <StatusPill domain={d} />
        </CardTitle>
        <CardDescription className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
          <Ago iso={d.createdAt} prefix="Added" />
          {d.lastCheckedAt && !d.local && <Ago iso={d.lastCheckedAt} prefix="Checked" />}
          {d.status === "failing" && d.switchOffAt && d.serving && (
            <span className="text-amber-700 dark:text-amber-400" suppressHydrationWarning>
              Switches off on {dateFmt.format(new Date(d.switchOffAt))}
            </span>
          )}
          {d.status === "pending" && d.claimExpiresAt && (
            <span suppressHydrationWarning>
              Claim expires on {dateFmt.format(new Date(d.claimExpiresAt))} unless verified
            </span>
          )}
        </CardDescription>
        {canManage && (
          <CardAction className="flex flex-wrap justify-end gap-2">
            {!d.local && (
              <Button
                size="sm"
                variant={d.status === "verified" ? "outline" : "default"}
                disabled={busy}
                onClick={() => onVerify(d)}
              >
                <RefreshCw data-icon="inline-start" aria-hidden="true" />
                {busy ? "Checking…" : "Verify now"}
              </Button>
            )}
            <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
              <AlertDialogTrigger asChild>
                <Button size="sm" variant="ghost" disabled={busy} aria-label={`Remove ${d.hostname}`}>
                  <Trash2 data-icon="inline-start" aria-hidden="true" />
                  Remove
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Remove {d.hostname}?</AlertDialogTitle>
                  <AlertDialogDescription>
                    It stops showing this workspace straight away, and anyone signed in there is signed out on their
                    next click. You can add it again later, but it will need to be verified again.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel size="sm">Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    size="sm"
                    variant="destructive"
                    onClick={() => {
                      setConfirmOpen(false);
                      onRemove(d);
                    }}
                  >
                    <Trash2 data-icon="inline-start" aria-hidden="true" />
                    Remove hostname
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </CardAction>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {d.local ? (
          <p className="text-muted-foreground text-sm">
            Verified on add, no DNS records needed. HTTPS: Local development — no certificate.{" "}
            <a
              className="inline-flex items-center gap-1 text-foreground underline underline-offset-4"
              href={`${protocol}://${d.hostname}/auth/login`}
              target="_blank"
              rel="noreferrer"
            >
              Open sign-in page
              <ExternalLink className="size-3.5" aria-hidden="true" />
            </a>
          </p>
        ) : (
          <>
            {d.lastError && d.status !== "verified" && (
              <p role="status" className="rounded-lg bg-muted px-3 py-2 text-muted-foreground text-sm">
                {d.lastError}
              </p>
            )}
            {!live && <SetupSteps steps={steps} />}
            {(!live || d.status !== "verified") && (
              <section aria-label={`Set up DNS for ${d.hostname}`} className="flex flex-col gap-2">
                <h3 className="font-medium text-sm">Set up DNS</h3>
                <p className="text-muted-foreground text-xs">
                  Add both records at your DNS provider, then select Verify now. If your provider adds the domain
                  automatically, enter only the part before it.
                </p>
                <DnsRecords records={d.records} />
              </section>
            )}
            {live && (
              <p className="text-muted-foreground text-sm">
                Live. Keep both DNS records in place: it is re-checked every hour.
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
