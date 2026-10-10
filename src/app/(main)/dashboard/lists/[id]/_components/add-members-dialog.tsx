"use client";

import { useEffect, useState } from "react";

import { useRouter } from "next/navigation";

import { Plus, Search } from "lucide-react";
import { toast } from "sonner";

import { Alert, AlertDescription } from "@/components/ui/alert";
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
  primary: string;
  secondary: string | null;
}

type CandidatesResponse =
  | {
      entityType: "contact";
      contacts: { id: string; name: string; email: string | null; companyName: string | null }[];
    }
  | { entityType: "company"; accounts: { id: string; name: string; domain: string | null; industry: string | null }[] };

function normalise(data: CandidatesResponse): Candidate[] {
  if (data.entityType === "contact") {
    return data.contacts.map((c) => ({
      id: c.id,
      primary: c.name,
      secondary: [c.email, c.companyName].filter(Boolean).join(" · ") || null,
    }));
  }
  return data.accounts.map((a) => ({
    id: a.id,
    primary: a.name,
    secondary: [a.domain, a.industry].filter(Boolean).join(" · ") || null,
  }));
}

/** Search records not yet in the list and add the selected ones. */
export function AddMembersDialog({ listId, entityType }: { listId: string; entityType: "contact" | "company" }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Candidate[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const noun = entityType === "contact" ? "people" : "companies";

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      setLoading(true);
      const result = await apiRequest<CandidatesResponse>(
        `/api/v1/labels/${listId}/candidates?q=${encodeURIComponent(query.trim())}`,
      );
      if (cancelled) return;
      setLoading(false);
      if (result.ok) {
        setResults(normalise(result.data));
        setError(null);
      } else setError(result.error);
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [open, query, listId]);

  function toggle(id: string, on: boolean) {
    setSelected((current) => {
      const next = new Set(current);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  async function add() {
    setSaving(true);
    const result = await apiRequest<{ added: number }>("/api/v1/labels/add_entity_ids", {
      body: { listId, entityIds: [...selected] },
    });
    setSaving(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    toast.success(`Added ${result.data.added} ${result.data.added === 1 ? "record" : "records"}.`);
    setOpen(false);
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
        }
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus data-icon="inline-start" aria-hidden="true" />
          Add {noun}
        </Button>
      </DialogTrigger>
      <DialogContent className="flex max-h-[90dvh] flex-col sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add {noun}</DialogTitle>
          <DialogDescription>Search your workspace and pick the {noun} to add to this list.</DialogDescription>
        </DialogHeader>
        <InputGroup>
          <InputGroupAddon align="inline-start">
            <Search className="size-3.5" aria-hidden="true" />
          </InputGroupAddon>
          <InputGroupInput
            type="search"
            aria-label={`Search ${noun}`}
            placeholder={entityType === "contact" ? "Name, email or title" : "Name or domain"}
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
            <li className="px-2 py-6 text-center text-muted-foreground text-sm">No matching {noun} to add.</li>
          ) : null}
          {results.map((r) => (
            <li key={r.id}>
              <label
                htmlFor={`pick-${r.id}`}
                className="flex cursor-pointer items-start gap-3 rounded-md px-2 py-2 hover:bg-muted"
              >
                <Checkbox
                  id={`pick-${r.id}`}
                  className="mt-0.5"
                  checked={selected.has(r.id)}
                  onCheckedChange={(v) => toggle(r.id, v === true)}
                />
                <span className="flex min-w-0 flex-col">
                  <span className="truncate font-medium text-sm">{r.primary}</span>
                  {r.secondary ? (
                    <span className="truncate font-mono text-muted-foreground text-xs">{r.secondary}</span>
                  ) : null}
                </span>
              </label>
            </li>
          ))}
        </ul>
        <DialogFooter>
          <Button type="button" variant="outline" size="sm" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button size="sm" disabled={selected.size === 0 || saving} onClick={add}>
            <Plus data-icon="inline-start" aria-hidden="true" />
            {saving
              ? "Adding…"
              : `Add ${selected.size || ""} ${selected.size === 1 ? "record" : "records"}`.replace("  ", " ")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
