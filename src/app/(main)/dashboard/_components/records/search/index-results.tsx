"use client";

import Link from "next/link";

import { cn } from "cn";
import { BookmarkPlus, Check, Loader2, MailSearch } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { relativeTime } from "@/lib/format-display";
import { SENIORITY_LABELS, type Seniority } from "@/lib/records-vocabulary";
import type { IndexCompanyView, IndexPersonView } from "@/server/services/discovery";

import type { IndexActions } from "./index-actions";
import { CompanyTile } from "./results-table";
import type { Density } from "./toolbar-menus";

/**
 * Results from the shared discovery index (Find people / Find companies → Total and Net new).
 * Emails stay hidden until "Access email"; each row says where it came from and how old it is,
 * and whether this workspace already holds it.
 */

const HEAD = "font-mono text-[11px] font-normal text-muted-foreground uppercase tracking-wider whitespace-nowrap";
const muted = <span className="text-muted-foreground">—</span>;
const SAVED_PILL = "bg-emerald-500/10 font-medium text-emerald-700 dark:text-emerald-400";

export interface IndexPermissions {
  save: boolean;
  saveCompany: boolean;
  savePerson: boolean;
  accessEmail: boolean;
}

export function hostOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

export function seniorityLabel(value: string | null): string | null {
  if (!value) return null;
  return SENIORITY_LABELS[value as Seniority] ?? value;
}

/** "acme.com/team · seen 3 days ago" in muted text, exact time on hover. */
export function Provenance({ url, label, at }: { url: string | null; label: string; at: string | null }) {
  const host = hostOf(url);
  return (
    <span className="flex flex-col text-muted-foreground text-xs">
      {host ? <span className="max-w-48 truncate font-mono">{host}</span> : null}
      {at ? (
        <time dateTime={at} title={new Date(at).toLocaleString("en-US")} suppressHydrationWarning>
          {label} {relativeTime(at)}
        </time>
      ) : null}
    </span>
  );
}

export function SavedLink({ href, label = "Saved" }: { href: string; label?: string }) {
  return (
    <Badge asChild variant="secondary" className={SAVED_PILL}>
      <Link href={href}>
        <Check aria-hidden="true" />
        {label}
      </Link>
    </Badge>
  );
}

function place(parts: (string | null | undefined)[]) {
  const text = parts.filter(Boolean).join(", ");
  return text ? <span className="whitespace-nowrap">{text}</span> : muted;
}

function SaveButton({
  label,
  busy,
  onClick,
  name,
}: {
  label: string;
  busy: boolean;
  onClick: () => void;
  name: string;
}) {
  return (
    <Button type="button" variant="outline" size="sm" disabled={busy} onClick={onClick} aria-label={`${label} ${name}`}>
      {busy ? (
        <Loader2 data-icon="inline-start" className="animate-spin" aria-hidden="true" />
      ) : (
        <BookmarkPlus data-icon="inline-start" aria-hidden="true" />
      )}
      {busy ? "Saving…" : label}
    </Button>
  );
}

/** Email cell: the address once accessed, else an "Access email" button (or a note for read-only roles). */
export function IndexEmailCell({
  person,
  actions,
  canAccess,
}: {
  person: Pick<IndexPersonView, "id" | "name" | "emailAvailable">;
  actions: IndexActions;
  canAccess: boolean;
}) {
  const revealed = actions.revealed[person.id];
  if (revealed) {
    return revealed.email ? (
      <span className="flex flex-col">
        <span className="max-w-56 truncate font-mono text-xs">{revealed.email}</span>
        {revealed.status ? (
          <span className="text-muted-foreground text-xs first-letter:uppercase">
            {revealed.status.replace("_", " ")}
          </span>
        ) : null}
      </span>
    ) : (
      <span className="text-muted-foreground text-xs">No email found</span>
    );
  }
  if (canAccess) {
    const busy = actions.busy.has(person.id);
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={busy}
        aria-label={`Access email for ${person.name}`}
        onClick={() => void actions.accessEmail(person.id)}
      >
        {busy ? (
          <Loader2 data-icon="inline-start" className="animate-spin" aria-hidden="true" />
        ) : (
          <MailSearch data-icon="inline-start" aria-hidden="true" />
        )}
        {busy ? "Finding…" : "Access email"}
      </Button>
    );
  }
  return (
    <span className="whitespace-nowrap text-muted-foreground text-xs">
      {person.emailAvailable ? "Published, hidden" : "Not published"}
    </span>
  );
}

interface TableProps<T> {
  rows: T[];
  selected: Set<string>;
  onSelectedChange: (ids: Set<string>) => void;
  selectable: boolean;
  density: Density;
  pending: boolean;
  actions: IndexActions;
  permissions: IndexPermissions;
}

function SelectHeader({
  ids,
  selected,
  onSelectedChange,
  noun,
}: {
  ids: string[];
  selected: Set<string>;
  onSelectedChange: (ids: Set<string>) => void;
  noun: string;
}) {
  const count = ids.filter((i) => selected.has(i)).length;
  let checked: boolean | "indeterminate" = count > 0;
  if (count > 0 && count < ids.length) checked = "indeterminate";
  return (
    <Checkbox
      aria-label={`Select all ${noun} on this page`}
      checked={checked}
      onCheckedChange={(v) => {
        const next = new Set(selected);
        for (const i of ids) {
          if (v) next.add(i);
          else next.delete(i);
        }
        onSelectedChange(next);
      }}
    />
  );
}

function toggle(selected: Set<string>, id: string, on: boolean): Set<string> {
  const next = new Set(selected);
  if (on) next.add(id);
  else next.delete(id);
  return next;
}

export function IndexPeopleTable({
  rows,
  selected,
  onSelectedChange,
  selectable,
  density,
  pending,
  actions,
  permissions,
  onOpenPerson,
  onOpenCompany,
}: TableProps<IndexPersonView> & {
  onOpenPerson: (person: IndexPersonView) => void;
  onOpenCompany: (id: string) => void;
}) {
  const cellPad = density === "compact" ? "py-1.5" : "py-3";
  const cell = cn("border-b px-3 align-middle", cellPad);
  return (
    <div className="relative min-w-0 overflow-x-auto" aria-busy={pending} data-testid="index-results">
      <table
        className={cn("w-full border-separate border-spacing-0 text-sm", pending && "opacity-60 transition-opacity")}
      >
        <caption className="sr-only">People in the shared database</caption>
        <thead>
          <tr>
            <th scope="col" className={cn(HEAD, "sticky left-0 z-20 border-b bg-card px-3 py-2 text-left")}>
              <span className="flex items-center gap-2">
                {selectable ? (
                  <SelectHeader
                    ids={rows.map((r) => r.id)}
                    selected={selected}
                    onSelectedChange={onSelectedChange}
                    noun="people"
                  />
                ) : null}
                Name
              </span>
            </th>
            {["Job title", "Company", "Emails", "Location", "Management level", "Employees", "Industry", "Source"].map(
              (h) => (
                <th key={h} scope="col" className={cn(HEAD, "border-b px-3 py-2 text-left")}>
                  {h}
                </th>
              ),
            )}
            <th scope="col" className={cn(HEAD, "border-b px-3 py-2 text-right")}>
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const isSelected = selected.has(r.id);
            const savedId = r.savedContactId ?? actions.savedNow[r.id] ?? null;
            const busy = actions.busy.has(r.id);
            return (
              <tr
                key={r.id}
                data-state={isSelected ? "selected" : undefined}
                data-index-id={r.id}
                className="group hover:bg-muted/40"
              >
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
                        onCheckedChange={(v) => onSelectedChange(toggle(selected, r.id, Boolean(v)))}
                      />
                    ) : null}
                    <button
                      type="button"
                      onClick={() => onOpenPerson(r)}
                      className="max-w-56 truncate rounded-sm text-left font-medium underline decoration-muted-foreground/40 underline-offset-4 outline-none hover:decoration-foreground focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {r.name}
                    </button>
                  </span>
                </th>
                <td className={cn(cell, "min-w-44 max-w-64")}>
                  {r.title ? <span className="line-clamp-2">{r.title}</span> : muted}
                </td>
                <td className={cn(cell, "min-w-44")}>
                  <button
                    type="button"
                    onClick={() => onOpenCompany(r.company.id)}
                    className="flex max-w-56 items-center gap-2 rounded-md text-left outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <CompanyTile name={r.company.name ?? r.company.domain} />
                    <span className="truncate">{r.company.name ?? r.company.domain}</span>
                  </button>
                </td>
                <td className={cn(cell, "min-w-44")}>
                  <IndexEmailCell person={r} actions={actions} canAccess={permissions.accessEmail} />
                </td>
                <td className={cn(cell, "min-w-36")}>{place([r.company.city, r.company.country])}</td>
                <td className={cell}>
                  <span className="flex flex-col whitespace-nowrap">
                    {seniorityLabel(r.seniority) ?? muted}
                    {r.department ? <span className="text-muted-foreground text-xs">{r.department}</span> : null}
                  </span>
                </td>
                <td className={cell}>
                  {r.company.employeeCount !== null ? (
                    <span className="font-mono text-xs tabular-nums">
                      {r.company.employeeCount.toLocaleString("en-US")}
                    </span>
                  ) : (
                    muted
                  )}
                </td>
                <td className={cn(cell, "min-w-36")}>
                  {r.company.industry ? <span className="whitespace-nowrap">{r.company.industry}</span> : muted}
                </td>
                <td className={cn(cell, "min-w-40")}>
                  <Provenance url={r.sourceUrl} label="Seen" at={r.lastSeenAt} />
                </td>
                <td className={cn(cell, "text-right")}>
                  {savedId ? (
                    <SavedLink href={`/dashboard/people/${savedId}`} />
                  ) : permissions.save ? (
                    <SaveButton
                      label="Save"
                      name={r.name}
                      busy={busy}
                      onClick={() => void actions.save("contact", [r.id])}
                    />
                  ) : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function IndexCompaniesTable({
  rows,
  selected,
  onSelectedChange,
  selectable,
  density,
  pending,
  actions,
  permissions,
  onOpenCompany,
}: TableProps<IndexCompanyView> & { onOpenCompany: (id: string) => void }) {
  const cellPad = density === "compact" ? "py-1.5" : "py-3";
  const cell = cn("border-b px-3 align-middle", cellPad);
  return (
    <div className="relative min-w-0 overflow-x-auto" aria-busy={pending} data-testid="index-results">
      <table
        className={cn("w-full border-separate border-spacing-0 text-sm", pending && "opacity-60 transition-opacity")}
      >
        <caption className="sr-only">Companies in the shared database</caption>
        <thead>
          <tr>
            <th scope="col" className={cn(HEAD, "sticky left-0 z-20 border-b bg-card px-3 py-2 text-left")}>
              <span className="flex items-center gap-2">
                {selectable ? (
                  <SelectHeader
                    ids={rows.map((r) => r.id)}
                    selected={selected}
                    onSelectedChange={onSelectedChange}
                    noun="companies"
                  />
                ) : null}
                Company
              </span>
            </th>
            {["Employees", "Industry", "Location", "Keywords", "People", "Hiring", "Founded", "Source"].map((h) => (
              <th key={h} scope="col" className={cn(HEAD, "border-b px-3 py-2 text-left")}>
                {h}
              </th>
            ))}
            <th scope="col" className={cn(HEAD, "border-b px-3 py-2 text-right")}>
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const isSelected = selected.has(r.id);
            const savedId = r.savedCompanyId ?? actions.savedNow[r.id] ?? null;
            const busy = actions.busy.has(r.id);
            const name = r.name ?? r.domain;
            return (
              <tr
                key={r.id}
                data-state={isSelected ? "selected" : undefined}
                data-index-id={r.id}
                className="group hover:bg-muted/40"
              >
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
                        aria-label={`Select ${name}`}
                        checked={isSelected}
                        onCheckedChange={(v) => onSelectedChange(toggle(selected, r.id, Boolean(v)))}
                      />
                    ) : null}
                    <CompanyTile name={name} />
                    <span className="flex min-w-0 flex-col">
                      <button
                        type="button"
                        onClick={() => onOpenCompany(r.id)}
                        className="max-w-56 truncate rounded-sm text-left font-medium underline decoration-muted-foreground/40 underline-offset-4 outline-none hover:decoration-foreground focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {name}
                      </button>
                      <span className="max-w-56 truncate font-mono text-muted-foreground text-xs">{r.domain}</span>
                    </span>
                  </span>
                </th>
                <td className={cell}>
                  {r.employeeCount !== null ? (
                    <span className="font-mono text-xs tabular-nums">{r.employeeCount.toLocaleString("en-US")}</span>
                  ) : r.employeeRange ? (
                    <span className="font-mono text-xs">{r.employeeRange}</span>
                  ) : (
                    muted
                  )}
                </td>
                <td className={cn(cell, "min-w-36")}>
                  {r.industry ? <span className="whitespace-nowrap">{r.industry}</span> : muted}
                </td>
                <td className={cn(cell, "min-w-36")}>{place([r.city, r.region, r.country])}</td>
                <td className={cn(cell, "min-w-48")}>
                  {r.keywords.length ? (
                    <span className="flex flex-wrap gap-1">
                      {r.keywords.slice(0, 3).map((k) => (
                        <span key={k} className="max-w-40 truncate rounded-md bg-muted px-1.5 py-0.5 text-xs">
                          {k}
                        </span>
                      ))}
                      {r.keywords.length > 3 ? (
                        <span className="font-mono text-muted-foreground text-xs">+{r.keywords.length - 3}</span>
                      ) : null}
                    </span>
                  ) : (
                    muted
                  )}
                </td>
                <td className={cell}>
                  <span className="font-mono text-xs tabular-nums">{r.peopleCount.toLocaleString("en-US")}</span>
                </td>
                <td className={cell}>
                  {r.hiring ? (
                    <Badge variant="secondary" className="bg-sky-500/10 font-medium text-sky-700 dark:text-sky-400">
                      Hiring
                    </Badge>
                  ) : (
                    muted
                  )}
                </td>
                <td className={cell}>
                  {r.foundedYear ? <span className="font-mono text-xs tabular-nums">{r.foundedYear}</span> : muted}
                </td>
                <td className={cn(cell, "min-w-40")}>
                  {r.lastCrawledAt ? (
                    <Provenance url={null} label="Crawled" at={r.lastCrawledAt} />
                  ) : (
                    <Provenance url={null} label="Found" at={r.firstSeenAt} />
                  )}
                </td>
                <td className={cn(cell, "text-right")}>
                  {savedId ? (
                    <SavedLink href={`/dashboard/companies/${savedId}`} />
                  ) : permissions.save ? (
                    <SaveButton
                      label="Save"
                      name={name}
                      busy={busy}
                      onClick={() => void actions.save("company", [r.id])}
                    />
                  ) : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
