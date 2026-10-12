"use client";

import { useEffect, useState } from "react";

import { Building2, ChevronsUpDown, User, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

import { apiRequest } from "../records/api-client";

export interface Association {
  kind: "contact" | "company";
  id: string;
  name: string;
  detail: string | null;
  companyId: string | null;
}

/**
 * Search contacts and companies (GET /api/v1/tasks/associations) and pick one. `kinds` limits the
 * results, e.g. contacts only for the email composer.
 */
export function AssociationPicker({
  id,
  value,
  onChange,
  kinds = ["contact", "company"],
  placeholder = "Select…",
  disabled,
  invalid,
}: {
  id: string;
  value: Association | null;
  onChange: (value: Association | null) => void;
  kinds?: Association["kind"][];
  placeholder?: string;
  disabled?: boolean;
  invalid?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [items, setItems] = useState<Association[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const kindKey = kinds.join(",");

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      void apiRequest<{ associations: Association[] }>(`/api/v1/tasks/associations?q=${encodeURIComponent(q)}`).then(
        (res) => {
          if (cancelled) return;
          if (res.ok) {
            setItems(res.data.associations.filter((a) => kindKey.split(",").includes(a.kind)));
            setError(null);
          } else setError(res.error);
        },
      );
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [open, q, kindKey]);

  const contacts = items?.filter((i) => i.kind === "contact") ?? [];
  const companies = items?.filter((i) => i.kind === "company") ?? [];
  const Icon = value?.kind === "company" ? Building2 : User;

  return (
    <div className="flex items-center gap-1">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            id={id}
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            aria-invalid={invalid}
            disabled={disabled}
            className="h-9 min-w-0 flex-1 justify-between font-normal"
          >
            {value ? (
              <span className="flex min-w-0 items-center gap-2">
                <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="truncate">{value.name}</span>
              </span>
            ) : (
              <span className="text-muted-foreground">{placeholder}</span>
            )}
            <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-(--radix-popover-trigger-width) min-w-72 p-0" align="start">
          <Command shouldFilter={false}>
            <CommandInput
              placeholder={kinds.length === 1 ? "Search contacts" : "Search contacts and companies"}
              value={q}
              onValueChange={setQ}
            />
            <CommandList>
              <CommandEmpty>{error ?? (items === null ? "Searching…" : "No matches.")}</CommandEmpty>
              {contacts.length ? (
                <CommandGroup heading="Contacts">
                  {contacts.map((a) => (
                    <CommandItem
                      key={a.id}
                      value={a.id}
                      onSelect={() => {
                        onChange(a);
                        setOpen(false);
                      }}
                    >
                      <User className="text-muted-foreground" aria-hidden="true" />
                      <div className="flex min-w-0 flex-col">
                        <span className="truncate">{a.name}</span>
                        {a.detail ? <span className="truncate text-muted-foreground text-xs">{a.detail}</span> : null}
                      </div>
                    </CommandItem>
                  ))}
                </CommandGroup>
              ) : null}
              {companies.length ? (
                <CommandGroup heading="Companies">
                  {companies.map((a) => (
                    <CommandItem
                      key={a.id}
                      value={a.id}
                      onSelect={() => {
                        onChange(a);
                        setOpen(false);
                      }}
                    >
                      <Building2 className="text-muted-foreground" aria-hidden="true" />
                      <div className="flex min-w-0 flex-col">
                        <span className="truncate">{a.name}</span>
                        {a.detail ? (
                          <span className="truncate font-mono text-muted-foreground text-xs">{a.detail}</span>
                        ) : null}
                      </div>
                    </CommandItem>
                  ))}
                </CommandGroup>
              ) : null}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {value && !disabled ? (
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          aria-label="Clear selection"
          onClick={() => onChange(null)}
        >
          <X aria-hidden="true" />
        </Button>
      ) : null}
    </div>
  );
}
