"use client";

import { useEffect, useState } from "react";

import { Braces, FileText, Scissors } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { MERGE_FIELDS } from "@/lib/engage-constants";

import { apiRequest } from "../records/api-client";

/**
 * Shared "Insert snippet", "Insert template" and "Merge field" pickers for the sequence editor, the
 * email composer and the task form. Each loads its list when opened and hands the choice back.
 */

interface SnippetOption {
  id: string;
  name: string;
  body: string;
}

interface TemplateOption {
  id: string;
  name: string;
  subject: string | null;
  body: string;
}

function useLoadOnOpen<T>(open: boolean, path: string, key: string) {
  const [items, setItems] = useState<T[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open || items) return;
    let cancelled = false;
    void apiRequest<Record<string, T[]>>(path).then((res) => {
      if (cancelled) return;
      if (res.ok) setItems(res.data[key] ?? []);
      else setError(res.error);
    });
    return () => {
      cancelled = true;
    };
  }, [open, items, path, key]);
  return { items, error };
}

export function SnippetPicker({
  onPick,
  disabled,
  label = "Add snippet",
}: {
  onPick: (body: string) => void;
  disabled?: boolean;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const { items, error } = useLoadOnOpen<SnippetOption>(open, "/api/v1/snippets", "snippets");
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" size="sm" variant="outline" disabled={disabled}>
          <Scissors data-icon="inline-start" aria-hidden="true" />
          {label}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="start">
        <Command>
          <CommandInput placeholder="Search snippets" />
          <CommandList>
            <CommandEmpty>
              {error ?? (items === null ? "Loading…" : "No snippets yet. Add them in Settings, Snippets & templates.")}
            </CommandEmpty>
            {items?.length ? (
              <CommandGroup heading="Snippets">
                {items.map((s) => (
                  <CommandItem
                    key={s.id}
                    value={`${s.name} ${s.id}`}
                    onSelect={() => {
                      onPick(s.body);
                      setOpen(false);
                    }}
                  >
                    <div className="flex min-w-0 flex-col">
                      <span className="truncate">{s.name}</span>
                      <span className="truncate text-muted-foreground text-xs">{s.body}</span>
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

export function TemplatePicker({
  onPick,
  disabled,
}: {
  onPick: (template: { subject: string | null; body: string }) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const { items, error } = useLoadOnOpen<TemplateOption>(open, "/api/v1/email_templates", "email_templates");
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" size="sm" variant="outline" disabled={disabled}>
          <FileText data-icon="inline-start" aria-hidden="true" />
          Insert template
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="start">
        <Command>
          <CommandInput placeholder="Search templates" />
          <CommandList>
            <CommandEmpty>
              {error ?? (items === null ? "Loading…" : "No templates yet. Add them in Settings, Snippets & templates.")}
            </CommandEmpty>
            {items?.length ? (
              <CommandGroup heading="Templates">
                {items.map((t) => (
                  <CommandItem
                    key={t.id}
                    value={`${t.name} ${t.id}`}
                    onSelect={() => {
                      onPick({ subject: t.subject, body: t.body });
                      setOpen(false);
                    }}
                  >
                    <div className="flex min-w-0 flex-col">
                      <span className="truncate">{t.name}</span>
                      <span className="truncate text-muted-foreground text-xs">{t.subject ?? "No subject"}</span>
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

export function MergeFieldPicker({ onPick, disabled }: { onPick: (token: string) => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" size="sm" variant="outline" disabled={disabled}>
          <Braces data-icon="inline-start" aria-hidden="true" />
          Merge field
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-0" align="start">
        <Command>
          <CommandInput placeholder="Search fields" />
          <CommandList>
            <CommandEmpty>No matching field.</CommandEmpty>
            <CommandGroup heading="Contact and company">
              {MERGE_FIELDS.map(([key, label]) => (
                <CommandItem
                  key={key}
                  value={`${label} ${key}`}
                  onSelect={() => {
                    onPick(`{{${key}}}`);
                    setOpen(false);
                  }}
                >
                  <span className="flex-1">{label}</span>
                  <span className="font-mono text-muted-foreground text-xs">{`{{${key}}}`}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/** Insert `text` into a textarea/input value at the caret (or at the end), returning the new value. */
export function insertAtCursor(
  element: HTMLTextAreaElement | HTMLInputElement | null,
  value: string,
  text: string,
): { value: string; caret: number } {
  const start = element?.selectionStart ?? value.length;
  const end = element?.selectionEnd ?? value.length;
  const next = `${value.slice(0, start)}${text}${value.slice(end)}`;
  return { value: next, caret: start + text.length };
}
