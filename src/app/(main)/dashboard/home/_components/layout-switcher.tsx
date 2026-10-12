"use client";

import { useState, useTransition } from "react";

import { useRouter } from "next/navigation";

import { Check, ChevronDown, LayoutGrid, Star } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { HOME_LAYOUT_LABELS, HOME_LAYOUTS, type HomeLayout } from "@/lib/onboarding";

const DESCRIPTIONS: Record<HomeLayout, string> = {
  getting_started: "Your setup checklist",
  generate_pipeline: "Suggested people and companies to reach",
  win_and_close: "Email stats, replies, tasks and deals",
};

/** Top-right layout picker for Home. The choice is saved per person (PATCH /api/v1/onboarding). */
export function LayoutSwitcher({ current }: { readonly current: HomeLayout }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [selected, setSelected] = useState(current);

  function choose(layout: HomeLayout) {
    setOpen(false);
    if (layout === selected) return;
    const previous = selected;
    setSelected(layout);
    startTransition(async () => {
      const res = await fetch("/api/v1/onboarding", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ homeLayout: layout }),
      }).catch(() => null);
      if (!res?.ok) {
        setSelected(previous);
        toast.error("Couldn't switch the layout. Try again.");
        return;
      }
      router.refresh();
    });
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          disabled={pending}
          aria-label={`Home layout: ${HOME_LAYOUT_LABELS[selected]}`}
        >
          <LayoutGrid data-icon="inline-start" />
          {HOME_LAYOUT_LABELS[selected]}
          <ChevronDown data-icon="inline-end" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <Tabs defaultValue="system" className="gap-0">
          <div className="border-b px-3 py-2">
            <TabsList>
              <TabsTrigger value="system">System</TabsTrigger>
              <TabsTrigger value="yours">Your layouts</TabsTrigger>
              <TabsTrigger value="starred">Starred</TabsTrigger>
            </TabsList>
          </div>
          <TabsContent value="system" className="p-1">
            <ul aria-label="System layouts">
              {HOME_LAYOUTS.map((layout) => (
                <li key={layout}>
                  <button
                    type="button"
                    onClick={() => choose(layout)}
                    aria-pressed={layout === selected}
                    className="flex w-full items-start gap-2 rounded-md px-2 py-2 text-left outline-none hover:bg-muted focus-visible:bg-muted"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium text-sm">{HOME_LAYOUT_LABELS[layout]}</span>
                      <span className="block text-muted-foreground text-xs">{DESCRIPTIONS[layout]}</span>
                    </span>
                    {layout === selected ? <Check className="mt-0.5 size-4 text-primary" aria-hidden="true" /> : null}
                  </button>
                </li>
              ))}
            </ul>
          </TabsContent>
          <TabsContent value="yours" className="px-3 py-6 text-center text-muted-foreground text-sm">
            Custom layouts with your own widgets aren't available yet. Pick a system layout for now.
          </TabsContent>
          <TabsContent
            value="starred"
            className="flex flex-col items-center gap-2 px-3 py-6 text-center text-muted-foreground text-sm"
          >
            <Star className="size-4" aria-hidden="true" />
            Starred layouts will show here once custom layouts arrive.
          </TabsContent>
        </Tabs>
      </PopoverContent>
    </Popover>
  );
}
