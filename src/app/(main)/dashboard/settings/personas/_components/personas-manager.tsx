"use client";

import { useState } from "react";

import Link from "next/link";
import { useRouter } from "next/navigation";

import { Pencil, Plus, Search, Trash2, UserRoundSearch } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { apiFetch } from "@/lib/api-fetch";
import { SENIORITY_LABELS, type Seniority } from "@/lib/records-vocabulary";
import type { PersonaDto } from "@/server/services/personas";

import { ConfirmDialog } from "../../../_components/pipeline/confirm-dialog";
import { PageHeader } from "../../../_components/pipeline/page-header";
import { PersonaDialog } from "../../../_components/records/persona-dialog";

function Chips({ values, label }: { values: string[]; label?: (v: string) => string }) {
  if (!values.length) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="flex max-w-72 flex-wrap gap-1">
      {values.slice(0, 5).map((v) => (
        <Badge key={v} variant="outline" className="font-normal">
          {label ? label(v) : v}
        </Badge>
      ))}
      {values.length > 5 ? <span className="text-muted-foreground text-xs">+{values.length - 5} more</span> : null}
    </span>
  );
}

const seniorityLabel = (v: string) => SENIORITY_LABELS[v as Seniority] ?? v;

export function PersonasManager({
  personas,
  canManage,
}: {
  readonly personas: PersonaDto[];
  readonly canManage: boolean;
}) {
  const router = useRouter();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<PersonaDto | undefined>(undefined);
  const [toDelete, setToDelete] = useState<PersonaDto | null>(null);

  function openCreate() {
    setEditing(undefined);
    setDialogOpen(true);
  }

  async function remove(): Promise<boolean> {
    if (!toDelete) return true;
    const res = await apiFetch(`/api/v1/personas/${toDelete.id}`, { method: "DELETE" });
    if (!res.ok) {
      toast.error(res.error);
      return false;
    }
    toast.success(`Deleted ${toDelete.name}.`);
    router.refresh();
    return true;
  }

  const addButton = canManage ? (
    <Button size="sm" onClick={openCreate}>
      <Plus data-icon="inline-start" aria-hidden="true" />
      Create persona
    </Button>
  ) : null;

  return (
    <div className="flex flex-col gap-4 md:gap-6">
      <PageHeader
        title="Personas"
        description="Describe the buyers you sell to by job title, management level and department, then filter people by persona."
        actions={addButton}
      />
      {personas.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <UserRoundSearch aria-hidden="true" />
            </EmptyMedia>
            <EmptyTitle>No personas yet</EmptyTitle>
            <EmptyDescription>
              Create a persona to find everyone who matches a kind of buyer in one click.
            </EmptyDescription>
          </EmptyHeader>
          {addButton ? <EmptyContent>{addButton}</EmptyContent> : null}
        </Empty>
      ) : (
        <div className="overflow-x-auto rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">Name</TableHead>
                <TableHead>Job titles</TableHead>
                <TableHead>Management levels</TableHead>
                <TableHead>Departments</TableHead>
                <TableHead className="pr-4 text-right">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {personas.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="pl-4 font-medium">{p.name}</TableCell>
                  <TableCell>
                    <Chips values={p.titles} />
                  </TableCell>
                  <TableCell>
                    <Chips values={p.seniorities} label={seniorityLabel} />
                  </TableCell>
                  <TableCell>
                    <Chips values={p.departments} />
                  </TableCell>
                  <TableCell className="pr-4 text-right">
                    <div className="flex justify-end gap-1">
                      <Button asChild variant="ghost" size="icon-sm" aria-label={`Find people matching ${p.name}`}>
                        <Link href={`/dashboard/people?personaId=${encodeURIComponent(p.id)}`}>
                          <Search aria-hidden="true" />
                        </Link>
                      </Button>
                      {canManage ? (
                        <>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`Edit ${p.name}`}
                            onClick={() => {
                              setEditing(p);
                              setDialogOpen(true);
                            }}
                          >
                            <Pencil aria-hidden="true" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`Delete ${p.name}`}
                            onClick={() => setToDelete(p)}
                          >
                            <Trash2 aria-hidden="true" />
                          </Button>
                        </>
                      ) : null}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {!canManage ? (
        <p className="text-muted-foreground text-xs">Managers, administrators and owners can change personas.</p>
      ) : null}
      <PersonaDialog open={dialogOpen} onOpenChange={setDialogOpen} persona={editing} />
      <ConfirmDialog
        open={toDelete !== null}
        onOpenChange={(open) => !open && setToDelete(null)}
        title={`Delete ${toDelete?.name ?? "this persona"}?`}
        description="People tagged with this persona keep their data. The persona filter stops matching them."
        confirmLabel="Delete persona"
        pendingLabel="Deleting…"
        icon={<Trash2 data-icon="inline-start" aria-hidden="true" />}
        onConfirm={remove}
      />
    </div>
  );
}
