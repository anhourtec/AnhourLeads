"use client";

import { useState } from "react";

import Link from "next/link";
import { useRouter } from "next/navigation";

import {
  Archive,
  ChevronDown,
  ChevronRight,
  FlaskConical,
  Maximize,
  Minus,
  Pause,
  Play,
  Plus,
  Redo2,
  Rocket,
  Save,
  Trash2,
  Undo2,
  Zap,
} from "lucide-react";
import { toast } from "sonner";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { apiFetch } from "@/lib/api-fetch";
import { formatDateTime } from "@/lib/format-display";
import {
  type BlockType,
  describeFilters,
  makeBlock,
  triggerEventLabel,
  WEEKDAY_LABELS,
  WORKFLOW_TARGET_LABELS,
} from "@/lib/workflows";
import type { WorkflowDto } from "@/server/services/workflows";

import { type PickedRecord, RecordPicker } from "../../../_components/pipeline/record-picker";
import { WorkflowStatusPill } from "../../_components/status-pill";
import { addToLane, findBlock, type Lane, laneOf, ROOT_LANE, removeBlock, updateBlock } from "../../_components/tree";
import { BlockConfigSheet } from "./block-config";
import { Canvas } from "./canvas";
import { EnrollmentTab } from "./enrollment-tab";
import { Palette } from "./palette";
import { TriggerSheet } from "./trigger-sheet";
import type { Draft, PickerData } from "./types";

const fromDto = (w: WorkflowDto): Draft => ({
  name: w.name,
  description: w.description,
  allowReenroll: w.allowReenroll,
  targetType: w.targetType,
  triggerType: w.triggerType,
  triggerEvent: w.triggerEvent,
  schedule: w.schedule,
  enrollmentFilters: w.enrollmentFilters,
  blocks: w.blocks,
});

interface Problem {
  title: string;
  details: string[];
}

async function post(
  url: string,
  body?: unknown,
): Promise<{ ok: true; data: { workflow?: WorkflowDto } } | { ok: false; problem: Problem }> {
  try {
    const res = await fetch(url, {
      method: body === undefined ? "POST" : "PATCH",
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: "same-origin",
    });
    const json = (await res.json().catch(() => ({}))) as {
      error?: string;
      details?: { path?: string; message?: string }[];
    };
    if (res.ok) return { ok: true, data: json as { workflow?: WorkflowDto } };
    return {
      ok: false,
      problem: {
        title: json.error ?? "Something went wrong. Try again.",
        details: (json.details ?? []).flatMap((d) => (d.message ? [d.message] : [])),
      },
    };
  } catch {
    return {
      ok: false,
      problem: { title: "Couldn't reach the server. Check your connection and try again.", details: [] },
    };
  }
}

function scheduleText(d: Draft): string {
  if (d.schedule?.weekly) {
    return `Every ${d.schedule.weekly.days.map((x) => WEEKDAY_LABELS[x]).join(", ")} at ${d.schedule.weekly.time} (${d.schedule.timezone})`;
  }
  if (d.schedule?.at) return `Once, ${formatDateTime(d.schedule.at)}`;
  return "Choose when it runs";
}

/** Workflow builder: header and launch menu, tabs Workflow / Settings / Enrollment. */
export function Builder({
  workflow,
  data,
  permissions,
}: {
  readonly workflow: WorkflowDto;
  readonly data: PickerData;
  readonly permissions: { update: boolean; launch: boolean; remove: boolean };
}) {
  const router = useRouter();
  const [saved, setSaved] = useState(workflow);
  const [draft, setDraftState] = useState<Draft>(() => fromDto(workflow));
  const [history, setHistory] = useState<{ past: Draft[]; future: Draft[] }>({ past: [], future: [] });
  const [tab, setTab] = useState("workflow");
  const [lane, setLane] = useState<Lane>(ROOT_LANE);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [triggerOpen, setTriggerOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [detail, setDetail] = useState(true);
  const [zoom, setZoom] = useState(1);
  const [pending, setPending] = useState<string | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [testOpen, setTestOpen] = useState(false);
  const [testRecord, setTestRecord] = useState<PickedRecord | null>(null);
  const [testResult, setTestResult] = useState<{
    matchesFilters: boolean;
    path: { blockId: string; label: string; outcome: string }[];
  } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const readOnly = !permissions.update || saved.status === "archived";
  const dirty = JSON.stringify(draft) !== JSON.stringify(fromDto(saved));
  const selected = selectedId ? findBlock(draft.blocks, selectedId) : null;

  /** Change the draft and record it for undo. */
  const change = (patch: Partial<Draft>) => {
    setHistory((h) => ({ past: [...h.past.slice(-49), draft], future: [] }));
    setDraftState((d) => ({ ...d, ...patch }));
  };
  const undo = () => {
    const prev = history.past[history.past.length - 1];
    if (!prev) return;
    setHistory((h) => ({ past: h.past.slice(0, -1), future: [draft, ...h.future] }));
    setDraftState(prev);
  };
  const redo = () => {
    const next = history.future[0];
    if (!next) return;
    setHistory((h) => ({ past: [...h.past, draft], future: h.future.slice(1) }));
    setDraftState(next);
  };

  function add(type: BlockType) {
    const block = makeBlock(type);
    const next = addToLane(draft.blocks, lane, block);
    if (!next) {
      toast.error("This path already ends with a branch or an exit. Add the block inside one of its paths.");
      return;
    }
    change({ blocks: next });
    setPaletteOpen(false);
    if (block.branches) setLane({ parentId: block.id, branchKey: Object.keys(block.branches)[0] ?? null });
    setSelectedId(block.id);
  }

  async function save(): Promise<boolean> {
    setPending("save");
    setProblem(null);
    const res = await post(`/api/v1/workflows/${saved.id}`, draft);
    setPending(null);
    if (!res.ok) {
      setProblem(res.problem);
      return false;
    }
    if (res.data.workflow) {
      setSaved(res.data.workflow);
      setDraftState(fromDto(res.data.workflow));
    }
    toast.success("Workflow saved");
    return true;
  }

  async function action(kind: "launch" | "pause" | "archive") {
    if (kind === "launch" && dirty && !(await save())) return;
    setPending(kind);
    setProblem(null);
    const res = await post(`/api/v1/workflows/${saved.id}/${kind}`);
    setPending(null);
    if (!res.ok) {
      setProblem(res.problem);
      return;
    }
    if (res.data.workflow) setSaved(res.data.workflow);
    toast.success({ launch: "Workflow launched", pause: "Workflow paused", archive: "Workflow archived" }[kind]);
    router.refresh();
  }

  async function runTest() {
    if (!testRecord) return;
    setPending("test");
    const res = await apiFetch<{
      test: { matchesFilters: boolean; path: { blockId: string; label: string; outcome: string }[] };
    }>(`/api/v1/workflows/${saved.id}/test`, { method: "POST", body: { entityId: testRecord.id } });
    setPending(null);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    setTestResult(res.data.test);
  }

  async function remove() {
    const res = await apiFetch(`/api/v1/workflows/${saved.id}`, { method: "DELETE" });
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    toast.success("Workflow deleted");
    router.push("/dashboard/workflows");
  }

  let launchLabel = saved.status === "paused" ? "Resume workflow" : "Launch workflow";
  if (pending === "launch") launchLabel = "Launching…";
  const triggerSet = draft.triggerType === "schedule" ? Boolean(draft.schedule) : Boolean(draft.triggerEvent);
  const triggerCard = (
    <button
      type="button"
      onClick={() => setTriggerOpen(true)}
      data-testid="trigger-card"
      className={
        triggerSet
          ? "flex w-72 flex-col gap-2 rounded-xl border bg-card p-3 text-left shadow-xs outline-none hover:border-primary/50 focus-visible:ring-2 focus-visible:ring-ring"
          : "flex w-72 items-center justify-center gap-2 rounded-xl border-2 border-dashed bg-card p-4 font-medium text-sm outline-none hover:border-primary/50 focus-visible:ring-2 focus-visible:ring-ring"
      }
    >
      {triggerSet ? (
        <>
          <span className="flex items-center gap-2 font-medium text-sm">
            <span className="flex size-7 items-center justify-center rounded-md bg-primary/10 text-primary">
              <Zap className="size-4" aria-hidden="true" />
            </span>
            {draft.triggerType === "schedule" ? scheduleText(draft) : triggerEventLabel(draft.triggerEvent)}
          </span>
          {detail ? (
            <span className="flex flex-col gap-0.5 rounded-md border p-2 text-xs">
              <span className="table-head-mono">Enrollment criteria</span>
              <span>
                {WORKFLOW_TARGET_LABELS[draft.targetType]}: {describeFilters(draft.enrollmentFilters)}
              </span>
            </span>
          ) : null}
        </>
      ) : (
        <>
          <Plus className="size-4" aria-hidden="true" />
          Add trigger
        </>
      )}
    </button>
  );

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1 text-muted-foreground text-xs">
        <Link href="/dashboard/workflows" className="shrink-0 hover:text-foreground hover:underline">
          Workflows
        </Link>
        <ChevronRight className="size-3 shrink-0" aria-hidden="true" />
        <span className="truncate text-foreground">{saved.name}</span>
      </nav>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <Input
            aria-label="Workflow name"
            value={draft.name}
            maxLength={120}
            disabled={readOnly}
            onChange={(e) => setDraftState((d) => ({ ...d, name: e.target.value }))}
            className="page-title h-auto min-w-0 border-transparent bg-transparent px-1 shadow-none hover:border-input disabled:opacity-100 md:text-2xl"
          />
          <WorkflowStatusPill status={saved.status} />
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {permissions.update && !readOnly ? (
            <Button size="sm" variant="outline" disabled={!dirty || pending !== null} onClick={() => void save()}>
              <Save data-icon="inline-start" />
              {pending === "save" ? "Saving…" : "Save"}
            </Button>
          ) : null}
          <ButtonGroup>
            <Button
              size="sm"
              disabled={!permissions.launch || readOnly || saved.status === "active" || pending !== null}
              onClick={() => void action("launch")}
            >
              <Rocket data-icon="inline-start" />
              {launchLabel}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" aria-label="More launch options" className="border-primary-foreground/20 border-l">
                  <ChevronDown />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  disabled={!permissions.launch || readOnly || saved.status === "active"}
                  onSelect={() => void action("launch")}
                >
                  <Play />
                  Launch
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={!permissions.launch || saved.status !== "active"}
                  onSelect={() => void action("pause")}
                >
                  <Pause />
                  Pause
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => {
                    setTestResult(null);
                    setTestOpen(true);
                  }}
                >
                  <FlaskConical />
                  Test run
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </ButtonGroup>
        </div>
      </div>

      {problem ? (
        <Alert variant="destructive">
          <AlertTitle>{problem.title}</AlertTitle>
          {problem.details.length ? (
            <AlertDescription>
              <ul className="list-disc pl-4">
                {problem.details.map((d) => (
                  <li key={d}>{d}</li>
                ))}
              </ul>
            </AlertDescription>
          ) : null}
        </Alert>
      ) : null}

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList
          variant="line"
          className="w-full justify-start overflow-x-auto border-b *:data-[slot=tabs-trigger]:flex-none"
        >
          <TabsTrigger value="workflow">
            <span className="font-mono text-xs">1</span> Workflow
          </TabsTrigger>
          <TabsTrigger value="settings">
            <span className="font-mono text-xs">2</span> Settings
          </TabsTrigger>
          <TabsTrigger value="enrollment">
            <span className="font-mono text-xs">3</span> Enrollment
          </TabsTrigger>
        </TabsList>

        <TabsContent value="workflow" className="pt-3">
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_17rem]">
            <div className="flex min-w-0 flex-col gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <ToggleGroup
                  type="single"
                  variant="outline"
                  size="sm"
                  value={detail ? "detail" : "outline"}
                  onValueChange={(v) => v && setDetail(v === "detail")}
                  aria-label="Canvas view"
                >
                  <ToggleGroupItem value="outline">Outline</ToggleGroupItem>
                  <ToggleGroupItem value="detail">Detail</ToggleGroupItem>
                </ToggleGroup>
                <ButtonGroup>
                  <Button
                    size="icon-sm"
                    variant="outline"
                    aria-label="Undo"
                    disabled={!history.past.length || readOnly}
                    onClick={undo}
                  >
                    <Undo2 />
                  </Button>
                  <Button
                    size="icon-sm"
                    variant="outline"
                    aria-label="Redo"
                    disabled={!history.future.length || readOnly}
                    onClick={redo}
                  >
                    <Redo2 />
                  </Button>
                </ButtonGroup>
                <ButtonGroup>
                  <Button
                    size="icon-sm"
                    variant="outline"
                    aria-label="Zoom out"
                    disabled={zoom <= 0.5}
                    onClick={() => setZoom((z) => Math.max(0.5, z - 0.1))}
                  >
                    <Minus />
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="w-14 font-mono tabular-nums"
                    aria-label="Reset zoom"
                    onClick={() => setZoom(1)}
                  >
                    {Math.round(zoom * 100)}%
                  </Button>
                  <Button
                    size="icon-sm"
                    variant="outline"
                    aria-label="Zoom in"
                    disabled={zoom >= 1.5}
                    onClick={() => setZoom((z) => Math.min(1.5, z + 0.1))}
                  >
                    <Plus />
                  </Button>
                  <Button size="icon-sm" variant="outline" aria-label="Fit to screen" onClick={() => setZoom(0.8)}>
                    <Maximize />
                  </Button>
                </ButtonGroup>
                {!readOnly ? (
                  <Button size="sm" className="lg:hidden" onClick={() => setPaletteOpen(true)}>
                    <Plus data-icon="inline-start" />
                    Add block
                  </Button>
                ) : null}
              </div>
              <Canvas
                blocks={draft.blocks}
                data={data}
                detail={detail}
                zoom={zoom}
                activeLane={lane}
                selectedId={selectedId}
                readOnly={readOnly}
                trigger={triggerCard}
                onSelectBlock={(id) => {
                  setSelectedId(id);
                  const blockLane = laneOf(draft.blocks, id);
                  if (blockLane) setLane(blockLane);
                }}
                onSelectLane={setLane}
              />
            </div>
            {!readOnly ? (
              <aside
                aria-label="Build"
                className="hidden max-h-[40rem] overflow-y-auto rounded-xl border bg-card p-3 lg:block"
              >
                <Palette onAdd={add} disabled={readOnly} />
              </aside>
            ) : null}
          </div>
        </TabsContent>

        <TabsContent value="settings" className="pt-3">
          <div className="flex max-w-2xl flex-col gap-4 rounded-xl border bg-card p-4">
            <Field>
              <FieldLabel htmlFor="wf-name">Name</FieldLabel>
              <Input
                id="wf-name"
                value={draft.name}
                maxLength={120}
                disabled={readOnly}
                onChange={(e) => setDraftState((d) => ({ ...d, name: e.target.value }))}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="wf-description">Description</FieldLabel>
              <Textarea
                id="wf-description"
                value={draft.description}
                maxLength={1000}
                disabled={readOnly}
                onChange={(e) => setDraftState((d) => ({ ...d, description: e.target.value }))}
              />
            </Field>
            <Field>
              <FieldLabel>Owner</FieldLabel>
              <p className="text-sm">{saved.owner?.name ?? "No owner"}</p>
              <FieldDescription>Runs act with the owner's permissions. Launching makes you the owner.</FieldDescription>
            </Field>
            <div className="flex items-start justify-between gap-4">
              <div>
                <label htmlFor="wf-reenroll" className="font-medium text-sm">
                  Allow re-enrollment
                </label>
                <p className="text-muted-foreground text-xs">A record can run again after its previous run finished.</p>
              </div>
              <Switch
                id="wf-reenroll"
                checked={draft.allowReenroll}
                disabled={readOnly}
                onCheckedChange={(v) => setDraftState((d) => ({ ...d, allowReenroll: v }))}
              />
            </div>
            <div className="flex flex-wrap justify-between gap-2 border-t pt-4">
              <div className="flex flex-wrap gap-2">
                {permissions.update && saved.status !== "archived" ? (
                  <Button size="sm" variant="outline" onClick={() => void action("archive")}>
                    <Archive data-icon="inline-start" />
                    Archive
                  </Button>
                ) : null}
                {permissions.remove ? (
                  <Button size="sm" variant="outline" onClick={() => setConfirmDelete(true)}>
                    <Trash2 data-icon="inline-start" />
                    Delete
                  </Button>
                ) : null}
              </div>
              {!readOnly ? (
                <Button size="sm" disabled={!dirty || pending !== null} onClick={() => void save()}>
                  <Save data-icon="inline-start" />
                  Save changes
                </Button>
              ) : null}
            </div>
          </div>
        </TabsContent>

        <TabsContent value="enrollment" className="pt-3">
          <EnrollmentTab workflowId={saved.id} />
        </TabsContent>
      </Tabs>

      <TriggerSheet
        open={triggerOpen}
        onOpenChange={setTriggerOpen}
        value={draft}
        data={data}
        readOnly={readOnly}
        onChange={(patch) => change(patch)}
      />
      <BlockConfigSheet
        block={selected}
        target={draft.targetType}
        data={data}
        readOnly={readOnly}
        onChange={(config) => selected && change({ blocks: updateBlock(draft.blocks, selected.id, config) })}
        onDelete={() => {
          if (!selected) return;
          change({ blocks: removeBlock(draft.blocks, selected.id) });
          setSelectedId(null);
          setLane(ROOT_LANE);
        }}
        onClose={() => setSelectedId(null)}
      />
      <Sheet open={paletteOpen} onOpenChange={setPaletteOpen}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-sm">
          <SheetHeader>
            <SheetTitle>Add a block</SheetTitle>
          </SheetHeader>
          <div className="px-4 pb-4">
            <Palette onAdd={add} disabled={readOnly} />
          </div>
        </SheetContent>
      </Sheet>
      <Dialog open={testOpen} onOpenChange={setTestOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Test run</DialogTitle>
            <DialogDescription>
              See the path a record would take with the saved version. Nothing is changed.
            </DialogDescription>
          </DialogHeader>
          <Field>
            <FieldLabel htmlFor="test-record">{WORKFLOW_TARGET_LABELS[saved.targetType]}</FieldLabel>
            <RecordPicker
              id="test-record"
              kind={saved.targetType}
              value={testRecord}
              onChange={(r) => {
                setTestRecord(r);
                setTestResult(null);
              }}
              placeholder="Choose a record"
            />
          </Field>
          {testResult ? (
            <div className="flex flex-col gap-2 text-sm" data-testid="test-result">
              <p className={testResult.matchesFilters ? "" : "text-amber-700 dark:text-amber-400"}>
                {testResult.matchesFilters
                  ? "This record matches the enrollment criteria."
                  : "This record doesn't match the enrollment criteria, so it wouldn't enroll."}
              </p>
              <ol className="flex flex-col gap-1">
                {testResult.path.map((p) => (
                  <li key={p.blockId} className="flex justify-between gap-2 rounded-md border px-2 py-1">
                    <span>{p.label}</span>
                    <span className="font-mono text-muted-foreground text-xs">{p.outcome}</span>
                  </li>
                ))}
                <li className="text-muted-foreground text-xs">Then exit.</li>
              </ol>
            </div>
          ) : null}
          <DialogFooter>
            <Button size="sm" disabled={!testRecord || pending === "test"} onClick={() => void runTest()}>
              <FlaskConical data-icon="inline-start" />
              {pending === "test" ? "Testing…" : "Run test"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete this workflow?</DialogTitle>
            <DialogDescription>Its runs and logs are deleted too. This can't be undone.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button size="sm" variant="outline" onClick={() => setConfirmDelete(false)}>
              Cancel
            </Button>
            <Button size="sm" variant="destructive" onClick={() => void remove()}>
              <Trash2 data-icon="inline-start" />
              Delete workflow
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
