"use client";

import { useEffect, useId, useState } from "react";

import { useRouter } from "next/navigation";

import { Plus, Save, X } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
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
import { apiFetch } from "@/lib/api-fetch";
import { SENIORITIES, SENIORITY_LABELS } from "@/lib/records-vocabulary";
import { DEPARTMENTS } from "@/lib/search/filters";

export interface PersonaLike {
  id: string;
  name: string;
  titles: string[];
  seniorities: string[];
  departments: string[];
}

interface PersonaDraft {
  name?: string;
  titles?: string[];
  seniorities?: string[];
  departments?: string[];
}

function toggle(list: string[], value: string, on: boolean): string[] {
  return on ? [...new Set([...list, value])] : list.filter((v) => v !== value);
}

/** Create or edit a persona: a named set of job titles, management levels and departments. */
export function PersonaDialog({
  open,
  onOpenChange,
  initial,
  persona,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial?: PersonaDraft;
  persona?: PersonaLike;
  onSaved?: (persona: { id: string; name: string }) => void;
}) {
  const router = useRouter();
  const id = useId();
  const [name, setName] = useState("");
  const [titles, setTitles] = useState<string[]>([]);
  const [titleDraft, setTitleDraft] = useState("");
  const [seniorities, setSeniorities] = useState<string[]>([]);
  const [departments, setDepartments] = useState<string[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const source = persona ?? initial ?? {};
    setName(source.name ?? "");
    setTitles(source.titles ?? []);
    setSeniorities(source.seniorities ?? []);
    setDepartments(source.departments ?? []);
    setTitleDraft("");
    setError(null);
  }, [open, persona, initial]);

  function addTitle() {
    const value = titleDraft.trim();
    if (!value) return;
    setTitles((prev) => (prev.some((t) => t.toLowerCase() === value.toLowerCase()) ? prev : [...prev, value]));
    setTitleDraft("");
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const pendingTitle = titleDraft.trim();
    const allTitles =
      pendingTitle && !titles.some((t) => t.toLowerCase() === pendingTitle.toLowerCase())
        ? [...titles, pendingTitle]
        : titles;
    setPending(true);
    setError(null);
    const body = { name, titles: allTitles, seniorities, departments };
    const res = persona
      ? await apiFetch<{ persona: PersonaLike }>(`/api/v1/personas/${persona.id}`, { method: "PATCH", body })
      : await apiFetch<{ persona: PersonaLike }>("/api/v1/personas", { body });
    setPending(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    toast.success(persona ? `Saved ${res.data.persona.name}.` : `Created the persona ${res.data.persona.name}.`);
    onOpenChange(false);
    onSaved?.({ id: res.data.persona.id, name: res.data.persona.name });
    router.refresh();
  }

  const submitLabel = persona ? "Save persona" : "Create persona";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{persona ? "Edit persona" : "Create persona"}</DialogTitle>
            <DialogDescription>
              A persona describes a kind of buyer. Use it as a people filter to find everyone who matches.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-2">
            <Label htmlFor={`${id}-name`}>Name</Label>
            <Input
              id={`${id}-name`}
              value={name}
              maxLength={120}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Sales leaders"
              required
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor={`${id}-title`}>Job titles</Label>
            <div className="flex gap-2">
              <Input
                id={`${id}-title`}
                value={titleDraft}
                maxLength={200}
                onChange={(e) => setTitleDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === ",") {
                    e.preventDefault();
                    addTitle();
                  }
                }}
                placeholder="e.g. VP sales"
              />
              <Button type="button" variant="outline" size="sm" className="h-8" onClick={addTitle}>
                <Plus data-icon="inline-start" aria-hidden="true" />
                Add
              </Button>
            </div>
            {titles.length ? (
              <ul className="flex flex-wrap gap-1" aria-label="Job titles in this persona">
                {titles.map((t) => (
                  <li key={t}>
                    <Badge variant="secondary" className="gap-1 pr-1 font-normal">
                      {t}
                      <button
                        type="button"
                        className="rounded-sm p-0.5 hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
                        aria-label={`Remove ${t}`}
                        onClick={() => setTitles((prev) => prev.filter((x) => x !== t))}
                      >
                        <X className="size-3" aria-hidden="true" />
                      </button>
                    </Badge>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-muted-foreground text-xs">Press Enter to add each title.</p>
            )}
          </div>

          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 font-medium text-sm">Management levels</legend>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {SENIORITIES.map((s) => (
                <Label key={s} className="flex items-center gap-2 font-normal">
                  <Checkbox
                    checked={seniorities.includes(s)}
                    onCheckedChange={(v) => setSeniorities((prev) => toggle(prev, s, v === true))}
                  />
                  {SENIORITY_LABELS[s]}
                </Label>
              ))}
            </div>
          </fieldset>

          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 font-medium text-sm">Departments</legend>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {DEPARTMENTS.map((d) => (
                <Label key={d} className="flex items-center gap-2 font-normal">
                  <Checkbox
                    checked={departments.includes(d)}
                    onCheckedChange={(v) => setDepartments((prev) => toggle(prev, d, v === true))}
                  />
                  {d}
                </Label>
              ))}
            </div>
          </fieldset>

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
              {persona ? (
                <Save data-icon="inline-start" aria-hidden="true" />
              ) : (
                <Plus data-icon="inline-start" aria-hidden="true" />
              )}
              {pending ? "Saving…" : submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
