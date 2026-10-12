"use client";

import { useEffect, useId, useState } from "react";

import { cn } from "cn";
import { ArrowDown, ArrowUp, ChevronDown, Lock, Pin, PinOff, Search } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { FilterState } from "@/lib/search/filters";

import { activeCountFor, type FilterDef, type FilterGroup, filtersFor, GROUP_LABELS } from "./filter-catalog";
import { type EditorContext, FilterEditor, type FilterPatch } from "./filter-editors";

/** Modal columns: the last one stacks "Created source" and "Misc." like the reference layout. */
const COLUMNS: FilterGroup[][] = [["person"], ["company"], ["engagement"], ["source", "misc"]];

function applyPatch(state: FilterState, patch: FilterPatch): FilterState {
  const next = { ...state };
  for (const [key, value] of Object.entries(patch)) {
    if (value === null || value === "" || (Array.isArray(value) && !value.length)) delete next[key];
    else next[key] = value;
  }
  return next;
}

function FilterCard({
  def,
  draft,
  onChange,
  ctx,
  pinned,
  onTogglePin,
  onMove,
}: {
  def: FilterDef;
  draft: FilterState;
  onChange: (patch: FilterPatch) => void;
  ctx: EditorContext;
  pinned: boolean;
  onTogglePin?: () => void;
  onMove?: (dir: -1 | 1) => void;
}) {
  const [open, setOpen] = useState(false);
  const Icon = def.icon;
  const active = activeCountFor(def, draft);
  const disabled = def.editor === "disabled";
  if (disabled) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-disabled="true"
            aria-label={`${def.label} (needs a data provider)`}
            className="flex w-full cursor-not-allowed items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2.5 text-left text-muted-foreground text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Icon className="size-4 shrink-0" aria-hidden="true" />
            <span className="flex-1 truncate">{def.label}</span>
            <Lock className="size-3.5" aria-hidden="true" />
          </button>
        </TooltipTrigger>
        <TooltipContent>Needs a data provider</TooltipContent>
      </Tooltip>
    );
  }
  return (
    <div className={cn("rounded-lg border bg-card", active && "border-primary/40")} data-filter-card={def.id}>
      <div className="flex items-center gap-1 px-2">
        {onMove ? (
          <span className="flex flex-col">
            <button
              type="button"
              aria-label={`Move ${def.label} up`}
              className="rounded p-0.5 text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => onMove(-1)}
            >
              <ArrowUp className="size-3" aria-hidden="true" />
            </button>
            <button
              type="button"
              aria-label={`Move ${def.label} down`}
              className="rounded p-0.5 text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => onMove(1)}
            >
              <ArrowDown className="size-3" aria-hidden="true" />
            </button>
          </span>
        ) : null}
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-1 py-2.5 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="truncate">{def.label}</span>
          {active ? (
            <Badge variant="secondary" className="font-mono tabular-nums">
              {active}
            </Badge>
          ) : null}
        </button>
        {onTogglePin ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-pressed={pinned}
            aria-label={pinned ? `Unpin ${def.label}` : `Pin ${def.label}`}
            onClick={onTogglePin}
          >
            {pinned ? <PinOff aria-hidden="true" /> : <Pin aria-hidden="true" />}
          </Button>
        ) : null}
        <ChevronDown
          className={cn("size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")}
          aria-hidden="true"
        />
      </div>
      {open ? (
        <div className="border-t px-3 py-3">
          <FilterEditor def={def} state={draft} onChange={onChange} ctx={ctx} />
        </div>
      ) : null}
    </div>
  );
}

/**
 * Every filter in one place: search, type, pinned column, grouped columns, a live record count for
 * the draft and Apply. Changes stay in the draft until Apply.
 */
export function FiltersModal({
  open,
  onOpenChange,
  filters,
  ctx,
  pins,
  onPinsChange,
  onApply,
  countUrl,
  fixedBody,
  pinnable = true,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  filters: FilterState;
  ctx: EditorContext;
  pins: string[];
  onPinsChange: (pins: string[]) => void;
  /** Pinning applies to the search rail; off where there is no rail (list filters). */
  pinnable?: boolean;
  onApply: (next: FilterState) => void;
  countUrl: string;
  fixedBody: Record<string, unknown>;
}) {
  const id = useId();
  const [draft, setDraft] = useState<FilterState>(filters);
  const [q, setQ] = useState("");
  const [group, setGroup] = useState<"all" | FilterGroup>("all");
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    if (open) {
      setDraft(filters);
      setQ("");
    }
  }, [open, filters]);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      fetch(countUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        signal: controller.signal,
        body: JSON.stringify({ ...draft, ...fixedBody, per_page: 1 }),
      })
        .then((r) => (r.ok ? (r.json() as Promise<{ pagination: { total_entries: number } }>) : null))
        .then((d) => setCount(d ? d.pagination.total_entries : null))
        .catch(() => undefined);
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [draft, open, countUrl, fixedBody]);

  const all = filtersFor(ctx.entity);
  const matches = (d: FilterDef) =>
    (!q || d.label.toLowerCase().includes(q.toLowerCase())) && (group === "all" || d.group === group);
  const pinnedDefs = pins.flatMap((p) => all.filter((d) => d.id === p && matches(d)));
  const groups = (Object.keys(GROUP_LABELS) as FilterGroup[]).filter((g) => group === "all" || g === group);
  const change = (patch: FilterPatch) => setDraft((d) => applyPatch(d, patch));
  const togglePin = (pid: string) => onPinsChange(pins.includes(pid) ? pins.filter((p) => p !== pid) : [...pins, pid]);
  const move = (pid: string, dir: -1 | 1) => {
    const i = pins.indexOf(pid);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= pins.length) return;
    const next = [...pins];
    [next[i], next[j]] = [next[j], next[i]];
    onPinsChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] flex-col gap-0 p-0 sm:max-w-6xl">
        <div className="flex flex-col gap-3 border-b p-4 pr-12">
          <DialogTitle className="font-medium text-base">Filters</DialogTitle>
          <DialogDescription className="sr-only">Choose filters, then apply them to the search.</DialogDescription>
          <div className="flex flex-wrap items-center gap-2">
            <InputGroup className="h-8 w-full sm:w-64">
              <InputGroupAddon align="inline-start">
                <Search className="size-3.5" aria-hidden="true" />
              </InputGroupAddon>
              <InputGroupInput
                aria-label="Search filters"
                placeholder="Search filters"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </InputGroup>
            <label htmlFor={`${id}-type`} className="sr-only">
              Filter type
            </label>
            <NativeSelect
              id={`${id}-type`}
              size="sm"
              className="w-44"
              value={group}
              onChange={(e) => setGroup(e.target.value as "all" | FilterGroup)}
            >
              <NativeSelectOption value="all">Type: All</NativeSelectOption>
              {(Object.keys(GROUP_LABELS) as FilterGroup[]).map((g) => (
                <NativeSelectOption key={g} value={g}>
                  Type: {GROUP_LABELS[g]}
                </NativeSelectOption>
              ))}
            </NativeSelect>
            <div className="ml-auto flex items-center gap-3">
              <p className="text-muted-foreground text-sm" aria-live="polite" data-testid="filters-modal-count">
                {count === null ? (
                  "Counting…"
                ) : (
                  <>
                    <span className="font-mono text-foreground tabular-nums">{count.toLocaleString("en-US")}</span>{" "}
                    {count === 1 ? "record" : "records"} found
                  </>
                )}
              </p>
              <Button
                type="button"
                size="sm"
                onClick={() => {
                  onApply(draft);
                  onOpenChange(false);
                }}
              >
                Apply filters
              </Button>
            </div>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className={cn("grid gap-4 p-4 md:grid-cols-2", pinnable ? "xl:grid-cols-5" : "xl:grid-cols-4")}>
            {pinnable ? (
              <section aria-labelledby={`${id}-pinned`} className="flex min-w-0 flex-col gap-2">
                <h3
                  id={`${id}-pinned`}
                  className="font-mono text-[11px] text-muted-foreground uppercase tracking-wider"
                >
                  Pinned filters
                </h3>
                {pinnedDefs.length ? (
                  pinnedDefs.map((def) => (
                    <FilterCard
                      key={def.id}
                      def={def}
                      draft={draft}
                      onChange={change}
                      ctx={ctx}
                      pinned
                      onTogglePin={() => togglePin(def.id)}
                      onMove={(dir) => move(def.id, dir)}
                    />
                  ))
                ) : (
                  <p className="text-muted-foreground text-xs">Pin filters to keep them in the left rail.</p>
                )}
              </section>
            ) : null}
            {COLUMNS.map((column) => {
              const sections = column.flatMap((g) => {
                if (!groups.includes(g)) return [];
                const defs = all.filter((d) => d.group === g && matches(d) && !(pinnable && pins.includes(d.id)));
                return defs.length ? [{ g, defs }] : [];
              });
              if (!sections.length) return null;
              return (
                <div key={column.join("-")} className="flex min-w-0 flex-col gap-4">
                  {sections.map(({ g, defs }) => (
                    <section key={g} aria-labelledby={`${id}-${g}`} className="flex min-w-0 flex-col gap-2">
                      <h3
                        id={`${id}-${g}`}
                        className="font-mono text-[11px] text-muted-foreground uppercase tracking-wider"
                      >
                        {GROUP_LABELS[g]}
                      </h3>
                      {defs.map((def) => (
                        <FilterCard
                          key={def.id}
                          def={def}
                          draft={draft}
                          onChange={change}
                          ctx={ctx}
                          pinned={false}
                          onTogglePin={def.editor === "disabled" || !pinnable ? undefined : () => togglePin(def.id)}
                        />
                      ))}
                    </section>
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
