"use client";

import { useEffect, useId, useState } from "react";

import { useRouter } from "next/navigation";

import { cn } from "cn";
import { ChevronDown, LayoutList, Plus, Star, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

import { apiRequest } from "../api-client";
import type { Option, SavedSearchItem } from "./types";

const TABS = [
  { value: "all", label: "All searches" },
  { value: "mine", label: "Your searches" },
  { value: "starred", label: "Starred" },
  { value: "assigned", label: "Assigned to you" },
  { value: "shared", label: "Shared" },
] as const;
type Tab = (typeof TABS)[number]["value"];

/** "Default view ▾": pick, star or delete a saved search, or create one from the current filters. */
export function SavedSearchMenu({
  searches,
  active,
  currentUserId,
  canSave,
  onSelect,
  onDefault,
  onCreate,
}: {
  searches: SavedSearchItem[];
  active: SavedSearchItem | null;
  currentUserId: string;
  canSave: boolean;
  onSelect: (s: SavedSearchItem) => void;
  onDefault: () => void;
  onCreate: () => void;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("all");
  const shown = searches.filter((s) => {
    switch (tab) {
      case "mine":
        return s.ownerId === currentUserId;
      case "starred":
        return s.starred;
      case "assigned":
        return s.assignedToId === currentUserId;
      case "shared":
        return s.shared;
      default:
        return true;
    }
  });

  async function star(s: SavedSearchItem) {
    const res = await apiRequest(`/api/v1/saved_searches/${s.id}`, { method: "PATCH", body: { starred: !s.starred } });
    if (!res.ok) toast.error(res.error);
    else router.refresh();
  }

  async function remove(s: SavedSearchItem) {
    const res = await apiRequest(`/api/v1/saved_searches/${s.id}`, { method: "DELETE" });
    if (!res.ok) toast.error(res.error);
    else {
      toast.success(`Deleted ${s.name}.`);
      if (active?.id === s.id) onDefault();
      router.refresh();
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="max-w-56">
          <LayoutList data-icon="inline-start" aria-hidden="true" />
          <span className="truncate">{active ? active.name : "Default view"}</span>
          <ChevronDown data-icon="inline-end" aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[min(26rem,calc(100vw-2rem))] gap-0 p-0">
        <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)} className="gap-0">
          <div className="overflow-x-auto border-b p-2">
            <TabsList className="w-max">
              {TABS.map((t) => (
                <TabsTrigger key={t.value} value={t.value} className="text-xs">
                  {t.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>
        </Tabs>
        <ul className="flex max-h-72 flex-col overflow-y-auto p-1" aria-label="Saved searches">
          <li>
            <button
              type="button"
              className={cn(
                "w-full rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                !active && "bg-muted font-medium",
              )}
              onClick={() => {
                onDefault();
                setOpen(false);
              }}
            >
              Default view
            </button>
          </li>
          {shown.map((s) => (
            <li key={s.id} className="group flex items-center gap-1 rounded-md hover:bg-muted">
              <button
                type="button"
                className={cn(
                  "min-w-0 flex-1 rounded-md px-2 py-1.5 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  active?.id === s.id && "font-medium",
                )}
                onClick={() => {
                  onSelect(s);
                  setOpen(false);
                }}
              >
                <span className="block truncate">{s.name}</span>
                <span className="block truncate text-muted-foreground text-xs">
                  {[s.owner?.name, s.shared ? "Shared" : "Private"].filter(Boolean).join(" · ")}
                </span>
              </button>
              {canSave ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-pressed={s.starred}
                  aria-label={s.starred ? `Unstar ${s.name}` : `Star ${s.name}`}
                  onClick={() => void star(s)}
                >
                  <Star className={cn(s.starred && "fill-current text-amber-500")} aria-hidden="true" />
                </Button>
              ) : null}
              {s.isOwner ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label={`Delete ${s.name}`}
                  onClick={() => void remove(s)}
                >
                  <Trash2 aria-hidden="true" />
                </Button>
              ) : null}
            </li>
          ))}
          {!shown.length ? (
            <li className="px-2 py-3 text-muted-foreground text-sm">No saved searches here yet.</li>
          ) : null}
        </ul>
        {canSave ? (
          <div className="border-t p-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="w-full justify-start"
              onClick={() => {
                setOpen(false);
                onCreate();
              }}
            >
              <Plus data-icon="inline-start" aria-hidden="true" />
              Create saved search
            </Button>
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

/** Name, sharing, alerts and assignee for a new saved search, or saving changes to the current one. */
export function SaveSearchDialog({
  open,
  onOpenChange,
  entityType,
  filters,
  columns,
  sort,
  members,
  existing,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entityType: "contact" | "company";
  filters: Record<string, unknown>;
  columns: string[];
  sort: { field: string; ascending: boolean } | null;
  members: Option[];
  existing: SavedSearchItem | null;
  onSaved: (id: string) => void;
}) {
  const id = useId();
  const [mode, setMode] = useState<"new" | "update">("new");
  const [name, setName] = useState("");
  const [shared, setShared] = useState(false);
  const [alerts, setAlerts] = useState(false);
  const [assignee, setAssignee] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    const canUpdate = Boolean(existing?.isOwner);
    setMode(canUpdate ? "update" : "new");
    setName(canUpdate && existing ? existing.name : "");
    setShared(canUpdate && existing ? existing.shared : false);
    setAlerts(canUpdate && existing ? existing.alertsEnabled : false);
    setAssignee(canUpdate && existing ? (existing.assignedToId ?? "") : "");
  }, [open, existing]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const body = {
      name,
      filters,
      columns,
      sort,
      shared,
      alertsEnabled: alerts,
      assignedToId: assignee || null,
    };
    const res =
      mode === "update" && existing
        ? await apiRequest<{ saved_search: { id: string } }>(`/api/v1/saved_searches/${existing.id}`, {
            method: "PATCH",
            body,
          })
        : await apiRequest<{ saved_search: { id: string } }>("/api/v1/saved_searches", {
            body: { ...body, entityType },
          });
    setPending(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    toast.success(mode === "update" ? "Saved search updated." : "Search saved.");
    onOpenChange(false);
    onSaved(res.data.saved_search.id);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{mode === "update" ? "Save search" : "Save as new search"}</DialogTitle>
            <DialogDescription>Keep these filters, columns and sort to come back to them.</DialogDescription>
          </DialogHeader>
          {existing?.isOwner ? (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${id}-mode`}>Save as</Label>
              <NativeSelect
                id={`${id}-mode`}
                value={mode}
                onChange={(e) => {
                  const next = e.target.value === "update" ? "update" : "new";
                  setMode(next);
                  if (next === "new") setName("");
                  else setName(existing.name);
                }}
              >
                <NativeSelectOption value="update">Update “{existing.name}”</NativeSelectOption>
                <NativeSelectOption value="new">A new saved search</NativeSelectOption>
              </NativeSelect>
            </div>
          ) : null}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${id}-name`}>Name</Label>
            <Input
              id={`${id}-name`}
              value={name}
              maxLength={120}
              required
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Sales leaders in Canada"
            />
          </div>
          <div className="flex items-center gap-2">
            <Checkbox id={`${id}-shared`} checked={shared} onCheckedChange={(v) => setShared(Boolean(v))} />
            <Label htmlFor={`${id}-shared`} className="font-normal">
              Share with everyone in the workspace
            </Label>
          </div>
          <div className="flex items-start gap-2">
            <Checkbox id={`${id}-alerts`} checked={alerts} onCheckedChange={(v) => setAlerts(Boolean(v))} />
            <div className="flex flex-col gap-0.5">
              <Label htmlFor={`${id}-alerts`} className="font-normal">
                Alert me about new matches
              </Label>
              <p className="text-muted-foreground text-xs">
                The preference is saved now; alert emails aren't sent yet.
              </p>
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${id}-assignee`}>Assign to</Label>
            <NativeSelect id={`${id}-assignee`} value={assignee} onChange={(e) => setAssignee(e.target.value)}>
              <NativeSelectOption value="">Nobody</NativeSelectOption>
              {members.map((m) => (
                <NativeSelectOption key={m.id} value={m.id}>
                  {m.name}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </div>
          {error ? (
            <p role="alert" className="text-destructive text-sm">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" size="sm" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={pending || !name.trim()}>
              {pending ? "Saving…" : "Save search"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
