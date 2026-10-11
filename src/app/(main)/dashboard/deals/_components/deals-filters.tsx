"use client";

import { useState } from "react";

import { Check, ChevronDown, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { PipelineDto } from "@/server/services/pipelines";

import type { MemberOption } from "./deal-form-dialog";
import type { DealParams } from "./deal-params";

function MultiPick({
  id,
  label,
  options,
  value,
  onChange,
}: {
  id: string;
  label: string;
  options: { id: string; name: string }[];
  value: string[];
  onChange: (next: string[]) => void;
}) {
  const summary = value.length ? `${value.length} selected` : "Any";
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <Label htmlFor={id} className="table-head-mono">
        {label}
      </Label>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button id={id} variant="outline" size="sm" className="justify-between font-normal">
            <span className="truncate">{summary}</span>
            <ChevronDown aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-h-72 min-w-56 overflow-y-auto">
          {options.map((o) => (
            <DropdownMenuCheckboxItem
              key={o.id}
              checked={value.includes(o.id)}
              onSelect={(e) => e.preventDefault()}
              onCheckedChange={(checked) => onChange(checked ? [...value, o.id] : value.filter((v) => v !== o.id))}
            >
              {o.name}
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

/** Filter row: owner, stage, close date range, amount range and company. Applied to the URL. */
export function DealsFilters({
  params,
  pipeline,
  members,
  onApply,
}: {
  readonly params: DealParams;
  readonly pipeline: PipelineDto | null;
  readonly members: MemberOption[];
  readonly onApply: (changes: Record<string, string | null>) => void;
}) {
  const [owners, setOwners] = useState(params.owners);
  const [stages, setStages] = useState(params.stages);
  const [closeFrom, setCloseFrom] = useState(params.closeFrom);
  const [closeTo, setCloseTo] = useState(params.closeTo);
  const [amountMin, setAmountMin] = useState(params.amountMin?.toString() ?? "");
  const [amountMax, setAmountMax] = useState(params.amountMax?.toString() ?? "");
  const [company, setCompany] = useState(params.company);

  const digits = (v: string) => v.replace(/\D/g, "").slice(0, 10);

  return (
    <form
      aria-label="Deal filters"
      className="grid grid-cols-1 gap-3 rounded-xl border bg-card p-3 sm:grid-cols-2 lg:grid-cols-6"
      onSubmit={(e) => {
        e.preventDefault();
        onApply({
          owner: owners.join(",") || null,
          stage: stages.join(",") || null,
          closeFrom: closeFrom || null,
          closeTo: closeTo || null,
          amountMin: amountMin || null,
          amountMax: amountMax || null,
          company: company.trim() || null,
        });
      }}
    >
      <MultiPick
        id="filter-owner"
        label="Owner"
        options={members.map((m) => ({ id: m.id, name: m.name }))}
        value={owners}
        onChange={setOwners}
      />
      <MultiPick
        id="filter-stage"
        label="Stage"
        options={(pipeline?.stages ?? []).map((s) => ({ id: s.id, name: s.name }))}
        value={stages}
        onChange={setStages}
      />
      <fieldset className="flex min-w-0 flex-col gap-1.5">
        <legend className="table-head-mono mb-1.5">Close date</legend>
        <div className="grid grid-cols-2 gap-1.5">
          <Input
            type="date"
            aria-label="Close date from"
            value={closeFrom}
            onChange={(e) => setCloseFrom(e.target.value)}
            className="h-8"
          />
          <Input
            type="date"
            aria-label="Close date to"
            value={closeTo}
            onChange={(e) => setCloseTo(e.target.value)}
            className="h-8"
          />
        </div>
      </fieldset>
      <fieldset className="flex min-w-0 flex-col gap-1.5">
        <legend className="table-head-mono mb-1.5">Amount</legend>
        <div className="grid grid-cols-2 gap-1.5">
          <Input
            inputMode="numeric"
            aria-label="Minimum amount"
            placeholder="Min"
            value={amountMin}
            onChange={(e) => setAmountMin(digits(e.target.value))}
            className="h-8 font-mono"
          />
          <Input
            inputMode="numeric"
            aria-label="Maximum amount"
            placeholder="Max"
            value={amountMax}
            onChange={(e) => setAmountMax(digits(e.target.value))}
            className="h-8 font-mono"
          />
        </div>
      </fieldset>
      <div className="flex min-w-0 flex-col gap-1.5">
        <Label htmlFor="filter-company" className="table-head-mono">
          Company
        </Label>
        <Input
          id="filter-company"
          placeholder="Name contains"
          value={company}
          onChange={(e) => setCompany(e.target.value)}
          className="h-8"
        />
      </div>
      <div className="flex items-end gap-2">
        <Button type="submit" size="sm">
          <Check data-icon="inline-start" />
          Apply
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => {
            setOwners([]);
            setStages([]);
            setCloseFrom("");
            setCloseTo("");
            setAmountMin("");
            setAmountMax("");
            setCompany("");
            onApply({
              owner: null,
              stage: null,
              closeFrom: null,
              closeTo: null,
              amountMin: null,
              amountMax: null,
              company: null,
            });
          }}
        >
          <X data-icon="inline-start" />
          Clear
        </Button>
      </div>
    </form>
  );
}
