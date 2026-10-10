"use client";

import { useEffect, useState } from "react";

import { useRouter } from "next/navigation";

import { Search, UserPlus } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Spinner } from "@/components/ui/spinner";

import { apiRequest } from "../../../_components/records/api-client";

interface Candidate {
  id: string;
  name: string;
  email: string | null;
  companyName: string | null;
}

interface EnrollResponse {
  enrolled_contact_ids: string[];
  skipped: { contactId: string; reason: string; message: string }[];
}

/** Search contacts not yet in the sequence, enroll the selected ones and show what was skipped and why. */
export function AddPeopleDialog({ sequenceId }: { sequenceId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Candidate[]>([]);
  const [names, setNames] = useState<Map<string, string>>(new Map());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<EnrollResponse | null>(null);

  useEffect(() => {
    if (!open || report) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      setLoading(true);
      const result = await apiRequest<{ contacts: Candidate[] }>(
        `/api/v1/emailer_campaigns/${sequenceId}/candidates?q=${encodeURIComponent(query.trim())}`,
      );
      if (cancelled) return;
      setLoading(false);
      if (result.ok) {
        setResults(result.data.contacts);
        setNames((m) => new Map([...m, ...result.data.contacts.map((c) => [c.id, c.name] as const)]));
        setError(null);
      } else setError(result.error);
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [open, query, sequenceId, report]);

  function toggle(id: string, on: boolean) {
    setSelected((current) => {
      const next = new Set(current);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  async function enroll() {
    setSaving(true);
    const result = await apiRequest<EnrollResponse>(`/api/v1/emailer_campaigns/${sequenceId}/add_contact_ids`, {
      body: { contactIds: [...selected] },
    });
    setSaving(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setReport(result.data);
    setSelected(new Set());
    router.refresh();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setQuery("");
          setSelected(new Set());
          setError(null);
          setReport(null);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm">
          <UserPlus data-icon="inline-start" aria-hidden="true" />
          Add people
        </Button>
      </DialogTrigger>
      <DialogContent className="flex max-h-[90dvh] flex-col sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add people</DialogTitle>
          <DialogDescription>
            People on the do-not-contact list, with invalid or disposable emails, or marked do not contact are skipped.
          </DialogDescription>
        </DialogHeader>
        {report ? (
          <div className="flex min-h-0 flex-col gap-3 overflow-y-auto">
            <Alert>
              <AlertTitle>
                Enrolled <span className="font-mono tabular-nums">{report.enrolled_contact_ids.length}</span>
                {report.skipped.length ? (
                  <>
                    , skipped <span className="font-mono tabular-nums">{report.skipped.length}</span>
                  </>
                ) : null}
              </AlertTitle>
              <AlertDescription>
                {report.enrolled_contact_ids.length
                  ? "They start on step one at the next run inside the mailbox's sending window."
                  : "Nobody new was enrolled."}
              </AlertDescription>
            </Alert>
            {report.skipped.length ? (
              <ul className="flex flex-col divide-y rounded-lg border" aria-label="Skipped people">
                {report.skipped.map((s) => (
                  <li
                    key={s.contactId}
                    className="flex flex-col gap-0.5 px-3 py-2 sm:flex-row sm:justify-between sm:gap-3"
                  >
                    <span className="truncate font-medium text-sm">{names.get(s.contactId) ?? s.contactId}</span>
                    <span className="text-muted-foreground text-xs">{s.message}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : (
          <>
            <InputGroup>
              <InputGroupAddon align="inline-start">
                <Search className="size-3.5" aria-hidden="true" />
              </InputGroupAddon>
              <InputGroupInput
                type="search"
                aria-label="Search people"
                placeholder="Name, email or title"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                autoFocus
              />
              {loading ? (
                <InputGroupAddon align="inline-end">
                  <Spinner aria-label="Searching" />
                </InputGroupAddon>
              ) : null}
            </InputGroup>
            {error ? (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}
            <ul className="-mx-1 flex min-h-24 flex-col gap-0.5 overflow-y-auto" aria-label="Search results">
              {results.length === 0 && !loading ? (
                <li className="px-2 py-6 text-center text-muted-foreground text-sm">No matching people to add.</li>
              ) : null}
              {results.map((c) => (
                <li key={c.id}>
                  <label
                    htmlFor={`pick-${c.id}`}
                    className="flex cursor-pointer items-start gap-3 rounded-md px-2 py-2 hover:bg-muted"
                  >
                    <Checkbox
                      id={`pick-${c.id}`}
                      className="mt-0.5"
                      checked={selected.has(c.id)}
                      onCheckedChange={(v) => toggle(c.id, v === true)}
                    />
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate font-medium text-sm">{c.name}</span>
                      <span className="truncate font-mono text-muted-foreground text-xs">
                        {[c.email ?? "No email", c.companyName].filter(Boolean).join(" · ")}
                      </span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" size="sm" onClick={() => setOpen(false)}>
            {report ? "Done" : "Cancel"}
          </Button>
          {report ? null : (
            <Button size="sm" disabled={selected.size === 0 || saving} onClick={enroll}>
              <UserPlus data-icon="inline-start" aria-hidden="true" />
              {saving ? "Adding…" : `Add ${selected.size} ${selected.size === 1 ? "person" : "people"}`}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
