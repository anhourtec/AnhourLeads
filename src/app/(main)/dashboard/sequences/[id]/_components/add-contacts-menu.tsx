"use client";

import { useEffect, useState } from "react";

import { useRouter } from "next/navigation";

import { ChevronDown, Hash, List, Search, UserPlus } from "lucide-react";

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
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";

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

type Mode = "search" | "list" | "ids";

/** "Add contacts ▾": from a search, from a contact list, or by pasting ids; then a report of who was skipped. */
export function AddContactsMenu({
  sequenceId,
  lists,
}: {
  sequenceId: string;
  lists: { id: string; name: string; memberCount: number }[];
}) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode | null>(null);
  const [report, setReport] = useState<EnrollResponse | null>(null);
  const [names, setNames] = useState<Map<string, string>>(new Map());

  function done(result: EnrollResponse, known: Map<string, string>) {
    setNames(known);
    setMode(null);
    setReport(result);
    router.refresh();
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm">
            <UserPlus data-icon="inline-start" aria-hidden="true" />
            Add contacts
            <ChevronDown data-icon="inline-end" aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuItem onSelect={() => setMode("search")}>
            <Search aria-hidden="true" />
            From search
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setMode("list")}>
            <List aria-hidden="true" />
            From a list
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setMode("ids")}>
            <Hash aria-hidden="true" />
            By contact ids
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <SearchDialog sequenceId={sequenceId} open={mode === "search"} onClose={() => setMode(null)} onDone={done} />
      <ListDialog
        sequenceId={sequenceId}
        lists={lists}
        open={mode === "list"}
        onClose={() => setMode(null)}
        onDone={done}
      />
      <IdsDialog sequenceId={sequenceId} open={mode === "ids"} onClose={() => setMode(null)} onDone={done} />
      <SkipReport report={report} names={names} onClose={() => setReport(null)} />
    </>
  );
}

type DoneFn = (result: EnrollResponse, names: Map<string, string>) => void;

function SearchDialog({
  sequenceId,
  open,
  onClose,
  onDone,
}: {
  sequenceId: string;
  open: boolean;
  onClose: () => void;
  onDone: DoneFn;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Candidate[]>([]);
  const [names, setNames] = useState<Map<string, string>>(new Map());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setSelected(new Set());
      setError(null);
      return;
    }
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
  }, [open, query, sequenceId]);

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
    onDone(result.data, names);
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="flex max-h-[90dvh] flex-col sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add contacts from search</DialogTitle>
          <DialogDescription>
            People on the do-not-contact list, with invalid or disposable emails, or marked do not contact are skipped.
          </DialogDescription>
        </DialogHeader>
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
                  onCheckedChange={(v) =>
                    setSelected((current) => {
                      const next = new Set(current);
                      if (v === true) next.add(c.id);
                      else next.delete(c.id);
                      return next;
                    })
                  }
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
        <DialogFooter>
          <Button type="button" variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" disabled={selected.size === 0 || saving} onClick={enroll}>
            <UserPlus data-icon="inline-start" aria-hidden="true" />
            {saving ? "Adding…" : `Add ${selected.size} ${selected.size === 1 ? "person" : "people"}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ListDialog({
  sequenceId,
  lists,
  open,
  onClose,
  onDone,
}: {
  sequenceId: string;
  lists: { id: string; name: string; memberCount: number }[];
  open: boolean;
  onClose: () => void;
  onDone: DoneFn;
}) {
  const [listId, setListId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function enroll() {
    setSaving(true);
    setError(null);
    const result = await apiRequest<EnrollResponse>(`/api/v1/emailer_campaigns/${sequenceId}/add_list`, {
      body: { listId },
    });
    setSaving(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onDone(result.data, new Map());
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add contacts from a list</DialogTitle>
          <DialogDescription>Everyone in the list who can be emailed is added, up to 1,000 people.</DialogDescription>
        </DialogHeader>
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        <Field className="gap-1.5">
          <FieldLabel htmlFor="add-list">List</FieldLabel>
          <NativeSelect id="add-list" className="w-full" value={listId} onChange={(e) => setListId(e.target.value)}>
            <NativeSelectOption value="">Choose a list</NativeSelectOption>
            {lists.map((l) => (
              <NativeSelectOption key={l.id} value={l.id}>
                {l.name} ({l.memberCount.toLocaleString("en-US")})
              </NativeSelectOption>
            ))}
          </NativeSelect>
          {lists.length === 0 ? (
            <FieldDescription className="text-xs">There are no contact lists in this workspace yet.</FieldDescription>
          ) : null}
        </Field>
        <DialogFooter>
          <Button type="button" variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" disabled={!listId || saving} onClick={enroll}>
            <UserPlus data-icon="inline-start" aria-hidden="true" />
            {saving ? "Adding…" : "Add list"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function IdsDialog({
  sequenceId,
  open,
  onClose,
  onDone,
}: {
  sequenceId: string;
  open: boolean;
  onClose: () => void;
  onDone: DoneFn;
}) {
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ids = [...new Set(text.split(/[\s,;]+/).filter(Boolean))];

  async function enroll() {
    setSaving(true);
    setError(null);
    const result = await apiRequest<EnrollResponse>(`/api/v1/emailer_campaigns/${sequenceId}/add_contact_ids`, {
      body: { contactIds: ids },
    });
    setSaving(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setText("");
    onDone(result.data, new Map());
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add contacts by id</DialogTitle>
          <DialogDescription>Paste contact ids separated by commas, spaces or new lines.</DialogDescription>
        </DialogHeader>
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        <Field className="gap-1.5">
          <FieldLabel htmlFor="add-ids">Contact ids</FieldLabel>
          <Textarea
            id="add-ids"
            rows={5}
            className="font-mono text-xs"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        </Field>
        <DialogFooter>
          <Button type="button" variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" disabled={!ids.length || ids.length > 1000 || saving} onClick={enroll}>
            <UserPlus data-icon="inline-start" aria-hidden="true" />
            {saving ? "Adding…" : `Add ${ids.length}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SkipReport({
  report,
  names,
  onClose,
}: {
  report: EnrollResponse | null;
  names: Map<string, string>;
  onClose: () => void;
}) {
  return (
    <Dialog open={report !== null} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="flex max-h-[90dvh] flex-col sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Contacts added</DialogTitle>
          <DialogDescription>
            New contacts start on the first step at the next run inside the schedule.
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
                {report.enrolled_contact_ids.length ? "They're now in the sequence." : "Nobody new was enrolled."}
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
        ) : null}
        <DialogFooter>
          <Button type="button" size="sm" variant="outline" onClick={onClose}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
