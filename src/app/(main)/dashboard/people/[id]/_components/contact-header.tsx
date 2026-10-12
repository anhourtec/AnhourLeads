"use client";

import { useState } from "react";

import Link from "next/link";
import { useRouter } from "next/navigation";

import {
  BriefcaseBusiness,
  CheckSquare,
  Copy,
  Ellipsis,
  ListPlus,
  Mail,
  MapPin,
  Phone,
  Send,
  Trash2,
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
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

import { AddToListDialog } from "../../../_components/records/actions/add-to-list-dialog";
import { AddToSequenceDialog } from "../../../_components/records/actions/add-to-sequence-dialog";
import { apiRequest } from "../../../_components/records/api-client";
import { PersonFormDialog } from "../../_components/person-form-dialog";
import type { CompanyOption, Option, PersonRow } from "../../_components/types";
import { EditLayoutMenu } from "./contact-layout";
import { TaskDialog } from "./task-dialog";

export interface HeaderPermissions {
  update: boolean;
  delete: boolean;
  createTask: boolean;
  addToList: boolean;
  createList: boolean;
  enroll: boolean;
}

function initials(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "")).toUpperCase() || "?";
}

function IconAction({
  label,
  onClick,
  href,
  children,
  disabled,
}: {
  label: string;
  onClick?: () => void;
  href?: string;
  children: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {href ? (
          <Button asChild variant="outline" size="icon-sm" aria-label={label}>
            <a href={href}>{children}</a>
          </Button>
        ) : (
          <Button variant="outline" size="icon-sm" aria-label={label} onClick={onClick} disabled={disabled}>
            {children}
          </Button>
        )}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export function ContactHeader({
  person,
  permissions,
  members,
  companies,
  emailHref,
}: {
  person: PersonRow;
  permissions: HeaderPermissions;
  members: Option[];
  companies: CompanyOption[];
  emailHref: string | null;
}) {
  const router = useRouter();
  const [taskOpen, setTaskOpen] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  const [sequenceOpen, setSequenceOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [calling, setCalling] = useState(false);
  const location = [person.city, person.state, person.country].filter(Boolean).join(", ");

  async function copy(value: string, what: string) {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(`${what} copied.`);
    } catch {
      toast.error(`Couldn't copy the ${what.toLowerCase()}.`);
    }
  }

  async function createCallTask() {
    setCalling(true);
    const res = await apiRequest("/api/v1/tasks", {
      body: { type: "call", title: `Call ${person.name}`, contactId: person.id, companyId: person.companyId },
    });
    setCalling(false);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    toast.success(person.phone ? `Call task created. Dial ${person.phone}.` : "Call task created.");
    router.refresh();
  }

  async function remove() {
    setDeleting(true);
    const res = await apiRequest(`/api/v1/contacts/${person.id}`, { method: "DELETE" });
    setDeleting(false);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    toast.success(`${person.name} deleted.`);
    router.push("/dashboard/people");
    router.refresh();
  }

  return (
    <TooltipProvider>
      <header className="flex flex-col gap-3">
        <nav aria-label="Breadcrumb" className="text-muted-foreground text-xs">
          <ol className="flex min-w-0 items-center gap-1.5">
            <li>
              <Link href="/dashboard/people" className="underline-offset-4 hover:text-foreground hover:underline">
                People
              </Link>
            </li>
            <li aria-hidden="true">›</li>
            <li className="min-w-0 truncate text-foreground" aria-current="page">
              {person.name}
            </li>
          </ol>
        </nav>
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <div
              aria-hidden="true"
              className="flex size-11 shrink-0 items-center justify-center rounded-full border bg-muted font-medium font-mono text-sm"
            >
              {initials(person.name)}
            </div>
            <div className="flex min-w-0 flex-col gap-1">
              <div className="flex min-w-0 items-center gap-2">
                <h1 className="truncate font-medium text-2xl tracking-tight">{person.name}</h1>
                {person.linkedinUrl ? (
                  <a
                    href={person.linkedinUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    aria-label="LinkedIn profile"
                    className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    <BriefcaseBusiness className="size-4" aria-hidden="true" />
                  </a>
                ) : null}
              </div>
              {person.title || person.company ? (
                <p className="text-sm">
                  {person.title ? <span>{person.title}</span> : null}
                  {person.title && person.company ? <span className="text-muted-foreground"> at </span> : null}
                  {person.company ? (
                    <Link
                      href={`/dashboard/companies/${person.company.id}`}
                      className="break-words underline underline-offset-4"
                    >
                      {person.company.name}
                    </Link>
                  ) : null}
                </p>
              ) : null}
              {location ? (
                <p className="flex items-center gap-1 text-muted-foreground text-sm">
                  <MapPin className="size-3.5" aria-hidden="true" />
                  {location}
                </p>
              ) : null}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <DropdownMenu>
              <Tooltip>
                <TooltipTrigger asChild>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="icon-sm" aria-label="More actions">
                      <Ellipsis aria-hidden="true" />
                    </Button>
                  </DropdownMenuTrigger>
                </TooltipTrigger>
                <TooltipContent>More actions</TooltipContent>
              </Tooltip>
              <DropdownMenuContent align="start">
                <DropdownMenuItem disabled={!person.email} onSelect={() => person.email && copy(person.email, "Email")}>
                  <Copy aria-hidden="true" />
                  Copy email
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={!person.linkedinUrl}
                  onSelect={() => person.linkedinUrl && copy(person.linkedinUrl, "LinkedIn link")}
                >
                  <Copy aria-hidden="true" />
                  Copy LinkedIn link
                </DropdownMenuItem>
                {permissions.delete ? (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem variant="destructive" onSelect={() => setDeleteOpen(true)}>
                      <Trash2 aria-hidden="true" />
                      Delete person
                    </DropdownMenuItem>
                  </>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
            {permissions.createTask ? (
              <IconAction label="Log a call (creates a call task)" onClick={createCallTask} disabled={calling}>
                <Phone aria-hidden="true" />
              </IconAction>
            ) : null}
            {emailHref ? (
              <IconAction label="Send email" href={emailHref}>
                <Mail aria-hidden="true" />
              </IconAction>
            ) : null}
            {permissions.createTask ? (
              <IconAction label="Create task" onClick={() => setTaskOpen(true)}>
                <CheckSquare aria-hidden="true" />
              </IconAction>
            ) : null}
            {permissions.update ? <PersonFormDialog person={person} members={members} companies={companies} /> : null}
            {permissions.addToList ? (
              <Button variant="outline" size="sm" onClick={() => setListOpen(true)}>
                <ListPlus data-icon="inline-start" aria-hidden="true" />
                Add to list
              </Button>
            ) : null}
            {permissions.enroll ? (
              <Button size="sm" onClick={() => setSequenceOpen(true)}>
                <Send data-icon="inline-start" aria-hidden="true" />
                Add to sequence
              </Button>
            ) : null}
            <EditLayoutMenu />
          </div>
        </div>
      </header>
      {permissions.createTask ? (
        <TaskDialog
          open={taskOpen}
          onOpenChange={setTaskOpen}
          contactId={person.id}
          companyId={person.companyId}
          personName={person.name}
        />
      ) : null}
      {permissions.addToList ? (
        <AddToListDialog
          open={listOpen}
          onOpenChange={setListOpen}
          entityType="contact"
          ids={[person.id]}
          canCreate={permissions.createList}
        />
      ) : null}
      {permissions.enroll ? (
        <AddToSequenceDialog open={sequenceOpen} onOpenChange={setSequenceOpen} contactIds={[person.id]} />
      ) : null}
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {person.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              They are removed from lists and sequences. Deals and tasks stay but lose the link. This can't be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel size="sm">Cancel</AlertDialogCancel>
            <Button variant="destructive" size="sm" disabled={deleting} onClick={remove}>
              <Trash2 data-icon="inline-start" aria-hidden="true" />
              {deleting ? "Deleting…" : "Delete"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </TooltipProvider>
  );
}
