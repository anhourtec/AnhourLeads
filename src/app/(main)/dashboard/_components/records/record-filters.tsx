"use client";

import { useEffect, useState } from "react";

import { ListFilter, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

import { type ParamUpdates, useUrlParams } from "./use-url-params";

export interface FilterOption {
  value: string;
  label: string;
}

export type FilterField =
  | { kind: "checkboxes"; name: string; label: string; options: FilterOption[] }
  | { kind: "text"; name: string; label: string; placeholder?: string; hint?: string }
  | { kind: "select"; name: string; label: string; options: FilterOption[]; emptyLabel: string }
  | { kind: "range"; label: string; minName: string; maxName: string };

function fieldNames(field: FilterField): string[] {
  return field.kind === "range" ? [field.minName, field.maxName] : [field.name];
}

function TextFilter({
  id,
  value,
  placeholder,
  label,
  inputMode,
  onCommit,
}: {
  id: string;
  value: string;
  placeholder?: string;
  label: string;
  inputMode?: "numeric";
  onCommit: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => {
    if (draft.trim() !== value) onCommit(draft.trim());
  };
  return (
    <Input
      id={id}
      aria-label={label}
      className="h-7 text-sm"
      value={draft}
      inputMode={inputMode}
      placeholder={placeholder}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          commit();
        }
      }}
    />
  );
}

function FilterFields({ fields, idPrefix }: { fields: FilterField[]; idPrefix: string }) {
  const { searchParams, setParams } = useUrlParams();
  const apply = (updates: ParamUpdates) => setParams(updates);

  return (
    <FieldGroup className="gap-5">
      {fields.map((field) => {
        const key = fieldNames(field).join("-");
        if (field.kind === "checkboxes") {
          const selected = searchParams.getAll(field.name);
          return (
            <FieldSet key={key} className="gap-2">
              <FieldLegend variant="label" className="mb-0 text-muted-foreground data-[variant=label]:text-xs">
                {field.label}
              </FieldLegend>
              <div className="flex flex-col gap-1.5">
                {field.options.map((option) => {
                  const id = `${idPrefix}-${field.name}-${option.value}`;
                  const checked = selected.includes(option.value);
                  return (
                    <div key={option.value} className="flex items-center gap-2">
                      <Checkbox
                        id={id}
                        checked={checked}
                        onCheckedChange={(next) =>
                          apply({
                            [field.name]: next
                              ? [...selected, option.value]
                              : selected.filter((value) => value !== option.value),
                          })
                        }
                      />
                      <Label htmlFor={id} className="font-normal text-sm">
                        {option.label}
                      </Label>
                    </div>
                  );
                })}
              </div>
            </FieldSet>
          );
        }
        if (field.kind === "select") {
          const id = `${idPrefix}-${field.name}`;
          return (
            <Field key={key} className="gap-1.5">
              <FieldLabel htmlFor={id} className="text-muted-foreground text-xs">
                {field.label}
              </FieldLabel>
              <NativeSelect
                id={id}
                size="sm"
                className="w-full"
                value={searchParams.get(field.name) ?? ""}
                onChange={(event) => apply({ [field.name]: event.target.value || null })}
              >
                <NativeSelectOption value="">{field.emptyLabel}</NativeSelectOption>
                {field.options.map((option) => (
                  <NativeSelectOption key={option.value} value={option.value}>
                    {option.label}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Field>
          );
        }
        if (field.kind === "text") {
          const id = `${idPrefix}-${field.name}`;
          return (
            <Field key={key} className="gap-1.5">
              <FieldLabel htmlFor={id} className="text-muted-foreground text-xs">
                {field.label}
              </FieldLabel>
              <TextFilter
                id={id}
                label={field.label}
                value={searchParams.get(field.name) ?? ""}
                placeholder={field.placeholder}
                onCommit={(value) => apply({ [field.name]: value || null })}
              />
              {field.hint ? <p className="text-muted-foreground text-xs">{field.hint}</p> : null}
            </Field>
          );
        }
        const minId = `${idPrefix}-${field.minName}`;
        return (
          <FieldSet key={key} className="gap-1.5">
            <FieldLegend variant="label" className="mb-0 text-muted-foreground data-[variant=label]:text-xs">
              {field.label}
            </FieldLegend>
            <div className="grid grid-cols-2 gap-2">
              <TextFilter
                id={minId}
                label={`${field.label}, minimum`}
                inputMode="numeric"
                placeholder="Min"
                value={searchParams.get(field.minName) ?? ""}
                onCommit={(value) => apply({ [field.minName]: value.replace(/\D/g, "") || null })}
              />
              <TextFilter
                id={`${idPrefix}-${field.maxName}`}
                label={`${field.label}, maximum`}
                inputMode="numeric"
                placeholder="Max"
                value={searchParams.get(field.maxName) ?? ""}
                onCommit={(value) => apply({ [field.maxName]: value.replace(/\D/g, "") || null })}
              />
            </div>
          </FieldSet>
        );
      })}
    </FieldGroup>
  );
}

function useActiveFilters(fields: FilterField[]) {
  const { searchParams, setParams } = useUrlParams();
  const names = fields.flatMap(fieldNames);
  const active = names.reduce((n, name) => n + searchParams.getAll(name).filter(Boolean).length, 0);
  const clear = () => setParams(Object.fromEntries(names.map((name) => [name, null])));
  return { active, clear };
}

function ClearButton({ onClick }: { onClick: () => void }) {
  return (
    <Button variant="ghost" size="sm" onClick={onClick}>
      <X data-icon="inline-start" aria-hidden="true" />
      Clear all
    </Button>
  );
}

/** Filters as a left column; shown from `lg` up. */
export function RecordFiltersAside({ fields, title = "Filters" }: { fields: FilterField[]; title?: string }) {
  const { active, clear } = useActiveFilters(fields);
  return (
    <aside aria-label={title} className="hidden lg:block">
      <Card className="sticky top-4 gap-4">
        <CardHeader className="flex min-h-7 flex-row items-center justify-between gap-2">
          <CardTitle className="font-medium text-base">{title}</CardTitle>
          {active ? <ClearButton onClick={clear} /> : null}
        </CardHeader>
        <CardContent>
          <FilterFields fields={fields} idPrefix="aside" />
        </CardContent>
      </Card>
    </aside>
  );
}

/** "Filters" button opening the same filters in a sheet; shown below `lg`. */
export function RecordFiltersSheet({ fields, title = "Filters" }: { fields: FilterField[]; title?: string }) {
  const { active, clear } = useActiveFilters(fields);
  return (
    <div className="lg:hidden">
      <Sheet>
        <SheetTrigger asChild>
          <Button variant="outline" size="sm">
            <ListFilter data-icon="inline-start" aria-hidden="true" />
            Filters
            {active ? (
              <Badge variant="secondary" className="ml-1 font-mono tabular-nums">
                {active}
              </Badge>
            ) : null}
          </Button>
        </SheetTrigger>
        <SheetContent side="left" className="w-full max-w-sm overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{title}</SheetTitle>
            <SheetDescription>Results update as you change filters.</SheetDescription>
          </SheetHeader>
          <div className="px-4">
            <FilterFields fields={fields} idPrefix="sheet" />
          </div>
          <SheetFooter>{active ? <ClearButton onClick={clear} /> : null}</SheetFooter>
        </SheetContent>
      </Sheet>
    </div>
  );
}
