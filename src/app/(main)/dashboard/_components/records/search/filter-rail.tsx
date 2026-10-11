"use client";

import { useState } from "react";

import { cn } from "cn";
import { ChevronDown, SlidersHorizontal, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { activeFilterCount, type FilterState, SEGMENT_LABELS, SEGMENTS, type Segment } from "@/lib/search/filters";

import { activeCountFor, type FilterDef, filterById, filtersFor } from "./filter-catalog";
import { chipsFor, type EditorContext, FilterEditor, type FilterPatch, useChipLabeler } from "./filter-editors";
import type { SegmentCounts } from "./types";

function compact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${(n / 1000).toFixed(1)}K`;
  return n.toLocaleString("en-US");
}

/** Total / Net new / Saved switch with the count under each label. */
export function SegmentTabs({
  counts,
  current,
  onChange,
  locked,
}: {
  counts: SegmentCounts;
  current: Segment;
  onChange: (segment: Segment) => void;
  locked?: Segment;
}) {
  return (
    <fieldset className="m-0 grid grid-cols-3 gap-1 rounded-lg border bg-muted/40 p-1">
      <legend className="sr-only">Records to show</legend>
      {SEGMENTS.map((s) => {
        const active = current === s;
        const disabled = Boolean(locked && locked !== s);
        return (
          <label
            key={s}
            className={cn(
              "flex cursor-pointer flex-col items-center gap-0.5 rounded-md px-2 py-1.5 text-sm transition-colors has-disabled:cursor-not-allowed has-disabled:opacity-50 has-focus-visible:ring-2 has-focus-visible:ring-ring",
              active ? "bg-background text-primary shadow-xs" : "text-foreground hover:bg-background/60",
            )}
          >
            <input
              type="radio"
              name="search-segment"
              value={s}
              checked={active}
              disabled={disabled}
              onChange={() => onChange(s)}
              className="sr-only"
            />
            <span>{SEGMENT_LABELS[s]}</span>
            <span className="font-mono text-[11px] text-muted-foreground tabular-nums">{compact(counts[s])}</span>
          </label>
        );
      })}
    </fieldset>
  );
}

/** One collapsible filter: header with active count and clear, chips when collapsed, editor when open. */
export function FilterSection({
  def,
  state,
  onChange,
  ctx,
  defaultOpen,
}: {
  def: FilterDef;
  state: FilterState;
  onChange: (patch: FilterPatch) => void;
  ctx: EditorContext;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(Boolean(defaultOpen));
  const label = useChipLabeler(ctx.entity, ctx.options);
  const active = activeCountFor(def, state);
  const chips = chipsFor(def, state, label);
  const Icon = def.icon;
  const sectionId = `filter-${def.id}`;
  const clear = () => {
    const keys = def.editor === "customFields" ? Object.keys(state).filter((k) => k.startsWith("cf.")) : def.keys;
    onChange(Object.fromEntries(keys.map((k) => [k, null])));
  };
  const grouped = new Map<string, typeof chips>();
  for (const c of chips) grouped.set(c.prefix, [...(grouped.get(c.prefix) ?? []), c]);

  return (
    <section className="border-b last:border-b-0" aria-labelledby={`${sectionId}-title`} data-filter={def.id}>
      <div className="flex items-center gap-1 px-3">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={`${sectionId}-body`}
          onClick={() => setOpen(!open)}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-md py-3 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {active ? <span className="size-1.5 shrink-0 rounded-full bg-primary" aria-hidden="true" /> : null}
          <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span id={`${sectionId}-title`} className="truncate">
            {def.label}
          </span>
        </button>
        {active ? (
          <Badge variant="secondary" className="gap-1 pr-1 font-mono tabular-nums">
            {active}
            <button
              type="button"
              aria-label={`Clear ${def.label} filter`}
              onClick={clear}
              className="rounded-sm opacity-70 hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <X className="size-3" aria-hidden="true" />
            </button>
          </Badge>
        ) : null}
        <button
          type="button"
          aria-label={open ? `Collapse ${def.label}` : `Expand ${def.label}`}
          onClick={() => setOpen(!open)}
          className="rounded-md p-1 text-muted-foreground outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ChevronDown className={cn("size-4 transition-transform", open && "rotate-180")} aria-hidden="true" />
        </button>
      </div>
      {!open && chips.length ? (
        <div className="flex flex-col gap-1.5 px-3 pb-3">
          {[...grouped.entries()].map(([prefix, list]) => (
            <div key={prefix} className="flex flex-wrap items-center gap-1 text-xs">
              <span className="text-muted-foreground">{prefix}:</span>
              {list.map((c) => (
                <Badge key={`${c.key}-${c.value}`} variant="outline" className="max-w-full gap-1 pr-1 font-normal">
                  <span className="truncate">{c.label}</span>
                  <button
                    type="button"
                    aria-label={`Remove ${prefix} ${c.label}`}
                    className="rounded-sm opacity-70 hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={() => {
                      const current = state[c.key];
                      onChange({
                        [c.key]: Array.isArray(current) ? current.filter((v) => v !== c.value) : null,
                      });
                    }}
                  >
                    <X className="size-3" aria-hidden="true" />
                  </button>
                </Badge>
              ))}
            </div>
          ))}
        </div>
      ) : null}
      {open ? (
        <div id={`${sectionId}-body`} className="px-3 pb-4">
          <FilterEditor def={def} state={state} onChange={onChange} ctx={ctx} />
        </div>
      ) : null}
    </section>
  );
}

/** Left rail: segment counts, pinned filters (plus any active ones), clear all and the full filter list. */
export function FilterRail({
  filters,
  onChange,
  onClearAll,
  ctx,
  pins,
  counts,
  segment,
  onSegment,
  lockedSegment,
  onOpenModal,
}: {
  filters: FilterState;
  onChange: (patch: FilterPatch) => void;
  onClearAll: () => void;
  ctx: EditorContext;
  pins: string[];
  counts: SegmentCounts;
  segment: Segment;
  onSegment: (s: Segment) => void;
  lockedSegment?: Segment;
  onOpenModal: () => void;
}) {
  const available = filtersFor(ctx.entity).filter((d) => d.editor !== "disabled");
  const pinned = pins.flatMap((id) => {
    const def = filterById(id);
    return def?.entities.includes(ctx.entity) && def.editor !== "disabled" ? [def] : [];
  });
  const extra = available.filter((d) => !pins.includes(d.id) && activeCountFor(d, filters) > 0);
  const total = activeFilterCount(filters);

  return (
    <div className="flex min-h-0 flex-col">
      <div className="p-3">
        <SegmentTabs counts={counts} current={segment} onChange={onSegment} locked={lockedSegment} />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto border-t">
        {[...pinned, ...extra].map((def) => (
          <FilterSection key={def.id} def={def} state={filters} onChange={onChange} ctx={ctx} />
        ))}
      </div>
      <div className="flex items-center justify-between gap-2 border-t p-3">
        <Button type="button" variant="ghost" size="sm" disabled={!total} onClick={onClearAll}>
          Clear all
          {total ? <span className="font-mono text-muted-foreground tabular-nums">{total}</span> : null}
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={onOpenModal}>
          <SlidersHorizontal data-icon="inline-start" aria-hidden="true" />
          View all filters
        </Button>
      </div>
    </div>
  );
}
