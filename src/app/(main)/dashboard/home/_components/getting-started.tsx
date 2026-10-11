"use client";

import { useState } from "react";

import Link from "next/link";

import { ChevronDown, Circle, CircleCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import type { ChecklistCard } from "@/server/services/onboarding";

/**
 * Collapsible checklist cards. Rows are checked from real data (nothing to tick by hand); the
 * first incomplete row across all cards gets the primary button.
 */
export function ChecklistCards({ cards }: { readonly cards: readonly ChecklistCard[] }) {
  const firstOpen = cards.flatMap((c) => c.steps).find((s) => !s.done)?.id ?? null;
  return (
    <div className="flex flex-col gap-3">
      {cards.map((card, index) => (
        <ChecklistCardView
          key={card.id}
          card={card}
          primaryStepId={firstOpen}
          defaultOpen={index === 0 || card.steps.some((s) => s.id === firstOpen)}
        />
      ))}
    </div>
  );
}

function ChecklistCardView({
  card,
  primaryStepId,
  defaultOpen,
}: {
  readonly card: ChecklistCard;
  readonly primaryStepId: string | null;
  readonly defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const done = card.steps.filter((s) => s.done).length;
  const headingId = `checklist-${card.id}`;

  return (
    <Card className="gap-0 py-0" data-testid="checklist-card">
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="flex w-full flex-col gap-1 rounded-xl px-4 py-4 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring sm:flex-row sm:items-start sm:justify-between sm:gap-4 sm:px-6 sm:py-5"
            aria-labelledby={headingId}
          >
            <span className="min-w-0">
              <span id={headingId} className="block font-heading text-lg sm:text-xl">
                {card.title}
              </span>
              <span className="mt-0.5 block text-muted-foreground text-sm">{card.description}</span>
            </span>
            <span className="flex shrink-0 items-center gap-1.5 text-muted-foreground text-sm">
              <span className="font-mono text-xs tabular-nums">
                {done} of {card.steps.length} completed
              </span>
              <ChevronDown
                className={`size-4 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
                aria-hidden="true"
              />
            </span>
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <ul className="divide-y px-4 pb-2 sm:px-6" aria-label={card.title}>
            {card.steps.map((step) => (
              <li key={step.id} className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 items-start gap-3 sm:items-center">
                  {/* Display-only status: steps are checked from real data, never by hand. */}
                  {step.done ? (
                    <CircleCheck className="mt-0.5 size-5 shrink-0 text-primary sm:mt-0" aria-hidden="true" />
                  ) : (
                    <Circle className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
                  )}
                  <span className="sr-only">{step.done ? "Done:" : "Not done yet:"}</span>
                  <p className={`text-sm ${step.done ? "text-muted-foreground line-through" : ""}`}>
                    <span className="font-medium">{step.action}</span> {step.description}
                  </p>
                </div>
                <Button
                  asChild
                  size="sm"
                  variant={step.id === primaryStepId ? "default" : "outline"}
                  className="shrink-0 self-start sm:self-auto"
                >
                  <Link prefetch={false} href={step.href}>
                    {step.cta}
                  </Link>
                </Button>
              </li>
            ))}
          </ul>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}
