"use client";

import { useEffect, useId, useState } from "react";

import { useRouter } from "next/navigation";

import { formatDistanceToNowStrict } from "date-fns";
import { StickyNote, Trash2 } from "lucide-react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

import { apiRequest } from "../../../_components/records/api-client";

export interface NoteItem {
  id: string;
  body: string;
  author: { id: string; name: string } | null;
  createdAt: string;
}

/** Relative time after hydration; the server renders a stable date so the markup matches. */
function NoteTime({ iso }: { iso: string }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => setNow(Date.now()), []);
  const date = new Date(iso);
  return (
    <time dateTime={iso} title={date.toUTCString()}>
      {now === null ? date.toISOString().slice(0, 10) : formatDistanceToNowStrict(date, { addSuffix: true })}
    </time>
  );
}

function DeleteNote({ id, onDeleted }: { id: string; onDeleted: (id: string) => void }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  async function confirm() {
    setPending(true);
    const res = await apiRequest(`/api/v1/notes/${id}`, { method: "DELETE" });
    setPending(false);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    setOpen(false);
    onDeleted(id);
    toast.success("Note deleted.");
    router.refresh();
  }
  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button variant="ghost" size="icon-xs" aria-label="Delete note">
          <Trash2 aria-hidden="true" />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this note?</AlertDialogTitle>
          <AlertDialogDescription>
            It's removed for everyone in the workspace. This can't be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel size="sm">Cancel</AlertDialogCancel>
          <Button variant="destructive" size="sm" disabled={pending} onClick={confirm}>
            <Trash2 data-icon="inline-start" aria-hidden="true" />
            {pending ? "Deleting…" : "Delete note"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** Notes on this person: newest first, add with note:create, delete your own or with note:delete. */
export function NotesCard({
  contactId,
  notes,
  canCreate,
  canDeleteAny,
  userId,
}: {
  contactId: string;
  notes: NoteItem[];
  canCreate: boolean;
  canDeleteAny: boolean;
  userId: string | null;
}) {
  const router = useRouter();
  const id = useId();
  const [body, setBody] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Shown immediately after a write; the server list replaces it on the next refresh.
  const [items, setItems] = useState(notes);
  useEffect(() => setItems(notes), [notes]);

  async function add(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const res = await apiRequest<{ note: NoteItem }>("/api/v1/notes", {
      body: { entityType: "contact", entityId: contactId, body },
    });
    setPending(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    const created = res.data.note;
    setItems((prev) => [created, ...prev.filter((n) => n.id !== created.id)]);
    setBody("");
    toast.success("Note added.");
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-3">
      {canCreate ? (
        <form onSubmit={add} className="flex flex-col gap-2">
          <Label htmlFor={`${id}-note`} className="sr-only">
            New note
          </Label>
          <Textarea
            id={`${id}-note`}
            value={body}
            maxLength={10_000}
            rows={3}
            placeholder="Write a note about this person"
            onChange={(e) => setBody(e.target.value)}
          />
          {error ? (
            <p role="alert" className="text-destructive text-xs">
              {error}
            </p>
          ) : null}
          <Button type="submit" size="sm" variant="outline" className="w-fit" disabled={pending || !body.trim()}>
            <StickyNote data-icon="inline-start" aria-hidden="true" />
            {pending ? "Adding…" : "Add note"}
          </Button>
        </form>
      ) : null}
      {items.length ? (
        <ul className="flex flex-col gap-2" aria-label="Notes">
          {items.map((note) => (
            <li key={note.id} className="flex flex-col gap-1 rounded-lg border bg-muted/30 p-3">
              <p className="whitespace-pre-wrap break-words text-sm">{note.body}</p>
              <div className="flex items-center justify-between gap-2">
                <p className="text-muted-foreground text-xs">
                  {note.author?.name ?? "Someone"} · <NoteTime iso={note.createdAt} />
                </p>
                {canDeleteAny || (canCreate && note.author?.id === userId) ? (
                  <DeleteNote
                    id={note.id}
                    onDeleted={(gone) => setItems((prev) => prev.filter((n) => n.id !== gone))}
                  />
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground text-sm">No notes yet.</p>
      )}
    </div>
  );
}
