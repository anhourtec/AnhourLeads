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
import { CONTACT_STAGE_LABELS, CONTACT_STAGES, SENIORITIES, SENIORITY_LABELS } from "@/lib/records-vocabulary";

import { apiRequest } from "../../_components/records/api-client";
import type { CompanyOption, Option, PersonRow } from "./types";

const formSchema = z
  .object({
    firstName: z.string().trim().max(100, "Keep it under 100 characters."),
    lastName: z.string().trim().max(100, "Keep it under 100 characters."),
    email: z.union([z.literal(""), z.email({ message: "Enter a valid email address." })]),
    title: z.string().trim().max(200, "Keep it under 200 characters."),
    seniority: z.string(),
    department: z.string().trim().max(100),
    companyId: z.string(),
    stage: z.string(),
    ownerId: z.string(),
    phone: z.string().trim().max(50),
    linkedinUrl: z.string().trim().max(500),
    city: z.string().trim().max(100),
    state: z.string().trim().max(100),
    country: z.string().trim().max(100),
    tags: z.string().trim().max(500),
  })
  .refine((v) => Boolean(v.firstName || v.lastName || v.email), {
    message: "Give the person a name or an email address.",
    path: ["firstName"],
  });
type FormValues = z.infer<typeof formSchema>;
type TextField = Exclude<keyof FormValues, "seniority" | "companyId" | "stage" | "ownerId">;

function toForm(person?: PersonRow): FormValues {
  return {
    firstName: person?.firstName ?? "",
    lastName: person?.lastName ?? "",
    email: person?.email ?? "",
    title: person?.title ?? "",
    seniority: person?.seniority ?? "",
    department: person?.department ?? "",
    companyId: person?.companyId ?? "",
    stage: person?.stage ?? "new",
    ownerId: person?.ownerId ?? "",
    phone: person?.phone ?? "",
    linkedinUrl: person?.linkedinUrl ?? "",
    city: person?.city ?? "",
    state: person?.state ?? "",
    country: person?.country ?? "",
    tags: person?.tags.join(", ") ?? "",
  };
}

function toPayload(values: FormValues): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(values)) {
    if (key === "tags") {
      out.tags = value
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
    } else out[key] = value.trim() === "" ? null : value.trim();
  }
  return out;
}

const TEXT_FIELDS: { name: TextField; label: string; type?: string; mono?: boolean; wide?: boolean; hint?: string }[] =
  [
    { name: "firstName", label: "First name" },
    { name: "lastName", label: "Last name" },
    { name: "email", label: "Email", type: "email", mono: true, wide: true },
    { name: "title", label: "Title", wide: true },
    { name: "department", label: "Department" },
    { name: "phone", label: "Phone", type: "tel", mono: true },
    { name: "linkedinUrl", label: "LinkedIn URL", type: "url", mono: true, wide: true },
    { name: "city", label: "City" },
    { name: "state", label: "State or region" },
    { name: "country", label: "Country" },
    { name: "tags", label: "Tags", hint: "Separate tags with commas." },
  ];

/** Add a person, or edit one (only changed fields are sent, so provenance stays accurate). */
export function PersonFormDialog({
  person,
  members,
  companies,
  defaultCompanyId,
  open: controlledOpen,
  onOpenChange,
  hideTrigger,
}: {
  person?: PersonRow;
  members: Option[];
  companies: CompanyOption[];
  defaultCompanyId?: string;
  /** Controlled mode (e.g. opened from a menu); `hideTrigger` drops the built-in button. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  hideTrigger?: boolean;
}) {
  const router = useRouter();
  const id = useId();
  const editing = Boolean(person);
  const submitLabel = editing ? "Save changes" : "Add person";
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = controlledOpen ?? uncontrolledOpen;
  const setOpen = (next: boolean) => {
    setUncontrolledOpen(next);
    onOpenChange?.(next);
  };
  const [error, setError] = useState<string | null>(null);
  const initial = { ...toForm(person), ...(defaultCompanyId && !person ? { companyId: defaultCompanyId } : {}) };
  const form = useForm<FormValues>({ resolver: zodResolver(formSchema), defaultValues: initial });

  async function onSubmit(values: FormValues) {
    setError(null);
    const payload = toPayload(values);
    let body: Record<string, unknown>;
    if (person) {
      const before = toPayload(toForm(person));
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
      if (!body.ownerId) delete body.ownerId;
    }
    const result = await apiRequest<{ contact: PersonRow }>(
      person ? `/api/v1/contacts/${person.id}` : "/api/v1/contacts",
      { method: person ? "PATCH" : "POST", body },
    );
    if (!result.ok) {
      setError(result.status === 409 ? "Someone in this workspace already has this email." : result.error);
      return;
    }
    toast.success(person ? "Changes saved." : `${result.data.contact.name} added.`);
    setOpen(false);
    form.reset(person ? toForm(result.data.contact) : initial);
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
      {hideTrigger ? null : (
        <DialogTrigger asChild>
          {editing ? (
            <Button variant="outline" size="sm">
              <Pencil data-icon="inline-start" aria-hidden="true" />
              Edit
            </Button>
          ) : (
            <Button size="sm">
              <Plus data-icon="inline-start" aria-hidden="true" />
              Add person
            </Button>
          )}
        </DialogTrigger>
      )}
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{editing ? `Edit ${person?.name}` : "Add person"}</DialogTitle>
          <DialogDescription>
            {editing
              ? "Changed fields are recorded as manual edits."
              : "Emails are unique within the workspace. Everything except a name or email is optional."}
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
                      className={f.mono ? "font-mono" : undefined}
                      aria-invalid={fieldState.invalid}
                    />
                    {f.hint ? <p className="text-muted-foreground text-xs">{f.hint}</p> : null}
                    {fieldState.invalid ? <FieldError errors={[fieldState.error]} /> : null}
                  </Field>
                )}
              />
            ))}
            <SelectField id={`${id}-seniority`} label="Seniority" {...form.register("seniority")}>
              <NativeSelectOption value="">Not set</NativeSelectOption>
              {SENIORITIES.map((s) => (
                <NativeSelectOption key={s} value={s}>
                  {SENIORITY_LABELS[s]}
                </NativeSelectOption>
              ))}
            </SelectField>
            <SelectField id={`${id}-stage`} label="Stage" {...form.register("stage")}>
              {CONTACT_STAGES.map((s) => (
                <NativeSelectOption key={s} value={s}>
                  {CONTACT_STAGE_LABELS[s]}
                </NativeSelectOption>
              ))}
            </SelectField>
            <SelectField id={`${id}-company`} label="Company" {...form.register("companyId")}>
              <NativeSelectOption value="">No company</NativeSelectOption>
              {companies.map((c) => (
                <NativeSelectOption key={c.id} value={c.id}>
                  {c.domain ? `${c.name} (${c.domain})` : c.name}
                </NativeSelectOption>
              ))}
            </SelectField>
            <SelectField id={`${id}-owner`} label="Owner" {...form.register("ownerId")}>
              <NativeSelectOption value="">{editing ? "Unassigned" : "Me"}</NativeSelectOption>
              {members.map((m) => (
                <NativeSelectOption key={m.id} value={m.id}>
                  {m.name}
                </NativeSelectOption>
              ))}
            </SelectField>
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

function SelectField({
  id,
  label,
  children,
  ...props
}: { id: string; label: string; children: React.ReactNode } & Omit<React.ComponentProps<"select">, "size">) {
  return (
    <Field className="gap-1.5">
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <NativeSelect id={id} className="w-full" {...props}>
        {children}
      </NativeSelect>
    </Field>
  );
}
