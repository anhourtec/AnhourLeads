"use client";

import { useId, useState } from "react";

import Link from "next/link";
import { useRouter } from "next/navigation";

import { cn } from "cn";
import {
  BriefcaseBusiness,
  CheckCircle2,
  ChevronDown,
  CircleAlert,
  CircleDashed,
  CircleX,
  Copy,
  Ellipsis,
  Globe,
  ListPlus,
  MailSearch,
  Plus,
  Send,
  UserCheck,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { EMAIL_STATUS_LABELS, SENIORITY_LABELS } from "@/lib/records-vocabulary";
import type { SearchEntity } from "@/lib/search/filters";
import type { CompanyDto } from "@/server/services/companies";
import type { ContactDto } from "@/server/services/contacts";

import { apiRequest } from "../api-client";
import { CompanyStagePill, ContactStagePill } from "../status-pills";
import type { Density } from "./toolbar-menus";
import type { CustomFieldOption, SearchPermissions } from "./types";

export type Row = ContactDto | CompanyDto;

export interface ColumnDef {
  id: string;
  label: string;
  /** Shown by default. */
  initial: boolean;
  className?: string;
}

const PEOPLE_COLUMNS: ColumnDef[] = [
  { id: "title", label: "Job title", initial: true, className: "min-w-44 max-w-64" },
  { id: "company", label: "Company", initial: true, className: "min-w-44" },
  { id: "emails", label: "Emails", initial: true, className: "min-w-56" },
  { id: "phone", label: "Phone numbers", initial: true, className: "min-w-36" },
  { id: "actions", label: "Actions", initial: true },
  { id: "links", label: "Links", initial: true },
  { id: "location", label: "Location", initial: true, className: "min-w-40" },
  { id: "employees", label: "Company · Number of employees", initial: true },
  { id: "industry", label: "Company · Industries", initial: true, className: "min-w-40" },
  { id: "keywords", label: "Company · Keywords", initial: true, className: "min-w-48" },
  { id: "stage", label: "Stage", initial: false },
  { id: "owner", label: "Owner", initial: false, className: "min-w-32" },
  { id: "lastActivity", label: "Last activity", initial: false },
  { id: "seniority", label: "Management level", initial: false },
  { id: "department", label: "Department", initial: false },
  { id: "source", label: "Source", initial: false },
  { id: "createdAt", label: "Date added", initial: false },
];

const COMPANY_COLUMNS: ColumnDef[] = [
  { id: "actions", label: "Actions", initial: true },
  { id: "links", label: "Links", initial: true },
  { id: "employees", label: "Number of employees", initial: true },
  { id: "industry", label: "Industries", initial: true, className: "min-w-40" },
  { id: "keywords", label: "Keywords", initial: true, className: "min-w-48" },
  { id: "location", label: "Location", initial: true, className: "min-w-40" },
  { id: "stage", label: "Stage", initial: false },
  { id: "owner", label: "Owner", initial: false, className: "min-w-32" },
  { id: "people", label: "People", initial: false },
  { id: "technologies", label: "Technologies", initial: false, className: "min-w-48" },
  { id: "revenue", label: "Annual revenue", initial: false },
  { id: "founded", label: "Founded", initial: false },
  { id: "phone", label: "Phone", initial: false, className: "min-w-36" },
  { id: "lastActivity", label: "Last activity", initial: false },
  { id: "source", label: "Source", initial: false },
  { id: "createdAt", label: "Date added", initial: false },
];

export function columnsFor(entity: SearchEntity, customFields: CustomFieldOption[]): ColumnDef[] {
  const base = entity === "contact" ? PEOPLE_COLUMNS : COMPANY_COLUMNS;
  return [...base, ...customFields.map((f) => ({ id: `cf.${f.key}`, label: f.label, initial: false }))];
}

export function defaultColumns(entity: SearchEntity): string[] {
  return (entity === "contact" ? PEOPLE_COLUMNS : COMPANY_COLUMNS).filter((c) => c.initial).map((c) => c.id);
}

const muted = <span className="text-muted-foreground">—</span>;

function dateText(iso: string | null) {
  if (!iso) return muted;
  const d = new Date(iso);
  return (
    <time dateTime={iso} title={d.toLocaleString("en-US")} className="whitespace-nowrap font-mono text-xs tabular-nums">
      {d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" })}
    </time>
  );
}

function chips(values: string[], max = 3) {
  if (!values.length) return muted;
  return (
    <span className="flex flex-wrap gap-1">
      {values.slice(0, max).map((v) => (
        <span key={v} className="max-w-40 truncate rounded-md bg-muted px-1.5 py-0.5 text-xs">
          {v}
        </span>
      ))}
      {values.length > max ? (
        <span className="font-mono text-muted-foreground text-xs">+{values.length - max}</span>
      ) : null}
    </span>
  );
}

function place(parts: (string | null | undefined)[]) {
  const text = parts.filter(Boolean).join(", ");
  return text ? <span className="whitespace-nowrap">{text}</span> : muted;
}

function customValue(value: unknown) {
  if (value === null || value === undefined || value === "") return muted;
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return <span className="whitespace-nowrap">{String(value)}</span>;
}

/** Initial tile standing in for a company logo. */
export function CompanyTile({ name, className }: { name: string; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex size-6 shrink-0 items-center justify-center rounded-md border bg-muted font-medium text-[11px] text-muted-foreground uppercase",
        className,
      )}
    >
      {name.trim().charAt(0) || "?"}
    </span>
  );
}

const STATUS_ICON = {
  valid: { icon: CheckCircle2, className: "text-emerald-600 dark:text-emerald-400" },
  catch_all: { icon: CircleAlert, className: "text-amber-600 dark:text-amber-400" },
  role: { icon: CircleAlert, className: "text-amber-600 dark:text-amber-400" },
  unknown: { icon: CircleDashed, className: "text-muted-foreground" },
  unverified: { icon: CircleDashed, className: "text-muted-foreground" },
  invalid: { icon: CircleX, className: "text-destructive" },
  disposable: { icon: CircleX, className: "text-destructive" },
} as const;

/** Email with its verification icon, or "Access email" (find + verify) when there is none. */
function EmailCell({ row, canEnrich }: { row: ContactDto; canEnrich: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  if (row.email) {
    const s = STATUS_ICON[row.emailStatus];
    const Icon = s.icon;
    return (
      <span className="flex items-center gap-1.5">
        <Tooltip>
          <TooltipTrigger asChild>
            <span role="img" aria-label={EMAIL_STATUS_LABELS[row.emailStatus]} className="inline-flex">
              <Icon className={cn("size-4", s.className)} aria-hidden="true" />
            </span>
          </TooltipTrigger>
          <TooltipContent>{EMAIL_STATUS_LABELS[row.emailStatus]}</TooltipContent>
        </Tooltip>
        <a
          href={`mailto:${row.email}`}
          className="truncate font-mono text-primary text-xs underline-offset-4 hover:underline"
        >
          {row.email}
        </a>
      </span>
    );
  }
  const run = async () => {
    setPending(true);
    const res = await apiRequest<{ person?: { email?: string | null } }>("/api/v1/people/match", {
      body: { contactId: row.id },
    });
    setPending(false);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    const email = res.data.person?.email;
    toast[email ? "success" : "info"](email ? `Found ${email}.` : "No email could be found or verified.");
    router.refresh();
  };
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex">
          <Button type="button" variant="outline" size="sm" disabled={!canEnrich || pending} onClick={() => void run()}>
            <MailSearch data-icon="inline-start" aria-hidden="true" />
            {pending ? "Looking…" : "Access email"}
          </Button>
        </span>
      </TooltipTrigger>
      <TooltipContent>
        {canEnrich ? "Find and verify this person's email" : "Your role can't run enrichment"}
      </TooltipContent>
    </Tooltip>
  );
}

export interface RowHandlers {
  onOpenCompany: (id: string) => void;
  onAddToList: (ids: string[]) => void;
  onAddToSequence: (ids: string[]) => void;
  onSaveCompany: (id: string) => void;
}

function PersonActions({
  row,
  permissions,
  handlers,
}: {
  row: ContactDto;
  permissions: SearchPermissions;
  handlers: RowHandlers;
}) {
  return (
    <span className="flex items-center gap-1">
      <Button
        type="button"
        variant="outline"
        size="icon-sm"
        aria-label={`Copy ${row.name}'s email`}
        disabled={!row.email}
        onClick={() => {
          if (!row.email) return;
          void navigator.clipboard
            .writeText(row.email)
            .then(() => toast.success("Email copied."))
            .catch(() => toast.error("Couldn't copy to the clipboard."));
        }}
      >
        <Copy aria-hidden="true" />
      </Button>
      {permissions.listUpdate ? (
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          aria-label={`Add ${row.name} to a list`}
          onClick={() => handlers.onAddToList([row.id])}
        >
          <ListPlus aria-hidden="true" />
        </Button>
      ) : null}
      {permissions.sequenceLaunch ? (
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          aria-label={`Add ${row.name} to a sequence`}
          onClick={() => handlers.onAddToSequence([row.id])}
        >
          <Send aria-hidden="true" />
        </Button>
      ) : null}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="outline" size="icon-sm" aria-label={`More actions for ${row.name}`}>
            <Ellipsis aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem asChild>
            <Link href={`/dashboard/people/${row.id}`}>Open contact</Link>
          </DropdownMenuItem>
          {row.company ? (
            <DropdownMenuItem onSelect={() => handlers.onOpenCompany(row.company?.id ?? "")}>
              View company
            </DropdownMenuItem>
          ) : null}
          {row.linkedinUrl ? (
            <DropdownMenuItem asChild>
              <a href={row.linkedinUrl} target="_blank" rel="noreferrer noopener">
                Open LinkedIn profile
              </a>
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </span>
  );
}

function CompanyActions({
  row,
  permissions,
  handlers,
  currentUserId,
}: {
  row: CompanyDto;
  permissions: SearchPermissions;
  handlers: RowHandlers;
  currentUserId: string;
}) {
  const saved = row.ownerId === currentUserId;
  return (
    <span className="flex items-center gap-1">
      {permissions.update ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={saved}
          aria-label={saved ? `${row.name} is saved to you` : `Save ${row.name}`}
          onClick={() => handlers.onSaveCompany(row.id)}
        >
          {saved ? (
            <UserCheck data-icon="inline-start" aria-hidden="true" />
          ) : (
            <Plus data-icon="inline-start" aria-hidden="true" />
          )}
          {saved ? "Saved" : "Save"}
        </Button>
      ) : null}
      {permissions.listUpdate ? (
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          aria-label={`Add ${row.name} to a list`}
          onClick={() => handlers.onAddToList([row.id])}
        >
          <ListPlus aria-hidden="true" />
        </Button>
      ) : null}
    </span>
  );
}

function linkIcons(linkedin: string | null, website: string | null, name: string) {
  if (!linkedin && !website) return muted;
  return (
    <span className="flex items-center gap-1">
      {website ? (
        <a
          href={website}
          target="_blank"
          rel="noreferrer noopener"
          aria-label={`${name} website`}
          className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <Globe className="size-4" aria-hidden="true" />
        </a>
      ) : null}
      {linkedin ? (
        <a
          href={linkedin}
          target="_blank"
          rel="noreferrer noopener"
          aria-label={`${name} on LinkedIn`}
          className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <BriefcaseBusiness className="size-4" aria-hidden="true" />
        </a>
      ) : null}
    </span>
  );
}

function personCell(
  col: string,
  r: ContactDto,
  permissions: SearchPermissions,
  handlers: RowHandlers,
): React.ReactNode {
  if (col.startsWith("cf.")) return customValue(r.customFields[col.slice(3)]);
  switch (col) {
    case "title":
      return r.title ? <span className="line-clamp-2">{r.title}</span> : muted;
    case "company":
      return r.company ? (
        <button
          type="button"
          onClick={() => handlers.onOpenCompany(r.company?.id ?? "")}
          className="flex max-w-56 items-center gap-2 rounded-md text-left outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
        >
          <CompanyTile name={r.company.name} />
          <span className="truncate">{r.company.name}</span>
        </button>
      ) : (
        muted
      );
    case "emails":
      return <EmailCell row={r} canEnrich={permissions.enrich} />;
    case "phone":
      return r.phone ? <span className="whitespace-nowrap font-mono text-xs">{r.phone}</span> : muted;
    case "actions":
      return <PersonActions row={r} permissions={permissions} handlers={handlers} />;
    case "links":
      return linkIcons(r.linkedinUrl, null, r.name);
    case "location":
      return place([r.city, r.state, r.country]);
    case "employees":
      return r.company?.employeeCount != null ? (
        <span className="font-mono text-xs tabular-nums">{r.company.employeeCount.toLocaleString("en-US")}</span>
      ) : (
        muted
      );
    case "industry":
      return r.company?.industry ? <span className="whitespace-nowrap">{r.company.industry}</span> : muted;
    case "keywords":
      return chips(r.company?.keywords ?? []);
    case "stage":
      return <ContactStagePill stage={r.stage} />;
    case "owner":
      return r.owner ? (
        <span className="whitespace-nowrap">{r.owner.name}</span>
      ) : (
        <span className="text-muted-foreground">Unassigned</span>
      );
    case "lastActivity":
      return dateText(r.lastActivityAt);
    case "seniority":
      return r.seniority ? SENIORITY_LABELS[r.seniority] : muted;
    case "department":
      return r.department ?? muted;
    case "source":
      return <span className="font-mono text-xs">{r.source}</span>;
    case "createdAt":
      return dateText(r.createdAt);
    default:
      return null;
  }
}

function companyCell(
  col: string,
  r: CompanyDto,
  permissions: SearchPermissions,
  handlers: RowHandlers,
  currentUserId: string,
): React.ReactNode {
  if (col.startsWith("cf.")) return customValue(r.customFields[col.slice(3)]);
  switch (col) {
    case "actions":
      return <CompanyActions row={r} permissions={permissions} handlers={handlers} currentUserId={currentUserId} />;
    case "links":
      return linkIcons(r.linkedinUrl, r.websiteUrl, r.name);
    case "employees":
      return r.employeeCount != null ? (
        <span className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-xs tabular-nums">
          {r.employeeCount.toLocaleString("en-US")}
        </span>
      ) : (
        muted
      );
    case "industry":
      return r.industry ? <span className="whitespace-nowrap">{r.industry}</span> : muted;
    case "keywords":
      return chips(r.keywords);
    case "location":
      return place([r.city, r.state, r.country]);
    case "stage":
      return <CompanyStagePill stage={r.stage} />;
    case "owner":
      return r.owner ? (
        <span className="whitespace-nowrap">{r.owner.name}</span>
      ) : (
        <span className="text-muted-foreground">Unassigned</span>
      );
    case "people":
      return <span className="font-mono text-xs tabular-nums">{r.contactCount.toLocaleString("en-US")}</span>;
    case "technologies":
      return chips(r.technologies);
    case "revenue":
      return r.annualRevenue != null ? (
        <span className="font-mono text-xs tabular-nums">
          {r.annualRevenue.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })}
        </span>
      ) : (
        muted
      );
    case "founded":
      return r.foundedYear ? <span className="font-mono text-xs tabular-nums">{r.foundedYear}</span> : muted;
    case "phone":
      return r.phone ? <span className="whitespace-nowrap font-mono text-xs">{r.phone}</span> : muted;
    case "lastActivity":
      return dateText(r.lastActivityAt);
    case "source":
      return <span className="font-mono text-xs">{r.source}</span>;
    case "createdAt":
      return dateText(r.createdAt);
    default:
      return null;
  }
}

/** "+ Add column": every available column with a checkbox. */
function ColumnChooser({
  all,
  visible,
  onChange,
}: {
  all: ColumnDef[];
  visible: string[];
  onChange: (ids: string[]) => void;
}) {
  const id = useId();
  const [q, setQ] = useState("");
  const shown = all.filter((c) => c.label.toLowerCase().includes(q.toLowerCase()));
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="font-sans normal-case tracking-normal">
          <Plus data-icon="inline-start" aria-hidden="true" />
          Add column
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72">
        <Input
          aria-label="Search columns"
          placeholder="Search columns"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="h-7 text-sm"
        />
        <ul className="flex max-h-72 flex-col gap-1.5 overflow-y-auto" aria-label="Columns">
          {shown.map((c, i) => (
            <li key={c.id} className="flex items-center gap-2">
              <Checkbox
                id={`${id}-${i}`}
                checked={visible.includes(c.id)}
                onCheckedChange={(v) => onChange(v ? [...visible, c.id] : visible.filter((x) => x !== c.id))}
              />
              <Label htmlFor={`${id}-${i}`} className="font-normal text-sm">
                {c.label}
              </Label>
            </li>
          ))}
        </ul>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="self-start"
          onClick={() => onChange(all.filter((c) => c.initial).map((c) => c.id))}
        >
          Reset to default
        </Button>
      </PopoverContent>
    </Popover>
  );
}

export type SelectMode = "number" | "page" | "all";

/** Select N (with a per-company cap for people), this page, or everything that matches. */
function SelectPopover({
  entity,
  pageCount,
  total,
  onApply,
}: {
  entity: SearchEntity;
  pageCount: number;
  total: number;
  onApply: (mode: SelectMode, n: number, maxPerCompany: number | null) => void;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<SelectMode>("page");
  const [n, setN] = useState(25);
  const [capOn, setCapOn] = useState(false);
  const [cap, setCap] = useState(1);
  const noun = entity === "contact" ? "people" : "companies";
  const all = Math.min(total, 10_000);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="ghost" size="icon-xs" aria-label="Selection options">
          <ChevronDown aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 font-sans normal-case tracking-normal">
        <RadioGroup
          value={mode}
          onValueChange={(v) => setMode(v as SelectMode)}
          aria-label="What to select"
          className="gap-3"
        >
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <RadioGroupItem id={`${id}-number`} value="number" />
              <Label htmlFor={`${id}-number`} className="font-normal text-sm">
                Select number of {noun}
              </Label>
            </div>
            <Input
              aria-label={`Number of ${noun} to select`}
              type="number"
              min={1}
              max={10000}
              value={n}
              disabled={mode !== "number"}
              onChange={(e) => setN(Math.max(1, Math.min(10_000, Number(e.target.value) || 1)))}
              className="h-7 font-mono text-sm"
            />
            {entity === "contact" ? (
              <div className="flex items-center gap-2">
                <Checkbox
                  id={`${id}-cap`}
                  checked={capOn}
                  disabled={mode !== "number"}
                  onCheckedChange={(v) => setCapOn(Boolean(v))}
                />
                <Label htmlFor={`${id}-cap`} className="flex-1 font-normal text-sm">
                  Max people per company
                </Label>
                <Input
                  aria-label="Max people per company"
                  type="number"
                  min={1}
                  max={1000}
                  value={cap}
                  disabled={mode !== "number" || !capOn}
                  onChange={(e) => setCap(Math.max(1, Math.min(1000, Number(e.target.value) || 1)))}
                  className="h-7 w-20 font-mono text-sm"
                />
              </div>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            <RadioGroupItem id={`${id}-page`} value="page" />
            <Label htmlFor={`${id}-page`} className="font-normal text-sm">
              Select this page <span className="font-mono text-muted-foreground tabular-nums">{pageCount}</span>
            </Label>
          </div>
          <div className="flex items-center gap-2">
            <RadioGroupItem id={`${id}-all`} value="all" />
            <Label htmlFor={`${id}-all`} className="font-normal text-sm">
              Select all{" "}
              <span className="font-mono text-muted-foreground tabular-nums">{all.toLocaleString("en-US")}</span>
            </Label>
          </div>
        </RadioGroup>
        {total > 10_000 ? <p className="text-muted-foreground text-xs">Selections stop at 10,000 records.</p> : null}
        <div className="flex justify-end gap-2 border-t pt-2">
          <Button type="button" variant="outline" size="sm" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={() => {
              onApply(mode, n, capOn ? cap : null);
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

const HEAD = "font-mono text-[11px] font-normal text-muted-foreground uppercase tracking-wider whitespace-nowrap";

/** The results grid: sticky checkbox + name, configurable columns, add-column chooser. */
export function ResultsTable({
  entity,
  rows,
  columns,
  allColumns,
  onColumnsChange,
  selected,
  onSelectedChange,
  onSelectApply,
  selectable,
  density,
  permissions,
  handlers,
  total,
  currentUserId,
  pending,
}: {
  entity: SearchEntity;
  rows: Row[];
  columns: string[];
  allColumns: ColumnDef[];
  onColumnsChange: (ids: string[]) => void;
  selected: Set<string>;
  onSelectedChange: (ids: Set<string>) => void;
  onSelectApply: (mode: SelectMode, n: number, maxPerCompany: number | null) => void;
  selectable: boolean;
  density: Density;
  permissions: SearchPermissions;
  handlers: RowHandlers;
  total: number;
  currentUserId: string;
  pending: boolean;
}) {
  const visible = columns.flatMap((c) => {
    const def = allColumns.find((x) => x.id === c);
    return def ? [def] : [];
  });
  const pageIds = rows.map((r) => r.id);
  const pageSelected = pageIds.filter((i) => selected.has(i)).length;
  let headerChecked: boolean | "indeterminate" = pageSelected > 0;
  if (pageSelected > 0 && pageSelected < pageIds.length) headerChecked = "indeterminate";
  const cellPad = density === "compact" ? "py-1.5" : "py-3";
  const noun = entity === "contact" ? "people" : "companies";

  return (
    <div className="relative min-w-0 overflow-x-auto" aria-busy={pending}>
      <table
        className={cn("w-full border-separate border-spacing-0 text-sm", pending && "opacity-60 transition-opacity")}
      >
        <caption className="sr-only">Search results</caption>
        <thead>
          <tr>
            <th scope="col" className={cn(HEAD, "sticky left-0 z-20 border-b bg-card px-3 py-2 text-left")}>
              <span className="flex items-center gap-2">
                {selectable ? (
                  <span className="flex items-center">
                    <Checkbox
                      aria-label={`Select all ${noun} on this page`}
                      checked={headerChecked}
                      onCheckedChange={(v) => {
                        const next = new Set(selected);
                        for (const i of pageIds) {
                          if (v) next.add(i);
                          else next.delete(i);
                        }
                        onSelectedChange(next);
                      }}
                    />
                    <SelectPopover entity={entity} pageCount={rows.length} total={total} onApply={onSelectApply} />
                  </span>
                ) : null}
                Name
              </span>
            </th>
            {visible.map((c) => (
              <th key={c.id} scope="col" className={cn(HEAD, "border-b px-3 py-2 text-left")}>
                {c.label}
              </th>
            ))}
            <th scope="col" className={cn(HEAD, "sticky right-0 z-20 border-b bg-card px-3 py-1.5 text-right")}>
              <ColumnChooser all={allColumns} visible={columns} onChange={onColumnsChange} />
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const isSelected = selected.has(r.id);
            const href = entity === "contact" ? `/dashboard/people/${r.id}` : `/dashboard/companies/${r.id}`;
            return (
              <tr key={r.id} data-state={isSelected ? "selected" : undefined} className="group hover:bg-muted/40">
                <th
                  scope="row"
                  className={cn(
                    "sticky left-0 z-10 border-b bg-card px-3 text-left font-normal group-hover:bg-muted group-data-[state=selected]:bg-muted",
                    cellPad,
                  )}
                >
                  <span className="flex min-w-48 items-center gap-3">
                    {selectable ? (
                      <Checkbox
                        aria-label={`Select ${r.name}`}
                        checked={isSelected}
                        onCheckedChange={(v) => {
                          const next = new Set(selected);
                          if (v) next.add(r.id);
                          else next.delete(r.id);
                          onSelectedChange(next);
                        }}
                      />
                    ) : null}
                    {entity === "company" ? <CompanyTile name={r.name} /> : null}
                    <Link
                      href={href}
                      className="max-w-56 truncate font-medium underline decoration-muted-foreground/40 underline-offset-4 hover:decoration-foreground"
                    >
                      {r.name}
                    </Link>
                  </span>
                </th>
                {visible.map((c) => (
                  <td key={c.id} className={cn("border-b px-3 align-middle", cellPad, c.className)}>
                    {entity === "contact"
                      ? personCell(c.id, r as ContactDto, permissions, handlers)
                      : companyCell(c.id, r as CompanyDto, permissions, handlers, currentUserId)}
                  </td>
                ))}
                <td className={cn("border-b", cellPad)} />
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
