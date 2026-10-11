"use client";

import { useState } from "react";

import Link from "next/link";

import { Bookmark, BookmarkPlus, Database, Info, ListPlus, Loader2, MailSearch, Send, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import type { SearchEntity } from "@/lib/search/filters";

import type { IndexActions } from "./index-actions";
import type { IndexPermissions } from "./index-results";

/** The shared index has nothing yet: say where it comes from and who can fill it. */
export function IndexEmptyState({
  entity,
  isPlatformAdmin,
  onShowSaved,
}: {
  entity: SearchEntity;
  isPlatformAdmin: boolean;
  onShowSaved: () => void;
}) {
  const noun = entity === "contact" ? "people" : "companies";
  return (
    <Empty className="m-4 border" data-testid="index-empty">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Database aria-hidden="true" />
        </EmptyMedia>
        <EmptyTitle>The shared database has no {noun} yet</EmptyTitle>
        <EmptyDescription>
          The crawler builds it from public sources such as company websites, open data and job boards.{" "}
          {isPlatformAdmin
            ? "Add domains or turn on sources to start collecting."
            : "Ask your administrator to turn on data sources."}
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent className="flex-row flex-wrap justify-center">
        {isPlatformAdmin ? (
          <Button asChild size="sm">
            <Link href="/dashboard/platform/data?tab=sources">
              <Database data-icon="inline-start" aria-hidden="true" />
              Manage data sources
            </Link>
          </Button>
        ) : null}
        <Button type="button" variant="outline" size="sm" onClick={onShowSaved}>
          <BookmarkPlus data-icon="inline-start" aria-hidden="true" />
          Show saved {noun}
        </Button>
      </EmptyContent>
    </Empty>
  );
}

/** Filters that only apply to the workspace's own records, listed instead of silently ignored. */
export function IgnoredFiltersNotice({ labels, onShowSaved }: { labels: string[]; onShowSaved: () => void }) {
  if (!labels.length) return null;
  return (
    <div
      role="note"
      className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b bg-muted/40 px-3 py-2 text-muted-foreground text-xs"
    >
      <Info className="size-3.5 shrink-0" aria-hidden="true" />
      <span className="min-w-0 flex-1">
        Not applied to the shared database: <span className="text-foreground">{labels.join(", ")}</span>. They apply to
        your saved records.
      </span>
      <Button type="button" variant="ghost" size="sm" onClick={onShowSaved}>
        <Bookmark data-icon="inline-start" aria-hidden="true" />
        Show saved
      </Button>
    </div>
  );
}

/** Bulk actions for selected index rows: save, access emails, and save-then-add to a list or sequence. */
export function IndexBulkBar({
  entity,
  ids,
  actions,
  permissions,
  canAddToList,
  canAddToSequence,
  onClear,
  onAddToList,
  onAddToSequence,
}: {
  entity: SearchEntity;
  ids: string[];
  actions: IndexActions;
  permissions: IndexPermissions;
  canAddToList: boolean;
  canAddToSequence: boolean;
  onClear: () => void;
  onAddToList: (workspaceIds: string[]) => void;
  onAddToSequence: (workspaceIds: string[]) => void;
}) {
  const [pending, setPending] = useState<string | null>(null);
  const count = ids.length;
  const noun = entity === "contact" ? (count === 1 ? "person" : "people") : count === 1 ? "company" : "companies";

  async function run(kind: string, fn: () => Promise<void>) {
    setPending(kind);
    try {
      await fn();
    } finally {
      setPending(null);
    }
  }

  const saveThen = (then?: (workspaceIds: string[]) => void) =>
    run(then ? "save-then" : "save", async () => {
      const saved = await actions.save(entity, ids);
      if (saved && then && saved.length) then(saved);
      if (saved) onClear();
    });

  const accessAll = () =>
    run("access", async () => {
      const todo = ids.filter((id) => !actions.revealed[id]).slice(0, 25);
      if (ids.length > 25) toast.info("Access email runs on 25 people at a time.");
      for (const id of todo) {
        const result = await actions.accessEmail(id);
        if (!result) break;
      }
    });

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
      {permissions.save ? (
        <Button type="button" size="sm" disabled={pending !== null} onClick={() => void saveThen()}>
          {pending === "save" ? (
            <Loader2 data-icon="inline-start" className="animate-spin" aria-hidden="true" />
          ) : (
            <BookmarkPlus data-icon="inline-start" aria-hidden="true" />
          )}
          {pending === "save" ? "Saving…" : `Save ${count.toLocaleString("en-US")} ${noun}`}
        </Button>
      ) : null}
      {entity === "contact" && permissions.accessEmail ? (
        <Button type="button" variant="outline" size="sm" disabled={pending !== null} onClick={() => void accessAll()}>
          {pending === "access" ? (
            <Loader2 data-icon="inline-start" className="animate-spin" aria-hidden="true" />
          ) : (
            <MailSearch data-icon="inline-start" aria-hidden="true" />
          )}
          {pending === "access" ? "Finding…" : "Access emails"}
        </Button>
      ) : null}
      {permissions.save && canAddToList ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={pending !== null}
          onClick={() => void saveThen(onAddToList)}
        >
          <ListPlus data-icon="inline-start" aria-hidden="true" />
          Save and add to list
        </Button>
      ) : null}
      {entity === "contact" && permissions.save && canAddToSequence ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={pending !== null}
          onClick={() => void saveThen(onAddToSequence)}
        >
          <Send data-icon="inline-start" aria-hidden="true" />
          Save and add to sequence
        </Button>
      ) : null}
    </div>
  );
}
