"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { useRouter } from "next/navigation";

import { ChevronsDownUp, ChevronsRight, ChevronsUpDown, Save, Send, Undo2 } from "lucide-react";
import { toast } from "sonner";

import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { describeWait, STEP_TYPE_LABELS, type StepType } from "@/lib/engage-constants";
import type { DetailedStats, SequenceView, StepView } from "@/server/services/sequences";

import { apiRequest } from "../../../../_components/records/api-client";
import { AssistedSequenceDialog, type GeneratedStep, TemplateSequenceDialog } from "./generate-dialogs";
import { blankStep, fingerprint, newKey, retype, STEP_ICONS, type StepDraft, serialise, toDrafts } from "./model";
import { StepCard } from "./step-card";
import { StepTypePicker } from "./step-type-picker";
import { WaitPill } from "./wait-pill";

export interface SequenceEditorProps {
  sequence: SequenceView;
  steps: StepView[];
  stepStats: DetailedStats["steps"];
  canEdit: boolean;
}

const MAX_STEPS = 30;

function fromGenerated(steps: GeneratedStep[]): StepDraft[] {
  return steps.map((s, i) => {
    const d = retype(blankStep(s.type, i === 0), s.type);
    const subject = s.subject ?? "";
    const body = s.body ?? "";
    return {
      ...d,
      waitDays: s.waitDays,
      waitMinutes: s.waitMinutes,
      threadMode: s.threadMode,
      subject,
      body,
      variants: s.type === "auto_email" ? [{ key: newKey("v"), label: "A", subject, body, active: true }] : [],
    };
  });
}

/** Warn before leaving with unsaved changes: browser unload and in-app link clicks. */
function useLeaveGuard(dirty: boolean, onBlockedLink: (href: string) => void) {
  const blocked = useRef(onBlockedLink);
  blocked.current = onBlockedLink;
  useEffect(() => {
    if (!dirty) return;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey) return;
      const anchor = (event.target as HTMLElement | null)?.closest("a[href]");
      if (!(anchor instanceof HTMLAnchorElement) || anchor.target === "_blank") return;
      const url = new URL(anchor.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname) return;
      event.preventDefault();
      event.stopPropagation();
      blocked.current(`${url.pathname}${url.search}${url.hash}`);
    };
    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      document.removeEventListener("click", onClick, true);
    };
  }, [dirty]);
}

/** The Editor tab: ordered steps with waits, versions and writing modes, saved together. */
export function SequenceEditor({ sequence, steps, stepStats, canEdit }: SequenceEditorProps) {
  const router = useRouter();
  const original = useMemo(() => toDrafts(steps), [steps]);
  const [drafts, setDrafts] = useState<StepDraft[]>(original);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [leaveTo, setLeaveTo] = useState<string | null>(null);
  const dirty = canEdit && fingerprint(drafts) !== fingerprint(original);
  const statById = new Map(stepStats.map((s) => [s.stepId, s]));
  const allCollapsed = drafts.length > 0 && drafts.every((d) => collapsed.has(d.key));

  // New server data (after saving or a refresh elsewhere on the page) replaces the drafts unless they
  // hold unsaved edits.
  const savedPrint = useRef(fingerprint(original));
  useEffect(() => {
    setDrafts((current) => (fingerprint(current) === savedPrint.current ? original : current));
    savedPrint.current = fingerprint(original);
  }, [original]);

  useLeaveGuard(dirty, setLeaveTo);

  const update = (key: string, patch: Partial<StepDraft>) =>
    setDrafts((list) => list.map((d) => (d.key === key ? { ...d, ...patch } : d)));

  const insertAt = (index: number, type: StepType) =>
    setDrafts((list) => {
      if (list.length >= MAX_STEPS) return list;
      const next = [...list];
      next.splice(index, 0, blankStep(type, index === 0));
      return next;
    });

  const move = (index: number, by: -1 | 1) =>
    setDrafts((list) => {
      const next = [...list];
      const [item] = next.splice(index, 1);
      next.splice(index + by, 0, item);
      return next;
    });

  const duplicate = (index: number) =>
    setDrafts((list) => {
      const source = list[index];
      const copy: StepDraft = {
        ...source,
        key: newKey("step"),
        id: undefined,
        variants: source.variants.map((v) => ({ ...v, key: newKey("v"), id: undefined })),
      };
      const next = [...list];
      next.splice(index + 1, 0, copy);
      return next;
    });

  const toggleCollapse = (key: string) =>
    setCollapsed((set) => {
      const next = new Set(set);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  async function save() {
    setSaving(true);
    setError(null);
    const result = await apiRequest<{ emailer_steps: StepView[] }>(`/api/v1/emailer_campaigns/${sequence.id}/steps`, {
      method: "PUT",
      body: { steps: serialise(drafts) },
    });
    setSaving(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setDrafts(toDrafts(result.data.emailer_steps));
    toast.success("Changes saved.");
    router.refresh();
  }

  const loadGenerated = (generated: GeneratedStep[]) => {
    setDrafts(fromGenerated(generated).slice(0, MAX_STEPS));
    toast.success("Steps loaded. Review them, then save changes.");
  };

  const scrollTo = (position: number) => {
    setOutlineOpen(false);
    window.setTimeout(() => {
      document.getElementById(`step-${position}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 150);
  };

  return (
    <section aria-label="Sequence editor" className="flex min-w-0 flex-col gap-4" data-testid="sequence-editor">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button size="sm" variant="outline" onClick={() => setOutlineOpen(true)} disabled={!drafts.length}>
          <Send data-icon="inline-start" aria-hidden="true" />
          <span className="font-mono tabular-nums">{drafts.length}</span> step{drafts.length === 1 ? "" : "s"}
          <ChevronsRight data-icon="inline-end" aria-hidden="true" />
        </Button>
        <div className="flex flex-wrap items-center gap-2">
          {drafts.length ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setCollapsed(allCollapsed ? new Set() : new Set(drafts.map((d) => d.key)))}
            >
              {allCollapsed ? (
                <ChevronsUpDown data-icon="inline-start" aria-hidden="true" />
              ) : (
                <ChevronsDownUp data-icon="inline-start" aria-hidden="true" />
              )}
              {allCollapsed ? "Expand steps" : "Collapse steps"}
            </Button>
          ) : null}
          {canEdit && dirty ? (
            <Button size="sm" variant="ghost" disabled={saving} onClick={() => setDrafts(original)}>
              <Undo2 data-icon="inline-start" aria-hidden="true" />
              Discard
            </Button>
          ) : null}
          {canEdit ? (
            <Button size="sm" disabled={!dirty || saving} onClick={() => void save()}>
              <Save data-icon="inline-start" aria-hidden="true" />
              {saving ? "Saving…" : "Save changes"}
            </Button>
          ) : null}
        </div>
      </div>

      {dirty ? (
        <p className="text-muted-foreground text-xs" role="status">
          You have unsaved changes.
        </p>
      ) : null}
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {drafts.length === 0 ? (
        <Empty className="border bg-muted/30 py-16">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Send aria-hidden="true" />
            </EmptyMedia>
            <EmptyTitle>Your sequence is empty</EmptyTitle>
            <EmptyDescription>
              {canEdit ? "Add steps to build your sequence." : "Steps added to this sequence appear here."}
            </EmptyDescription>
          </EmptyHeader>
          {canEdit ? (
            <EmptyContent className="gap-3">
              <StepTypePicker onPick={(t) => insertAt(0, t)} />
              <span className="text-muted-foreground text-sm">Or</span>
              <div className="flex flex-wrap justify-center gap-2">
                <TemplateSequenceDialog onLoad={loadGenerated} />
                <AssistedSequenceDialog onLoad={loadGenerated} />
              </div>
            </EmptyContent>
          ) : null}
        </Empty>
      ) : (
        <ol className="flex min-w-0 flex-col">
          {drafts.map((d, index) => (
            <li key={d.key} className="flex min-w-0 flex-col">
              <WaitPill
                index={index}
                type={d.type}
                waitDays={d.waitDays}
                waitMinutes={d.waitMinutes}
                canEdit={canEdit}
                onChange={(wait) => update(d.key, wait)}
              />
              <StepCard
                sequenceId={sequence.id}
                step={d}
                index={index}
                total={drafts.length}
                canEdit={canEdit}
                collapsed={collapsed.has(d.key)}
                stat={d.id ? statById.get(d.id) : undefined}
                actions={{
                  onChange: (patch) => update(d.key, patch),
                  onMove: (by) => move(index, by),
                  onDuplicate: () => duplicate(index),
                  onDelete: () => setDrafts((list) => list.filter((x) => x.key !== d.key)),
                  onToggleCollapse: () => toggleCollapse(d.key),
                }}
              />
              {canEdit && index < drafts.length - 1 ? (
                <div className="flex justify-center pt-2">
                  <StepTypePicker
                    variant="ghost"
                    label="Insert step"
                    ariaLabel={`Insert a step after step ${index + 1}`}
                    disabled={drafts.length >= MAX_STEPS}
                    onPick={(t) => insertAt(index + 1, t)}
                  />
                </div>
              ) : null}
            </li>
          ))}
          {canEdit ? (
            <li className="flex flex-col items-center pt-3">
              <span className="h-4 w-px bg-border" aria-hidden="true" />
              <StepTypePicker
                variant="outline"
                label="Add a step"
                disabled={drafts.length >= MAX_STEPS}
                onPick={(t) => insertAt(drafts.length, t)}
              />
            </li>
          ) : null}
        </ol>
      )}

      <Sheet open={outlineOpen} onOpenChange={setOutlineOpen}>
        <SheetContent side="left" className="w-80 max-w-[85vw]">
          <SheetHeader>
            <SheetTitle>Steps</SheetTitle>
            <SheetDescription>Jump to a step.</SheetDescription>
          </SheetHeader>
          <ol className="flex flex-col gap-1 px-4 pb-4">
            {drafts.map((d, index) => {
              const Icon = STEP_ICONS[d.type];
              return (
                <li key={d.key}>
                  <button
                    type="button"
                    onClick={() => scrollTo(index + 1)}
                    className="flex w-full items-start gap-2 rounded-md px-2 py-2 text-left text-sm outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
                  >
                    <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate">
                        Step {index + 1}: {STEP_TYPE_LABELS[d.type]}
                        {d.enabled ? "" : " (off)"}
                      </span>
                      <span className="truncate text-muted-foreground text-xs">
                        {describeWait(d.waitDays, d.waitMinutes, index === 0, d.type)}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        </SheetContent>
      </Sheet>

      <AlertDialog open={leaveTo !== null} onOpenChange={(open) => !open && setLeaveTo(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard unsaved changes?</AlertDialogTitle>
            <AlertDialogDescription>
              Your changes to the steps haven't been saved and will be lost.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                const href = leaveTo;
                setDrafts(original);
                setLeaveTo(null);
                if (href) window.setTimeout(() => router.push(href), 0);
              }}
            >
              Discard changes
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
