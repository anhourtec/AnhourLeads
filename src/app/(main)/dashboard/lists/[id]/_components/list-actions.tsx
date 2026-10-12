"use client";

import { useId, useMemo, useState } from "react";

import { useRouter } from "next/navigation";

import { Filter, Pencil } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { type FilterState, filtersFromObject } from "@/lib/search/filters";

import { apiRequest } from "../../../_components/records/api-client";
import { ConfirmDeleteDialog } from "../../../_components/records/confirm-delete-dialog";
import type { EditorContext } from "../../../_components/records/search/filter-editors";
import { FiltersModal } from "../../../_components/records/search/filters-modal";
import type { SearchOptions, SearchPermissions } from "../../../_components/records/search/types";
import { AddMembersDialog } from "./add-members-dialog";

interface ListInfo {
  id: string;
  name: string;
  entityType: "contact" | "company";
  kind: "static" | "dynamic";
  filters: Record<string, unknown> | null;
}

function RenameDialog({ list }: { list: ListInfo }) {
  const router = useRouter();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(list.name);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => {
          setName(list.name);
          setError(null);
          setOpen(true);
        }}
      >
        <Pencil data-icon="inline-start" aria-hidden="true" />
        Rename
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <form
            className="flex flex-col gap-4"
            onSubmit={async (e) => {
              e.preventDefault();
              setPending(true);
              const res = await apiRequest(`/api/v1/labels/${list.id}`, { method: "PATCH", body: { name } });
              setPending(false);
              if (!res.ok) {
                setError(res.error);
                return;
              }
              toast.success("List renamed.");
              setOpen(false);
              router.refresh();
            }}
          >
            <DialogHeader>
              <DialogTitle>Rename list</DialogTitle>
              <DialogDescription>Members stay as they are.</DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${id}-name`}>Name</Label>
              <Input id={`${id}-name`} value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
            </div>
            {error ? (
              <p role="alert" className="text-destructive text-sm">
                {error}
              </p>
            ) : null}
            <DialogFooter>
              <Button type="button" variant="outline" size="sm" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={pending || !name.trim()}>
                {pending ? "Saving…" : "Save"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

function EditFiltersButton({
  list,
  options,
  permissions,
}: {
  list: ListInfo;
  options: SearchOptions;
  permissions: SearchPermissions;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const current = useMemo(() => filtersFromObject(list.filters), [list.filters]);
  const ctx: EditorContext = useMemo(
    () => ({ entity: list.entityType, facets: {}, options, permissions }),
    [list.entityType, options, permissions],
  );
  const fixedBody = useMemo(() => ({}), []);
  return (
    <>
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Filter data-icon="inline-start" aria-hidden="true" />
        Edit filters
      </Button>
      <FiltersModal
        open={open}
        onOpenChange={setOpen}
        filters={current}
        ctx={ctx}
        pins={[]}
        onPinsChange={() => undefined}
        pinnable={false}
        countUrl={`/api/v1/${list.entityType === "contact" ? "mixed_people" : "mixed_companies"}/search`}
        fixedBody={fixedBody}
        onApply={async (next: FilterState) => {
          const res = await apiRequest(`/api/v1/labels/${list.id}`, { method: "PATCH", body: { filters: next } });
          if (!res.ok) toast.error(res.error);
          else {
            toast.success("List filters saved.");
            router.refresh();
          }
        }}
      />
    </>
  );
}

/** Header actions on a list page: add people (static), edit filters (dynamic), rename, delete. */
export function ListActions({
  list,
  canUpdate,
  canDelete,
  options,
  permissions,
}: {
  list: ListInfo;
  canUpdate: boolean;
  canDelete: boolean;
  options: SearchOptions;
  permissions: SearchPermissions;
}) {
  const router = useRouter();
  if (!canUpdate && !canDelete) return null;
  return (
    <>
      {canUpdate && list.kind === "static" ? <AddMembersDialog listId={list.id} entityType={list.entityType} /> : null}
      {canUpdate && list.kind === "dynamic" ? (
        <EditFiltersButton list={list} options={options} permissions={permissions} />
      ) : null}
      {canUpdate ? <RenameDialog list={list} /> : null}
      {canDelete ? (
        <ConfirmDeleteDialog
          title="Delete this list?"
          description={`"${list.name}" will be deleted. The ${list.entityType === "contact" ? "people" : "companies"} in it are kept.`}
          onConfirm={async () => {
            const result = await apiRequest(`/api/v1/labels/${list.id}`, { method: "DELETE" });
            if (!result.ok) return result.error;
            toast.success("List deleted.");
            router.push("/dashboard/lists");
            router.refresh();
            return null;
          }}
        />
      ) : null}
    </>
  );
}
