"use client";

import { useState } from "react";

import { useRouter } from "next/navigation";

import { Search, ShieldBan, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { apiFetch } from "@/lib/api-fetch";
import { formatDate, formatDateTime } from "@/lib/format-display";
import { SUPPRESSION_REASON_LABELS, type SuppressionReason } from "@/lib/pipeline-constants";
import type { SuppressionDto } from "@/server/services/suppressions";

import { ConfirmDialog } from "../../../_components/pipeline/confirm-dialog";
import { ListPagination } from "../../../_components/pipeline/list-pagination";
import { Pill, type Tone } from "../../../_components/pipeline/pills";
import { useUrlFilters } from "../../../_components/pipeline/use-url-filters";

const REASON_TONE: Record<SuppressionReason, Tone> = {
  manual: "neutral",
  unsubscribed: "info",
  bounced: "attention",
  complaint: "negative",
  erasure_request: "negative",
};

export function EntriesList({
  entries,
  pagination,
  canDelete,
  canCreate,
}: {
  readonly entries: SuppressionDto[];
  readonly pagination: { page: number; total_pages: number; total_entries: number };
  readonly canDelete: boolean;
  readonly canCreate: boolean;
}) {
  const router = useRouter();
  const filters = useUrlFilters();
  const [query, setQuery] = useState(filters.get("q"));
  const [toDelete, setToDelete] = useState<SuppressionDto | null>(null);
  const filtered = Boolean(filters.get("q") || filters.get("kind"));

  async function remove(): Promise<boolean> {
    if (!toDelete) return true;
    const res = await apiFetch(`/api/v1/suppressions/${toDelete.id}`, { method: "DELETE" });
    if (!res.ok) {
      toast.error(res.error);
      return false;
    }
    toast.success(`${toDelete.value} removed from the list`);
    router.refresh();
    return true;
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-col gap-2 sm:flex-row">
          <form
            className="w-full sm:max-w-xs"
            onSubmit={(e) => {
              e.preventDefault();
              filters.set({ q: query.trim() || null });
            }}
          >
            <InputGroup>
              <InputGroupAddon>
                <Search aria-hidden="true" />
              </InputGroupAddon>
              <InputGroupInput
                aria-label="Search the list"
                placeholder="Search emails, domains, notes"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </InputGroup>
          </form>
          <NativeSelect
            size="sm"
            aria-label="Kind"
            value={filters.get("kind")}
            onChange={(e) => filters.set({ kind: e.target.value })}
            className="w-full sm:w-36"
          >
            <NativeSelectOption value="">Emails and domains</NativeSelectOption>
            <NativeSelectOption value="email">Emails</NativeSelectOption>
            <NativeSelectOption value="domain">Domains</NativeSelectOption>
          </NativeSelect>
        </div>

        {entries.length === 0 ? (
          <Empty className="border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <ShieldBan aria-hidden="true" />
              </EmptyMedia>
              <EmptyTitle>{filtered ? "Nothing matches" : "The list is empty"}</EmptyTitle>
              <EmptyDescription>
                {filtered ? "Try a different search." : null}
                {!filtered && canCreate ? "Add addresses or domains you must never email." : null}
                {filtered || canCreate ? null : "Nobody has been added yet."}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <ul className="flex flex-col divide-y" aria-label="Do-not-contact entries">
            {entries.map((entry) => (
              <li
                key={entry.id}
                className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="flex min-w-0 flex-col gap-1">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <span className="min-w-0 break-all font-mono text-sm">{entry.value}</span>
                    <Pill tone={REASON_TONE[entry.reason]}>{SUPPRESSION_REASON_LABELS[entry.reason]}</Pill>
                  </div>
                  <span className="text-muted-foreground text-xs">
                    {entry.kind === "domain" ? "Whole domain" : "Email"} · added{" "}
                    <time dateTime={entry.createdAt} title={formatDateTime(entry.createdAt)}>
                      {formatDate(entry.createdAt)}
                    </time>
                    {entry.createdBy ? ` by ${entry.createdBy.name}` : ""}
                    {entry.note ? ` · ${entry.note}` : ""}
                  </span>
                </div>
                {canDelete && entry.reason !== "erasure_request" ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="self-start sm:self-auto"
                    onClick={() => setToDelete(entry)}
                    aria-label={`Remove ${entry.value}`}
                  >
                    <Trash2 data-icon="inline-start" />
                    Remove
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        <ListPagination
          page={pagination.page}
          totalPages={pagination.total_pages}
          total={pagination.total_entries}
          noun={pagination.total_entries === 1 ? "entry" : "entries"}
        />
      </CardContent>
      <ConfirmDialog
        open={toDelete !== null}
        onOpenChange={(open) => !open && setToDelete(null)}
        title={`Remove ${toDelete?.value ?? ""}?`}
        description="Sequences will be able to email matching people again. People already marked do not contact keep that stage until someone changes it."
        confirmLabel="Remove from list"
        pendingLabel="Removing…"
        icon={<Trash2 data-icon="inline-start" />}
        onConfirm={remove}
      />
    </Card>
  );
}
