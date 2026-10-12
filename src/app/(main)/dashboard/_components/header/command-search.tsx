"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { usePathname, useRouter } from "next/navigation";

import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  Building2,
  Clock,
  CornerDownLeft,
  ListPlus,
  Search,
  Send,
  Settings,
  Sparkles,
  Users,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { Kbd } from "@/components/ui/kbd";
import { Skeleton } from "@/components/ui/skeleton";
import { can, type Role } from "@/lib/rbac/permissions";
import {
  COMPANY_STAGE_LABELS,
  CONTACT_STAGE_LABELS,
  type CompanyStage,
  type ContactStage,
} from "@/lib/records-vocabulary";
import { getInitials } from "@/lib/utils";

interface SearchResults {
  people: { id: string; name: string; title: string | null; company: string | null; stage: string }[];
  companies: { id: string; name: string; employeeCount: number | null; industry: string | null; stage: string }[];
  settings: { id: string; title: string; section: string; url: string }[];
}

interface RecentPage {
  path: string;
  title: string;
}

const RECENT_KEY = "recent_pages";
const RECENT_LIMIT = 5;

function readRecent(): RecentPage[] {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(RECENT_KEY) ?? "[]");
    return Array.isArray(parsed)
      ? parsed.filter(
          (p): p is RecentPage => typeof p?.path === "string" && typeof p?.title === "string" && p.path.startsWith("/"),
        )
      : [];
  } catch {
    return [];
  }
}

/** Remembers the last few pages visited (per browser), for the palette's "Recent pages". */
function useRecordRecentPage(path: string) {
  useEffect(() => {
    if (!path.startsWith("/dashboard")) return;
    // The page title updates after navigation renders.
    const timer = window.setTimeout(() => {
      const title = document.title.split(" · ")[0]?.trim();
      if (!title) return;
      try {
        const next = [{ path, title }, ...readRecent().filter((p) => p.path !== path)].slice(0, RECENT_LIMIT);
        window.localStorage.setItem(RECENT_KEY, JSON.stringify(next));
      } catch {
        // Storage can be unavailable (private mode); recent pages are a convenience.
      }
    }, 400);
    return () => window.clearTimeout(timer);
  }, [path]);
}

function stageLabel(kind: "contact" | "company", stage: string): string {
  if (kind === "contact") return CONTACT_STAGE_LABELS[stage as ContactStage] ?? stage;
  return COMPANY_STAGE_LABELS[stage as CompanyStage] ?? stage;
}

const SUGGESTIONS = [
  {
    id: "audience",
    label: "Build your target audience",
    href: "/dashboard/people",
    icon: Users,
    permission: "contact:read",
  },
  {
    id: "sequence",
    label: "Craft an outbound sequence",
    href: "/dashboard/sequences/new?ai=1",
    icon: Send,
    permission: "sequence:create",
  },
  {
    id: "enrich",
    label: "Enrich your data",
    href: "/dashboard/enrichment",
    icon: ListPlus,
    permission: "enrich:run",
  },
] as const;

/** The top bar's "Search or ask a question" box and its ⌘K command palette. */
export function CommandSearch({ role }: { readonly role: Role | null }) {
  const router = useRouter();
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResults | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [recent, setRecent] = useState<RecentPage[]>([]);
  const requestId = useRef(0);

  useRecordRecentPage(path);

  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setOpen((prev) => !prev);
      }
    };
    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, []);

  useEffect(() => {
    if (open) setRecent(readRecent());
  }, [open]);

  const trimmed = query.trim();
  useEffect(() => {
    if (!trimmed) {
      setResults(null);
      setLoading(false);
      setFailed(false);
      return;
    }
    const id = ++requestId.current;
    setLoading(true);
    const timer = window.setTimeout(async () => {
      try {
        const res = await fetch(`/api/v1/search?q=${encodeURIComponent(trimmed)}`);
        if (id !== requestId.current) return;
        if (!res.ok) throw new Error(String(res.status));
        setResults((await res.json()) as SearchResults);
        setFailed(false);
      } catch {
        if (id === requestId.current) {
          setResults(null);
          setFailed(true);
        }
      } finally {
        if (id === requestId.current) setLoading(false);
      }
    }, 200);
    return () => window.clearTimeout(timer);
  }, [trimmed]);

  const onOpenChange = useCallback((value: boolean) => {
    setOpen(value);
    if (!value) setQuery("");
  }, []);

  const go = (href: string) => {
    onOpenChange(false);
    router.push(href);
  };

  const suggestions = SUGGESTIONS.filter((s) => can(role, s.permission));
  let view: "idle" | "loading" | "error" | "results" = "results";
  if (!trimmed) view = "idle";
  else if (loading && !results) view = "loading";
  else if (failed) view = "error";
  const hasResults = Boolean(results && (results.people.length || results.companies.length || results.settings.length));

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex h-9 w-full min-w-0 max-w-xl items-center gap-2 rounded-md border bg-background px-3 text-left text-muted-foreground text-sm shadow-xs outline-none transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring"
        aria-label="Search or ask a question"
        aria-keyshortcuts="Meta+K Control+K"
      >
        <Search className="size-4 shrink-0" aria-hidden="true" />
        <span className="truncate">
          <span className="sm:hidden">Search</span>
          <span className="hidden sm:inline">Search or ask a question</span>
        </span>
        <span className="ml-auto hidden items-center gap-1 sm:flex" aria-hidden="true">
          <Kbd>⌘</Kbd>
          <Kbd>K</Kbd>
        </span>
      </button>
      <CommandDialog
        open={open}
        onOpenChange={onOpenChange}
        title="Search"
        description="Search people, companies and settings, or jump to a page."
        className="top-2 sm:top-3 sm:max-w-xl"
      >
        <Command shouldFilter={false} className="rounded-none!">
          <CommandInput placeholder="Search or ask a question" value={query} onValueChange={setQuery} />
          <CommandList className="max-h-[min(28rem,60dvh)]">
            {view === "idle" ? (
              <>
                {suggestions.length ? (
                  <CommandGroup heading="Suggestions">
                    {suggestions.map((s) => (
                      <CommandItem key={s.id} value={`suggestion-${s.id}`} onSelect={() => go(s.href)}>
                        <Sparkles aria-hidden="true" />
                        <span className="truncate">{s.label}</span>
                        <ArrowRight className="ml-auto text-muted-foreground" aria-hidden="true" />
                      </CommandItem>
                    ))}
                  </CommandGroup>
                ) : null}
                {recent.length ? (
                  <>
                    <CommandSeparator />
                    <CommandGroup heading="Recent pages">
                      {recent.map((p) => (
                        <CommandItem key={p.path} value={`recent-${p.path}`} onSelect={() => go(p.path)}>
                          <Clock aria-hidden="true" />
                          <span className="truncate">{p.title}</span>
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </>
                ) : null}
              </>
            ) : null}
            {view === "loading" ? (
              <div className="flex flex-col gap-3 p-3" role="status" aria-busy="true" aria-label="Searching">
                <Skeleton className="h-3 w-20" />
                {[0, 1, 2].map((i) => (
                  <div key={i} className="flex items-center gap-3">
                    <Skeleton className="size-5 rounded-full" />
                    <Skeleton className="h-3 flex-1" />
                  </div>
                ))}
              </div>
            ) : null}
            {view === "error" ? (
              <p className="px-3 py-6 text-center text-muted-foreground text-sm">
                Search isn't available right now. Try again in a moment.
              </p>
            ) : null}
            {view === "results" ? (
              <>
                {!hasResults ? <CommandEmpty>No people, companies or settings match “{trimmed}”.</CommandEmpty> : null}
                {results?.people.length ? (
                  <CommandGroup heading="People">
                    {results.people.map((p) => (
                      <CommandItem key={p.id} value={`person-${p.id}`} onSelect={() => go(`/dashboard/people/${p.id}`)}>
                        <span
                          className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted font-medium text-[10px] text-muted-foreground"
                          aria-hidden="true"
                        >
                          {getInitials(p.name)}
                        </span>
                        <span className="min-w-0 flex-1 truncate">
                          <span className="font-medium">{p.name}</span>
                          {p.title || p.company ? (
                            <span className="text-muted-foreground">
                              {" · "}
                              {[p.title, p.company].filter(Boolean).join(" @ ")}
                            </span>
                          ) : null}
                        </span>
                        <Badge variant="secondary" className="ml-2 shrink-0 font-medium">
                          {stageLabel("contact", p.stage)}
                        </Badge>
                      </CommandItem>
                    ))}
                    <CommandItem
                      value="view-all-people"
                      onSelect={() => go(`/dashboard/people?q=${encodeURIComponent(trimmed)}`)}
                      className="text-muted-foreground"
                    >
                      <ArrowRight aria-hidden="true" />
                      View all people
                    </CommandItem>
                  </CommandGroup>
                ) : null}
                {results?.companies.length ? (
                  <CommandGroup heading="Companies">
                    {results.companies.map((c) => (
                      <CommandItem
                        key={c.id}
                        value={`company-${c.id}`}
                        onSelect={() => go(`/dashboard/companies/${c.id}`)}
                      >
                        <Building2 aria-hidden="true" />
                        <span className="min-w-0 flex-1 truncate">
                          <span className="font-medium">{c.name}</span>
                          {c.employeeCount || c.industry ? (
                            <span className="text-muted-foreground">
                              {" · "}
                              {[c.employeeCount ? `${c.employeeCount.toLocaleString()} employees` : null, c.industry]
                                .filter(Boolean)
                                .join(" · ")}
                            </span>
                          ) : null}
                        </span>
                        <Badge variant="secondary" className="ml-2 shrink-0 font-medium">
                          {stageLabel("company", c.stage)}
                        </Badge>
                      </CommandItem>
                    ))}
                    <CommandItem
                      value="view-all-companies"
                      onSelect={() => go(`/dashboard/companies?q=${encodeURIComponent(trimmed)}`)}
                      className="text-muted-foreground"
                    >
                      <ArrowRight aria-hidden="true" />
                      View all companies
                    </CommandItem>
                  </CommandGroup>
                ) : null}
                {results?.settings.length ? (
                  <CommandGroup heading="Settings">
                    {results.settings.map((s) => (
                      <CommandItem key={s.id} value={`setting-${s.id}`} onSelect={() => go(s.url)}>
                        <Settings aria-hidden="true" />
                        <span className="truncate">{s.title}</span>
                        <span className="ml-auto truncate text-muted-foreground text-xs">{s.section}</span>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                ) : null}
              </>
            ) : null}
          </CommandList>
          <div className="flex items-center gap-3 border-t px-3 py-2 text-muted-foreground text-xs" aria-hidden="true">
            <span className="flex items-center gap-1">
              <ArrowUp className="size-3" />
              <ArrowDown className="size-3" />
              Navigate
            </span>
            <span className="flex items-center gap-1">
              <Kbd>esc</Kbd>
              Close
            </span>
            <span className="ml-auto flex items-center gap-1">
              <CornerDownLeft className="size-3" />
              Select
            </span>
          </div>
        </Command>
      </CommandDialog>
    </>
  );
}
