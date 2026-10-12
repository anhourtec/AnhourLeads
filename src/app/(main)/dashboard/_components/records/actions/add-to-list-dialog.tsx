"use client";

import { useEffect, useId, useState } from "react";

import { useRouter } from "next/navigation";

import { ListPlus, Plus } from "lucide-react";
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
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";

import { apiRequest } from "../api-client";

interface ListOption {
  id: string;
  name: string;
  kind: "static" | "dynamic";
  memberCount: number;
}

const CHUNK = 1000;

/**
 * Add records to an existing static list, or create a list inline and add them to it.
 * Dynamic lists are left out: they fill themselves from their filters.
 */
export function AddToListDialog({
  open,
  onOpenChange,
  entityType,
  ids,
  canCreate,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entityType: "contact" | "company";
  ids: string[];
  canCreate: boolean;
  onDone?: () => void;
}) {
  const router = useRouter();
  const id = useId();
  const [lists, setLists] = useState<ListOption[] | null>(null);
  const [listId, setListId] = useState("");
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const noun =
    entityType === "contact" ? (ids.length === 1 ? "person" : "people") : ids.length === 1 ? "company" : "companies";

  useEffect(() => {
    if (!open) return;
    setError(null);
    setName("");
    let cancelled = false;
    void apiRequest<{ labels: ListOption[] }>(`/api/v1/labels?entityType=${entityType}`).then((res) => {
      if (cancelled) return;
      if (!res.ok) {
        setError(res.error);
        setLists([]);
        return;
      }
      const statics = res.data.labels.filter((l) => l.kind === "static");
      setLists(statics);
      setListId(statics[0]?.id ?? "");
      setCreating(statics.length === 0 && canCreate);
    });
    return () => {
      cancelled = true;
    };
  }, [open, entityType, canCreate]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    let target = listId;
    let targetName = lists?.find((l) => l.id === listId)?.name ?? "the list";
    if (creating) {
      const created = await apiRequest<{ label: { id: string; name: string } }>("/api/v1/labels", {
        body: { name, entityType, kind: "static" },
      });
      if (!created.ok) {
        setPending(false);
        setError(created.error);
        return;
      }
      target = created.data.label.id;
      targetName = created.data.label.name;
    }
    let added = 0;
    for (let i = 0; i < ids.length; i += CHUNK) {
      const res = await apiRequest<{ added: number }>("/api/v1/labels/add_entity_ids", {
        body: { listId: target, entityIds: ids.slice(i, i + CHUNK) },
      });
      if (!res.ok) {
        setPending(false);
        setError(res.error);
        return;
      }
      added += res.data.added;
    }
    setPending(false);
    toast.success(
      added === ids.length
        ? `Added ${ids.length.toLocaleString("en-US")} ${noun} to ${targetName}.`
        : `Added ${added.toLocaleString("en-US")} ${noun} to ${targetName}. The rest were already in it.`,
    );
    onOpenChange(false);
    onDone?.();
    router.refresh();
  }

  const loading = lists === null;
  const canSubmit = !pending && (creating ? name.trim().length > 0 : Boolean(listId));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Add to list</DialogTitle>
            <DialogDescription>
              Add <span className="font-mono tabular-nums">{ids.length.toLocaleString("en-US")}</span> {noun} to a list.
            </DialogDescription>
          </DialogHeader>
          {loading ? (
            <p className="text-muted-foreground text-sm">Loading lists…</p>
          ) : creating ? (
            <div className="flex flex-col gap-2">
              <Label htmlFor={`${id}-name`}>New list name</Label>
              <Input
                id={`${id}-name`}
                value={name}
                maxLength={120}
                autoFocus
                onChange={(e) => setName(e.target.value)}
                placeholder={entityType === "contact" ? "e.g. Q4 sales leaders" : "e.g. Target accounts"}
              />
              {lists?.length ? (
                <Button
                  type="button"
                  variant="link"
                  size="sm"
                  className="w-fit px-0"
                  onClick={() => setCreating(false)}
                >
                  Pick an existing list instead
                </Button>
              ) : null}
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <Label htmlFor={`${id}-list`}>List</Label>
              <NativeSelect id={`${id}-list`} value={listId} onChange={(e) => setListId(e.target.value)}>
                {lists?.map((l) => (
                  <NativeSelectOption key={l.id} value={l.id}>
                    {l.name} ({l.memberCount.toLocaleString("en-US")})
                  </NativeSelectOption>
                ))}
              </NativeSelect>
              {canCreate ? (
                <Button type="button" variant="link" size="sm" className="w-fit px-0" onClick={() => setCreating(true)}>
                  <Plus data-icon="inline-start" aria-hidden="true" />
                  Create a new list
                </Button>
              ) : null}
            </div>
          )}
          {!loading && !creating && !lists?.length ? (
            <p className="text-muted-foreground text-sm">There are no lists yet, and your role can't create one.</p>
          ) : null}
          {error ? (
            <p role="alert" className="text-destructive text-sm">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" size="sm" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={!canSubmit}>
              <ListPlus data-icon="inline-start" aria-hidden="true" />
              {pending ? "Adding…" : "Add to list"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
