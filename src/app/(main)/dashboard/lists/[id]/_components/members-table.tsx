"use client";

import { useState } from "react";

import { useRouter } from "next/navigation";

import { Trash2, Users } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { CompanyStage, ContactEmailStatus, ContactStage } from "@/lib/records-vocabulary";
import type { MembersResult } from "@/server/services/lists";

import { apiRequest } from "../../../_components/records/api-client";
import { CompanyStagePill, ContactStagePill, EmailStatusPill } from "../../../_components/records/status-pills";

/** Members of a list. Static lists let editors select and remove members. */
export function MembersTable({
  listId,
  members,
  canRemove,
  filtered,
}: {
  listId: string;
  members: MembersResult;
  canRemove: boolean;
  filtered: boolean;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState(false);
  const rows = members.entityType === "contact" ? members.contacts : members.accounts;
  const ids = rows.map((r) => r.id);
  const allSelected = ids.length > 0 && ids.every((id) => selected.has(id));

  let emptyHint = "Records added to this list appear here.";
  if (filtered) emptyHint = "Try a different search.";
  else if (canRemove) emptyHint = "Use the add button to put records in this list.";

  if (rows.length === 0) {
    return (
      <Empty className="border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Users aria-hidden="true" />
          </EmptyMedia>
          <EmptyTitle>{filtered ? "No matching members" : "This list is empty"}</EmptyTitle>
          <EmptyDescription>{emptyHint}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  function toggle(id: string, on: boolean) {
    setSelected((current) => {
      const next = new Set(current);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  async function remove(entityIds: string[]) {
    setPending(true);
    const result = await apiRequest<{ removed: number }>("/api/v1/labels/remove_entity_ids", {
      body: { listId, entityIds },
    });
    setPending(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(`Removed ${result.data.removed} from the list.`);
    setSelected(new Set());
    router.refresh();
  }

  const selectCell = (id: string, label: string) =>
    canRemove ? (
      <TableCell className="w-10 pl-4">
        <Checkbox
          aria-label={`Select ${label}`}
          checked={selected.has(id)}
          onCheckedChange={(v) => toggle(id, v === true)}
        />
      </TableCell>
    ) : null;

  return (
    <div className="flex flex-col gap-2">
      {canRemove && selected.size > 0 ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2">
          <span className="text-sm">
            <span className="font-mono tabular-nums">{selected.size}</span> selected
          </span>
          <Button size="sm" variant="destructive" disabled={pending} onClick={() => remove([...selected])}>
            <Trash2 data-icon="inline-start" aria-hidden="true" />
            {pending ? "Removing…" : "Remove from list"}
          </Button>
        </div>
      ) : null}
      <div className="overflow-hidden rounded-xl border bg-card">
        <Table className="min-w-[720px]">
          <TableHeader className="bg-muted/50">
            <TableRow>
              {canRemove ? (
                <TableHead className="w-10 pl-4">
                  <Checkbox
                    aria-label="Select all on this page"
                    checked={allSelected}
                    onCheckedChange={(v) => setSelected(v === true ? new Set(ids) : new Set())}
                  />
                </TableHead>
              ) : null}
              {members.entityType === "contact" ? (
                <>
                  <TableHead className={canRemove ? "" : "px-4"}>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Email status</TableHead>
                  <TableHead>Stage</TableHead>
                  <TableHead className="px-4">Company</TableHead>
                </>
              ) : (
                <>
                  <TableHead className={canRemove ? "" : "px-4"}>Name</TableHead>
                  <TableHead>Domain</TableHead>
                  <TableHead>Industry</TableHead>
                  <TableHead className="text-right">Employees</TableHead>
                  <TableHead className="px-4">Stage</TableHead>
                </>
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {members.entityType === "contact"
              ? members.contacts.map((c) => (
                  <TableRow key={c.id} data-state={selected.has(c.id) ? "selected" : undefined}>
                    {selectCell(c.id, c.name)}
                    <TableCell className={canRemove ? "max-w-60" : "max-w-60 px-4"}>
                      <div className="flex min-w-0 flex-col">
                        <span className="truncate font-medium">{c.name}</span>
                        {c.title ? <span className="truncate text-muted-foreground text-xs">{c.title}</span> : null}
                      </div>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{c.email ?? "—"}</TableCell>
                    <TableCell>
                      <EmailStatusPill status={c.emailStatus as ContactEmailStatus} />
                    </TableCell>
                    <TableCell>
                      <ContactStagePill stage={c.stage as ContactStage} />
                    </TableCell>
                    <TableCell className="max-w-48 truncate px-4 text-muted-foreground">
                      {c.companyName ?? "—"}
                    </TableCell>
                  </TableRow>
                ))
              : members.accounts.map((a) => (
                  <TableRow key={a.id} data-state={selected.has(a.id) ? "selected" : undefined}>
                    {selectCell(a.id, a.name)}
                    <TableCell
                      className={canRemove ? "max-w-60 truncate font-medium" : "max-w-60 truncate px-4 font-medium"}
                    >
                      {a.name}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{a.domain ?? "—"}</TableCell>
                    <TableCell className="text-muted-foreground">{a.industry ?? "—"}</TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {a.employeeCount?.toLocaleString("en-US") ?? "—"}
                    </TableCell>
                    <TableCell className="px-4">
                      <CompanyStagePill stage={a.stage as CompanyStage} />
                    </TableCell>
                  </TableRow>
                ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
