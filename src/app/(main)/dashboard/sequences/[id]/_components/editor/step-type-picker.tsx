"use client";

import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { STEP_TYPE_HINTS, STEP_TYPE_LABELS, STEP_TYPES, type StepType } from "@/lib/engage-constants";

import { STEP_ICONS } from "./model";

const EMAIL_AND_TASKS = STEP_TYPES.filter((t) => !t.startsWith("linkedin"));
const LINKEDIN = STEP_TYPES.filter((t) => t.startsWith("linkedin"));

/** "Add a step" menu with every step type, grouped like the reference: email and tasks, then LinkedIn. */
export function StepTypePicker({
  onPick,
  label = "Add a step",
  variant = "default",
  disabled,
  ariaLabel,
}: {
  onPick: (type: StepType) => void;
  label?: string;
  variant?: "default" | "outline" | "ghost";
  disabled?: boolean;
  ariaLabel?: string;
}) {
  const item = (t: StepType) => {
    const Icon = STEP_ICONS[t];
    return (
      <DropdownMenuItem key={t} onSelect={() => onPick(t)} className="items-start gap-2 py-2">
        <Icon className="mt-0.5 size-4 text-muted-foreground" aria-hidden="true" />
        <span className="flex min-w-0 flex-col">
          <span>{STEP_TYPE_LABELS[t]}</span>
          <span className="text-muted-foreground text-xs">{STEP_TYPE_HINTS[t]}</span>
        </span>
      </DropdownMenuItem>
    );
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" variant={variant} disabled={disabled} aria-label={ariaLabel}>
          <Plus data-icon="inline-start" aria-hidden="true" />
          {label}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="center" className="w-80 max-w-[calc(100vw-2rem)]">
        <DropdownMenuLabel className="text-muted-foreground text-xs">Email and tasks</DropdownMenuLabel>
        {EMAIL_AND_TASKS.map(item)}
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-muted-foreground text-xs">LinkedIn (manual tasks)</DropdownMenuLabel>
        {LINKEDIN.map(item)}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
