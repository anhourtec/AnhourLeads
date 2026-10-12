"use client";

import { useState } from "react";

import { useRouter } from "next/navigation";

import { Save, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Alert, AlertDescription } from "@/components/ui/alert";
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
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

interface Workspace {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
  memberCount: number;
  roleLabel: string;
}

async function errorOf(res: Response, fallback: string): Promise<string> {
  const body = (await res.json().catch(() => ({}))) as { error?: string; details?: { message?: string }[] };
  return body.details?.[0]?.message ?? body.error ?? fallback;
}

export function WorkspaceDetails({
  workspace,
  canRename,
  canDelete,
}: {
  readonly workspace: Workspace;
  readonly canRename: boolean;
  readonly canDelete: boolean;
}) {
  const router = useRouter();
  const [name, setName] = useState(workspace.name);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const trimmed = name.trim();

  async function rename() {
    setSaving(true);
    setError(null);
    const res = await fetch("/api/v1/workspace", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: trimmed }),
    }).catch(() => null);
    setSaving(false);
    if (!res?.ok) {
      setError(res ? await errorOf(res, "The name couldn't be saved.") : "The name couldn't be saved. Try again.");
      return;
    }
    toast.success("Workspace renamed");
    router.refresh();
  }

  async function remove() {
    setDeleting(true);
    setDeleteError(null);
    const res = await fetch("/api/v1/workspace", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ confirm }),
    }).catch(() => null);
    if (!res?.ok) {
      setDeleting(false);
      setDeleteError(res ? await errorOf(res, "The workspace couldn't be deleted.") : "Try again.");
      return;
    }
    toast.success("Workspace deleted");
    router.replace("/auth/login");
    router.refresh();
  }

  const facts: { label: string; value: string; mono?: boolean }[] = [
    { label: "Workspace id", value: workspace.slug, mono: true },
    { label: "Created", value: new Date(workspace.createdAt).toLocaleDateString() },
    { label: "Members", value: workspace.memberCount.toLocaleString(), mono: true },
    { label: "Your role", value: workspace.roleLabel },
  ];

  return (
    <>
      <Card>
        <form
          className="flex flex-col gap-6"
          onSubmit={(event) => {
            event.preventDefault();
            if (canRename) void rename();
          }}
        >
          <CardHeader>
            <CardTitle>Workspace</CardTitle>
            <CardDescription>
              {canRename ? "Rename the workspace. Branding has its own page." : "Only administrators can rename it."}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {error ? (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}
            <Field>
              <FieldLabel htmlFor="workspace-name">Name</FieldLabel>
              <Input
                id="workspace-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                readOnly={!canRename}
                minLength={2}
                maxLength={80}
                required
              />
              <FieldDescription>Between 2 and 80 characters.</FieldDescription>
            </Field>
            <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
              {facts.map((f) => (
                <div key={f.label} className="flex flex-col gap-0.5">
                  <dt className="text-muted-foreground text-xs">{f.label}</dt>
                  <dd className={f.mono ? "font-mono tabular-nums" : undefined}>{f.value}</dd>
                </div>
              ))}
            </dl>
          </CardContent>
          {canRename ? (
            <CardFooter>
              <Button type="submit" size="sm" disabled={saving || trimmed.length < 2 || trimmed === workspace.name}>
                <Save data-icon="inline-start" />
                {saving ? "Saving…" : "Save name"}
              </Button>
            </CardFooter>
          ) : null}
        </form>
      </Card>

      {canDelete ? (
        <Card className="border-destructive/40">
          <CardHeader>
            <CardTitle>Delete workspace</CardTitle>
            <CardDescription>
              Deletes every person, company, list, sequence, task, deal and setting in it. This can't be undone.
            </CardDescription>
          </CardHeader>
          <CardFooter>
            <AlertDialog
              onOpenChange={(open) => {
                if (!open) {
                  setConfirm("");
                  setDeleteError(null);
                }
              }}
            >
              <AlertDialogTrigger asChild>
                <Button size="sm" variant="destructive">
                  <Trash2 data-icon="inline-start" />
                  Delete workspace
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete {workspace.name}?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Everyone loses access and all its data is removed. Type the workspace name to confirm.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                {deleteError ? (
                  <Alert variant="destructive">
                    <AlertDescription>{deleteError}</AlertDescription>
                  </Alert>
                ) : null}
                <Field>
                  <FieldLabel htmlFor="workspace-delete-confirm">Workspace name</FieldLabel>
                  <Input
                    id="workspace-delete-confirm"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    autoComplete="off"
                  />
                </Field>
                <AlertDialogFooter>
                  <AlertDialogCancel size="sm">Cancel</AlertDialogCancel>
                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={deleting || confirm.trim() !== workspace.name}
                    onClick={() => void remove()}
                  >
                    <Trash2 data-icon="inline-start" />
                    {deleting ? "Deleting…" : "Delete workspace"}
                  </Button>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </CardFooter>
        </Card>
      ) : null}
    </>
  );
}
