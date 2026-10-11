"use client";

import { useState } from "react";

import { useRouter } from "next/navigation";

import { Pencil, Plus, SlidersHorizontal, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { apiFetch } from "@/lib/api-fetch";
import type { CustomFieldDto, CustomFieldEntity } from "@/server/services/custom-fields";

import { ConfirmDialog } from "../../../_components/pipeline/confirm-dialog";
import { PageHeader } from "../../../_components/pipeline/page-header";
import { CustomFieldDialog, TYPE_LABELS } from "./custom-field-dialog";

const TABS: { value: CustomFieldEntity; label: string; noun: string }[] = [
  { value: "contact", label: "Contacts", noun: "people" },
  { value: "company", label: "Accounts", noun: "companies" },
  { value: "deal", label: "Deals", noun: "deals" },
];

export function CustomFieldsManager({
  fields,
  canManage,
  initialTab,
}: {
  readonly fields: CustomFieldDto[];
  readonly canManage: boolean;
  readonly initialTab: CustomFieldEntity;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<CustomFieldEntity>(initialTab);
  const [editing, setEditing] = useState<CustomFieldDto | null>(null);
  const [creating, setCreating] = useState(false);
  const [toDelete, setToDelete] = useState<CustomFieldDto | null>(null);

  async function remove(): Promise<boolean> {
    if (!toDelete) return true;
    const res = await apiFetch(`/api/v1/custom_fields/${toDelete.id}`, { method: "DELETE" });
    if (!res.ok) {
      toast.error(res.error);
      return false;
    }
    toast.success(`Deleted ${toDelete.label}.`);
    router.refresh();
    return true;
  }

  const addButton = canManage ? (
    <Button size="sm" onClick={() => setCreating(true)}>
      <Plus data-icon="inline-start" aria-hidden="true" />
      Add field
    </Button>
  ) : null;

  return (
    <div className="flex flex-col gap-4 md:gap-6">
      <PageHeader
        title="Custom fields"
        description="Extra fields for people, companies and deals. They show on record pages, in search filters and as import targets."
        actions={addButton}
      />
      <Tabs value={tab} onValueChange={(v) => setTab(v as CustomFieldEntity)}>
        <TabsList>
          {TABS.map((t) => (
            <TabsTrigger key={t.value} value={t.value}>
              {t.label}
              <span className="font-mono text-muted-foreground text-xs tabular-nums">
                {fields.filter((f) => f.entityType === t.value).length}
              </span>
            </TabsTrigger>
          ))}
        </TabsList>
        {TABS.map((t) => {
          const rows = fields.filter((f) => f.entityType === t.value);
          return (
            <TabsContent key={t.value} value={t.value} className="mt-2">
              {rows.length === 0 ? (
                <Empty className="border">
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <SlidersHorizontal aria-hidden="true" />
                    </EmptyMedia>
                    <EmptyTitle>No custom fields for {t.noun}</EmptyTitle>
                    <EmptyDescription>
                      Add a field to keep information the standard fields don't cover.
                    </EmptyDescription>
                  </EmptyHeader>
                  {addButton ? <EmptyContent>{addButton}</EmptyContent> : null}
                </Empty>
              ) : (
                <div className="overflow-x-auto rounded-xl border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="pl-4">Label</TableHead>
                        <TableHead>Key</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>Options</TableHead>
                        {canManage ? (
                          <TableHead className="pr-4 text-right">
                            <span className="sr-only">Actions</span>
                          </TableHead>
                        ) : null}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rows.map((f) => (
                        <TableRow key={f.id}>
                          <TableCell className="pl-4 font-medium">{f.label}</TableCell>
                          <TableCell className="font-mono text-xs">{f.key}</TableCell>
                          <TableCell>{TYPE_LABELS[f.type]}</TableCell>
                          <TableCell>
                            {f.options.length ? (
                              <span className="flex max-w-80 flex-wrap gap-1">
                                {f.options.slice(0, 6).map((o) => (
                                  <Badge key={o} variant="outline" className="font-normal">
                                    {o}
                                  </Badge>
                                ))}
                                {f.options.length > 6 ? (
                                  <span className="text-muted-foreground text-xs">+{f.options.length - 6} more</span>
                                ) : null}
                              </span>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </TableCell>
                          {canManage ? (
                            <TableCell className="pr-4 text-right">
                              <div className="flex justify-end gap-1">
                                <Button
                                  variant="ghost"
                                  size="icon-sm"
                                  aria-label={`Edit ${f.label}`}
                                  onClick={() => setEditing(f)}
                                >
                                  <Pencil aria-hidden="true" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon-sm"
                                  aria-label={`Delete ${f.label}`}
                                  onClick={() => setToDelete(f)}
                                >
                                  <Trash2 aria-hidden="true" />
                                </Button>
                              </div>
                            </TableCell>
                          ) : null}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </TabsContent>
          );
        })}
      </Tabs>
      {!canManage ? (
        <p className="text-muted-foreground text-xs">Only administrators and owners can change custom fields.</p>
      ) : null}
      <CustomFieldDialog
        open={creating || editing !== null}
        onOpenChange={(open) => {
          if (!open) {
            setCreating(false);
            setEditing(null);
          }
        }}
        entityType={tab}
        field={editing}
      />
      <ConfirmDialog
        open={toDelete !== null}
        onOpenChange={(open) => !open && setToDelete(null)}
        title={`Delete ${toDelete?.label ?? "this field"}?`}
        description="The field and every value stored in it are removed from all records. This can't be undone."
        confirmLabel="Delete field"
        pendingLabel="Deleting…"
        icon={<Trash2 data-icon="inline-start" aria-hidden="true" />}
        onConfirm={remove}
      />
    </div>
  );
}
