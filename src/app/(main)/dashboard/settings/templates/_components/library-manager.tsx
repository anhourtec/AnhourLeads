"use client";

import { useRef, useState } from "react";

import { useRouter } from "next/navigation";

import { FileText, Pencil, Plus, Save, Scissors, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { apiFetch } from "@/lib/api-fetch";
import { formatDate } from "@/lib/format-display";

import { insertAtCursor, MergeFieldPicker } from "../../../_components/engage/insert-pickers";
import { ConfirmDialog } from "../../../_components/pipeline/confirm-dialog";

export interface LibraryItem {
  id: string;
  name: string;
  subject: string | null;
  body: string;
  shared: boolean;
  ownerId: string | null;
  ownerName: string | null;
  createdAt: string;
}

export interface LibraryAccess {
  canCreate: boolean;
  canUpdate: boolean;
  /** `template:delete` (manager and up). Owners may always delete their own. */
  canDeleteAny: boolean;
  currentUserId: string | null;
}

const COPY = {
  template: {
    noun: "template",
    title: "Email templates",
    empty: "No templates yet",
    emptyText: "Save an email you send often, with merge fields, and insert it into any step or one-off email.",
    endpoint: "/api/v1/email_templates",
    key: "email_template",
  },
  snippet: {
    noun: "snippet",
    title: "Snippets",
    empty: "No snippets yet",
    emptyText: "Short pieces of text, such as a meeting link or a product line, to drop into emails and tasks.",
    endpoint: "/api/v1/snippets",
    key: "snippet",
  },
} as const;

interface Draft {
  name: string;
  subject: string;
  body: string;
  shared: boolean;
}

function EditorDialog({
  kind,
  item,
  open,
  onOpenChange,
}: {
  kind: "template" | "snippet";
  item: LibraryItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const copy = COPY[kind];
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const [draft, setDraft] = useState<Draft>({ name: "", subject: "", body: "", shared: true });
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [lastKey, setLastKey] = useState<string | null>(null);
  const key = `${open}-${item?.id ?? "new"}`;
  if (key !== lastKey) {
    setLastKey(key);
    setDraft({
      name: item?.name ?? "",
      subject: item?.subject ?? "",
      body: item?.body ?? "",
      shared: item?.shared ?? true,
    });
    setError(null);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const body: Record<string, unknown> = { name: draft.name.trim(), body: draft.body, shared: draft.shared };
    if (kind === "template") body.subject = draft.subject.trim() || null;
    const res = await apiFetch(item ? `${copy.endpoint}/${item.id}` : copy.endpoint, {
      method: item ? "PATCH" : "POST",
      body,
    });
    setPending(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    toast.success(
      item
        ? `${kind === "template" ? "Template" : "Snippet"} saved.`
        : `${kind === "template" ? "Template" : "Snippet"} created.`,
    );
    onOpenChange(false);
    router.refresh();
  }

  const title = item ? `Edit ${copy.noun}` : `New ${copy.noun}`;
  let submitLabel = item ? "Save" : `Create ${copy.noun}`;
  if (pending) submitLabel = "Saving…";
  return (
    <Dialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <form onSubmit={submit} noValidate className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>
              {kind === "template"
                ? "Merge fields such as {{first_name}} fill in for each contact when the email is sent."
                : "Snippets are inserted as written where your cursor is."}
            </DialogDescription>
          </DialogHeader>
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          <FieldGroup className="gap-4">
            <Field className="gap-1.5">
              <FieldLabel htmlFor={`${kind}-name`}>Name</FieldLabel>
              <Input
                id={`${kind}-name`}
                value={draft.name}
                maxLength={120}
                onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                autoFocus
              />
            </Field>
            {kind === "template" ? (
              <Field className="gap-1.5">
                <FieldLabel htmlFor="template-subject">Subject</FieldLabel>
                <Input
                  id="template-subject"
                  value={draft.subject}
                  maxLength={300}
                  onChange={(e) => setDraft((d) => ({ ...d, subject: e.target.value }))}
                />
              </Field>
            ) : null}
            <Field className="gap-1.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <FieldLabel htmlFor={`${kind}-body`}>Body</FieldLabel>
                <MergeFieldPicker
                  onPick={(token) => {
                    const next = insertAtCursor(bodyRef.current, draft.body, token);
                    setDraft((d) => ({ ...d, body: next.value }));
                  }}
                />
              </div>
              <Textarea
                id={`${kind}-body`}
                ref={bodyRef}
                rows={kind === "template" ? 8 : 4}
                value={draft.body}
                maxLength={20000}
                onChange={(e) => setDraft((d) => ({ ...d, body: e.target.value }))}
              />
            </Field>
            <Field orientation="horizontal" className="gap-3">
              <Switch
                id={`${kind}-shared`}
                checked={draft.shared}
                onCheckedChange={(v) => setDraft((d) => ({ ...d, shared: v }))}
              />
              <div className="flex flex-col gap-0.5">
                <FieldLabel htmlFor={`${kind}-shared`}>Shared with the team</FieldLabel>
                <FieldDescription className="text-xs">Off keeps it visible to you only.</FieldDescription>
              </div>
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button type="button" variant="outline" size="sm" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={pending}>
              {item ? (
                <Save data-icon="inline-start" aria-hidden="true" />
              ) : (
                <Plus data-icon="inline-start" aria-hidden="true" />
              )}
              {submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** List, create, edit and delete templates or snippets. */
export function LibraryManager({
  kind,
  items,
  access,
}: {
  kind: "template" | "snippet";
  items: LibraryItem[];
  access: LibraryAccess;
}) {
  const router = useRouter();
  const copy = COPY[kind];
  const [editing, setEditing] = useState<{ open: boolean; item: LibraryItem | null }>({ open: false, item: null });
  const [toDelete, setToDelete] = useState<LibraryItem | null>(null);
  const Icon = kind === "template" ? FileText : Scissors;
  const canDelete = (item: LibraryItem) =>
    access.canDeleteAny || (access.currentUserId !== null && item.ownerId === access.currentUserId);

  return (
    <section className="flex flex-col gap-3" aria-label={copy.title}>
      {access.canCreate ? (
        <div className="flex justify-end">
          <Button size="sm" onClick={() => setEditing({ open: true, item: null })}>
            <Plus data-icon="inline-start" aria-hidden="true" />
            New {copy.noun}
          </Button>
        </div>
      ) : null}
      {items.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Icon aria-hidden="true" />
            </EmptyMedia>
            <EmptyTitle>{copy.empty}</EmptyTitle>
            <EmptyDescription>{copy.emptyText}</EmptyDescription>
          </EmptyHeader>
          {access.canCreate ? (
            <EmptyContent>
              <Button size="sm" onClick={() => setEditing({ open: true, item: null })}>
                <Plus data-icon="inline-start" aria-hidden="true" />
                New {copy.noun}
              </Button>
            </EmptyContent>
          ) : null}
        </Empty>
      ) : (
        <ul className="flex flex-col divide-y rounded-xl border bg-card">
          {items.map((item) => (
            <li key={item.id} className="flex flex-col gap-2 p-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex min-w-0 flex-col gap-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="break-words font-medium text-sm">{item.name}</span>
                  {item.shared ? null : (
                    <Badge variant="secondary" className="bg-muted font-medium text-muted-foreground">
                      Private
                    </Badge>
                  )}
                </div>
                {item.subject ? <span className="break-words text-sm">{item.subject}</span> : null}
                <p className="line-clamp-2 whitespace-pre-line break-words text-muted-foreground text-xs">
                  {item.body}
                </p>
                <span className="text-muted-foreground text-xs">
                  {item.ownerName ?? "Unknown owner"} · {formatDate(item.createdAt)}
                </span>
              </div>
              {access.canUpdate || canDelete(item) ? (
                <div className="flex shrink-0 gap-2">
                  {access.canUpdate ? (
                    <Button
                      size="sm"
                      variant="outline"
                      aria-label={`Edit ${item.name}`}
                      onClick={() => setEditing({ open: true, item })}
                    >
                      <Pencil data-icon="inline-start" aria-hidden="true" />
                      Edit
                    </Button>
                  ) : null}
                  {canDelete(item) ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={`Delete ${item.name}`}
                      onClick={() => setToDelete(item)}
                    >
                      <Trash2 data-icon="inline-start" aria-hidden="true" />
                      Delete
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      <EditorDialog
        kind={kind}
        item={editing.item}
        open={editing.open}
        onOpenChange={(open) => setEditing((e) => ({ ...e, open }))}
      />
      <ConfirmDialog
        open={toDelete !== null}
        onOpenChange={(open) => !open && setToDelete(null)}
        title={`Delete this ${copy.noun}?`}
        description={`"${toDelete?.name ?? ""}" will be removed for everyone. Steps that already used it keep their text.`}
        confirmLabel={`Delete ${copy.noun}`}
        pendingLabel="Deleting…"
        icon={<Trash2 data-icon="inline-start" aria-hidden="true" />}
        onConfirm={async () => {
          if (!toDelete) return true;
          const res = await apiFetch(`${copy.endpoint}/${toDelete.id}`, { method: "DELETE" });
          if (!res.ok) {
            toast.error(res.error);
            return false;
          }
          toast.success(`${kind === "template" ? "Template" : "Snippet"} deleted.`);
          router.refresh();
          return true;
        }}
      />
    </section>
  );
}
