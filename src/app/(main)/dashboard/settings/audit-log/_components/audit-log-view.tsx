"use client";

import { FilterX, ScrollText } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { formatDateTime, relativeTime } from "@/lib/format-display";
import type { AuditLogDto } from "@/server/services/audit-log";

import { actorLabel, describeAction } from "../../../_components/pipeline/audit-describe";
import { ListPagination } from "../../../_components/pipeline/list-pagination";
import { useUrlFilters } from "../../../_components/pipeline/use-url-filters";

const ACTION_GROUPS = [
  { value: "member.", label: "Members" },
  { value: "apikey.", label: "API keys" },
  { value: "workspace.", label: "Workspace" },
  { value: "task.", label: "Tasks" },
  { value: "deal.", label: "Deals" },
  { value: "suppression.", label: "Do not contact" },
  { value: "privacy.", label: "Data requests" },
  { value: "contact.", label: "People" },
  { value: "company.", label: "Companies" },
] as const;

function metadataSummary(metadata: Record<string, unknown> | null): string {
  if (!metadata) return "";
  return Object.entries(metadata)
    .filter(([, v]) => v !== null && v !== undefined && typeof v !== "object")
    .slice(0, 4)
    .map(([k, v]) => `${k}: ${String(v)}`)
    .join(" · ");
}

export function AuditLogView({
  entries,
  pagination,
  entityTypes,
  members,
  now,
}: {
  readonly entries: AuditLogDto[];
  readonly pagination: { page: number; total_pages: number; total_entries: number };
  readonly entityTypes: string[];
  readonly members: { id: string; name: string }[];
  readonly now: string;
}) {
  const filters = useUrlFilters();
  const reference = new Date(now);
  const active = ["action", "actor", "entity", "from", "to"].some((k) => filters.get(k));

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-end">
        <div className="flex flex-col gap-1">
          <Label htmlFor="audit-action" className="text-muted-foreground text-xs">
            Area
          </Label>
          <NativeSelect
            id="audit-action"
            size="sm"
            value={filters.get("action")}
            onChange={(e) => filters.set({ action: e.target.value })}
            className="w-full sm:w-40"
          >
            <NativeSelectOption value="">All areas</NativeSelectOption>
            {ACTION_GROUPS.map((g) => (
              <NativeSelectOption key={g.value} value={g.value}>
                {g.label}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="audit-actor" className="text-muted-foreground text-xs">
            Person
          </Label>
          <NativeSelect
            id="audit-actor"
            size="sm"
            value={filters.get("actor")}
            onChange={(e) => filters.set({ actor: e.target.value })}
            className="w-full sm:w-44"
          >
            <NativeSelectOption value="">Anyone</NativeSelectOption>
            {members.map((m) => (
              <NativeSelectOption key={m.id} value={m.id}>
                {m.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="audit-entity" className="text-muted-foreground text-xs">
            Record type
          </Label>
          <NativeSelect
            id="audit-entity"
            size="sm"
            value={filters.get("entity")}
            onChange={(e) => filters.set({ entity: e.target.value })}
            className="w-full sm:w-40"
          >
            <NativeSelectOption value="">Any type</NativeSelectOption>
            {entityTypes.map((t) => (
              <NativeSelectOption key={t} value={t}>
                {t.replace(/_/g, " ")}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="audit-from" className="text-muted-foreground text-xs">
            From
          </Label>
          <Input
            id="audit-from"
            type="date"
            className="h-7 w-full sm:w-40"
            value={filters.get("from")}
            onChange={(e) => filters.set({ from: e.target.value })}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="audit-to" className="text-muted-foreground text-xs">
            To
          </Label>
          <Input
            id="audit-to"
            type="date"
            className="h-7 w-full sm:w-40"
            value={filters.get("to")}
            onChange={(e) => filters.set({ to: e.target.value })}
          />
        </div>
        {active ? (
          <Button
            variant="ghost"
            size="sm"
            className="col-span-2 justify-self-start"
            onClick={() => filters.set({ action: null, actor: null, entity: null, from: null, to: null })}
          >
            <FilterX data-icon="inline-start" />
            Clear filters
          </Button>
        ) : null}
      </div>

      {entries.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <ScrollText aria-hidden="true" />
            </EmptyMedia>
            <EmptyTitle>{active ? "Nothing matches these filters" : "No activity yet"}</EmptyTitle>
            <EmptyDescription>
              {active ? "Try a wider date range or another area." : "Changes people make here will be listed."}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ol className="flex flex-col divide-y rounded-xl border" aria-label="Audit entries" aria-busy={filters.pending}>
          {entries.map((entry) => {
            const summary = metadataSummary(entry.metadata);
            return (
              <li
                key={entry.id}
                className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4"
              >
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-sm">
                    <span className="font-medium">{actorLabel(entry)}</span>{" "}
                    <span className="text-muted-foreground">{describeAction(entry.action)}</span>
                  </span>
                  <span className="break-all font-mono text-muted-foreground text-xs">
                    {entry.action}
                    {entry.entityId ? ` · ${entry.entityType} ${entry.entityId}` : ` · ${entry.entityType}`}
                  </span>
                  {summary ? <span className="break-words text-muted-foreground text-xs">{summary}</span> : null}
                </div>
                <time
                  dateTime={entry.createdAt}
                  title={formatDateTime(entry.createdAt)}
                  className="shrink-0 text-muted-foreground text-xs"
                >
                  {relativeTime(entry.createdAt, reference)}
                </time>
              </li>
            );
          })}
        </ol>
      )}
      <ListPagination
        page={pagination.page}
        totalPages={pagination.total_pages}
        total={pagination.total_entries}
        noun={pagination.total_entries === 1 ? "entry" : "entries"}
      />
    </div>
  );
}
