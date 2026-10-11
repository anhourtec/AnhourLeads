"use client";

import { useState } from "react";

import { ArrowRight, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";

import { templateForPrompt } from "./templates";

/** "What can I help automate?": maps a plain sentence to the closest template. */
export function AutomatePrompt({
  onTemplate,
  disabled,
}: {
  readonly onTemplate: (templateId: string) => void;
  readonly disabled?: boolean;
}) {
  const [prompt, setPrompt] = useState("");
  const [miss, setMiss] = useState(false);
  return (
    <form
      className="flex w-full flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        const id = templateForPrompt(prompt);
        setMiss(!id);
        if (id) onTemplate(id);
      }}
    >
      <InputGroup className="h-11">
        <InputGroupAddon>
          <Sparkles aria-hidden="true" className="text-primary" />
        </InputGroupAddon>
        <InputGroupInput
          aria-label="Describe what to automate"
          placeholder="For example: when someone replies, create a task to follow up"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          disabled={disabled}
        />
        <InputGroupAddon align="inline-end">
          <Button type="submit" size="icon-sm" aria-label="Find a workflow" disabled={disabled ? true : !prompt.trim()}>
            <ArrowRight />
          </Button>
        </InputGroupAddon>
      </InputGroup>
      <p className="text-muted-foreground text-xs" aria-live="polite">
        {miss
          ? "No template matches that yet. Try words like replies, bounces, new job, won deal or enrich, or start from scratch."
          : "Describe a trigger and an action. The closest template opens for you to adjust."}
      </p>
    </form>
  );
}
