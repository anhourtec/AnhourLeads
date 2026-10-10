"use client";

import { useId, useState } from "react";

import { useRouter } from "next/navigation";

import { zodResolver } from "@hookform/resolvers/zod";
import { Pencil, Plus } from "lucide-react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

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
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { COMPANY_STAGE_LABELS, COMPANY_STAGES } from "@/lib/records-vocabulary";

import { apiRequest } from "../../_components/records/api-client";
import type { CompanyRow, Option } from "./types";

const wholeNumber = (label: string, max: number) =>
  z
    .string()
    .trim()
    .refine((v) => v === "" || (/^\d+$/.test(v.replace(/,/g, "")) && Number(v.replace(/,/g, "")) <= max), {
      message: `${label} must be a whole number.`,
    });

const formSchema = z.object({
  name: z.string().trim().min(1, "Give the company a name.").max(200),
  domain: z
    .string()
    .trim()
    .max(255)
    .refine((v) => v === "" || /^(https?:\/\/)?(www\.)?[a-z0-9-]+(\.[a-z0-9-]+)+\/?$/i.test(v), {
      message: "Enter a domain like example.com.",
    }),
  websiteUrl: z.string().trim().max(500),
  industry: z.string().trim().max(100),
  employeeCount: wholeNumber("Employees", 10_000_000),
  annualRevenue: wholeNumber("Annual revenue", Number.MAX_SAFE_INTEGER),
  foundedYear: z
    .string()
    .trim()
    .refine((v) => v === "" || (/^\d{4}$/.test(v) && Number(v) >= 1000 && Number(v) <= 2100), {
      message: "Enter a four-digit year.",
    }),
  phone: z.string().trim().max(50),
  linkedinUrl: z.string().trim().max(500),
  city: z.string().trim().max(100),
  state: z.string().trim().max(100),
  country: z.string().trim().max(100),
  stage: z.string(),
  ownerId: z.string(),
  technologies: z.string().trim().max(1000),
  keywords: z.string().trim().max(1000),
  description: z.string().trim().max(5000),
});
type FormValues = z.infer<typeof formSchema>;
type TextField = Exclude<keyof FormValues, "stage" | "ownerId" | "description">;

const LIST_FIELDS = new Set(["technologies", "keywords"]);
const NUMBER_FIELDS = new Set(["employeeCount", "annualRevenue", "foundedYear"]);

function toForm(company?: CompanyRow): FormValues {
  return {
    name: company?.name ?? "",
    domain: company?.domain ?? "",
    websiteUrl: company?.websiteUrl ?? "",
    industry: company?.industry ?? "",
    employeeCount: company?.employeeCount?.toString() ?? "",
    annualRevenue: company?.annualRevenue?.toString() ?? "",
    foundedYear: company?.foundedYear?.toString() ?? "",
    phone: company?.phone ?? "",
    linkedinUrl: company?.linkedinUrl ?? "",
    city: company?.city ?? "",
    state: company?.state ?? "",
    country: company?.country ?? "",
    stage: company?.stage ?? "cold",
    ownerId: company?.ownerId ?? "",
    technologies: company?.technologies.join(", ") ?? "",
    keywords: company?.keywords.join(", ") ?? "",
    description: company?.description ?? "",
  };
}

function toPayload(values: FormValues): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(values)) {
    const value = raw.trim();
    if (LIST_FIELDS.has(key)) {
      out[key] = value
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
    } else if (NUMBER_FIELDS.has(key)) out[key] = value === "" ? null : Number(value.replace(/,/g, ""));
    else out[key] = value === "" ? null : value;
  }
  return out;
}

const TEXT_FIELDS: { name: TextField; label: string; type?: string; mono?: boolean; wide?: boolean; hint?: string }[] =
  [
    { name: "name", label: "Name", wide: true },
    { name: "domain", label: "Domain", mono: true, hint: "Used to match imports and people's emails." },
    { name: "websiteUrl", label: "Website", type: "url", mono: true },
    { name: "industry", label: "Industry" },
    { name: "employeeCount", label: "Employees", mono: true },
    { name: "annualRevenue", label: "Annual revenue (USD)", mono: true },
    { name: "foundedYear", label: "Founded", mono: true },
    { name: "phone", label: "Phone", type: "tel", mono: true },
    { name: "linkedinUrl", label: "LinkedIn URL", type: "url", mono: true },
    { name: "city", label: "City" },
    { name: "state", label: "State or region" },
    { name: "country", label: "Country" },
    { name: "technologies", label: "Technologies", hint: "Separate with commas." },
    { name: "keywords", label: "Keywords", wide: true, hint: "Separate with commas." },
  ];

/** Add a company, or edit one (only changed fields are sent, so provenance stays accurate). */
export function CompanyFormDialog({ company, members }: { company?: CompanyRow; members: Option[] }) {
  const router = useRouter();
  const id = useId();
  const editing = Boolean(company);
  const submitLabel = editing ? "Save changes" : "Add company";
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const initial = toForm(company);
  const form = useForm<FormValues>({ resolver: zodResolver(formSchema), defaultValues: initial });

  async function onSubmit(values: FormValues) {
    setError(null);
    const payload = toPayload(values);
    let body: Record<string, unknown>;
    if (company) {
      const before = toPayload(toForm(company));
      body = Object.fromEntries(
        Object.entries(payload).filter(([key, value]) => JSON.stringify(value) !== JSON.stringify(before[key])),
      );
      if (!Object.keys(body).length) {
        setOpen(false);
        return;
      }
    } else {
      body = Object.fromEntries(
        Object.entries(payload).filter(([, value]) => value !== null && !(Array.isArray(value) && !value.length)),
      );
    }
    const result = await apiRequest<{ account: CompanyRow }>(
      company ? `/api/v1/accounts/${company.id}` : "/api/v1/accounts",
      { method: company ? "PATCH" : "POST", body },
    );
    if (!result.ok) {
      setError(result.status === 409 ? "Another company in this workspace already has this domain." : result.error);
      return;
    }
    toast.success(company ? "Changes saved." : `${result.data.account.name} added.`);
    setOpen(false);
    form.reset(company ? toForm(result.data.account) : initial);
    router.refresh();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setError(null);
          form.reset(initial);
        }
      }}
    >
      <DialogTrigger asChild>
        {editing ? (
          <Button variant="outline" size="sm">
            <Pencil data-icon="inline-start" aria-hidden="true" />
            Edit
          </Button>
        ) : (
          <Button size="sm">
            <Plus data-icon="inline-start" aria-hidden="true" />
            Add company
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{editing ? `Edit ${company?.name}` : "Add company"}</DialogTitle>
          <DialogDescription>
            {editing
              ? "Changed fields are recorded as manual edits."
              : "Domains are unique within the workspace. Only the name is required."}
          </DialogDescription>
        </DialogHeader>
        <form noValidate onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4">
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          <FieldGroup className="grid gap-3 sm:grid-cols-2">
            {TEXT_FIELDS.map((f) => (
              <Controller
                key={f.name}
                control={form.control}
                name={f.name}
                render={({ field, fieldState }) => (
                  <Field className={f.wide ? "gap-1.5 sm:col-span-2" : "gap-1.5"} data-invalid={fieldState.invalid}>
                    <FieldLabel htmlFor={`${id}-${f.name}`}>{f.label}</FieldLabel>
                    <Input
                      {...field}
                      id={`${id}-${f.name}`}
                      type={f.type ?? "text"}
                      inputMode={NUMBER_FIELDS.has(f.name) ? "numeric" : undefined}
                      className={f.mono ? "font-mono" : undefined}
                      aria-invalid={fieldState.invalid}
                    />
                    {f.hint ? <p className="text-muted-foreground text-xs">{f.hint}</p> : null}
                    {fieldState.invalid ? <FieldError errors={[fieldState.error]} /> : null}
                  </Field>
                )}
              />
            ))}
            <Field className="gap-1.5">
              <FieldLabel htmlFor={`${id}-stage`}>Stage</FieldLabel>
              <NativeSelect id={`${id}-stage`} className="w-full" {...form.register("stage")}>
                {COMPANY_STAGES.map((s) => (
                  <NativeSelectOption key={s} value={s}>
                    {COMPANY_STAGE_LABELS[s]}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Field>
            <Field className="gap-1.5">
              <FieldLabel htmlFor={`${id}-owner`}>Owner</FieldLabel>
              <NativeSelect id={`${id}-owner`} className="w-full" {...form.register("ownerId")}>
                <NativeSelectOption value="">{editing ? "Unassigned" : "Me"}</NativeSelectOption>
                {members.map((m) => (
                  <NativeSelectOption key={m.id} value={m.id}>
                    {m.name}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Field>
            <Field className="gap-1.5 sm:col-span-2">
              <FieldLabel htmlFor={`${id}-description`}>Description</FieldLabel>
              <Textarea id={`${id}-description`} rows={3} {...form.register("description")} />
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button type="submit" size="sm" disabled={form.formState.isSubmitting}>
              {editing ? (
                <Pencil data-icon="inline-start" aria-hidden="true" />
              ) : (
                <Plus data-icon="inline-start" aria-hidden="true" />
              )}
              {form.formState.isSubmitting ? "Saving…" : submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
