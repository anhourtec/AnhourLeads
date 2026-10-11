"use client";

import { useEffect, useId, useState } from "react";

import { useRouter } from "next/navigation";

import { Plus, Save } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { apiFetch } from "@/lib/api-fetch";
import type { CustomFieldDto, CustomFieldEntity, CustomFieldType } from "@/server/services/custom-fields";

export const TYPE_LABELS: Record<CustomFieldType, string> = {
  text: "Text",
  number: "Number",
  date: "Date",
  boolean: "Yes / no",
  picklist: "Picklist",
  url: "Web address",
};

const TYPES = Object.keys(TYPE_LABELS) as CustomFieldType[];

const ENTITY_NOUN: Record<CustomFieldEntity, string> = { contact: "people", company: "accounts", deal: "deals" };

/** Add a field (label, type, picklist options) or edit one (label and options; the type is fixed). */
export function CustomFieldDialog({
  open,
  onOpenChange,
  entityType,
  field,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entityType: CustomFieldEntity;
  field: CustomFieldDto | null;
}) {
  const router = useRouter();
  const id = useId();
  const [label, setLabel] = useState("");
  const [type, setType] = useState<CustomFieldType>("text");
  const [options, setOptions] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setLabel(field?.label ?? "");
    setType(field?.type ?? "text");
    setOptions(field?.options.join("\n") ?? "");
    setError(null);
  }, [open, field]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const list = options
      .split("\n")
      .map((o) => o.trim())
      .filter(Boolean);
    setPending(true);
    setError(null);
    const res = field
      ? await apiFetch<{ custom_field: CustomFieldDto }>(`/api/v1/custom_fields/${field.id}`, {
          method: "PATCH",
          body: { label, ...(field.type === "picklist" ? { options: list } : {}) },
        })
      : await apiFetch<{ custom_field: CustomFieldDto }>("/api/v1/custom_fields", {
          body: { entityType, label, type, ...(type === "picklist" ? { options: list } : {}) },
        });
    setPending(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    toast.success(field ? `Saved ${res.data.custom_field.label}.` : `Added ${res.data.custom_field.label}.`);
    onOpenChange(false);
    router.refresh();
  }

  const effectiveType = field?.type ?? type;

  const submitLabel = field ? "Save field" : "Add field";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{field ? "Edit field" : "Add field"}</DialogTitle>
            <DialogDescription>
              {field
                ? "Rename the field or change its options. The type stays fixed so stored values remain valid."
                : `A new field for ${ENTITY_NOUN[entityType]}.`}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <Label htmlFor={`${id}-label`}>Label</Label>
            <Input
              id={`${id}-label`}
              value={label}
              maxLength={80}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. Annual budget"
              required
            />
            {field ? (
              <p className="text-muted-foreground text-xs">
                Key <span className="font-mono">{field.key}</span> (used in the API and CSV imports)
              </p>
            ) : null}
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor={`${id}-type`}>Type</Label>
            <NativeSelect
              id={`${id}-type`}
              value={effectiveType}
              disabled={Boolean(field)}
              onChange={(e) => setType(e.target.value as CustomFieldType)}
            >
              {TYPES.map((t) => (
                <NativeSelectOption key={t} value={t}>
                  {TYPE_LABELS[t]}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </div>
          {effectiveType === "picklist" ? (
            <div className="flex flex-col gap-2">
              <Label htmlFor={`${id}-options`}>Options</Label>
              <Textarea
                id={`${id}-options`}
                value={options}
                rows={5}
                onChange={(e) => setOptions(e.target.value)}
                placeholder={"One option per line\ne.g. Small\nMedium\nLarge"}
              />
              <p className="text-muted-foreground text-xs">One option per line, up to 100.</p>
            </div>
          ) : null}
          {error ? (
            <p role="alert" className="text-destructive text-sm">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" size="sm" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={pending || !label.trim()}>
              {field ? (
                <Save data-icon="inline-start" aria-hidden="true" />
              ) : (
                <Plus data-icon="inline-start" aria-hidden="true" />
              )}
              {pending ? "Saving…" : submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
