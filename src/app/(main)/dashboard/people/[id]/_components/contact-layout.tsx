"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

import { ArrowDown, ArrowUp, ChevronDown, ChevronUp, GripVertical, LayoutGrid, RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * Left-column cards of the contact page: order, collapsed and hidden state, kept per browser in
 * localStorage. Also holds the active right-hand tab so a card can switch to "All fields".
 */

export const CARD_IDS = ["contact", "record", "account", "deals", "notes", "tasks"] as const;
export type CardId = (typeof CARD_IDS)[number];

export const CARD_TITLES: Record<CardId, string> = {
  contact: "Contact information",
  record: "Record details",
  account: "Account",
  deals: "Deals",
  notes: "Notes",
  tasks: "Tasks",
};

export const TAB_IDS = ["prospect", "activities", "sequences", "fields"] as const;
export type TabId = (typeof TAB_IDS)[number];

interface LayoutState {
  order: CardId[];
  collapsed: CardId[];
  hidden: CardId[];
}

const STORAGE_KEY = "contact-page-layout:v1";
const DEFAULT_STATE: LayoutState = { order: [...CARD_IDS], collapsed: [], hidden: [] };

function readState(): LayoutState {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_STATE;
    const parsed = JSON.parse(raw) as Partial<LayoutState>;
    const valid = (v: unknown): v is CardId => typeof v === "string" && (CARD_IDS as readonly string[]).includes(v);
    const order = Array.isArray(parsed.order) ? parsed.order.filter(valid) : [];
    for (const id of CARD_IDS) if (!order.includes(id)) order.push(id);
    return {
      order,
      collapsed: Array.isArray(parsed.collapsed) ? parsed.collapsed.filter(valid) : [],
      hidden: Array.isArray(parsed.hidden) ? parsed.hidden.filter(valid) : [],
    };
  } catch {
    return DEFAULT_STATE;
  }
}

function writeState(state: LayoutState): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage blocked (private mode): the layout still works for this visit.
  }
}

interface LayoutContextValue extends LayoutState {
  move: (id: CardId, to: number) => void;
  toggleCollapsed: (id: CardId) => void;
  toggleHidden: (id: CardId) => void;
  reset: () => void;
  tab: TabId;
  setTab: (tab: TabId) => void;
}

const LayoutContext = createContext<LayoutContextValue | null>(null);

function useLayout(): LayoutContextValue {
  const value = useContext(LayoutContext);
  if (!value) throw new Error("ContactLayoutProvider is missing");
  return value;
}

export function useContactTab(): [TabId, (tab: TabId) => void] {
  const { tab, setTab } = useLayout();
  return [tab, setTab];
}

export function ContactLayoutProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<LayoutState>(DEFAULT_STATE);
  const [tab, setTab] = useState<TabId>("prospect");

  useEffect(() => {
    setState(readState());
  }, []);

  const update = useCallback((next: (prev: LayoutState) => LayoutState) => {
    setState((prev) => {
      const value = next(prev);
      writeState(value);
      return value;
    });
  }, []);

  const value = useMemo<LayoutContextValue>(
    () => ({
      ...state,
      tab,
      setTab,
      move: (id, to) =>
        update((prev) => {
          const order = prev.order.filter((x) => x !== id);
          order.splice(Math.max(0, Math.min(to, order.length)), 0, id);
          return { ...prev, order };
        }),
      toggleCollapsed: (id) =>
        update((prev) => ({
          ...prev,
          collapsed: prev.collapsed.includes(id) ? prev.collapsed.filter((x) => x !== id) : [...prev.collapsed, id],
        })),
      toggleHidden: (id) =>
        update((prev) => ({
          ...prev,
          hidden: prev.hidden.includes(id) ? prev.hidden.filter((x) => x !== id) : [...prev.hidden, id],
        })),
      reset: () => update(() => DEFAULT_STATE),
    }),
    [state, tab, update],
  );

  return <LayoutContext.Provider value={value}>{children}</LayoutContext.Provider>;
}

export function EditLayoutMenu() {
  const { order, hidden, toggleHidden, reset } = useLayout();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm">
          <LayoutGrid data-icon="inline-start" aria-hidden="true" />
          Edit layout
          <ChevronDown data-icon="inline-end" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>Cards shown</DropdownMenuLabel>
        {order.map((id) => (
          <DropdownMenuCheckboxItem
            key={id}
            checked={!hidden.includes(id)}
            onCheckedChange={() => toggleHidden(id)}
            onSelect={(e) => e.preventDefault()}
          >
            {CARD_TITLES[id]}
          </DropdownMenuCheckboxItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={reset}>
          <RotateCcw aria-hidden="true" />
          Reset layout
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The draggable, collapsible card column. `cards` are rendered on the server. */
export function CardColumn({
  cards,
}: {
  cards: Partial<Record<CardId, { action?: React.ReactNode; body: React.ReactNode }>>;
}) {
  const { order, collapsed, hidden, move, toggleCollapsed } = useLayout();
  const [dragging, setDragging] = useState<CardId | null>(null);
  const [over, setOver] = useState<CardId | null>(null);
  const visible = order.filter((id) => cards[id] && !hidden.includes(id));

  return (
    <div className="flex min-w-0 flex-col gap-4">
      {visible.map((id, index) => {
        const card = cards[id];
        if (!card) return null;
        const isCollapsed = collapsed.includes(id);
        const bodyId = `contact-card-${id}`;
        return (
          <section
            key={id}
            aria-labelledby={`${bodyId}-title`}
            data-testid={`card-${id}`}
            onDragOver={(e) => {
              if (!dragging) return;
              e.preventDefault();
              setOver(id);
            }}
            onDragLeave={() => setOver((cur) => (cur === id ? null : cur))}
            onDrop={(e) => {
              e.preventDefault();
              if (dragging && dragging !== id) move(dragging, order.indexOf(id));
              setDragging(null);
              setOver(null);
            }}
            className={`min-w-0 rounded-xl border bg-card text-card-foreground transition-shadow ${
              over === id && dragging !== id ? "ring-2 ring-ring/50" : ""
            } ${dragging === id ? "opacity-60" : ""}`}
          >
            <header className="flex items-center gap-1 px-3 py-2.5">
              <button
                type="button"
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.effectAllowed = "move";
                  e.dataTransfer.setData("text/plain", id);
                  setDragging(id);
                }}
                onDragEnd={() => {
                  setDragging(null);
                  setOver(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "ArrowUp" && index > 0) {
                    e.preventDefault();
                    move(id, order.indexOf(visible[index - 1]));
                  } else if (e.key === "ArrowDown" && index < visible.length - 1) {
                    e.preventDefault();
                    move(id, order.indexOf(visible[index + 1]));
                  }
                }}
                className="cursor-grab rounded-md p-1 text-muted-foreground outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 active:cursor-grabbing"
                aria-label={`Move ${CARD_TITLES[id]} (drag, or use the arrow keys)`}
              >
                <GripVertical className="size-4" aria-hidden="true" />
              </button>
              <h2 id={`${bodyId}-title`} className="min-w-0 flex-1 truncate font-medium text-sm">
                {CARD_TITLES[id]}
              </h2>
              {card.action}
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Move ${CARD_TITLES[id]} up`}
                className="hidden sm:inline-flex"
                disabled={index === 0}
                onClick={() => move(id, order.indexOf(visible[index - 1]))}
              >
                <ArrowUp aria-hidden="true" />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Move ${CARD_TITLES[id]} down`}
                className="hidden sm:inline-flex"
                disabled={index === visible.length - 1}
                onClick={() => move(id, order.indexOf(visible[index + 1]))}
              >
                <ArrowDown aria-hidden="true" />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-expanded={!isCollapsed}
                aria-controls={bodyId}
                aria-label={isCollapsed ? `Expand ${CARD_TITLES[id]}` : `Collapse ${CARD_TITLES[id]}`}
                onClick={() => toggleCollapsed(id)}
              >
                {isCollapsed ? <ChevronDown aria-hidden="true" /> : <ChevronUp aria-hidden="true" />}
              </Button>
            </header>
            <div id={bodyId} hidden={isCollapsed} className="border-t px-4 py-4">
              {card.body}
            </div>
          </section>
        );
      })}
      {visible.length === 0 ? (
        <p className="rounded-xl border border-dashed p-4 text-muted-foreground text-sm">
          All cards are hidden. Use Edit layout to show them again.
        </p>
      ) : null}
    </div>
  );
}
