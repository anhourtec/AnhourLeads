"use client";

import { useEffect, useId, useState } from "react";

import Link from "next/link";

import { ArrowDownUp, ChevronDown, MessageSquareText, Settings2, Sparkles, Workflow, Zap } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { PER_PAGE_OPTIONS, type SearchEntity, SORT_FIELDS } from "@/lib/search/filters";

export type Density = "comfortable" | "compact";

/** Sort field + direction + Apply ("Relevance" means newest first). */
export function SortPopover({
  entity,
  sortBy,
  ascending,
  onApply,
  fields: fieldsProp,
}: {
  entity: SearchEntity;
  sortBy: string;
  ascending: boolean;
  onApply: (sortBy: string | null, ascending: boolean) => void;
  /** Sort fields to offer (defaults to the workspace fields for the entity). */
  fields?: { value: string; label: string }[];
}) {
  const fields = fieldsProp ?? SORT_FIELDS[entity];
  const id = useId();
  const [open, setOpen] = useState(false);
  const [field, setField] = useState(sortBy);
  const [asc, setAsc] = useState(ascending);
  useEffect(() => {
    if (open) {
      setField(sortBy);
      setAsc(ascending);
    }
  }, [open, sortBy, ascending]);
  const label = fields.find((f) => f.value === sortBy)?.label ?? "Relevance";
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" aria-label={`Sort: ${label}`}>
          <ArrowDownUp data-icon="inline-start" aria-hidden="true" />
          {label}
          <ChevronDown data-icon="inline-end" aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${id}-field`}>Sort by</Label>
          <NativeSelect id={`${id}-field`} size="sm" value={field} onChange={(e) => setField(e.target.value)}>
            <NativeSelectOption value="">Relevance (newest first)</NativeSelectOption>
            {fields.map((f) => (
              <NativeSelectOption key={f.value} value={f.value}>
                {f.label}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
        <RadioGroup
          value={asc ? "asc" : "desc"}
          onValueChange={(v) => setAsc(v === "asc")}
          aria-label="Sort direction"
          className="gap-2"
        >
          <div className="flex items-center gap-2">
            <RadioGroupItem id={`${id}-asc`} value="asc" />
            <Label htmlFor={`${id}-asc`} className="font-normal">
              Ascending
            </Label>
          </div>
          <div className="flex items-center gap-2">
            <RadioGroupItem id={`${id}-desc`} value="desc" />
            <Label htmlFor={`${id}-desc`} className="font-normal">
              Descending
            </Label>
          </div>
        </RadioGroup>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={() => {
              onApply(field || null, asc);
              setOpen(false);
            }}
          >
            Apply
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** Row density and results per page. */
export function SearchSettingsPopover({
  density,
  onDensity,
  perPage,
  onPerPage,
}: {
  density: Density;
  onDensity: (d: Density) => void;
  perPage: number;
  onPerPage: (n: number) => void;
}) {
  const id = useId();
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm">
          <Settings2 data-icon="inline-start" aria-hidden="true" />
          Search settings
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${id}-density`}>Row density</Label>
          <NativeSelect
            id={`${id}-density`}
            size="sm"
            value={density}
            onChange={(e) => onDensity(e.target.value === "compact" ? "compact" : "comfortable")}
          >
            <NativeSelectOption value="comfortable">Comfortable</NativeSelectOption>
            <NativeSelectOption value="compact">Compact</NativeSelectOption>
          </NativeSelect>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${id}-per-page`}>Results per page</Label>
          <NativeSelect
            id={`${id}-per-page`}
            size="sm"
            value={String(perPage)}
            onChange={(e) => onPerPage(Number(e.target.value))}
          >
            {PER_PAGE_OPTIONS.map((n) => (
              <NativeSelectOption key={n} value={String(n)}>
                {n}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** Research with AI: find and verify emails for the selection, or ask the assistant about the search. */
export function ResearchMenu({
  entity,
  selectedCount,
  canEnrich,
  canAsk,
  assistantHref,
  onEnrichSelected,
}: {
  entity: SearchEntity;
  selectedCount: number;
  canEnrich: boolean;
  canAsk: boolean;
  assistantHref: string;
  onEnrichSelected: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="text-primary">
          <Sparkles data-icon="inline-start" aria-hidden="true" />
          Research with AI
          <ChevronDown data-icon="inline-end" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72">
        <DropdownMenuLabel className="text-muted-foreground text-xs">
          {selectedCount ? `${selectedCount.toLocaleString("en-US")} selected` : "Select records to research them"}
        </DropdownMenuLabel>
        <DropdownMenuItem disabled={!canEnrich || !selectedCount} onSelect={onEnrichSelected}>
          <Zap aria-hidden="true" />
          {entity === "contact" ? "Find and verify emails" : "Research company websites"}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {canAsk ? (
          <DropdownMenuItem asChild>
            <Link href={assistantHref}>
              <MessageSquareText aria-hidden="true" />
              Ask the assistant about this search
            </Link>
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem disabled>
            <MessageSquareText aria-hidden="true" />
            Ask the assistant about this search
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Create workflow: start a workflow from these filters, or open the workflows page. */
export function WorkflowMenu({ canCreate, fromSearchHref }: { canCreate: boolean; fromSearchHref: string }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm">
          <Workflow data-icon="inline-start" aria-hidden="true" />
          Create workflow
          <ChevronDown data-icon="inline-end" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        {canCreate ? (
          <DropdownMenuItem asChild>
            <Link href={fromSearchHref}>
              <Zap aria-hidden="true" />
              From this search
            </Link>
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem disabled>
            <Zap aria-hidden="true" />
            From this search
          </DropdownMenuItem>
        )}
        <DropdownMenuItem asChild>
          <Link href="/dashboard/workflows">
            <Workflow aria-hidden="true" />
            View workflows
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
