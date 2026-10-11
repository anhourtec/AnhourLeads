"use client";

import { useState } from "react";

import Link from "next/link";
import { useRouter } from "next/navigation";

import {
  ChevronDown,
  Download,
  Ellipsis,
  ListMinus,
  ListPlus,
  Mail,
  Plus,
  Send,
  Sparkles,
  Trash2,
  Workflow,
  X,
} from "lucide-react";
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
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { COMPANY_STAGE_LABELS, COMPANY_STAGES, CONTACT_STAGE_LABELS, CONTACT_STAGES } from "@/lib/records-vocabulary";
import type { SearchEntity } from "@/lib/search/filters";

import { apiRequest } from "../api-client";
import type { Option, SearchPermissions } from "./types";

const CHUNK = 1000;

function IconAction({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button type="button" variant="ghost" size="icon-sm" aria-label={label} disabled={disabled} onClick={onClick}>
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

async function inChunks(ids: string[], call: (part: string[]) => Promise<string | null>): Promise<string | null> {
  for (let i = 0; i < ids.length; i += CHUNK) {
    const error = await call(ids.slice(i, i + CHUNK));
    if (error) return error;
  }
  return null;
}

/** Actions for the selected rows; replaces the toolbar while anything is selected. */
export function BulkBar({
  entity,
  ids,
  emails,
  permissions,
  members,
  currentUserId,
  workflowHref,
  onClear,
  onAddToList,
  onAddToSequence,
  onExport,
  onResearch,
  onRemoveFromList,
}: {
  entity: SearchEntity;
  ids: string[];
  /** Email addresses of selected rows we have loaded (for the composer). */
  emails: string[];
  permissions: SearchPermissions;
  members: Option[];
  currentUserId: string;
  workflowHref: string;
  onClear: () => void;
  onAddToList: () => void;
  onAddToSequence: () => void;
  onExport: () => void;
  onResearch: () => void;
  onRemoveFromList?: () => void;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const count = ids.length;
  const isPeople = entity === "contact";
  const noun = isPeople ? (count === 1 ? "person" : "people") : count === 1 ? "company" : "companies";
  const base = isPeople ? "/api/v1/contacts" : "/api/v1/accounts";
  const idKey = isPeople ? "contactIds" : "accountIds";

  async function run(path: string, body: Record<string, unknown>, success: string) {
    setPending(true);
    const error = await inChunks(ids, async (part) => {
      const res = await apiRequest(path, { body: { [idKey]: part, ...body } });
      return res.ok ? null : res.error;
    });
    setPending(false);
    if (error) {
      toast.error(error);
      return false;
    }
    toast.success(success);
    router.refresh();
    return true;
  }

  const stageOptions = isPeople
    ? CONTACT_STAGES.map((s) => ({ value: s, label: CONTACT_STAGE_LABELS[s] }))
    : COMPANY_STAGES.map((s) => ({ value: s, label: COMPANY_STAGE_LABELS[s] }));
  const composeHref = emails.length ? `mailto:?bcc=${encodeURIComponent(emails.slice(0, 50).join(","))}` : undefined;

  return (
    <div
      role="toolbar"
      aria-label="Bulk actions"
      className="flex min-w-0 flex-wrap items-center gap-1 rounded-lg border bg-card px-2 py-1 shadow-xs"
    >
      <Button type="button" variant="outline" size="sm" onClick={onClear}>
        <X data-icon="inline-start" aria-hidden="true" />
        Clear <span className="font-mono tabular-nums">{count.toLocaleString("en-US")}</span> selected
      </Button>
      {permissions.update ? (
        <Button
          type="button"
          size="sm"
          disabled={pending}
          onClick={() =>
            void run(
              `${base}/update_owners`,
              { ownerId: currentUserId },
              `Saved ${count.toLocaleString("en-US")} ${noun} to you.`,
            )
          }
        >
          <Plus data-icon="inline-start" aria-hidden="true" />
          Save
        </Button>
      ) : null}
      {isPeople ? (
        composeHref ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button asChild variant="ghost" size="icon-sm">
                <a href={composeHref} aria-label="Email selected people">
                  <Mail aria-hidden="true" />
                </a>
              </Button>
            </TooltipTrigger>
            <TooltipContent>Email selected people</TooltipContent>
          </Tooltip>
        ) : (
          <IconAction label="Email selected people" disabled>
            <Mail aria-hidden="true" />
          </IconAction>
        )
      ) : null}
      {isPeople && permissions.sequenceLaunch ? (
        <IconAction label="Add to sequence" onClick={onAddToSequence} disabled={pending}>
          <Send aria-hidden="true" />
        </IconAction>
      ) : null}
      {permissions.workflowCreate ? (
        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <Button type="button" variant="ghost" size="sm" aria-label="Workflows">
                  <Workflow aria-hidden="true" />
                  <ChevronDown aria-hidden="true" />
                </Button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent>Workflows</TooltipContent>
          </Tooltip>
          <DropdownMenuContent>
            <DropdownMenuItem asChild>
              <Link href={workflowHref}>Create a workflow for this search</Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href="/dashboard/workflows">View workflows</Link>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
      {permissions.listUpdate ? (
        <IconAction label="Add to list" onClick={onAddToList} disabled={pending}>
          <ListPlus aria-hidden="true" />
        </IconAction>
      ) : null}
      {onRemoveFromList ? (
        <IconAction label="Remove from list" onClick={onRemoveFromList} disabled={pending}>
          <ListMinus aria-hidden="true" />
        </IconAction>
      ) : null}
      {permissions.export ? (
        <IconAction label="Export to CSV" onClick={onExport} disabled={pending}>
          <Download aria-hidden="true" />
        </IconAction>
      ) : null}
      {permissions.enrich ? (
        <IconAction
          label={isPeople ? "Research with AI: find and verify emails" : "Research company websites"}
          onClick={onResearch}
          disabled={pending}
        >
          <Sparkles aria-hidden="true" />
        </IconAction>
      ) : null}
      {permissions.update || permissions.delete ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="ghost" size="icon-sm" aria-label="More bulk actions" disabled={pending}>
              <Ellipsis aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {permissions.update ? (
              <>
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>Update stage</DropdownMenuSubTrigger>
                  <DropdownMenuSubContent>
                    {stageOptions.map((s) => (
                      <DropdownMenuItem
                        key={s.value}
                        onSelect={() =>
                          void (isPeople
                            ? run(
                                "/api/v1/contacts/update_stages",
                                { stage: s.value },
                                `Moved ${count} ${noun} to ${s.label}.`,
                              )
                            : run(
                                "/api/v1/accounts/bulk_update",
                                { stage: s.value },
                                `Moved ${count} ${noun} to ${s.label}.`,
                              ))
                        }
                      >
                        {s.label}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>Update owner</DropdownMenuSubTrigger>
                  <DropdownMenuSubContent className="max-h-72 overflow-y-auto">
                    <DropdownMenuItem
                      onSelect={() =>
                        void run(`${base}/update_owners`, { ownerId: null }, `Unassigned ${count} ${noun}.`)
                      }
                    >
                      Unassigned
                    </DropdownMenuItem>
                    {members.map((m) => (
                      <DropdownMenuItem
                        key={m.id}
                        onSelect={() =>
                          void run(
                            `${base}/update_owners`,
                            { ownerId: m.id },
                            `Assigned ${count} ${noun} to ${m.name}.`,
                          )
                        }
                      >
                        {m.name}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              </>
            ) : null}
            {permissions.delete ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onSelect={() => setConfirmDelete(true)}>
                  <Trash2 aria-hidden="true" />
                  Delete
                </DropdownMenuItem>
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete {count.toLocaleString("en-US")} {noun}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              They are removed from lists and sequences. Deals and tasks stay but lose the link. This can't be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              disabled={pending}
              onClick={async () => {
                const ok = await run(`${base}/bulk_delete`, {}, `Deleted ${count.toLocaleString("en-US")} ${noun}.`);
                if (ok) {
                  setConfirmDelete(false);
                  onClear();
                }
              }}
            >
              <Trash2 data-icon="inline-start" aria-hidden="true" />
              {pending ? "Deleting…" : "Delete"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
