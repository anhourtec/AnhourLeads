"use client";

import { useEffect, useId, useMemo, useState } from "react";

import { useRouter } from "next/navigation";

import { Filter, Upload, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { activeFilterCount, type FilterState } from "@/lib/search/filters";

import { apiRequest } from "../../_components/records/api-client";
import { filtersFor } from "../../_components/records/search/filter-catalog";
import { chipsFor, type EditorContext, useChipLabeler } from "../../_components/records/search/filter-editors";
import { FiltersModal } from "../../_components/records/search/filters-modal";
import type { FilterPickerData } from "./types";

type Source = "none" | "filters" | "csv";

/**
 * New list drawer: name, target (people or companies) and where records come from: saved filters
 * (a dynamic list that keeps itself up to date) or a CSV file (the import wizard, adding to this list).
 */
export function NewListSheet({
  open,
  onOpenChange,
  defaultTarget,
  picker,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultTarget: "contact" | "company";
  picker: FilterPickerData;
}) {
  const router = useRouter();
  const id = useId();
  const [name, setName] = useState("");
  const [target, setTarget] = useState<"contact" | "company">(defaultTarget);
  const [source, setSource] = useState<Source>("none");
  const [filters, setFilters] = useState<FilterState>({});
  const [modalOpen, setModalOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName("");
    setTarget(defaultTarget);
    setSource("none");
    setFilters({});
    setError(null);
  }, [open, defaultTarget]);

  const ctx: EditorContext = useMemo(
    () => ({ entity: target, facets: {}, options: picker[target].options, permissions: picker[target].permissions }),
    [target, picker],
  );
  const label = useChipLabeler(target, picker[target].options);
  const chips = filtersFor(target).flatMap((def) => chipsFor(def, filters, label));
  const fixedBody = useMemo(() => ({}), []);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const dynamic = source === "filters";
    const res = await apiRequest<{ label: { id: string } }>("/api/v1/labels", {
      body: { name, entityType: target, kind: dynamic ? "dynamic" : "static", ...(dynamic ? { filters } : {}) },
    });
    setPending(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    toast.success("List created.");
    onOpenChange(false);
    const listId = res.data.label.id;
    if (source === "csv") {
      router.push(`/dashboard/import?type=${target === "contact" ? "contacts" : "accounts"}&listId=${listId}`);
    } else {
      router.push(`/dashboard/lists/${listId}`);
    }
  }

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="right" className="w-full gap-0 data-[side=right]:sm:max-w-md">
          <form onSubmit={submit} className="flex h-full flex-col">
            <SheetHeader className="border-b">
              <SheetTitle>New list</SheetTitle>
              <SheetDescription>Group people or companies to work on together.</SheetDescription>
            </SheetHeader>
            <div className="flex flex-1 flex-col gap-5 overflow-y-auto p-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`${id}-name`}>List name</Label>
                <Input
                  id={`${id}-name`}
                  value={name}
                  maxLength={120}
                  required
                  placeholder="Enter a list name"
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`${id}-target`}>List target</Label>
                <NativeSelect
                  id={`${id}-target`}
                  className="w-48"
                  value={target}
                  onChange={(e) => {
                    setTarget(e.target.value === "company" ? "company" : "contact");
                    setFilters({});
                  }}
                >
                  <NativeSelectOption value="contact">People</NativeSelectOption>
                  <NativeSelectOption value="company">Companies</NativeSelectOption>
                </NativeSelect>
              </div>
              <Separator />
              <div className="flex flex-col gap-4">
                <p className="font-medium text-sm">Add records from</p>
                <div className="flex flex-col gap-2">
                  <p className="text-muted-foreground text-xs">Filters</p>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      variant={source === "filters" ? "secondary" : "outline"}
                      size="sm"
                      onClick={() => {
                        setSource("filters");
                        setModalOpen(true);
                      }}
                    >
                      <Filter data-icon="inline-start" aria-hidden="true" />
                      Select filters
                    </Button>
                    {source === "filters" ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setSource("none");
                          setFilters({});
                        }}
                      >
                        <X data-icon="inline-start" aria-hidden="true" />
                        Don't use filters
                      </Button>
                    ) : null}
                  </div>
                  {source === "filters" ? (
                    <div className="flex flex-col gap-1 rounded-lg border p-3 text-xs" data-testid="new-list-filters">
                      <p className="text-muted-foreground">
                        {activeFilterCount(filters)
                          ? "Records matching these filters join the list automatically:"
                          : "No filters yet, so every record would be in the list."}
                      </p>
                      <ul className="flex flex-wrap gap-1">
                        {chips.map((c) => (
                          <li key={`${c.key}-${c.value}`} className="rounded-md bg-muted px-1.5 py-0.5">
                            <span className="text-muted-foreground">{c.prefix}:</span> {c.label}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </div>
                <div className="flex flex-col gap-2">
                  <p className="text-muted-foreground text-xs">CSV</p>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      variant={source === "csv" ? "secondary" : "outline"}
                      size="sm"
                      aria-pressed={source === "csv"}
                      onClick={() => setSource(source === "csv" ? "none" : "csv")}
                    >
                      <Upload data-icon="inline-start" aria-hidden="true" />
                      Upload CSV
                    </Button>
                    {source === "csv" ? (
                      <span className="text-muted-foreground text-xs">
                        You'll map the file's columns after the list is created.
                      </span>
                    ) : null}
                  </div>
                </div>
              </div>
              {error ? (
                <p role="alert" className="text-destructive text-sm">
                  {error}
                </p>
              ) : null}
            </div>
            <SheetFooter className="flex-row justify-end border-t">
              <Button type="button" variant="outline" size="sm" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={pending || !name.trim()}>
                {pending ? "Creating…" : "Create"}
              </Button>
            </SheetFooter>
          </form>
        </SheetContent>
      </Sheet>
      <FiltersModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        filters={filters}
        ctx={ctx}
        pins={[]}
        onPinsChange={() => undefined}
        pinnable={false}
        onApply={setFilters}
        countUrl={`/api/v1/${target === "contact" ? "mixed_people" : "mixed_companies"}/search`}
        fixedBody={fixedBody}
      />
    </>
  );
}
