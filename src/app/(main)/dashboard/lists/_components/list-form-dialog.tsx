"use client";

import { useState } from "react";

import { useRouter } from "next/navigation";

import { Pencil, Plus } from "lucide-react";
import { toast } from "sonner";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import {
  CONTACT_STAGE_LABELS,
  CONTACT_STAGES,
  EMAIL_STATUS_LABELS,
  EMAIL_STATUSES,
  SENIORITIES,
  SENIORITY_LABELS,
} from "@/lib/records-vocabulary";

import { apiRequest } from "../../_components/records/api-client";
import type { ListRow } from "./types";

type Filters = Partial<Record<string, string>>;

const CONTACT_FILTER_KEYS = ["q", "stage", "emailStatus", "country", "seniority"] as const;
const COMPANY_FILTER_KEYS = ["q", "industry", "country", "employeeMin", "employeeMax"] as const;

function toFilters(entityType: "contact" | "company", raw: Filters): Record<string, string | number> {
  const keys: readonly string[] = entityType === "contact" ? CONTACT_FILTER_KEYS : COMPANY_FILTER_KEYS;
  const out: Record<string, string | number> = {};
  for (const key of keys) {
    const value = raw[key]?.trim();
    if (!value) continue;
    out[key] = key === "employeeMin" || key === "employeeMax" ? Number(value) : value;
  }
  return out;
}

function fromFilters(filters: Record<string, unknown> | null): Filters {
  const out: Filters = {};
  for (const [key, value] of Object.entries(filters ?? {})) {
    if (value !== null && value !== undefined) out[key] = String(value);
  }
  return out;
}

/** Create a list, or rename one (and edit a dynamic list's filters). */
export function ListFormDialog({ mode, list }: { mode: "create" | "edit"; list?: ListRow }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(list?.name ?? "");
  const [entityType, setEntityType] = useState<"contact" | "company">(list?.entityType ?? "contact");
  const [kind, setKind] = useState<"static" | "dynamic">(list?.kind ?? "static");
  const [filters, setFilters] = useState<Filters>(fromFilters(list?.filters ?? null));
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function reset() {
    setName(list?.name ?? "");
    setEntityType(list?.entityType ?? "contact");
    setKind(list?.kind ?? "static");
    setFilters(fromFilters(list?.filters ?? null));
    setError(null);
  }

  const submitLabel = mode === "create" ? "Create list" : "Save";
  const setFilter = (key: string, value: string) => setFilters((f) => ({ ...f, [key]: value }));

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim()) {
      setError("Name the list.");
      return;
    }
    setPending(true);
    setError(null);
    const body =
      mode === "create"
        ? {
            name: name.trim(),
            entityType,
            kind,
            ...(kind === "dynamic" ? { filters: toFilters(entityType, filters) } : {}),
          }
        : { name: name.trim(), ...(kind === "dynamic" ? { filters: toFilters(entityType, filters) } : {}) };
    const result = await apiRequest<{ label: ListRow }>(
      mode === "create" ? "/api/v1/labels" : `/api/v1/labels/${list?.id}`,
      {
        method: mode === "create" ? "POST" : "PATCH",
        body,
      },
    );
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setOpen(false);
    toast.success(mode === "create" ? "List created." : "List saved.");
    if (mode === "create") router.push(`/dashboard/lists/${result.data.label.id}`);
    else router.refresh();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) reset();
      }}
    >
      <DialogTrigger asChild>
        {mode === "create" ? (
          <Button size="sm">
            <Plus data-icon="inline-start" aria-hidden="true" />
            Create list
          </Button>
        ) : (
          <Button size="sm" variant="outline">
            <Pencil data-icon="inline-start" aria-hidden="true" />
            Edit
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
        <form onSubmit={submit} noValidate className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{mode === "create" ? "Create list" : "Edit list"}</DialogTitle>
            <DialogDescription>
              {mode === "create"
                ? "Static lists hold the records you add. Dynamic lists show every record that matches their filters."
                : "Rename the list. The record type and kind can't change."}
            </DialogDescription>
          </DialogHeader>
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          <FieldGroup className="gap-4">
            <Field className="gap-1.5">
              <FieldLabel htmlFor="list-name">Name</FieldLabel>
              <Input id="list-name" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} autoFocus />
            </Field>
            {mode === "create" ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <Field className="gap-1.5">
                  <FieldLabel htmlFor="list-entity">Records</FieldLabel>
                  <NativeSelect
                    id="list-entity"
                    className="w-full"
                    value={entityType}
                    onChange={(e) => {
                      setEntityType(e.target.value === "company" ? "company" : "contact");
                      setFilters({});
                    }}
                  >
                    <NativeSelectOption value="contact">People</NativeSelectOption>
                    <NativeSelectOption value="company">Companies</NativeSelectOption>
                  </NativeSelect>
                </Field>
                <Field className="gap-1.5">
                  <FieldLabel htmlFor="list-kind">Kind</FieldLabel>
                  <NativeSelect
                    id="list-kind"
                    className="w-full"
                    value={kind}
                    onChange={(e) => setKind(e.target.value === "dynamic" ? "dynamic" : "static")}
                  >
                    <NativeSelectOption value="static">Static</NativeSelectOption>
                    <NativeSelectOption value="dynamic">Dynamic</NativeSelectOption>
                  </NativeSelect>
                </Field>
              </div>
            ) : null}
            {kind === "dynamic" ? (
              <fieldset className="flex flex-col gap-3 rounded-lg border p-3">
                <legend className="px-1 font-medium text-sm">Filters</legend>
                <FieldDescription className="text-xs">Leave a filter empty to ignore it.</FieldDescription>
                <Field className="gap-1.5">
                  <FieldLabel htmlFor="filter-q">Keyword</FieldLabel>
                  <Input
                    id="filter-q"
                    value={filters.q ?? ""}
                    placeholder={entityType === "contact" ? "Name, email or title" : "Name or domain"}
                    onChange={(e) => setFilter("q", e.target.value)}
                  />
                </Field>
                {entityType === "contact" ? (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field className="gap-1.5">
                      <FieldLabel htmlFor="filter-stage">Stage</FieldLabel>
                      <NativeSelect
                        id="filter-stage"
                        className="w-full"
                        value={filters.stage ?? ""}
                        onChange={(e) => setFilter("stage", e.target.value)}
                      >
                        <NativeSelectOption value="">Any stage</NativeSelectOption>
                        {CONTACT_STAGES.map((s) => (
                          <NativeSelectOption key={s} value={s}>
                            {CONTACT_STAGE_LABELS[s]}
                          </NativeSelectOption>
                        ))}
                      </NativeSelect>
                    </Field>
                    <Field className="gap-1.5">
                      <FieldLabel htmlFor="filter-email-status">Email status</FieldLabel>
                      <NativeSelect
                        id="filter-email-status"
                        className="w-full"
                        value={filters.emailStatus ?? ""}
                        onChange={(e) => setFilter("emailStatus", e.target.value)}
                      >
                        <NativeSelectOption value="">Any status</NativeSelectOption>
                        {EMAIL_STATUSES.map((s) => (
                          <NativeSelectOption key={s} value={s}>
                            {EMAIL_STATUS_LABELS[s]}
                          </NativeSelectOption>
                        ))}
                      </NativeSelect>
                    </Field>
                    <Field className="gap-1.5">
                      <FieldLabel htmlFor="filter-seniority">Seniority</FieldLabel>
                      <NativeSelect
                        id="filter-seniority"
                        className="w-full"
                        value={filters.seniority ?? ""}
                        onChange={(e) => setFilter("seniority", e.target.value)}
                      >
                        <NativeSelectOption value="">Any seniority</NativeSelectOption>
                        {SENIORITIES.map((s) => (
                          <NativeSelectOption key={s} value={s}>
                            {SENIORITY_LABELS[s]}
                          </NativeSelectOption>
                        ))}
                      </NativeSelect>
                    </Field>
                    <Field className="gap-1.5">
                      <FieldLabel htmlFor="filter-country">Country</FieldLabel>
                      <Input
                        id="filter-country"
                        value={filters.country ?? ""}
                        onChange={(e) => setFilter("country", e.target.value)}
                      />
                    </Field>
                  </div>
                ) : (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field className="gap-1.5">
                      <FieldLabel htmlFor="filter-industry">Industry</FieldLabel>
                      <Input
                        id="filter-industry"
                        value={filters.industry ?? ""}
                        onChange={(e) => setFilter("industry", e.target.value)}
                      />
                    </Field>
                    <Field className="gap-1.5">
                      <FieldLabel htmlFor="filter-company-country">Country</FieldLabel>
                      <Input
                        id="filter-company-country"
                        value={filters.country ?? ""}
                        onChange={(e) => setFilter("country", e.target.value)}
                      />
                    </Field>
                    <Field className="gap-1.5">
                      <FieldLabel htmlFor="filter-min">Employees from</FieldLabel>
                      <Input
                        id="filter-min"
                        type="number"
                        min={0}
                        inputMode="numeric"
                        className="font-mono"
                        value={filters.employeeMin ?? ""}
                        onChange={(e) => setFilter("employeeMin", e.target.value)}
                      />
                    </Field>
                    <Field className="gap-1.5">
                      <FieldLabel htmlFor="filter-max">Employees to</FieldLabel>
                      <Input
                        id="filter-max"
                        type="number"
                        min={0}
                        inputMode="numeric"
                        className="font-mono"
                        value={filters.employeeMax ?? ""}
                        onChange={(e) => setFilter("employeeMax", e.target.value)}
                      />
                    </Field>
                  </div>
                )}
              </fieldset>
            ) : null}
          </FieldGroup>
          <DialogFooter>
            <Button type="button" variant="outline" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={pending}>
              {mode === "create" ? (
                <Plus data-icon="inline-start" aria-hidden="true" />
              ) : (
                <Pencil data-icon="inline-start" aria-hidden="true" />
              )}
              {pending ? "Saving…" : submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
