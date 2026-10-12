"use client";

import { useState } from "react";

import { ShieldOff, Trash2, UserX } from "lucide-react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { apiFetch } from "@/lib/api-fetch";
import type { OptoutKind, OptoutView } from "@/server/discovery/optouts";

import type { RemovalRequestRow } from "./data-view";
import { Pager, type PaginationInfo } from "./pager";
import { Pill } from "./pill";
import { exactTime, numberFormat, relativeTime } from "./tabs";

const KIND_LABEL: Record<OptoutKind, string> = { domain: "Domain", email: "Email", person: "Person" };

function sourceLabel(requestedBy: string | null): string {
  if (!requestedBy) return "Unknown";
  if (requestedBy.startsWith("removal_request")) return "Removal request";
  if (requestedBy.startsWith("platform_admin")) return "Added by an administrator";
  return requestedBy;
}

export function OptoutsTab({
  initial,
  initialTotal,
  requests,
}: {
  initial: OptoutView[];
  initialTotal: number;
  requests: RemovalRequestRow[];
}) {
  const [optouts, setOptouts] = useState(initial);
  const [pagination, setPagination] = useState<PaginationInfo | null>({
    page: 1,
    per_page: 50,
    total_entries: initialTotal,
    total_pages: Math.max(1, Math.ceil(initialTotal / 50)),
  });
  const [kind, setKind] = useState<OptoutKind>("domain");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState<OptoutView | null>(null);

  async function load(page: number) {
    const res = await apiFetch<{ optouts: OptoutView[]; pagination: PaginationInfo }>(
      `/api/v1/platform/optouts?page=${page}&per_page=50`,
    );
    if (res.ok) {
      setOptouts(res.data.optouts);
      setPagination(res.data.pagination);
    } else toast.error(res.error);
  }

  async function add(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const value = String(data.get("value") ?? "").trim();
    const domain = String(data.get("domain") ?? "").trim();
    const reason = String(data.get("reason") ?? "").trim();
    if (!value) {
      setErrors({ value: "Enter what to leave out of the index." });
      return;
    }
    setSaving(true);
    setErrors({});
    const res = await apiFetch<{
      optout: OptoutView;
      created: boolean;
      removed: { companies: number; people: number };
    }>("/api/v1/platform/optouts", {
      body: { kind, value, ...(kind === "person" ? { domain } : {}), ...(reason ? { reason } : {}) },
    });
    setSaving(false);
    if (!res.ok) {
      setErrors(Object.keys(res.fields).length ? res.fields : { form: res.error });
      return;
    }
    form.reset();
    const { removed } = res.data;
    toast.success(
      res.data.created
        ? `Opt-out added. Removed ${numberFormat.format(removed.companies)} companies and ${numberFormat.format(removed.people)} people.`
        : "Already opted out.",
    );
    await load(1);
  }

  async function confirmRemove() {
    if (!removing) return;
    const res = await apiFetch<{ deleted: boolean }>(`/api/v1/platform/optouts/${removing.id}`, { method: "DELETE" });
    setRemoving(null);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    toast.success("Opt-out removed.");
    await load(pagination?.page ?? 1);
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Add an opt-out</CardTitle>
          <CardDescription>
            What the index holds about it is deleted now, the crawler never adds it again, and search and saving leave
            it out. Public requests arrive through <span className="font-mono text-xs">/privacy/removal</span>.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form noValidate onSubmit={add} className="flex flex-col gap-3" aria-label="Add an opt-out">
            <FieldGroup className="grid gap-3 md:grid-cols-[10rem_1fr_1fr]">
              <Field className="gap-1.5">
                <FieldLabel htmlFor="optout-kind">Kind</FieldLabel>
                <NativeSelect
                  id="optout-kind"
                  value={kind}
                  onChange={(e) => {
                    setKind(e.target.value as OptoutKind);
                    setErrors({});
                  }}
                  className="w-full"
                >
                  <NativeSelectOption value="domain">Domain</NativeSelectOption>
                  <NativeSelectOption value="email">Email address</NativeSelectOption>
                  <NativeSelectOption value="person">Person</NativeSelectOption>
                </NativeSelect>
              </Field>
              <Field className="gap-1.5" data-invalid={Boolean(errors.value) || undefined}>
                <FieldLabel htmlFor="optout-value">
                  {kind === "domain" ? "Domain" : kind === "email" ? "Email address" : "Full name"}
                </FieldLabel>
                <Input
                  id="optout-value"
                  name="value"
                  key={kind}
                  placeholder={kind === "domain" ? "example.com" : kind === "email" ? "jane@example.com" : "Jane Doe"}
                  aria-invalid={Boolean(errors.value) || undefined}
                  className={kind === "person" ? undefined : "font-mono"}
                />
                {errors.value && <FieldError>{errors.value}</FieldError>}
              </Field>
              {kind === "person" ? (
                <Field className="gap-1.5" data-invalid={Boolean(errors.domain) || undefined}>
                  <FieldLabel htmlFor="optout-domain">Company domain</FieldLabel>
                  <Input
                    id="optout-domain"
                    name="domain"
                    placeholder="example.com"
                    aria-invalid={Boolean(errors.domain) || undefined}
                    className="font-mono"
                  />
                  {errors.domain && <FieldError>{errors.domain}</FieldError>}
                </Field>
              ) : (
                <Field className="gap-1.5">
                  <FieldLabel htmlFor="optout-reason">Reason (optional)</FieldLabel>
                  <Input id="optout-reason" name="reason" maxLength={1000} />
                </Field>
              )}
            </FieldGroup>
            {errors.form && (
              <p role="alert" className="text-destructive text-sm">
                {errors.form}
              </p>
            )}
            <div>
              <Button type="submit" size="sm" disabled={saving}>
                <ShieldOff data-icon="inline-start" aria-hidden="true" />
                {saving ? "Adding…" : "Add opt-out"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Opt-outs</CardTitle>
          <CardDescription>{numberFormat.format(pagination?.total_entries ?? 0)} honoured everywhere.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {optouts.length === 0 ? (
            <Empty className="border">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <UserX aria-hidden="true" />
                </EmptyMedia>
                <EmptyTitle>No opt-outs yet</EmptyTitle>
                <EmptyDescription>Confirmed removal requests and the ones you add appear here.</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Kind</TableHead>
                    <TableHead>Value</TableHead>
                    <TableHead>Source</TableHead>
                    <TableHead>Added</TableHead>
                    <TableHead>
                      <span className="sr-only">Actions</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {optouts.map((o) => (
                    <TableRow key={o.id} data-testid="optout-row">
                      <TableCell>
                        <Pill tone="neutral">{KIND_LABEL[o.kind]}</Pill>
                      </TableCell>
                      <TableCell className="max-w-[20rem] break-all font-mono text-xs">{o.value}</TableCell>
                      <TableCell className="text-muted-foreground text-xs">{sourceLabel(o.requestedBy)}</TableCell>
                      <TableCell
                        className="whitespace-nowrap text-muted-foreground text-xs"
                        title={exactTime(o.createdAt)}
                      >
                        {relativeTime(o.createdAt)}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button size="sm" variant="ghost" onClick={() => setRemoving(o)}>
                          <Trash2 data-icon="inline-start" aria-hidden="true" />
                          Remove
                          <span className="sr-only"> opt-out for {o.value}</span>
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          <Pager pagination={pagination} onPage={(p) => void load(p)} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Pending removal requests</CardTitle>
          <CardDescription>Waiting for the emailed link or the DNS record. They expire after 7 days.</CardDescription>
        </CardHeader>
        <CardContent>
          {requests.length === 0 ? (
            <p className="text-muted-foreground text-sm">No requests waiting.</p>
          ) : (
            <ul className="flex flex-col divide-y">
              {requests.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2 first:pt-0 last:pb-0">
                  <span className="flex min-w-0 items-center gap-2">
                    <Pill tone="neutral">{r.kind === "email" ? "Email" : "Domain"}</Pill>
                    <span className="min-w-0 break-all font-mono text-xs">{r.value}</span>
                  </span>
                  <span
                    className="text-muted-foreground text-xs"
                    title={exactTime(r.createdAt)}
                    suppressHydrationWarning
                  >
                    {r.verification} · {relativeTime(r.createdAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={removing !== null} onOpenChange={(open) => !open && setRemoving(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this opt-out?</AlertDialogTitle>
            <AlertDialogDescription>
              The crawler may index <span className="font-mono">{removing?.value}</span> again. Only do this when the
              opt-out was added by mistake.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel size="sm">Cancel</AlertDialogCancel>
            <AlertDialogAction size="sm" variant="destructive" onClick={confirmRemove}>
              <Trash2 data-icon="inline-start" aria-hidden="true" />
              Remove opt-out
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
