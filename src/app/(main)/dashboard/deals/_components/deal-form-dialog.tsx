"use client";

import { useState } from "react";

import Link from "next/link";
import { useRouter } from "next/navigation";

import { ChevronDown, ChevronRight, Plus, Save, Settings2 } from "lucide-react";
import { toast } from "sonner";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { apiFetch } from "@/lib/api-fetch";
import type { DealDto } from "@/server/services/deals";
import type { PipelineDto } from "@/server/services/pipelines";

import { type PickedRecord, RecordPicker } from "../../_components/pipeline/record-picker";

const INPUT_TYPES: Partial<Record<DealCustomField["type"], string>> = { date: "date", url: "url" };

export interface DealPrefill {
  contact: PickedRecord | null;
  company: PickedRecord | null;
}

export interface MemberOption {
  id: string;
  name: string;
  email: string;
}

export interface DealCustomField {
  key: string;
  label: string;
  type: "text" | "number" | "date" | "boolean" | "picklist" | "url";
  options: string[] | null;
}

interface Draft {
  name: string;
  company: PickedRecord | null;
  contact: PickedRecord | null;
  pipelineId: string;
  stageId: string;
  closeDate: string;
  ownerId: string;
  amount: string;
  currency: string;
  custom: Record<string, string | boolean>;
}

function draftFrom(
  deal: DealDto | null,
  pipelines: PipelineDto[],
  defaults: { pipelineId: string; stageId?: string; ownerId: string; prefill?: DealPrefill | null },
): Draft {
  const pipeline = pipelines.find((p) => p.id === (deal?.pipelineId ?? defaults.pipelineId)) ?? pipelines[0];
  const custom: Record<string, string | boolean> = {};
  for (const [k, v] of Object.entries(deal?.customFields ?? {})) {
    if (typeof v === "boolean") custom[k] = v;
    else if (v !== null && v !== undefined) custom[k] = String(v);
  }
  return {
    name: deal?.name ?? "",
    company: deal?.company
      ? { id: deal.company.id, name: deal.company.name, detail: deal.company.domain }
      : (defaults.prefill?.company ?? null),
    contact: deal?.contact
      ? { id: deal.contact.id, name: deal.contact.name, detail: deal.contact.email }
      : (defaults.prefill?.contact ?? null),
    pipelineId: pipeline?.id ?? "",
    stageId: deal?.stageId ?? defaults.stageId ?? pipeline?.stages.find((s) => s.type === "open")?.id ?? "",
    closeDate: deal?.closeDate ?? "",
    ownerId: deal ? (deal.owner?.id ?? "") : defaults.ownerId,
    amount: deal?.amount !== null && deal?.amount !== undefined ? String(deal.amount) : "",
    currency: deal?.currency ?? "USD",
    custom,
  };
}

/**
 * Create or edit a deal (reference §11): name, company (search or create an account), contact,
 * pipeline and stage, estimated close date, owner, amount and the workspace's deal fields.
 */
export function DealFormDialog({
  open,
  onOpenChange,
  deal,
  pipelines,
  defaultPipelineId,
  defaultStageId,
  members,
  customFields,
  currentUserId,
  canCreateCompany,
  prefill = null,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly deal: DealDto | null;
  readonly pipelines: PipelineDto[];
  readonly defaultPipelineId: string;
  readonly defaultStageId?: string;
  readonly members: MemberOption[];
  readonly customFields: DealCustomField[];
  readonly currentUserId: string;
  readonly canCreateCompany: boolean;
  readonly prefill?: DealPrefill | null;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft>(() =>
    draftFrom(deal, pipelines, {
      pipelineId: defaultPipelineId,
      stageId: defaultStageId,
      ownerId: currentUserId,
      prefill,
    }),
  );
  const [showCustom, setShowCustom] = useState(false);
  const [pending, setPending] = useState<"save" | "another" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const pipeline = pipelines.find((p) => p.id === draft.pipelineId) ?? pipelines[0];
  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));

  async function submit(mode: "save" | "another") {
    setPending(mode);
    setError(null);
    setFields({});
    const customFieldValues: Record<string, string | number | boolean | null> = {};
    for (const f of customFields) {
      const v = draft.custom[f.key];
      if (v === undefined) continue;
      if (f.type === "boolean") customFieldValues[f.key] = v === true;
      else if (f.type === "number") customFieldValues[f.key] = v === "" ? null : Number(v);
      else customFieldValues[f.key] = v === "" ? null : String(v);
    }
    const amount = draft.amount.replace(/[\s,$]/g, "");
    const body = {
      name: draft.name.trim(),
      pipelineId: draft.pipelineId,
      stageId: draft.stageId,
      amount: amount ? amount : null,
      currency: draft.currency || "USD",
      closeDate: draft.closeDate ? draft.closeDate : null,
      ownerId: draft.ownerId ? draft.ownerId : null,
      companyId: draft.company?.id ?? null,
      contactId: draft.contact?.id ?? null,
      ...(Object.keys(customFieldValues).length ? { customFields: customFieldValues } : {}),
    };
    const res = await apiFetch(deal ? `/api/v1/opportunities/${deal.id}` : "/api/v1/opportunities", {
      method: deal ? "PATCH" : "POST",
      body,
    });
    setPending(null);
    if (!res.ok) {
      setError(res.error);
      setFields(res.fields);
      return;
    }
    toast.success(deal ? "Deal saved" : "Deal created");
    router.refresh();
    if (mode === "another") {
      setDraft(
        draftFrom(null, pipelines, { pipelineId: draft.pipelineId, stageId: draft.stageId, ownerId: currentUserId }),
      );
      return;
    }
    onOpenChange(false);
  }

  const title = deal ? "Edit deal" : "Create deal";

  return (
    <Dialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <div className="flex items-start justify-between gap-3 pr-8">
            <DialogTitle>{title}</DialogTitle>
            <Link
              href="/dashboard/settings/custom-fields?tab=deal"
              className="inline-flex shrink-0 items-center gap-1 rounded-sm text-primary text-xs outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Settings2 className="size-3.5" aria-hidden="true" />
              Customize deal form
            </Link>
          </div>
          <DialogDescription>Track an opportunity through your pipeline.</DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void submit("save");
          }}
        >
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          <FieldGroup className="gap-4">
            <Field data-invalid={Boolean(fields.name)}>
              <FieldLabel htmlFor="deal-name">
                Deal name <span className="text-destructive">*</span>
              </FieldLabel>
              <Input
                id="deal-name"
                required
                maxLength={200}
                value={draft.name}
                onChange={(e) => set({ name: e.target.value })}
                placeholder="Northwind, annual plan"
                aria-invalid={Boolean(fields.name)}
              />
              {fields.name ? <FieldError>{fields.name}</FieldError> : null}
            </Field>
            <Field data-invalid={Boolean(fields.companyId)}>
              <FieldLabel htmlFor="deal-company">Company</FieldLabel>
              <RecordPicker
                id="deal-company"
                kind="company"
                value={draft.company}
                onChange={(company) => set({ company })}
                placeholder="Search or create an account"
                canCreate={canCreateCompany}
              />
              {fields.companyId ? <FieldError>{fields.companyId}</FieldError> : null}
            </Field>
            <Field data-invalid={Boolean(fields.contactId)}>
              <FieldLabel htmlFor="deal-contact">Contact (optional)</FieldLabel>
              <RecordPicker
                id="deal-contact"
                kind="contact"
                value={draft.contact}
                onChange={(contact) => set({ contact })}
                placeholder="Search people"
              />
            </Field>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="deal-pipeline">Pipeline</FieldLabel>
                <NativeSelect
                  id="deal-pipeline"
                  value={draft.pipelineId}
                  onChange={(e) => {
                    const next = pipelines.find((p) => p.id === e.target.value);
                    set({ pipelineId: e.target.value, stageId: next?.stages.find((s) => s.type === "open")?.id ?? "" });
                  }}
                  className="w-full"
                >
                  {pipelines.map((p) => (
                    <NativeSelectOption key={p.id} value={p.id}>
                      {p.name}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </Field>
              <Field data-invalid={Boolean(fields.stageId)}>
                <FieldLabel htmlFor="deal-stage">Stage</FieldLabel>
                <NativeSelect
                  id="deal-stage"
                  value={draft.stageId}
                  onChange={(e) => set({ stageId: e.target.value })}
                  className="w-full"
                >
                  {pipeline?.stages.map((s) => (
                    <NativeSelectOption key={s.id} value={s.id}>
                      {s.name}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </Field>
              <Field data-invalid={Boolean(fields.closeDate)}>
                <FieldLabel htmlFor="deal-close">Estimated close date</FieldLabel>
                <Input
                  id="deal-close"
                  type="date"
                  value={draft.closeDate}
                  onChange={(e) => set({ closeDate: e.target.value })}
                />
                {fields.closeDate ? <FieldError>{fields.closeDate}</FieldError> : null}
              </Field>
              <Field>
                <FieldLabel htmlFor="deal-owner">Owner</FieldLabel>
                <NativeSelect
                  id="deal-owner"
                  value={draft.ownerId}
                  onChange={(e) => set({ ownerId: e.target.value })}
                  className="w-full"
                >
                  <NativeSelectOption value="">No owner</NativeSelectOption>
                  {members.map((m) => (
                    <NativeSelectOption key={m.id} value={m.id}>
                      {m.id === currentUserId ? `${m.name} (you)` : m.name}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </Field>
            </div>
            <div className="grid grid-cols-[1fr_6rem] gap-3">
              <Field data-invalid={Boolean(fields.amount)}>
                <FieldLabel htmlFor="deal-amount">Amount</FieldLabel>
                <Input
                  id="deal-amount"
                  inputMode="numeric"
                  className="font-mono"
                  value={draft.amount}
                  onChange={(e) => set({ amount: e.target.value })}
                  placeholder="12000"
                  aria-invalid={Boolean(fields.amount)}
                />
                {fields.amount ? <FieldError>{fields.amount}</FieldError> : null}
              </Field>
              <Field data-invalid={Boolean(fields.currency)}>
                <FieldLabel htmlFor="deal-currency">Currency</FieldLabel>
                <Input
                  id="deal-currency"
                  maxLength={3}
                  className="font-mono uppercase"
                  value={draft.currency}
                  onChange={(e) => set({ currency: e.target.value.toUpperCase() })}
                />
              </Field>
            </div>
            {customFields.length ? (
              <div className="flex flex-col gap-3">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="self-start"
                  aria-expanded={showCustom}
                  onClick={() => setShowCustom((v) => !v)}
                >
                  {showCustom ? <ChevronDown data-icon="inline-start" /> : <ChevronRight data-icon="inline-start" />}
                  {showCustom ? "Hide custom fields" : `Show custom fields (${customFields.length})`}
                </Button>
                {showCustom
                  ? customFields.map((f) => {
                      const id = `deal-cf-${f.key}`;
                      const value = draft.custom[f.key];
                      const setValue = (v: string | boolean) => set({ custom: { ...draft.custom, [f.key]: v } });
                      const error_ = fields[`customFields.${f.key}`];
                      if (f.type === "boolean") {
                        return (
                          <div key={f.key} className="flex items-center gap-2">
                            <Checkbox id={id} checked={value === true} onCheckedChange={(c) => setValue(c === true)} />
                            <FieldLabel htmlFor={id}>{f.label}</FieldLabel>
                          </div>
                        );
                      }
                      return (
                        <Field key={f.key} data-invalid={Boolean(error_)}>
                          <FieldLabel htmlFor={id}>{f.label}</FieldLabel>
                          {f.type === "picklist" ? (
                            <NativeSelect
                              id={id}
                              value={typeof value === "string" ? value : ""}
                              onChange={(e) => setValue(e.target.value)}
                              className="w-full"
                            >
                              <NativeSelectOption value="">Not set</NativeSelectOption>
                              {(f.options ?? []).map((o) => (
                                <NativeSelectOption key={o} value={o}>
                                  {o}
                                </NativeSelectOption>
                              ))}
                            </NativeSelect>
                          ) : (
                            <Input
                              id={id}
                              type={INPUT_TYPES[f.type] ?? "text"}
                              inputMode={f.type === "number" ? "decimal" : undefined}
                              value={typeof value === "string" ? value : ""}
                              onChange={(e) => setValue(e.target.value)}
                            />
                          )}
                          {error_ ? <FieldError>{error_}</FieldError> : null}
                        </Field>
                      );
                    })
                  : null}
              </div>
            ) : null}
          </FieldGroup>
          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={pending !== null}
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            {!deal ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={pending !== null}
                onClick={() => void submit("another")}
              >
                <Plus data-icon="inline-start" />
                {pending === "another" ? "Saving…" : "Save and create another"}
              </Button>
            ) : null}
            <Button type="submit" size="sm" disabled={pending !== null}>
              <Save data-icon="inline-start" />
              {pending === "save" ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
