"use client";

import { useEffect, useState } from "react";

import { Check, ChevronsUpDown, Plus, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { apiFetch } from "@/lib/api-fetch";

export interface PickedRecord {
  id: string;
  name: string;
  detail?: string | null;
}

interface Props {
  readonly id: string;
  readonly kind: "company" | "contact" | "deal";
  readonly value: PickedRecord | null;
  readonly onChange: (value: PickedRecord | null) => void;
  readonly placeholder: string;
  /** Offer "Create account" with the typed name (company:create). */
  readonly canCreate?: boolean;
  readonly disabled?: boolean;
}

/** Search-as-you-type picker for a company (account) or a person, with optional create. */
export function RecordPicker({ id, kind, value, onChange, placeholder, canCreate = false, disabled = false }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PickedRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(async () => {
      setLoading(true);
      const URLS = {
        company: "/api/v1/accounts/search",
        contact: "/api/v1/contacts/search",
        deal: "/api/v1/opportunities/search",
      } as const;
      const res = await apiFetch<{
        accounts?: { id: string; name: string; domain: string | null }[];
        contacts?: { id: string; name: string; email: string | null }[];
        opportunities?: { id: string; name: string; stageName: string }[];
      }>(URLS[kind], { method: "POST", body: { q: query.trim() || undefined, per_page: 8 } });
      setLoading(false);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setError(null);
      const rows: PickedRecord[] = [
        ...(res.data.accounts ?? []).map((a) => ({ id: a.id, name: a.name, detail: a.domain })),
        ...(res.data.contacts ?? []).map((c) => ({ id: c.id, name: c.name, detail: c.email })),
        ...(res.data.opportunities ?? []).map((d) => ({ id: d.id, name: d.name, detail: d.stageName })),
      ];
      setResults(rows);
    }, 200);
    return () => clearTimeout(timer);
  }, [open, query, kind]);

  async function create() {
    const name = query.trim();
    if (!name) return;
    setCreating(true);
    const res = await apiFetch<{ account: { id: string; name: string; domain: string | null } }>("/api/v1/accounts", {
      method: "POST",
      body: { name },
    });
    setCreating(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    onChange({ id: res.data.account.id, name: res.data.account.name, detail: res.data.account.domain });
    setOpen(false);
  }

  return (
    <div className="flex min-w-0 items-center gap-1">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            id={id}
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            disabled={disabled}
            className="h-8 min-w-0 flex-1 justify-between font-normal"
          >
            <span className={value ? "truncate" : "truncate text-muted-foreground"}>{value?.name ?? placeholder}</span>
            <ChevronsUpDown className="opacity-50" aria-hidden="true" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-(--radix-popover-trigger-width) min-w-64 p-0" align="start">
          <Command shouldFilter={false}>
            <CommandInput
              placeholder={{ company: "Search companies", contact: "Search people", deal: "Search deals" }[kind]}
              value={query}
              onValueChange={setQuery}
            />
            <CommandList>
              <CommandEmpty>{loading ? "Searching…" : (error ?? "Nothing found.")}</CommandEmpty>
              {results.length ? (
                <CommandGroup>
                  {results.map((r) => (
                    <CommandItem
                      key={r.id}
                      value={r.id}
                      onSelect={() => {
                        onChange(r);
                        setOpen(false);
                      }}
                    >
                      <Check className={value?.id === r.id ? "opacity-100" : "opacity-0"} aria-hidden="true" />
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate">{r.name}</span>
                        {r.detail ? (
                          <span className="truncate font-mono text-muted-foreground text-xs">{r.detail}</span>
                        ) : null}
                      </span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              ) : null}
              {kind === "company" && canCreate && query.trim() ? (
                <CommandGroup>
                  <CommandItem value="__create" onSelect={() => void create()} disabled={creating}>
                    <Plus aria-hidden="true" />
                    {creating ? "Creating…" : `Create account “${query.trim()}”`}
                  </CommandItem>
                </CommandGroup>
              ) : null}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {value && !disabled ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={`Clear ${kind}`}
          onClick={() => onChange(null)}
        >
          <X />
        </Button>
      ) : null}
    </div>
  );
}
