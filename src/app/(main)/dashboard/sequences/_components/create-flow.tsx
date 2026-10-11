"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";

import Link from "next/link";
import { useRouter } from "next/navigation";

import { ArrowLeft, ChevronDown, FileText, ListChecks, Mail, Phone, Plus, ShieldCheck, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  describeWait,
  describeWindows,
  type ScheduleWindows,
  SEQUENCE_TEMPLATES,
  type SequenceTemplateId,
  STEP_TYPE_LABELS,
  type StepType,
  TONE_LABELS,
  TONES,
  type Tone,
} from "@/lib/engage-constants";

import { apiRequest } from "../../_components/records/api-client";

export interface MailboxOption {
  id: string;
  email: string;
  readyToSend: boolean;
}

export interface ScheduleOption {
  id: string;
  name: string;
  timezone: string;
  windows: ScheduleWindows;
  isDefault: boolean;
}

export interface DraftStep {
  type: StepType;
  waitDays: number;
  waitMinutes: number;
  threadMode: "new_thread" | "reply";
  subject: string | null;
  body: string | null;
}

interface Draft {
  name: string;
  steps: DraftStep[];
}

interface CreateFlow {
  startBlank: () => void;
  startAi: () => void;
  startTemplate: (id: SequenceTemplateId) => void;
}

const CreateFlowContext = createContext<CreateFlow | null>(null);

function useCreateFlow(): CreateFlow {
  const ctx = useContext(CreateFlowContext);
  if (!ctx) throw new Error("CreateFlowProvider is missing.");
  return ctx;
}

/**
 * Every way to create a sequence goes through here: the anti-spam acknowledgement (once, when the
 * person still has to accept it), then the new sequence form, optionally prefilled from a template
 * or an AI-assisted outline.
 */
export function CreateFlowProvider({
  antiSpamRequired,
  schedules,
  mailboxes,
  children,
}: {
  antiSpamRequired: boolean;
  schedules: ScheduleOption[];
  mailboxes: MailboxOption[];
  children: React.ReactNode;
}) {
  const [consentNeeded, setConsentNeeded] = useState(antiSpamRequired);
  const [pending, setPending] = useState<(() => void) | null>(null);
  const [consentOpen, setConsentOpen] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [fromAi, setFromAi] = useState(false);

  const gate = useCallback(
    (next: () => void) => {
      if (consentNeeded) {
        setPending(() => next);
        setConsentOpen(true);
      } else next();
    },
    [consentNeeded],
  );

  const loadTemplate = useCallback(async (id: SequenceTemplateId) => {
    const result = await apiRequest<{ draft: Draft }>("/api/v1/emailer_campaigns/generate", {
      body: { template: id },
    });
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    setDraft(result.data.draft);
    setFromAi(false);
    setNewOpen(true);
  }, []);

  const flow = useMemo<CreateFlow>(
    () => ({
      startBlank: () =>
        gate(() => {
          setDraft(null);
          setFromAi(false);
          setNewOpen(true);
        }),
      startAi: () => gate(() => setAiOpen(true)),
      startTemplate: (id) =>
        gate(() => {
          void loadTemplate(id);
        }),
    }),
    [gate, loadTemplate],
  );

  return (
    <CreateFlowContext.Provider value={flow}>
      {children}
      <AntiSpamDialog
        open={consentOpen}
        onOpenChange={setConsentOpen}
        onAccepted={() => {
          setConsentNeeded(false);
          setConsentOpen(false);
          const next = pending;
          setPending(null);
          next?.();
        }}
      />
      <CreateWithAiDialog
        open={aiOpen}
        onOpenChange={setAiOpen}
        onUse={(d) => {
          setDraft(d);
          setFromAi(true);
          setAiOpen(false);
          setNewOpen(true);
        }}
      />
      <NewSequenceDialog
        open={newOpen}
        onOpenChange={setNewOpen}
        draft={draft}
        schedules={schedules}
        mailboxes={mailboxes}
        onBack={() => {
          setNewOpen(false);
          if (fromAi) setAiOpen(true);
        }}
      />
    </CreateFlowContext.Provider>
  );
}

/* -------------------------------------------------------------------------- */
/* Anti-spam acknowledgement                                                  */
/* -------------------------------------------------------------------------- */

function AntiSpamDialog({
  open,
  onOpenChange,
  onAccepted,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAccepted: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function accept() {
    setSaving(true);
    setError(null);
    const result = await apiRequest("/api/v1/consents/anti-spam", { body: { accepted: true } });
    setSaving(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onAccepted();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) setError(null);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader className="items-center text-center">
          <span className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
            <ShieldCheck className="size-6" aria-hidden="true" />
          </span>
          <DialogTitle>Send responsibly</DialogTitle>
          <DialogDescription className="text-center">
            Before your first sequence, confirm that you'll only email people you have a lawful reason to contact,
            honour every unsubscribe, and never send spam or harassing messages, commercial or otherwise.
          </DialogDescription>
        </DialogHeader>
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        <div className="flex flex-col gap-2">
          <Button size="sm" onClick={accept} disabled={saving}>
            <ShieldCheck data-icon="inline-start" aria-hidden="true" />
            {saving ? "Saving…" : "I will comply"}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
            I decline
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* -------------------------------------------------------------------------- */
/* New sequence                                                               */
/* -------------------------------------------------------------------------- */

export function SchedulePreview({ windows, timezone }: { windows: ScheduleWindows; timezone?: string }) {
  const rows = describeWindows(windows);
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs" aria-label="Weekly sending windows">
      {rows.map((r) => (
        <div key={r.day} className="contents">
          <dt className="text-muted-foreground">{r.label}</dt>
          <dd className="font-mono tabular-nums">{r.text}</dd>
        </div>
      ))}
      {rows.length === 0 ? <dd className="col-span-2 text-muted-foreground">No sending windows.</dd> : null}
      {timezone ? (
        <dd className="col-span-2 pt-1 text-muted-foreground">
          Time zone <span className="font-mono">{timezone}</span>
        </dd>
      ) : null}
    </dl>
  );
}

function NewSequenceDialog({
  open,
  onOpenChange,
  draft,
  schedules,
  mailboxes,
  onBack,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  draft: Draft | null;
  schedules: ScheduleOption[];
  mailboxes: MailboxOption[];
  onBack: () => void;
}) {
  const router = useRouter();
  const defaultSchedule = schedules.find((s) => s.isDefault) ?? schedules[0];
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [scheduleId, setScheduleId] = useState("");
  const [mailboxId, setMailboxId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [seeded, setSeeded] = useState<Draft | null | undefined>(undefined);

  // Reset the form each time it opens (or the draft changes).
  if (open && seeded !== draft) {
    setSeeded(draft);
    setName(draft?.name ?? "");
    setDescription("");
    setScheduleId(defaultSchedule?.id ?? "");
    setMailboxId(mailboxes.find((m) => m.readyToSend)?.id ?? "");
    setError(null);
  }
  if (!open && seeded !== undefined) setSeeded(undefined);

  const schedule = schedules.find((s) => s.id === scheduleId);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim()) {
      setError("Name the sequence.");
      return;
    }
    setSaving(true);
    setError(null);
    const result = await apiRequest<{ emailer_campaign: { id: string } }>("/api/v1/emailer_campaigns", {
      body: {
        name: name.trim(),
        description: description.trim() || null,
        scheduleId: scheduleId || null,
        mailboxId: mailboxId || null,
        steps: draft?.steps ?? [],
      },
    });
    setSaving(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onOpenChange(false);
    toast.success("Sequence created as a draft.");
    router.push(`/dashboard/sequences/${result.data.emailer_campaign.id}`);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <form onSubmit={submit} noValidate className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>New sequence</DialogTitle>
            <DialogDescription>Name it, say what it's for and choose when it may send.</DialogDescription>
          </DialogHeader>
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          <FieldGroup className="gap-4">
            <Field className="gap-1.5">
              <FieldLabel htmlFor="new-sequence-name">Sequence name</FieldLabel>
              <Input
                id="new-sequence-name"
                value={name}
                maxLength={120}
                onChange={(e) => setName(e.target.value)}
                autoFocus
              />
            </Field>
            <Field className="gap-1.5">
              <FieldLabel htmlFor="new-sequence-description">Description</FieldLabel>
              <Textarea
                id="new-sequence-description"
                rows={3}
                maxLength={2000}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </Field>
            <div className="grid gap-4 rounded-lg border bg-muted/30 p-4 sm:grid-cols-2">
              <Field className="gap-1.5">
                <FieldLabel htmlFor="new-sequence-schedule">Schedule</FieldLabel>
                <NativeSelect
                  id="new-sequence-schedule"
                  className="w-full"
                  value={scheduleId}
                  onChange={(e) => setScheduleId(e.target.value)}
                >
                  <NativeSelectOption value="">Mailbox sending window</NativeSelectOption>
                  {schedules.map((s) => (
                    <NativeSelectOption key={s.id} value={s.id}>
                      {s.name}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
                <FieldDescription className="text-xs">
                  You can edit or create schedules in{" "}
                  <Link href="/dashboard/settings/schedules" className="underline underline-offset-4">
                    schedule settings
                  </Link>
                  .
                </FieldDescription>
              </Field>
              <div className="min-w-0">
                {schedule ? (
                  <SchedulePreview windows={schedule.windows} timezone={schedule.timezone} />
                ) : (
                  <p className="text-muted-foreground text-xs">Sends inside the mailbox's own daily window.</p>
                )}
              </div>
            </div>
            <Field className="gap-1.5">
              <FieldLabel htmlFor="new-sequence-mailbox">Send from</FieldLabel>
              <NativeSelect
                id="new-sequence-mailbox"
                className="w-full"
                value={mailboxId}
                onChange={(e) => setMailboxId(e.target.value)}
              >
                <NativeSelectOption value="">Choose later</NativeSelectOption>
                {mailboxes.map((m) => (
                  <NativeSelectOption key={m.id} value={m.id}>
                    {m.email}
                    {m.readyToSend ? "" : " (needs setup)"}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Field>
            {draft?.steps.length ? (
              <div className="flex flex-col gap-1.5">
                <p className="font-medium text-sm">Steps</p>
                <StepOutline steps={draft.steps} />
              </div>
            ) : null}
          </FieldGroup>
          <DialogFooter>
            <Button type="button" variant="outline" size="sm" onClick={onBack}>
              <ArrowLeft data-icon="inline-start" aria-hidden="true" />
              Back
            </Button>
            <Button type="submit" size="sm" disabled={saving}>
              <Plus data-icon="inline-start" aria-hidden="true" />
              {saving ? "Creating…" : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function stepIcon(type: StepType) {
  if (type === "auto_email" || type === "manual_email") return Mail;
  if (type === "call") return Phone;
  return ListChecks;
}

function stepHint(s: DraftStep): string {
  if (s.subject) return ` · ${s.subject}`;
  return s.threadMode === "reply" ? " · Reply in thread" : "";
}

function StepOutline({ steps }: { steps: DraftStep[] }) {
  return (
    <ol className="flex flex-col divide-y rounded-lg border" aria-label="Drafted steps">
      {steps.map((s, i) => {
        const Icon = stepIcon(s.type);
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: steps are an ordered draft without ids
          <li key={`${s.type}-${i}`} className="flex min-w-0 items-start gap-3 px-3 py-2">
            <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <div className="flex min-w-0 flex-col">
              <span className="text-sm">
                Step {i + 1}: {STEP_TYPE_LABELS[s.type]}
              </span>
              <span className="truncate text-muted-foreground text-xs">
                {describeWait(s.waitDays, s.waitMinutes, i === 0, s.type)}
                {stepHint(s)}
              </span>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/* -------------------------------------------------------------------------- */
/* Create with AI                                                             */
/* -------------------------------------------------------------------------- */

function CreateWithAiDialog({
  open,
  onOpenChange,
  onUse,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUse: (draft: Draft) => void;
}) {
  const [audience, setAudience] = useState("");
  const [goal, setGoal] = useState("");
  const [steps, setSteps] = useState("4");
  const [tone, setTone] = useState<Tone>("default");
  const [includeCalls, setIncludeCalls] = useState(true);
  const [result, setResult] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function generate(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const res = await apiRequest<{ draft: Draft }>("/api/v1/emailer_campaigns/generate", {
      body: { audience: audience.trim(), goal: goal.trim(), steps: Number(steps), tone, includeCalls },
    });
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setResult(res.data.draft);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) setError(null);
      }}
    >
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Create with AI</DialogTitle>
          <DialogDescription>
            Describe who you're writing to and what you want. You get a draft outline with emails that use merge fields,
            ready to edit.
          </DialogDescription>
        </DialogHeader>
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        {result ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm">
              Draft: <span className="font-medium">{result.name}</span>
            </p>
            <StepOutline steps={result.steps} />
            <DialogFooter>
              <Button type="button" variant="outline" size="sm" onClick={() => setResult(null)}>
                <ArrowLeft data-icon="inline-start" aria-hidden="true" />
                Change answers
              </Button>
              <Button type="button" size="sm" onClick={() => onUse(result)}>
                <Plus data-icon="inline-start" aria-hidden="true" />
                Use this outline
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <form onSubmit={generate} noValidate className="flex flex-col gap-4">
            <FieldGroup className="gap-4">
              <Field className="gap-1.5">
                <FieldLabel htmlFor="ai-audience">Who are you writing to?</FieldLabel>
                <Input
                  id="ai-audience"
                  placeholder="Heads of sales at software companies"
                  value={audience}
                  maxLength={300}
                  onChange={(e) => setAudience(e.target.value)}
                />
              </Field>
              <Field className="gap-1.5">
                <FieldLabel htmlFor="ai-goal">What should they do?</FieldLabel>
                <Input
                  id="ai-goal"
                  placeholder="Book a 15-minute demo"
                  value={goal}
                  maxLength={300}
                  onChange={(e) => setGoal(e.target.value)}
                />
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field className="gap-1.5">
                  <FieldLabel htmlFor="ai-steps">Number of steps</FieldLabel>
                  <NativeSelect
                    id="ai-steps"
                    className="w-full"
                    value={steps}
                    onChange={(e) => setSteps(e.target.value)}
                  >
                    {[2, 3, 4, 5, 6, 7, 8].map((n) => (
                      <NativeSelectOption key={n} value={String(n)}>
                        {n} steps
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                </Field>
                <Field className="gap-1.5">
                  <FieldLabel htmlFor="ai-tone">Tone</FieldLabel>
                  <NativeSelect
                    id="ai-tone"
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
                <Switch id="ai-calls" checked={includeCalls} onCheckedChange={setIncludeCalls} />
                <FieldLabel htmlFor="ai-calls" className="font-normal">
                  Include phone call steps
                </FieldLabel>
              </Field>
            </FieldGroup>
            <DialogFooter>
              <Button type="button" variant="outline" size="sm" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={busy || !audience.trim() || !goal.trim()}>
                <Sparkles data-icon="inline-start" aria-hidden="true" />
                {busy ? "Drafting…" : "Draft sequence"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

/* -------------------------------------------------------------------------- */
/* Triggers                                                                   */
/* -------------------------------------------------------------------------- */

export function CreateSequenceButton() {
  const flow = useCreateFlow();
  return (
    <Button size="sm" onClick={flow.startBlank}>
      <Plus data-icon="inline-start" aria-hidden="true" />
      Create sequence
    </Button>
  );
}

export function CreateWithAiButton() {
  const flow = useCreateFlow();
  return (
    <Button size="sm" variant="outline" onClick={flow.startAi}>
      <Sparkles data-icon="inline-start" aria-hidden="true" />
      Create with AI
    </Button>
  );
}

/** "Create manually" with a menu of ready-made outlines. */
export function CreateManuallyButton() {
  const flow = useCreateFlow();
  return (
    <ButtonGroup>
      <Button size="sm" variant="outline" onClick={flow.startBlank}>
        <Plus data-icon="inline-start" aria-hidden="true" />
        Create manually
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="icon-sm" variant="outline" aria-label="More ways to create">
            <ChevronDown aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-72">
          <DropdownMenuLabel>Start from a template</DropdownMenuLabel>
          <DropdownMenuGroup>
            {SEQUENCE_TEMPLATES.map((t) => (
              <DropdownMenuItem key={t.id} onSelect={() => flow.startTemplate(t.id)}>
                <FileText aria-hidden="true" />
                <div className="flex min-w-0 flex-col">
                  <span>{t.name}</span>
                  <span className="text-muted-foreground text-xs">{t.description}</span>
                </div>
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </ButtonGroup>
  );
}
