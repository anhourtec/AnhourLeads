"use client";

import { useEffect, useId, useMemo, useState } from "react";

import { Plus, UserPlus, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import {
  COMPANY_STAGE_LABELS,
  COMPANY_STAGES,
  CONTACT_STAGE_LABELS,
  CONTACT_STAGES,
  EMAIL_STATUS_LABELS,
  EMAIL_STATUSES,
  SENIORITIES,
  SENIORITY_LABELS,
} from "@/lib/records-vocabulary";
import {
  asArray,
  DEPARTMENTS,
  EMPLOYEE_RANGES,
  employeeRangeLabel,
  type FilterState,
  type FilterValue,
  type SearchEntity,
} from "@/lib/search/filters";

import type { FilterDef } from "./filter-catalog";
import type { Facets, FacetValue, SearchOptions, SearchPermissions } from "./types";

export type FilterPatch = Record<string, FilterValue | null>;

export interface EditorContext {
  entity: SearchEntity;
  facets: Facets;
  options: SearchOptions;
  permissions: SearchPermissions;
  onCreatePersona?: (initial: { titles: string[]; seniorities: string[]; departments: string[] }) => void;
  /** Why a filter can't be used here (e.g. on the shared database tabs), or null when it can. */
  unavailable?: (def: FilterDef) => string | null;
}

interface EditorProps {
  def: FilterDef;
  state: FilterState;
  onChange: (patch: FilterPatch) => void;
  ctx: EditorContext;
}

/* -------------------------------------------------------------------------- */
/* Building blocks                                                            */
/* -------------------------------------------------------------------------- */

function count(n: number | undefined) {
  if (n === undefined) return null;
  return (
    <span className="font-mono text-muted-foreground text-xs tabular-nums">
      ({n >= 1000 ? `${(n / 1000).toFixed(1)}K` : n.toLocaleString("en-US")})
    </span>
  );
}

interface CheckOption {
  value: string;
  label: string;
  count?: number;
}

/** Checkbox list with optional facet counts and a search box when long. */
export function CheckList({
  label,
  options,
  selected,
  onChange,
  searchable,
}: {
  label: string;
  options: CheckOption[];
  selected: string[];
  onChange: (values: string[]) => void;
  searchable?: boolean;
}) {
  const id = useId();
  const [q, setQ] = useState("");
  const shown = q ? options.filter((o) => o.label.toLowerCase().includes(q.toLowerCase())) : options;
  return (
    <fieldset className="m-0 flex min-w-0 flex-col gap-1.5 border-0 p-0">
      <legend className="mb-1.5 font-medium text-muted-foreground text-xs">{label}</legend>
      {searchable || options.length > 10 ? (
        <Input
          aria-label={`Search ${label.toLowerCase()}`}
          placeholder={`Search ${label.toLowerCase()}`}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="mb-1 h-7 text-xs"
        />
      ) : null}
      <div className="flex max-h-64 flex-col gap-1.5 overflow-y-auto pr-1">
        {shown.map((o, i) => {
          const checked = selected.includes(o.value);
          const cid = `${id}-${i}`;
          return (
            <div key={o.value} className="flex items-center gap-2">
              <Checkbox
                id={cid}
                checked={checked}
                onCheckedChange={(v) => onChange(v ? [...selected, o.value] : selected.filter((s) => s !== o.value))}
              />
              <Label
                htmlFor={cid}
                className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 font-normal text-sm"
              >
                <span className="truncate">{o.label}</span>
                {count(o.count)}
              </Label>
            </div>
          );
        })}
        {!shown.length ? <p className="text-muted-foreground text-xs">Nothing matches.</p> : null}
      </div>
    </fieldset>
  );
}

/** Free-text values entered one at a time, with workspace suggestions. */
export function TokenInput({
  label,
  values,
  onChange,
  placeholder,
  suggestField,
  entity,
  staticSuggestions = [],
  hint,
}: {
  label: string;
  values: string[];
  onChange: (values: string[]) => void;
  placeholder: string;
  suggestField?: string;
  entity: SearchEntity;
  staticSuggestions?: string[];
  hint?: string;
}) {
  const id = useId();
  const [text, setText] = useState("");
  const [suggestions, setSuggestions] = useState<string[]>([]);

  useEffect(() => {
    if (!suggestField) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      const path = entity === "contact" ? "mixed_people" : "mixed_companies";
      fetch(`/api/v1/${path}/filter_values?field=${suggestField}&q=${encodeURIComponent(text.trim())}&limit=15`, {
        signal: controller.signal,
        credentials: "same-origin",
      })
        .then((r) => (r.ok ? (r.json() as Promise<{ values: FacetValue[] }>) : { values: [] }))
        .then((d) => setSuggestions(d.values.map((v) => v.value)))
        .catch(() => undefined);
    }, 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [text, suggestField, entity]);

  const merged = [...new Set([...suggestions, ...staticSuggestions])].filter((s) => !values.includes(s)).slice(0, 20);

  const add = (raw: string) => {
    const v = raw.trim();
    if (!v || values.includes(v)) return;
    onChange([...values, v]);
    setText("");
  };

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <Label htmlFor={id} className="font-medium text-muted-foreground text-xs">
        {label}
      </Label>
      <div className="flex gap-1.5">
        <Input
          id={id}
          list={`${id}-list`}
          value={text}
          placeholder={placeholder}
          className="h-7 text-sm"
          onChange={(e) => {
            const v = e.target.value;
            // Picking a datalist option fires a change with the full value.
            if (merged.includes(v)) add(v);
            else setText(v);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add(text);
            }
          }}
        />
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          aria-label={`Add ${label.toLowerCase()}`}
          onClick={() => add(text)}
        >
          <Plus aria-hidden="true" />
        </Button>
      </div>
      <datalist id={`${id}-list`}>
        {merged.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
      {hint ? <p className="text-muted-foreground text-xs">{hint}</p> : null}
      {values.length ? (
        <ul className="flex flex-wrap gap-1" aria-label={`${label} values`}>
          {values.map((v) => (
            <li key={v}>
              <Badge variant="secondary" className="gap-1 pr-1 font-normal">
                {v}
                <button
                  type="button"
                  className="rounded-sm opacity-70 hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label={`Remove ${v}`}
                  onClick={() => onChange(values.filter((x) => x !== v))}
                >
                  <X className="size-3" aria-hidden="true" />
                </button>
              </Badge>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function NumberRange({
  label,
  min,
  max,
  onChange,
  placeholders = ["Min", "Max"],
}: {
  label: string;
  min: string;
  max: string;
  onChange: (min: string, max: string) => void;
  placeholders?: [string, string];
}) {
  const id = useId();
  const [a, setA] = useState(min);
  const [b, setB] = useState(max);
  useEffect(() => {
    setA(min);
    setB(max);
  }, [min, max]);
  const commit = () => {
    if (a !== min || b !== max) onChange(a.replace(/[^\d]/g, ""), b.replace(/[^\d]/g, ""));
  };
  return (
    <fieldset className="m-0 flex min-w-0 flex-col gap-1.5 border-0 p-0">
      <legend className="mb-1.5 font-medium text-muted-foreground text-xs">{label}</legend>
      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${id}-min`} className="sr-only">
            {label} minimum
          </Label>
          <Input
            id={`${id}-min`}
            inputMode="numeric"
            placeholder={placeholders[0]}
            value={a}
            className="h-7 font-mono text-sm"
            onChange={(e) => setA(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => e.key === "Enter" && commit()}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${id}-max`} className="sr-only">
            {label} maximum
          </Label>
          <Input
            id={`${id}-max`}
            inputMode="numeric"
            placeholder={placeholders[1]}
            value={b}
            className="h-7 font-mono text-sm"
            onChange={(e) => setB(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => e.key === "Enter" && commit()}
          />
        </div>
      </div>
    </fieldset>
  );
}

function DateRange({
  label,
  from,
  to,
  onChange,
}: {
  label: string;
  from: string;
  to: string;
  onChange: (from: string, to: string) => void;
}) {
  const id = useId();
  const presets = [
    { label: "Last 7 days", days: 7 },
    { label: "Last 30 days", days: 30 },
    { label: "Last 90 days", days: 90 },
  ];
  return (
    <fieldset className="m-0 flex min-w-0 flex-col gap-1.5 border-0 p-0">
      <legend className="mb-1.5 font-medium text-muted-foreground text-xs">{label}</legend>
      <div className="flex flex-wrap gap-1">
        {presets.map((p) => (
          <Button
            key={p.days}
            type="button"
            variant="outline"
            size="xs"
            onClick={() => {
              const d = new Date(Date.now() - p.days * 86_400_000).toISOString().slice(0, 10);
              onChange(d, "");
            }}
          >
            {p.label}
          </Button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${id}-from`} className="text-muted-foreground text-xs">
            From
          </Label>
          <Input
            id={`${id}-from`}
            type="date"
            value={from}
            className="h-7 text-sm"
            onChange={(e) => onChange(e.target.value, to)}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${id}-to`} className="text-muted-foreground text-xs">
            To
          </Label>
          <Input
            id={`${id}-to`}
            type="date"
            value={to}
            className="h-7 text-sm"
            onChange={(e) => onChange(from, e.target.value)}
          />
        </div>
      </div>
    </fieldset>
  );
}

function facetMap(facets: Facets, name: string): Map<string, number> {
  return new Map((facets[name] ?? []).map((f) => [f.value, f.count]));
}

function IncludeExcludeSelect({
  label,
  options,
  include,
  exclude,
  onChange,
  counts,
  anyLabel,
}: {
  label: string;
  options: { id: string; name: string }[];
  include: string[];
  exclude: string[];
  onChange: (include: string[], exclude: string[]) => void;
  counts?: Map<string, number>;
  anyLabel?: string;
}) {
  const id = useId();
  const [mode, setMode] = useState<"include" | "exclude">("include");
  const all = anyLabel ? [{ id: "any", name: anyLabel }, ...options] : options;
  const nameOf = (v: string) => all.find((o) => o.id === v)?.name ?? v;
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex items-end gap-2">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <Label htmlFor={`${id}-pick`} className="font-medium text-muted-foreground text-xs">
            {label}
          </Label>
          <NativeSelect
            id={`${id}-pick`}
            size="sm"
            value=""
            onChange={(e) => {
              const v = e.target.value;
              if (!v) return;
              if (mode === "include")
                onChange(
                  [...new Set([...include, v])],
                  exclude.filter((x) => x !== v),
                );
              else
                onChange(
                  include.filter((x) => x !== v),
                  [...new Set([...exclude, v])],
                );
            }}
          >
            <NativeSelectOption value="">{options.length || anyLabel ? "Choose…" : "None yet"}</NativeSelectOption>
            {all.map((o) => (
              <NativeSelectOption key={o.id} value={o.id}>
                {o.name}
                {counts?.get(o.id) !== undefined ? ` (${counts.get(o.id)})` : ""}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
        <NativeSelect
          aria-label={`${label}: include or exclude`}
          size="sm"
          className="w-28"
          value={mode}
          onChange={(e) => setMode(e.target.value === "exclude" ? "exclude" : "include")}
        >
          <NativeSelectOption value="include">Is any of</NativeSelectOption>
          <NativeSelectOption value="exclude">Is not</NativeSelectOption>
        </NativeSelect>
      </div>
      {[...include.map((v) => ["include", v] as const), ...exclude.map((v) => ["exclude", v] as const)].length ? (
        <ul className="flex flex-wrap gap-1">
          {include.map((v) => (
            <li key={`i-${v}`}>
              <Badge variant="secondary" className="gap-1 pr-1 font-normal">
                {nameOf(v)}
                <button
                  type="button"
                  aria-label={`Remove ${nameOf(v)}`}
                  className="rounded-sm opacity-70 hover:opacity-100"
                  onClick={() =>
                    onChange(
                      include.filter((x) => x !== v),
                      exclude,
                    )
                  }
                >
                  <X className="size-3" aria-hidden="true" />
                </button>
              </Badge>
            </li>
          ))}
          {exclude.map((v) => (
            <li key={`e-${v}`}>
              <Badge variant="outline" className="gap-1 pr-1 font-normal line-through decoration-muted-foreground">
                {nameOf(v)}
                <button
                  type="button"
                  aria-label={`Remove excluded ${nameOf(v)}`}
                  className="rounded-sm opacity-70 hover:opacity-100"
                  onClick={() =>
                    onChange(
                      include,
                      exclude.filter((x) => x !== v),
                    )
                  }
                >
                  <X className="size-3" aria-hidden="true" />
                </button>
              </Badge>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** A scalar filter value as a string ("" when unset). */
function val(state: FilterState, key: string): string {
  const v = state[key] as FilterValue | undefined;
  if (v === undefined) return "";
  return Array.isArray(v) ? (v[0] ?? "") : v;
}

const set = (key: string, values: string[]): FilterPatch => ({ [key]: values.length ? values : null });
const setScalar = (key: string, value: string): FilterPatch => ({ [key]: value || null });

/* -------------------------------------------------------------------------- */
/* Editors                                                                    */
/* -------------------------------------------------------------------------- */

function JobTitlesEditor({ state, onChange, ctx }: EditorProps) {
  const id = useId();
  const seniority = facetMap(ctx.facets, "seniority");
  const departments = facetMap(ctx.facets, "department");
  const similar = state.similarTitles !== "false";
  const titles = asArray(state.titles);
  const deptOptions = [...new Set([...DEPARTMENTS, ...departments.keys()])].map((d) => ({
    value: d,
    label: d,
    count: departments.get(d),
  }));
  return (
    <div className="flex flex-col gap-4">
      <TokenInput
        label="Include"
        values={titles}
        onChange={(v) => onChange(set("titles", v))}
        placeholder="Search for a job title"
        suggestField="titles"
        entity={ctx.entity}
        hint='Wrap a title in "quotation marks" to match it exactly.'
      />
      <div className="flex items-center gap-2">
        <Checkbox
          id={`${id}-similar`}
          checked={similar}
          onCheckedChange={(v) => onChange({ similarTitles: v ? null : "false" })}
        />
        <Label htmlFor={`${id}-similar`} className="font-normal text-sm">
          Include people with similar titles
        </Label>
      </div>
      <TokenInput
        label="Exclude"
        values={asArray(state.titlesExclude)}
        onChange={(v) => onChange(set("titlesExclude", v))}
        placeholder="Titles to leave out"
        suggestField="titles"
        entity={ctx.entity}
      />
      <CheckList
        label="Management level"
        options={SENIORITIES.map((s) => ({ value: s, label: SENIORITY_LABELS[s], count: seniority.get(s) ?? 0 }))}
        selected={asArray(state.seniority)}
        onChange={(v) => onChange(set("seniority", v))}
      />
      <CheckList
        label="Departments and job function"
        options={deptOptions}
        selected={asArray(state.department)}
        onChange={(v) => onChange(set("department", v))}
        searchable
      />
      {ctx.permissions.personaManage && ctx.onCreatePersona ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() =>
            ctx.onCreatePersona?.({
              titles,
              seniorities: asArray(state.seniority),
              departments: asArray(state.department),
            })
          }
        >
          <UserPlus data-icon="inline-start" aria-hidden="true" />
          Create new persona
        </Button>
      ) : null}
      <p className="text-muted-foreground text-xs">
        A persona saves a set of titles, levels and departments so you can reuse it as one filter.
      </p>
    </div>
  );
}

function LocationEditor({ state, onChange, ctx }: EditorProps) {
  const countries = (ctx.facets.country ?? []).map((c) => c.value);
  return (
    <div className="flex flex-col gap-4">
      <TokenInput
        label={ctx.entity === "contact" ? "Person location" : "Account location"}
        values={[...asArray(state.location), ...asArray(state.country)]}
        onChange={(v) => onChange({ ...set("location", v), country: null })}
        placeholder="City, state or country"
        suggestField="location"
        entity={ctx.entity}
        staticSuggestions={countries}
      />
      <TokenInput
        label="Exclude locations"
        values={asArray(state.locationExclude)}
        onChange={(v) => onChange(set("locationExclude", v))}
        placeholder="Places to leave out"
        suggestField="location"
        entity={ctx.entity}
      />
    </div>
  );
}

function CompanyEditor({ state, onChange, ctx }: EditorProps) {
  return (
    <div className="flex flex-col gap-4">
      <TokenInput
        label="Is any of"
        values={asArray(state.company)}
        onChange={(v) => onChange(set("company", v))}
        placeholder="Company name or domain"
        suggestField="company"
        entity={ctx.entity}
      />
      <TokenInput
        label="Is not any of"
        values={asArray(state.companyExclude)}
        onChange={(v) => onChange(set("companyExclude", v))}
        placeholder="Companies to leave out"
        suggestField="company"
        entity={ctx.entity}
      />
      {state.companyId ? (
        <Button type="button" variant="outline" size="sm" onClick={() => onChange({ companyId: null })}>
          <X data-icon="inline-start" aria-hidden="true" />
          Clear the single-company filter
        </Button>
      ) : null}
    </div>
  );
}

function EmployeesEditor({ state, onChange, ctx }: EditorProps) {
  const id = useId();
  const counts = facetMap(ctx.facets, "employeeRanges");
  return (
    <div className="flex flex-col gap-4">
      <CheckList
        label="Predefined ranges"
        options={EMPLOYEE_RANGES.map((r) => ({
          value: r.key,
          label: employeeRangeLabel(r.key),
          count: counts.get(r.key) ?? 0,
        }))}
        selected={asArray(state.employeeRanges)}
        onChange={(v) => onChange(set("employeeRanges", v))}
      />
      <NumberRange
        label="Custom range"
        min={val(state, "employeesMin")}
        max={val(state, "employeesMax")}
        onChange={(min, max) => onChange({ employeesMin: min || null, employeesMax: max || null })}
      />
      <div className="flex items-center gap-2">
        <Checkbox
          id={`${id}-unknown`}
          checked={state.employeesUnknown === "true"}
          onCheckedChange={(v) => onChange({ employeesUnknown: v ? "true" : null })}
        />
        <Label htmlFor={`${id}-unknown`} className="font-normal text-sm">
          Number of employees is unknown
        </Label>
      </div>
    </div>
  );
}

function IndustryKeywordsEditor({ state, onChange, ctx }: EditorProps) {
  const industries = (ctx.facets.industry ?? []).map((c) => c.value);
  return (
    <div className="flex flex-col gap-4">
      <TokenInput
        label="Industries"
        values={asArray(state.industry)}
        onChange={(v) => onChange(set("industry", v))}
        placeholder="e.g. Software"
        suggestField="industry"
        entity={ctx.entity}
        staticSuggestions={industries}
      />
      <TokenInput
        label="Exclude industries"
        values={asArray(state.industryExclude)}
        onChange={(v) => onChange(set("industryExclude", v))}
        placeholder="Industries to leave out"
        suggestField="industry"
        entity={ctx.entity}
      />
      <TokenInput
        label="Company keywords"
        values={asArray(state.keywords)}
        onChange={(v) => onChange(set("keywords", v))}
        placeholder="e.g. payments"
        suggestField="keywords"
        entity={ctx.entity}
      />
      <TokenInput
        label="Exclude keywords"
        values={asArray(state.keywordsExclude)}
        onChange={(v) => onChange(set("keywordsExclude", v))}
        placeholder="Keywords to leave out"
        suggestField="keywords"
        entity={ctx.entity}
      />
    </div>
  );
}

function YesNoEditor({ def, state, onChange }: EditorProps) {
  const key = def.flag ?? def.keys[0];
  const id = useId();
  const value = val(state, key);
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id} className="font-medium text-muted-foreground text-xs">
        {def.label}
      </Label>
      <NativeSelect id={id} size="sm" value={value} onChange={(e) => onChange(setScalar(key, e.target.value))}>
        <NativeSelectOption value="">Any</NativeSelectOption>
        <NativeSelectOption value="yes">Yes</NativeSelectOption>
        <NativeSelectOption value="no">No</NativeSelectOption>
      </NativeSelect>
    </div>
  );
}

function CustomFieldsEditor({ state, onChange, ctx }: EditorProps) {
  const fields = ctx.options.customFields;
  if (!fields.length) {
    return <p className="text-muted-foreground text-sm">No custom fields yet. Add them in settings.</p>;
  }
  return (
    <div className="flex flex-col gap-3">
      {fields.map((f) => {
        const key = `cf.${f.key}`;
        const value = val(state, key);
        const inputId = `cf-${f.key}`;
        if (f.type === "picklist" || f.type === "boolean") {
          const opts = f.type === "boolean" ? ["true", "false"] : f.options;
          return (
            <div key={f.key} className="flex flex-col gap-1">
              <Label htmlFor={inputId} className="font-medium text-muted-foreground text-xs">
                {f.label}
              </Label>
              <NativeSelect
                id={inputId}
                size="sm"
                value={value}
                onChange={(e) => onChange(setScalar(key, e.target.value))}
              >
                <NativeSelectOption value="">Any</NativeSelectOption>
                {opts.map((o) => (
                  <NativeSelectOption key={o} value={o}>
                    {f.type === "boolean" ? (o === "true" ? "Yes" : "No") : o}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </div>
          );
        }
        return (
          <div key={f.key} className="flex flex-col gap-1">
            <Label htmlFor={inputId} className="font-medium text-muted-foreground text-xs">
              {f.label}
            </Label>
            <Input
              id={inputId}
              defaultValue={value}
              placeholder="Contains…"
              className="h-7 text-sm"
              onBlur={(e) => e.target.value !== value && onChange(setScalar(key, e.target.value.trim()))}
              onKeyDown={(e) => {
                if (e.key === "Enter") onChange(setScalar(key, (e.target as HTMLInputElement).value.trim()));
              }}
            />
          </div>
        );
      })}
    </div>
  );
}

/** Render the editor for one filter. */
export function FilterEditor(props: EditorProps) {
  const { def, state, onChange, ctx } = props;
  const facets = ctx.facets;
  switch (def.editor) {
    case "jobTitles":
      return <JobTitlesEditor {...props} />;
    case "persona":
      return (
        <CheckList
          label="Personas"
          options={ctx.options.personas.map((p) => ({ value: p.id, label: p.name }))}
          selected={asArray(state.personaId)}
          onChange={(v) => onChange(set("personaId", v))}
        />
      );
    case "emailStatus": {
      const counts = facetMap(facets, "emailStatus");
      return (
        <CheckList
          label="Email status"
          options={EMAIL_STATUSES.map((s) => ({ value: s, label: EMAIL_STATUS_LABELS[s], count: counts.get(s) ?? 0 }))}
          selected={asArray(state.emailStatus)}
          onChange={(v) => onChange(set("emailStatus", v))}
        />
      );
    }
    case "name":
      return (
        <TextFilter label="Name contains" value={val(state, "name")} onChange={(v) => onChange(setScalar("name", v))} />
      );
    case "location":
      return <LocationEditor {...props} />;
    case "timezone":
      return (
        <TokenInput
          label="Time zones"
          values={asArray(state.timezone)}
          onChange={(v) => onChange(set("timezone", v))}
          placeholder="e.g. America/Toronto"
          suggestField="timezone"
          entity={ctx.entity}
        />
      );
    case "company":
      return <CompanyEditor {...props} />;
    case "companyLocation":
      return (
        <TokenInput
          label="Company headquarters"
          values={asArray(state.companyLocation)}
          onChange={(v) => onChange(set("companyLocation", v))}
          placeholder="City, state or country"
          suggestField="companyLocation"
          entity={ctx.entity}
        />
      );
    case "employees":
      return <EmployeesEditor {...props} />;
    case "industryKeywords":
      return <IndustryKeywordsEditor {...props} />;
    case "technologies":
      return (
        <TokenInput
          label="Uses any of"
          values={asArray(state.technologies)}
          onChange={(v) => onChange(set("technologies", v))}
          placeholder="e.g. HubSpot"
          suggestField="technologies"
          entity={ctx.entity}
        />
      );
    case "revenue":
      return (
        <NumberRange
          label="Annual revenue (USD)"
          min={val(state, "revenueMin")}
          max={val(state, "revenueMax")}
          onChange={(min, max) => onChange({ revenueMin: min || null, revenueMax: max || null })}
        />
      );
    case "founded":
      return (
        <NumberRange
          label="Founded between"
          min={val(state, "foundedMin")}
          max={val(state, "foundedMax")}
          placeholders={["From year", "To year"]}
          onChange={(min, max) => onChange({ foundedMin: min || null, foundedMax: max || null })}
        />
      );
    case "sequence":
      return (
        <IncludeExcludeSelect
          label="Sequence"
          options={ctx.options.sequences}
          include={asArray(state.sequenceId)}
          exclude={asArray(state.sequenceExclude)}
          anyLabel="Any sequence"
          onChange={(inc, exc) => onChange({ ...set("sequenceId", inc), ...set("sequenceExclude", exc) })}
        />
      );
    case "lastActivity":
      return (
        <DateRange
          label="Last activity"
          from={val(state, "lastActivityFrom")}
          to={val(state, "lastActivityTo")}
          onChange={(from, to) => onChange({ lastActivityFrom: from || null, lastActivityTo: to || null })}
        />
      );
    case "engagementFlag":
      return <YesNoEditor {...props} />;
    case "source": {
      const sources = facets.source ?? [];
      return (
        <CheckList
          label="Source"
          options={sources.map((s) => ({ value: s.value, label: s.value.replaceAll("_", " "), count: s.count }))}
          selected={asArray(state.source)}
          onChange={(v) => onChange(set("source", v))}
        />
      );
    }
    case "importId":
      return ctx.options.importBatches.length ? (
        <CheckList
          label="Import"
          options={ctx.options.importBatches.map((b) => ({ value: b.id, label: b.name }))}
          selected={asArray(state.importId)}
          onChange={(v) => onChange(set("importId", v))}
        />
      ) : (
        <p className="text-muted-foreground text-sm">No CSV imports yet.</p>
      );
    case "created":
      return (
        <DateRange
          label="Created"
          from={val(state, "createdFrom")}
          to={val(state, "createdTo")}
          onChange={(from, to) => onChange({ createdFrom: from || null, createdTo: to || null })}
        />
      );
    case "lists":
      return (
        <IncludeExcludeSelect
          label="List"
          options={ctx.options.lists}
          include={asArray(state.listId)}
          exclude={asArray(state.listExclude)}
          onChange={(inc, exc) => onChange({ ...set("listId", inc), ...set("listExclude", exc) })}
        />
      );
    case "owner": {
      const counts = facetMap(facets, "ownerId");
      return (
        <CheckList
          label="Owner"
          options={[
            { value: "me", label: "Me" },
            { value: "none", label: "Unassigned", count: counts.get("none") ?? 0 },
            ...ctx.options.members.map((m) => ({ value: m.id, label: m.name, count: counts.get(m.id) ?? 0 })),
          ]}
          selected={asArray(state.ownerId)}
          onChange={(v) => onChange(set("ownerId", v))}
        />
      );
    }
    case "stage": {
      const counts = facetMap(facets, "stage");
      const options =
        ctx.entity === "contact"
          ? CONTACT_STAGES.map((s) => ({ value: s, label: CONTACT_STAGE_LABELS[s], count: counts.get(s) ?? 0 }))
          : COMPANY_STAGES.map((s) => ({ value: s, label: COMPANY_STAGE_LABELS[s], count: counts.get(s) ?? 0 }));
      return (
        <CheckList
          label="Stage"
          options={options}
          selected={asArray(state.stage)}
          onChange={(v) => onChange(set("stage", v))}
        />
      );
    }
    case "customFields":
      return <CustomFieldsEditor {...props} />;
    case "disabled":
      return (
        <p className="text-muted-foreground text-sm">
          This filter needs a data provider that this installation doesn't have configured.
        </p>
      );
  }
}

function TextFilter({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const id = useId();
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id} className="font-medium text-muted-foreground text-xs">
        {label}
      </Label>
      <Input
        id={id}
        value={text}
        className="h-7 text-sm"
        onChange={(e) => setText(e.target.value)}
        onBlur={() => text.trim() !== value && onChange(text.trim())}
        onKeyDown={(e) => e.key === "Enter" && onChange(text.trim())}
      />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Chips                                                                      */
/* -------------------------------------------------------------------------- */

export interface Chip {
  key: string;
  value: string;
  label: string;
  prefix: string;
}

const KEY_PREFIX: Record<string, string> = {
  titles: "Include titles",
  titlesExclude: "Exclude titles",
  title: "Title contains",
  seniority: "Management level",
  department: "Department",
  personaId: "Persona",
  emailStatus: "Email status",
  name: "Name",
  location: "Locations",
  country: "Country",
  locationExclude: "Exclude locations",
  timezone: "Time zone",
  company: "Companies",
  companyExclude: "Exclude companies",
  companyId: "Company",
  domains: "Domains",
  companyLocation: "Company location",
  employeeRanges: "Employees",
  employeesMin: "At least",
  employeesMax: "At most",
  employeesUnknown: "Employees",
  industry: "Industries",
  industryExclude: "Exclude industries",
  keywords: "Keywords",
  keywordsExclude: "Exclude keywords",
  technologies: "Technologies",
  revenueMin: "Revenue from",
  revenueMax: "Revenue to",
  foundedMin: "Founded from",
  foundedMax: "Founded to",
  sequenceId: "In sequence",
  sequenceExclude: "Not in sequence",
  lastActivityFrom: "Active since",
  lastActivityTo: "Active before",
  emailSent: "Email sent",
  emailOpened: "Email opened",
  emailReplied: "Email replied",
  emailBounced: "Email bounced",
  emailUnsubscribed: "Email unsubscribed",
  source: "Source",
  importId: "Import",
  createdFrom: "Created from",
  createdTo: "Created to",
  listId: "In list",
  listExclude: "Not in list",
  ownerId: "Owner",
  stage: "Stage",
  tags: "Tags",
};

export function useChipLabeler(entity: SearchEntity, options: SearchOptions) {
  return useMemo(() => {
    const byId = (list: { id: string; name: string }[]) => new Map(list.map((o) => [o.id, o.name]));
    const members = byId(options.members);
    const lists = byId(options.lists);
    const sequences = byId(options.sequences);
    const personas = byId(options.personas);
    const imports = byId(options.importBatches);
    const cfs = new Map(options.customFields.map((f) => [f.key, f.label]));
    return (key: string, value: string): Chip => {
      if (key.startsWith("cf.")) {
        return { key, value, prefix: cfs.get(key.slice(3)) ?? key.slice(3), label: value };
      }
      let label = value;
      switch (key) {
        case "seniority":
          label = SENIORITY_LABELS[value as keyof typeof SENIORITY_LABELS] ?? value;
          break;
        case "emailStatus":
          label = EMAIL_STATUS_LABELS[value as keyof typeof EMAIL_STATUS_LABELS] ?? value;
          break;
        case "stage":
          label =
            entity === "contact"
              ? (CONTACT_STAGE_LABELS[value as keyof typeof CONTACT_STAGE_LABELS] ?? value)
              : (COMPANY_STAGE_LABELS[value as keyof typeof COMPANY_STAGE_LABELS] ?? value);
          break;
        case "employeeRanges":
          label = employeeRangeLabel(value);
          break;
        case "employeesUnknown":
          label = "Unknown";
          break;
        case "ownerId":
          label = value === "me" ? "Me" : value === "none" ? "Unassigned" : (members.get(value) ?? "Former member");
          break;
        case "listId":
        case "listExclude":
          label = lists.get(value) ?? "List";
          break;
        case "sequenceId":
        case "sequenceExclude":
          label = value === "any" ? "Any sequence" : (sequences.get(value) ?? "Sequence");
          break;
        case "personaId":
          label = personas.get(value) ?? "Persona";
          break;
        case "importId":
          label = imports.get(value) ?? "CSV import";
          break;
        case "emailSent":
        case "emailOpened":
        case "emailReplied":
        case "emailBounced":
        case "emailUnsubscribed":
          label = value === "yes" ? "Yes" : "No";
          break;
        case "companyId":
          label = "Selected company";
          break;
        default:
          break;
      }
      return { key, value, label, prefix: KEY_PREFIX[key] ?? key };
    };
  }, [entity, options]);
}

/** Chips for one filter, grouped by key prefix ("Include titles: founder ×"). */
export function chipsFor(def: FilterDef, state: FilterState, label: (key: string, value: string) => Chip): Chip[] {
  const keys = def.editor === "customFields" ? Object.keys(state).filter((k) => k.startsWith("cf.")) : def.keys;
  return keys.flatMap((key) => asArray(state[key]).map((v) => label(key, v)));
}
