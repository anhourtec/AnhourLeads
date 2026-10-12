"use client";

import { useCallback, useState } from "react";

import { useRouter } from "next/navigation";

import { toast } from "sonner";

import type { SearchEntity } from "@/lib/search/filters";

import { apiRequest } from "../api-client";

/** Save to the workspace and "Access email" for discovery index rows (Find people / Find companies). */

interface SaveOutcome {
  saved: { indexId: string; id: string }[];
  existing: { indexId: string; id: string }[];
  skipped: { indexId: string; reason: "not_found" | "opted_out" | "suppressed" | "gone" }[];
}

interface AccessEmailResult {
  contactId: string;
  created: boolean;
  person: { email: string | null; emailStatus: string | null };
}

export interface RevealedEmail {
  contactId: string;
  email: string | null;
  status: string | null;
}

const SKIP_REASONS: Record<SaveOutcome["skipped"][number]["reason"], string> = {
  not_found: "no longer listed",
  opted_out: "no longer listed",
  suppressed: "on your do-not-contact list",
  gone: "no longer listed by their company",
};

function plural(n: number, one: string, many: string) {
  return `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
}

/** "Saved 2 people. 1 was already saved. 1 skipped (on your do-not-contact list)." */
export function saveSummary(entity: SearchEntity, out: SaveOutcome): string {
  const [one, many] = entity === "contact" ? ["person", "people"] : ["company", "companies"];
  const parts: string[] = [];
  if (out.saved.length) parts.push(`Saved ${plural(out.saved.length, one, many)}.`);
  if (out.existing.length)
    parts.push(
      `${plural(out.existing.length, one, many)} ${out.existing.length === 1 ? "was" : "were"} already saved.`,
    );
  if (out.skipped.length) {
    const reasons = [...new Set(out.skipped.map((s) => SKIP_REASONS[s.reason]))].join(", ");
    parts.push(`${out.skipped.length.toLocaleString("en-US")} skipped (${reasons}).`);
  }
  return parts.join(" ") || "Nothing to save.";
}

export function useIndexActions() {
  const router = useRouter();
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [revealed, setRevealed] = useState<Record<string, RevealedEmail>>({});
  /** Workspace record ids saved during this visit (index id → workspace id), shown before the refresh lands. */
  const [savedNow, setSavedNow] = useState<Record<string, string>>({});

  const mark = useCallback((ids: string[], on: boolean) => {
    setBusy((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }, []);

  const save = useCallback(
    /** Saves the index rows; resolves to the workspace record ids (new and existing), or null on failure. */
    async (entity: SearchEntity, ids: string[]): Promise<string[] | null> => {
      if (!ids.length) return [];
      mark(ids, true);
      const path = entity === "contact" ? "/api/v1/index/people/save" : "/api/v1/index/companies/save";
      let ok = true;
      const total: SaveOutcome = { saved: [], existing: [], skipped: [] };
      for (let i = 0; i < ids.length; i += 100) {
        const res = await apiRequest<SaveOutcome>(path, { body: { ids: ids.slice(i, i + 100) } });
        if (!res.ok) {
          toast.error(res.error);
          ok = false;
          break;
        }
        total.saved.push(...res.data.saved);
        total.existing.push(...res.data.existing);
        total.skipped.push(...res.data.skipped);
      }
      mark(ids, false);
      if (!ok) return null;
      if (total.saved.length || total.existing.length || total.skipped.length) {
        setSavedNow((prev) => ({
          ...prev,
          ...Object.fromEntries([...total.saved, ...total.existing].map((s) => [s.indexId, s.id])),
        }));
        (total.saved.length || total.existing.length ? toast.success : toast.info)(saveSummary(entity, total));
        router.refresh();
      }
      return [...total.saved, ...total.existing].map((s) => s.id);
    },
    [mark, router],
  );

  const accessEmail = useCallback(
    async (indexPersonId: string): Promise<RevealedEmail | null> => {
      mark([indexPersonId], true);
      const res = await apiRequest<AccessEmailResult>("/api/v1/index/people/access_email", {
        body: { id: indexPersonId },
      });
      mark([indexPersonId], false);
      if (!res.ok) {
        toast.error(res.error);
        return null;
      }
      const result: RevealedEmail = {
        contactId: res.data.contactId,
        email: res.data.person.email,
        status: res.data.person.emailStatus,
      };
      setRevealed((prev) => ({ ...prev, [indexPersonId]: result }));
      setSavedNow((prev) => ({ ...prev, [indexPersonId]: res.data.contactId }));
      if (result.email) toast.success(`Email found: ${result.email}`);
      else toast.info("No email found for this person. They're saved, so you can try again later.");
      router.refresh();
      return result;
    },
    [mark, router],
  );

  return { save, accessEmail, busy, revealed, savedNow };
}

export type IndexActions = ReturnType<typeof useIndexActions>;
