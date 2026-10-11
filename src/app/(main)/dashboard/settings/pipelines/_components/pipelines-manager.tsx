"use client";

import { useEffect, useState } from "react";

import { useRouter } from "next/navigation";

import { cn } from "cn";
import { Plus, Save, Star, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { apiFetch } from "@/lib/api-fetch";
import { stageListProblem } from "@/lib/deal-pipelines";
import { formatNumber } from "@/lib/format-display";
import type { PipelineDto } from "@/server/services/pipelines";

import { PageHeader } from "../../../_components/pipeline/page-header";
import { type EditableStage, StageListEditor } from "../../../_components/pipeline/stage-list-editor";

const editable = (p: PipelineDto): EditableStage[] =>
  p.stages.map((s) => ({
    key: s.id,
    id: s.id,
    name: s.name,
    type: s.type,
    probability: s.probability,
    dealCount: s.dealCount,
  }));

/** Settings → Deal pipelines: list, rename, edit stages (order, type, probability), default, delete. */
export function PipelinesManager({ pipelines }: { readonly pipelines: PipelineDto[] }) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState(pipelines.find((p) => p.isDefault)?.id ?? pipelines[0]?.id ?? "");
  const selected = pipelines.find((p) => p.id === selectedId) ?? pipelines[0];
  const [name, setName] = useState(selected?.name ?? "");
  const [stages, setStages] = useState<EditableStage[]>(selected ? editable(selected) : []);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [moveDialog, setMoveDialog] = useState<{ removed: EditableStage[]; targets: Record<string, string> } | null>(
    null,
  );
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState("");

  useEffect(() => {
    if (!selected) return;
    setName(selected.name);
    setStages(editable(selected));
    setError(null);
  }, [selected]);

  if (!selected) return null;
  const dealTotal = selected.stages.reduce((n, s) => n + s.dealCount, 0);

  async function save(moveDealsTo?: Record<string, string>) {
    const problem = name.trim() ? stageListProblem(stages) : "Name the pipeline.";
    if (problem) {
      setError(problem);
      return;
    }
    const kept = new Set(stages.flatMap((s) => (s.id ? [s.id] : [])));
    const removed = editable(selected).filter((s) => !kept.has(s.id ?? "") && (s.dealCount ?? 0) > 0);
    if (removed.length && !moveDealsTo) {
      const firstOpen = stages.find((s) => s.id && s.type === "open")?.id ?? "";
      setMoveDialog({ removed, targets: Object.fromEntries(removed.map((r) => [r.id ?? "", firstOpen])) });
      return;
    }
    setPending(true);
    setError(null);
    const renamed =
      name.trim() !== selected.name
        ? await apiFetch(`/api/v1/pipelines/${selected.id}`, { method: "PATCH", body: { name: name.trim() } })
        : ({ ok: true } as const);
    const res = renamed.ok
      ? await apiFetch(`/api/v1/pipelines/${selected.id}/stages`, {
          method: "PUT",
          body: {
            stages: stages.map((s) => ({
              ...(s.id ? { id: s.id } : {}),
              name: s.name.trim(),
              type: s.type,
              probability: s.probability,
            })),
            ...(moveDealsTo ? { moveDealsTo } : {}),
          },
        })
      : renamed;
    setPending(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setMoveDialog(null);
    toast.success("Pipeline saved");
    router.refresh();
  }

  async function makeDefault() {
    const res = await apiFetch(`/api/v1/pipelines/${selected.id}`, { method: "PATCH", body: { isDefault: true } });
    if (!res.ok) toast.error(res.error);
    else {
      toast.success(`${selected.name} is now the default pipeline`);
      router.refresh();
    }
  }

  async function create() {
    const res = await apiFetch<{ pipeline: PipelineDto }>("/api/v1/pipelines", {
      method: "POST",
      body: { name: newName.trim() },
    });
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    setCreateOpen(false);
    setNewName("");
    setSelectedId(res.data.pipeline.id);
    toast.success("Pipeline created");
    router.refresh();
  }

  async function remove() {
    const res = await apiFetch(`/api/v1/pipelines/${selected.id}`, {
      method: "DELETE",
      body: dealTotal ? { moveDealsToPipelineId: deleteTarget } : {},
    });
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    setDeleteOpen(false);
    setSelectedId(pipelines.find((p) => p.id !== selected.id)?.id ?? "");
    toast.success("Pipeline deleted");
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-4 md:gap-6">
      <PageHeader
        title="Deal pipelines"
        description="Each pipeline has ordered open stages, then closed won and closed lost. New deals go to the default pipeline."
        actions={
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus data-icon="inline-start" />
            Create pipeline
          </Button>
        }
      />
      <div className="grid gap-4 lg:grid-cols-[16rem_minmax(0,1fr)]">
        <nav aria-label="Pipelines" className="flex flex-col gap-1">
          {pipelines.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setSelectedId(p.id)}
              aria-current={p.id === selected.id ? "true" : undefined}
              className={cn(
                "flex items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-sm outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring",
                p.id === selected.id && "bg-muted font-medium",
              )}
            >
              <span className="truncate">{p.name}</span>
              {p.isDefault ? (
                <Badge variant="secondary" className="shrink-0 bg-muted text-muted-foreground">
                  Default
                </Badge>
              ) : null}
            </button>
          ))}
        </nav>
        <Card>
          <CardHeader className="border-b">
            <CardTitle>{selected.name}</CardTitle>
            <CardDescription>
              <span className="font-mono tabular-nums">{formatNumber(dealTotal)}</span>{" "}
              {dealTotal === 1 ? "deal" : "deals"}. Drag stages to reorder them.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            {error ? (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}
            <Field>
              <FieldLabel htmlFor="pipeline-name">Pipeline name</FieldLabel>
              <Input id="pipeline-name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
            </Field>
            <StageListEditor stages={stages} onChange={setStages} showProbability renameClosed />
            <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-4">
              <div className="flex flex-wrap gap-2">
                {!selected.isDefault ? (
                  <Button size="sm" variant="outline" onClick={() => void makeDefault()}>
                    <Star data-icon="inline-start" />
                    Set as default
                  </Button>
                ) : null}
                <Button
                  size="sm"
                  variant="outline"
                  disabled={pipelines.length < 2}
                  onClick={() => {
                    setDeleteTarget(pipelines.find((p) => p.id !== selected.id)?.id ?? "");
                    setDeleteOpen(true);
                  }}
                >
                  <Trash2 data-icon="inline-start" />
                  Delete pipeline
                </Button>
              </div>
              <Button size="sm" disabled={pending} onClick={() => void save()}>
                <Save data-icon="inline-start" />
                {pending ? "Saving…" : "Save changes"}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      <Dialog open={moveDialog !== null} onOpenChange={(open) => !open && setMoveDialog(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Move deals from removed stages</DialogTitle>
            <DialogDescription>Choose where the deals in each removed stage go.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            {moveDialog?.removed.map((r) => (
              <Field key={r.key}>
                <FieldLabel htmlFor={`move-${r.key}`}>
                  {r.name} ({formatNumber(r.dealCount ?? 0)})
                </FieldLabel>
                <NativeSelect
                  id={`move-${r.key}`}
                  value={moveDialog.targets[r.id ?? ""] ?? ""}
                  onChange={(e) =>
                    setMoveDialog((m) => (m ? { ...m, targets: { ...m.targets, [r.id ?? ""]: e.target.value } } : m))
                  }
                  className="w-full"
                >
                  {stages
                    .filter((s) => s.id)
                    .map((s) => (
                      <NativeSelectOption key={s.key} value={s.id ?? ""}>
                        {s.name}
                      </NativeSelectOption>
                    ))}
                </NativeSelect>
              </Field>
            ))}
          </div>
          <DialogFooter>
            <Button size="sm" variant="outline" onClick={() => setMoveDialog(null)}>
              Cancel
            </Button>
            <Button size="sm" disabled={pending} onClick={() => moveDialog && void save(moveDialog.targets)}>
              <Save data-icon="inline-start" />
              Move deals and save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Create pipeline</DialogTitle>
            <DialogDescription>It starts with the default stages; edit them after.</DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void create();
            }}
            className="flex flex-col gap-4"
          >
            <Field>
              <FieldLabel htmlFor="new-pipeline-name">Name</FieldLabel>
              <Input
                id="new-pipeline-name"
                required
                maxLength={80}
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
              />
            </Field>
            <DialogFooter>
              <Button type="button" size="sm" variant="outline" onClick={() => setCreateOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={!newName.trim()}>
                <Plus data-icon="inline-start" />
                Create pipeline
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete {selected.name}?</DialogTitle>
            <DialogDescription>
              {dealTotal
                ? "Its deals move to another pipeline: open deals to its first stage, won and lost deals to its closed stages."
                : "This pipeline has no deals. This can't be undone."}
            </DialogDescription>
          </DialogHeader>
          {dealTotal ? (
            <Field>
              <FieldLabel htmlFor="delete-target">Move deals to</FieldLabel>
              <NativeSelect
                id="delete-target"
                value={deleteTarget}
                onChange={(e) => setDeleteTarget(e.target.value)}
                className="w-full"
              >
                {pipelines
                  .filter((p) => p.id !== selected.id)
                  .map((p) => (
                    <NativeSelectOption key={p.id} value={p.id}>
                      {p.name}
                    </NativeSelectOption>
                  ))}
              </NativeSelect>
            </Field>
          ) : null}
          <DialogFooter>
            <Button size="sm" variant="outline" onClick={() => setDeleteOpen(false)}>
              Cancel
            </Button>
            <Button size="sm" variant="destructive" onClick={() => void remove()}>
              <Trash2 data-icon="inline-start" />
              Delete pipeline
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
