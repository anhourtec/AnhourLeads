"use client";

import { useId, useState } from "react";

import { ArrowRight, Lock, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { employeeRangeLabel, type FilterState, type SearchEntity } from "@/lib/search/filters";
import { parseNaturalLanguage } from "@/lib/search/nl-parser";

import type { FilterPatch } from "./filter-editors";
import type { QuickFilterData } from "./types";

/** Parsed sentence → filter patch (only keys the entity supports). */
export function nlToFilters(
  text: string,
  entity: SearchEntity,
  vocabulary: { locations: string[]; industries: string[] },
) {
  const parsed = parseNaturalLanguage(text, vocabulary);
  const patch: FilterState = {};
  if (entity === "contact" && parsed.titles?.length) patch.titles = parsed.titles;
  if (parsed.location?.length) patch.location = parsed.location;
  if (parsed.industry?.length) patch.industry = parsed.industry;
  if (parsed.company?.length) patch.company = parsed.company;
  if (parsed.employeesMin) patch.employeesMin = parsed.employeesMin;
  if (parsed.employeesMax) patch.employeesMax = parsed.employeesMax;
  if (entity === "contact" && parsed.emailStatus?.length) patch.emailStatus = parsed.emailStatus;
  return patch;
}

/** "Describe who you're looking for" box: a rule-based parser fills the filters (no AI service). */
export function NaturalLanguageBox({
  entity,
  vocabulary,
  onApply,
}: {
  entity: SearchEntity;
  vocabulary: { locations: string[]; industries: string[] };
  onApply: (filters: FilterState) => void;
}) {
  const id = useId();
  const [text, setText] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const example =
    entity === "contact"
      ? "e.g. VP sales in Canada at software companies with 50-200 employees"
      : "e.g. software companies in Germany with 50-200 employees";
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const filters = nlToFilters(text, entity, vocabulary);
    if (!Object.keys(filters).length) {
      setNote("That didn't match any filters. Try a title, a place, an industry or a company size.");
      return;
    }
    setNote(null);
    onApply(filters);
  };
  return (
    <form onSubmit={submit} className="flex flex-col gap-2">
      <label htmlFor={id} className="font-medium text-base">
        {entity === "contact" ? "Describe who you're looking for" : "Describe the companies you're looking for"}
      </label>
      <div className="flex gap-2">
        <div className="relative min-w-0 flex-1">
          <Sparkles
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-primary"
            aria-hidden="true"
          />
          <Input
            id={id}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={example}
            className="h-10 pl-9"
            aria-describedby={`${id}-hint`}
          />
        </div>
        <Button type="submit" size="sm" className="h-10" disabled={!text.trim()}>
          <ArrowRight data-icon="inline-start" aria-hidden="true" />
          Search
        </Button>
      </div>
      <p id={`${id}-hint`} className="text-muted-foreground text-xs">
        Turned into filters you can review and change. Nothing leaves your workspace.
      </p>
      {note ? (
        <p role="status" className="text-amber-700 text-sm dark:text-amber-400">
          {note}
        </p>
      ) : null}
    </form>
  );
}

function ChipRow({
  label,
  items,
  onPick,
}: {
  label: string;
  items: { value: string; label: string }[];
  onPick: (value: string) => void;
}) {
  if (!items.length) return null;
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <h3 className="text-muted-foreground text-xs">{label}</h3>
      <ul className="flex flex-wrap gap-1.5">
        {items.map((i) => (
          <li key={i.value}>
            <Button type="button" variant="outline" size="xs" onClick={() => onPick(i.value)}>
              {i.label}
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Quick filters card: chips from the workspace's own data. */
export function QuickFilters({
  entity,
  data,
  onApply,
}: {
  entity: SearchEntity;
  data: QuickFilterData;
  onApply: (patch: FilterPatch) => void;
}) {
  const empty = !data.locations.length && !data.titles.length && !data.industries.length && !data.employeeRanges.length;
  return (
    <section aria-labelledby="quick-filters" className="flex flex-col gap-4 rounded-xl border bg-card">
      <div className="flex flex-col gap-4 p-4">
        <h2 id="quick-filters" className="font-medium text-sm">
          Quick filters
        </h2>
        {empty ? (
          <p className="text-muted-foreground text-sm">Add or import records and their common values show up here.</p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            <ChipRow
              label="Locations"
              items={data.locations.map((l) => ({ value: l.value, label: l.value }))}
              onPick={(v) => onApply({ location: [v] })}
            />
            {entity === "contact" ? (
              <ChipRow
                label="Email status"
                items={[
                  { value: "valid", label: "Verified" },
                  { value: "unverified", label: "Unverified" },
                  { value: "invalid", label: "Unavailable" },
                ]}
                onPick={(v) => onApply({ emailStatus: [v] })}
              />
            ) : (
              <ChipRow
                label="Employee count"
                items={data.employeeRanges.map((r) => ({ value: r.value, label: employeeRangeLabel(r.value) }))}
                onPick={(v) => onApply({ employeeRanges: [v] })}
              />
            )}
            {entity === "contact" ? (
              <ChipRow
                label="Job titles"
                items={data.titles.map((t) => ({ value: t.value, label: t.value.toLowerCase() }))}
                onPick={(v) => onApply({ titles: [v] })}
              />
            ) : null}
            <ChipRow
              label="Industry"
              items={data.industries.map((i) => ({ value: i.value, label: i.value }))}
              onPick={(v) => onApply({ industry: [v] })}
            />
          </div>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t bg-muted/40 px-4 py-3 text-muted-foreground text-xs">
        <Lock className="size-3.5" aria-hidden="true" />
        <span>Filters that need a data provider:</span>
        {["Funding", "Buying intent", "Lookalikes"].map((f) => (
          <Tooltip key={f}>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-disabled="true"
                className="cursor-not-allowed rounded-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {f}
              </button>
            </TooltipTrigger>
            <TooltipContent>Needs a data provider</TooltipContent>
          </Tooltip>
        ))}
      </div>
    </section>
  );
}
