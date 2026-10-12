"use client";

import { useState } from "react";

import { BookOpen, Sparkles } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Switch } from "@/components/ui/switch";
import {
  SEQUENCE_TEMPLATES,
  type SequenceTemplateId,
  type StepType,
  type ThreadMode,
  TONE_LABELS,
  TONES,
  type Tone,
} from "@/lib/engage-constants";

import { apiRequest } from "../../../../_components/records/api-client";

export interface GeneratedStep {
  type: StepType;
  waitDays: number;
  waitMinutes: number;
  threadMode: ThreadMode;
  subject: string | null;
  body: string | null;
}

type Generated = { draft: { name: string; steps: GeneratedStep[] } };

/** "Select a template": ready-made outlines loaded into the editor (still unsaved). */
export function TemplateSequenceDialog({ onLoad }: { onLoad: (steps: GeneratedStep[]) => void }) {
  const [open, setOpen] = useState(false);
  const [choice, setChoice] = useState<SequenceTemplateId>(SEQUENCE_TEMPLATES[0].id);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function load() {
    setPending(true);
    setError(null);
    const res = await apiRequest<Generated>("/api/v1/emailer_campaigns/generate", { body: { template: choice } });
    setPending(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    onLoad(res.data.draft.steps);
    setOpen(false);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <BookOpen data-icon="inline-start" aria-hidden="true" />
          Select a template
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Select a template</DialogTitle>
          <DialogDescription>Start from a proven outline. You can change every step before saving.</DialogDescription>
        </DialogHeader>
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        <RadioGroup value={choice} onValueChange={(v) => setChoice(v as SequenceTemplateId)} className="gap-2">
          {SEQUENCE_TEMPLATES.map((t) => (
            <label
              key={t.id}
              htmlFor={`tpl-${t.id}`}
              className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 has-data-[state=checked]:border-primary"
            >
              <RadioGroupItem id={`tpl-${t.id}`} value={t.id} className="mt-0.5" />
              <span className="flex flex-col">
                <span className="font-medium text-sm">{t.name}</span>
                <span className="text-muted-foreground text-xs">{t.description}</span>
              </span>
            </label>
          ))}
        </RadioGroup>
        <DialogFooter>
          <Button size="sm" variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button size="sm" disabled={pending} onClick={() => void load()}>
            <BookOpen data-icon="inline-start" aria-hidden="true" />
            {pending ? "Loading…" : "Use template"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** "AI-assisted sequence": audience, goal, length and tone → a full outline of steps. */
export function AssistedSequenceDialog({ onLoad }: { onLoad: (steps: GeneratedStep[]) => void }) {
  const [open, setOpen] = useState(false);
  const [audience, setAudience] = useState("");
  const [goal, setGoal] = useState("");
  const [steps, setSteps] = useState("4");
  const [tone, setTone] = useState<Tone>("default");
  const [includeCalls, setIncludeCalls] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const res = await apiRequest<Generated>("/api/v1/emailer_campaigns/generate", {
      body: { audience, goal, steps: Number(steps), tone, includeCalls },
    });
    setPending(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    onLoad(res.data.draft.steps);
    setOpen(false);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <Sparkles data-icon="inline-start" aria-hidden="true" />
          AI-assisted sequence
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Draft a sequence</DialogTitle>
            <DialogDescription>
              Describe who you're writing to and what you want. Review every step before saving.
            </DialogDescription>
          </DialogHeader>
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          <Field className="gap-1.5">
            <FieldLabel htmlFor="gen-audience">Audience</FieldLabel>
            <Input
              id="gen-audience"
              value={audience}
              maxLength={300}
              placeholder="Heads of sales at software companies"
              onChange={(e) => setAudience(e.target.value)}
            />
          </Field>
          <Field className="gap-1.5">
            <FieldLabel htmlFor="gen-goal">Goal</FieldLabel>
            <Input
              id="gen-goal"
              value={goal}
              maxLength={300}
              placeholder="Book a 15-minute intro call"
              onChange={(e) => setGoal(e.target.value)}
            />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field className="gap-1.5">
              <FieldLabel htmlFor="gen-steps">Number of steps</FieldLabel>
              <NativeSelect id="gen-steps" className="w-full" value={steps} onChange={(e) => setSteps(e.target.value)}>
                {[2, 3, 4, 5, 6, 7, 8].map((v) => (
                  <NativeSelectOption key={v} value={String(v)}>
                    {v}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Field>
            <Field className="gap-1.5">
              <FieldLabel htmlFor="gen-tone">Tone</FieldLabel>
              <NativeSelect
                id="gen-tone"
                className="w-full"
                value={tone}
                onChange={(e) => setTone(e.target.value as Tone)}
              >
                {TONES.filter((t) => t !== "custom").map((t) => (
                  <NativeSelectOption key={t} value={t}>
                    {TONE_LABELS[t]}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Field>
          </div>
          <Field orientation="horizontal" className="items-center gap-2">
            <Switch id="gen-calls" checked={includeCalls} onCheckedChange={setIncludeCalls} />
            <FieldLabel htmlFor="gen-calls">Include phone call steps</FieldLabel>
          </Field>
          <DialogFooter>
            <Button type="button" size="sm" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={pending || !audience.trim() || !goal.trim()}>
              <Sparkles data-icon="inline-start" aria-hidden="true" />
              {pending ? "Drafting…" : "Draft steps"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
