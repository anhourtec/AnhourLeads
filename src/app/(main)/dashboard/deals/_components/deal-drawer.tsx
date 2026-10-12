"use client";

import { useCallback, useEffect, useState } from "react";

import { useRouter } from "next/navigation";

import { NotebookPen, Pencil, Send, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { apiFetch } from "@/lib/api-fetch";
import { formatDate, formatDateTime, formatMoney, relativeTime } from "@/lib/format-display";
import type { DealDto } from "@/server/services/deals";
import type { PipelineDto } from "@/server/services/pipelines";

import { ConfirmDialog } from "../../_components/pipeline/confirm-dialog";
import { DealStagePill } from "./deals-table";

interface ActivityRow {
  id: string;
  type: string;
  summary: string;
  occurredAt: string;
  actorName: string | null;
}

interface NoteRow {
  id: string;
  body: string;
  author: { id: string; name: string } | null;
  createdAt: string;
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="table-head-mono">{label}</dt>
      <dd className="min-w-0 truncate text-sm">{children}</dd>
    </div>
  );
}

/** Deal detail drawer: fields, stage change, notes and the activity timeline. */
export function DealDrawer({
  deal,
  pipelines,
  canUpdate,
  canDelete,
  canNote,
  onClose,
  onEdit,
  onMove,
}: {
  readonly deal: DealDto | null;
  readonly pipelines: PipelineDto[];
  readonly canUpdate: boolean;
  readonly canDelete: boolean;
  readonly canNote: boolean;
  readonly onClose: () => void;
  readonly onEdit: (deal: DealDto) => void;
  readonly onMove: (deal: DealDto, stageId: string) => void;
}) {
  const router = useRouter();
  const [activity, setActivity] = useState<ActivityRow[] | null>(null);
  const [notes, setNotes] = useState<NoteRow[] | null>(null);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const pipeline = pipelines.find((p) => p.id === deal?.pipelineId);

  const load = useCallback(async (id: string) => {
    const [a, n] = await Promise.all([
      apiFetch<{ activities: ActivityRow[] }>(`/api/v1/opportunities/${id}/activity`),
      apiFetch<{ notes: NoteRow[] }>(`/api/v1/notes?entityType=deal&entityId=${encodeURIComponent(id)}`),
    ]);
    setActivity(a.ok ? a.data.activities : []);
    setNotes(n.ok ? n.data.notes : []);
  }, []);

  useEffect(() => {
    setActivity(null);
    setNotes(null);
    if (deal) void load(deal.id);
  }, [deal, load]);

  async function addNote() {
    if (!deal || !note.trim()) return;
    setSaving(true);
    const res = await apiFetch("/api/v1/notes", {
      method: "POST",
      body: { entityType: "deal", entityId: deal.id, body: note.trim() },
    });
    setSaving(false);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    setNote("");
    await load(deal.id);
  }

  async function remove(): Promise<boolean> {
    if (!deal) return true;
    const res = await apiFetch(`/api/v1/opportunities/${deal.id}`, { method: "DELETE" });
    if (!res.ok) {
      toast.error(res.error);
      return false;
    }
    toast.success("Deal deleted");
    onClose();
    router.refresh();
    return true;
  }

  let notesBody: React.ReactNode = <Skeleton className="h-12 w-full" />;
  if (notes?.length) {
    notesBody = (
      <ul className="flex flex-col gap-2">
        {notes.map((n) => (
          <li key={n.id} className="rounded-lg border p-3">
            <p className="whitespace-pre-wrap break-words text-sm">{n.body}</p>
            <p className="mt-1 text-muted-foreground text-xs">
              {n.author?.name ?? "Someone"} ·{" "}
              <span title={formatDateTime(n.createdAt)}>{relativeTime(n.createdAt)}</span>
            </p>
          </li>
        ))}
      </ul>
    );
  } else if (notes) {
    notesBody = (
      <Empty className="border p-4">
        <EmptyHeader>
          <EmptyTitle className="flex items-center gap-2 text-sm">
            <NotebookPen className="size-4" aria-hidden="true" />
            No notes yet
          </EmptyTitle>
          <EmptyDescription>Notes you add here stay with the deal.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  let activityBody: React.ReactNode = <Skeleton className="h-16 w-full" />;
  if (activity?.length) {
    activityBody = (
      <ol className="flex flex-col gap-3 border-l pl-4">
        {activity.map((a) => (
          <li key={a.id} className="relative">
            <span className="absolute top-1.5 -left-[1.3rem] size-2 rounded-full bg-border" aria-hidden="true" />
            <p className="text-sm">{a.summary}</p>
            <p className="text-muted-foreground text-xs">
              {a.actorName ? `${a.actorName} · ` : ""}
              <span title={formatDateTime(a.occurredAt)}>{relativeTime(a.occurredAt)}</span>
            </p>
          </li>
        ))}
      </ol>
    );
  } else if (activity) {
    activityBody = <p className="text-muted-foreground text-sm">Stage changes, notes and tasks appear here.</p>;
  }

  return (
    <Sheet open={deal !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="flex w-full flex-col gap-0 overflow-y-auto sm:max-w-md">
        {deal ? (
          <>
            <SheetHeader className="gap-1 border-b">
              <SheetTitle className="pr-8 font-medium text-lg">{deal.name}</SheetTitle>
              <SheetDescription className="flex flex-wrap items-center gap-2">
                <DealStagePill deal={deal} />
                <span className="font-medium font-mono text-foreground tabular-nums">
                  {formatMoney(deal.amount, deal.currency)}
                </span>
              </SheetDescription>
              {canUpdate || canDelete ? (
                <div className="flex flex-wrap gap-2 pt-2">
                  {canUpdate ? (
                    <Button size="sm" variant="outline" onClick={() => onEdit(deal)}>
                      <Pencil data-icon="inline-start" />
                      Edit
                    </Button>
                  ) : null}
                  {canDelete ? (
                    <Button size="sm" variant="outline" onClick={() => setConfirmDelete(true)}>
                      <Trash2 data-icon="inline-start" />
                      Delete
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </SheetHeader>
            <div className="flex flex-col gap-5 p-4">
              {canUpdate && pipeline ? (
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="drawer-stage" className="table-head-mono">
                    Stage
                  </label>
                  <NativeSelect
                    id="drawer-stage"
                    value={deal.stageId ?? ""}
                    onChange={(e) => onMove(deal, e.target.value)}
                    className="w-full"
                  >
                    {pipeline.stages.map((s) => (
                      <NativeSelectOption key={s.id} value={s.id}>
                        {s.name}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                </div>
              ) : null}
              <dl className="grid grid-cols-2 gap-4">
                <Detail label="Pipeline">{deal.pipelineName ?? "—"}</Detail>
                <Detail label="Owner">{deal.owner?.name ?? "No owner"}</Detail>
                <Detail label="Company">{deal.company?.name ?? "—"}</Detail>
                <Detail label="Contact">{deal.contact?.name ?? "—"}</Detail>
                <Detail label="Close date">{formatDate(deal.closeDate)}</Detail>
                <Detail label="Win probability">{deal.probability === null ? "—" : `${deal.probability}%`}</Detail>
                <Detail label="Created">
                  <span title={formatDateTime(deal.createdAt)}>{relativeTime(deal.createdAt)}</span>
                </Detail>
              </dl>
              <Separator />
              <section aria-labelledby="deal-notes" className="flex flex-col gap-3">
                <h3 id="deal-notes" className="font-medium text-sm">
                  Notes
                </h3>
                {canNote ? (
                  <form
                    className="flex flex-col gap-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void addNote();
                    }}
                  >
                    <Textarea
                      aria-label="New note"
                      placeholder="Add a note about this deal"
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      maxLength={10_000}
                      rows={3}
                    />
                    <Button type="submit" size="sm" className="self-end" disabled={saving || !note.trim()}>
                      <Send data-icon="inline-start" />
                      {saving ? "Saving…" : "Add note"}
                    </Button>
                  </form>
                ) : null}
                {notesBody}
              </section>
              <Separator />
              <section aria-labelledby="deal-activity" className="flex flex-col gap-3">
                <h3 id="deal-activity" className="font-medium text-sm">
                  Activity
                </h3>
                {activityBody}
              </section>
            </div>
            <ConfirmDialog
              open={confirmDelete}
              onOpenChange={setConfirmDelete}
              title="Delete this deal?"
              description={`"${deal.name}" will be removed from the pipeline. This can't be undone.`}
              confirmLabel="Delete deal"
              pendingLabel="Deleting…"
              icon={<Trash2 data-icon="inline-start" />}
              onConfirm={remove}
            />
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
