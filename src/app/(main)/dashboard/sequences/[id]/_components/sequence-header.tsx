"use client";

import { useState } from "react";

import Link from "next/link";
import { useRouter } from "next/navigation";

import { Archive, Copy, Ellipsis, Lightbulb, Share2, Trash2, Zap } from "lucide-react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Spinner } from "@/components/ui/spinner";
import type { Suggestion } from "@/server/services/sequence-insights";
import type { SequenceView } from "@/server/services/sequences";

import { SequenceStatusPill } from "../../../_components/engage/tone-pill";
import { apiRequest } from "../../../_components/records/api-client";
import { ActiveSwitch } from "../../_components/active-switch";
import { StarButton } from "../../_components/star-button";
import { AddContactsMenu } from "./add-contacts-menu";

interface Permissions {
  canUpdate: boolean;
  canLaunch: boolean;
  canCreate: boolean;
  canDelete: boolean;
}

/** Breadcrumb, name with star, and the sequence's actions (Optimize, Share, Add contacts, Activate, ⋯). */
export function SequenceHeader({
  sequence,
  lists,
  can,
}: {
  sequence: SequenceView;
  lists: { id: string; name: string; memberCount: number }[];
  can: Permissions;
}) {
  const archived = sequence.status === "archived";
  return (
    <div className="flex flex-col gap-2">
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link href="/dashboard/sequences">Sequences</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem className="min-w-0">
            <BreadcrumbPage className="truncate">{sequence.name}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex min-w-0 items-center gap-1">
            <h1 className="min-w-0 break-words font-medium text-2xl tracking-tight">{sequence.name}</h1>
            <StarButton
              sequenceId={sequence.id}
              name={sequence.name}
              starred={sequence.starred}
              canEdit={can.canUpdate}
            />
          </div>
          <div className="flex flex-wrap items-center gap-2 text-muted-foreground text-xs">
            <SequenceStatusPill status={sequence.status} />
            {sequence.mailbox ? <span className="font-mono">{sequence.mailbox.email}</span> : <span>No mailbox</span>}
            {sequence.owner ? <span>Owner: {sequence.owner.name}</span> : null}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <OptimizeDialog sequenceId={sequence.id} />
          <ShareButton />
          {can.canLaunch && !archived ? <AddContactsMenu sequenceId={sequence.id} lists={lists} /> : null}
          {can.canLaunch ? (
            <div className="flex h-7 items-center rounded-lg border px-2.5">
              <ActiveSwitch
                sequenceId={sequence.id}
                name={sequence.name}
                status={sequence.status}
                canLaunch={can.canLaunch}
                withLabel
              />
            </div>
          ) : null}
          <MoreMenu sequence={sequence} can={can} />
        </div>
      </div>
    </div>
  );
}

function OptimizeDialog({ sequenceId }: { sequenceId: string }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Suggestion[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setItems(null);
    setError(null);
    const result = await apiRequest<{ suggestions: Suggestion[] }>(`/api/v1/emailer_campaigns/${sequenceId}/optimize`);
    if (result.ok) setItems(result.data.suggestions);
    else setError(result.error);
  }

  return (
    <>
      <Button
        size="sm"
        variant="outline"
        onClick={() => {
          setOpen(true);
          void load();
        }}
      >
        <Lightbulb data-icon="inline-start" aria-hidden="true" />
        Optimize
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Ways to improve this sequence</DialogTitle>
            <DialogDescription>
              Checks on subject length, personalisation, spacing and the mix of steps.
            </DialogDescription>
          </DialogHeader>
          {error ? <p className="text-destructive text-sm">{error}</p> : null}
          {items === null && !error ? (
            <div className="flex justify-center py-6">
              <Spinner aria-label="Checking" />
            </div>
          ) : null}
          {items?.length === 0 ? (
            <p className="py-4 text-center text-muted-foreground text-sm">Nothing to suggest. It looks good.</p>
          ) : null}
          {items?.length ? (
            <ul className="flex flex-col gap-2" aria-label="Suggestions">
              {items.map((s) => (
                <li
                  key={`${s.code}-${s.stepPosition ?? "all"}-${s.detail}`}
                  className="flex gap-3 rounded-lg border p-3"
                >
                  <Lightbulb className="mt-0.5 size-4 shrink-0 text-amber-500" aria-hidden="true" />
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <p className="font-medium text-sm">
                      {s.title}
                      {s.stepPosition ? (
                        <span className="font-normal text-muted-foreground"> · Step {s.stepPosition}</span>
                      ) : null}
                    </p>
                    <p className="text-muted-foreground text-sm">{s.detail}</p>
                  </div>
                </li>
              ))}
            </ul>
          ) : null}
          <DialogFooter>
            <Button size="sm" variant="outline" onClick={() => setOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function ShareButton() {
  return (
    <Button
      size="sm"
      variant="outline"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(window.location.href.split("?")[0]);
          toast.success("Link copied. Sequences are visible to everyone in the workspace.");
        } catch {
          toast.error("Couldn't copy the link. Copy it from the address bar instead.");
        }
      }}
    >
      <Share2 data-icon="inline-start" aria-hidden="true" />
      Share
    </Button>
  );
}

function MoreMenu({ sequence, can }: { sequence: SequenceView; can: Permissions }) {
  const router = useRouter();
  const [confirm, setConfirm] = useState<"archive" | "delete" | null>(null);
  const [busy, setBusy] = useState(false);
  const archived = sequence.status === "archived";
  const showLaunch = can.canLaunch && !archived;
  if (!can.canCreate && !showLaunch && !can.canDelete) return null;

  async function post(path: string) {
    setBusy(true);
    const result = await apiRequest<{
      emailer_campaign?: { id: string };
      run?: { ran: boolean; note?: string; sent: number };
    }>(`/api/v1/emailer_campaigns/${sequence.id}/${path}`, { method: "POST" });
    setBusy(false);
    return result;
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="icon-sm" variant="outline" aria-label="More actions" disabled={busy}>
            <Ellipsis aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          {sequence.status === "active" && can.canLaunch ? (
            <DropdownMenuItem
              onSelect={async () => {
                const r = await post("run_now");
                if (!r.ok) toast.error(r.error);
                else {
                  const run = r.data.run;
                  toast.success(run?.ran ? `Run finished: ${run.sent} sent.` : (run?.note ?? "Nothing to do."));
                  router.refresh();
                }
              }}
            >
              <Zap aria-hidden="true" />
              Run now
            </DropdownMenuItem>
          ) : null}
          {can.canCreate ? (
            <DropdownMenuItem
              onSelect={async () => {
                const r = await post("clone");
                if (!r.ok || !r.data.emailer_campaign) {
                  toast.error(r.ok ? "Couldn't clone the sequence." : r.error);
                  return;
                }
                toast.success("Sequence cloned as a draft.");
                router.push(`/dashboard/sequences/${r.data.emailer_campaign.id}`);
              }}
            >
              <Copy aria-hidden="true" />
              Clone
            </DropdownMenuItem>
          ) : null}
          {showLaunch ? (
            <DropdownMenuItem onSelect={() => setConfirm("archive")}>
              <Archive aria-hidden="true" />
              Archive
            </DropdownMenuItem>
          ) : null}
          {can.canDelete ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={() => setConfirm("delete")}>
                <Trash2 aria-hidden="true" />
                Delete
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      <AlertDialog open={confirm !== null} onOpenChange={(next) => !next && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirm === "delete" ? "Delete this sequence?" : "Archive this sequence?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirm === "delete"
                ? `"${sequence.name}", its steps and enrollments are deleted. Sent emails stay in the email log.`
                : "Sending stops and everyone still in it is marked finished. Emails waiting for review won't be sent."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel size="sm">Cancel</AlertDialogCancel>
            <Button
              size="sm"
              variant={confirm === "delete" ? "destructive" : "default"}
              disabled={busy}
              onClick={async () => {
                if (confirm === "delete") {
                  setBusy(true);
                  const r = await apiRequest(`/api/v1/emailer_campaigns/${sequence.id}`, { method: "DELETE" });
                  setBusy(false);
                  if (!r.ok) {
                    toast.error(r.error);
                    return;
                  }
                  setConfirm(null);
                  toast.success("Sequence deleted.");
                  router.push("/dashboard/sequences");
                  return;
                }
                const r = await post("archive");
                setConfirm(null);
                if (!r.ok) toast.error(r.error);
                else {
                  toast.success("Sequence archived.");
                  router.refresh();
                }
              }}
            >
              {confirm === "delete" ? (
                <Trash2 data-icon="inline-start" aria-hidden="true" />
              ) : (
                <Archive data-icon="inline-start" aria-hidden="true" />
              )}
              {confirm === "delete" ? "Delete" : "Archive"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
