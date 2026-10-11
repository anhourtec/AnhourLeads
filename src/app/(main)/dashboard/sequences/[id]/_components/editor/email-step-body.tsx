"use client";

import { useRef, useState } from "react";

import { cn } from "cn";
import { Eye, EyeOff, Plus, Send, Sparkles, Trash2, Wand2 } from "lucide-react";
import { toast } from "sonner";

import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  EMAIL_KIND_LABELS,
  EMAIL_KINDS,
  type EmailKind,
  PERSONALIZATION_CHIPS,
  PERSONALIZATION_LABELS,
  type PersonalizationChip,
  THREAD_MODE_LABELS,
  THREAD_MODES,
  type ThreadMode,
  TONE_LABELS,
  TONES,
  type Tone,
} from "@/lib/engage-constants";

import {
  insertAtCursor,
  MergeFieldPicker,
  SnippetPicker,
  TemplatePicker,
} from "../../../../_components/engage/insert-pickers";
import { apiRequest } from "../../../../_components/records/api-client";
import { newKey, nextVariantLabel, type StepDraft, type VariantDraft } from "./model";
import { PreviewPanel } from "./preview-panel";

type Mode = "assisted" | "prompt" | "template";

interface DraftResponse {
  draft: { subject: string; body: string; source: "ai" | "template"; notice: string | null };
}

/** Chip toggle used for email type, personalisation and tone choices. */
function Chips<T extends string>({
  label,
  values,
  labels,
  selected,
  onToggle,
  disabled,
}: {
  label: string;
  values: readonly T[];
  labels: Record<T, string>;
  selected: T[];
  onToggle: (value: T) => void;
  disabled?: boolean;
}) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-2 font-medium text-sm">{label}</legend>
      <div className="flex flex-wrap gap-2">
        {values.map((v) => {
          const on = selected.includes(v);
          return (
            <button
              key={v}
              type="button"
              disabled={disabled}
              aria-pressed={on}
              onClick={() => onToggle(v)}
              className={cn(
                "rounded-md border px-2.5 py-1 text-sm outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50",
                on
                  ? "border-primary bg-primary/10 text-foreground"
                  : "bg-background text-muted-foreground hover:bg-muted",
              )}
            >
              {labels[v]}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

/**
 * Body of an email step: A/B versions, test send, preview and the Assisted / Prompt / Template modes.
 * Manual emails (which become tasks) get the template form only.
 */
export function EmailStepBody({
  sequenceId,
  step,
  position,
  canEdit,
  onChange,
}: {
  sequenceId: string;
  step: StepDraft;
  position: number;
  canEdit: boolean;
  onChange: (patch: Partial<StepDraft>) => void;
}) {
  const isAuto = step.type === "auto_email";
  const [variantKey, setVariantKey] = useState(step.variants[0]?.key ?? "");
  const [mode, setMode] = useState<Mode>("template");
  const [showPreview, setShowPreview] = useState(true);
  const [kind, setKind] = useState<EmailKind>(position === 1 ? "outreach" : "follow_up");
  const [tone, setTone] = useState<Tone>("default");
  const [customTone, setCustomTone] = useState("");
  const [chips, setChips] = useState<PersonalizationChip[]>([]);
  const [customNote, setCustomNote] = useState("");
  const [context, setContext] = useState("");
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState<"draft" | "test" | null>(null);
  const [draftNote, setDraftNote] = useState<{ source: "ai" | "template"; notice: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingTemplate, setPendingTemplate] = useState<{ subject: string | null; body: string } | null>(null);
  const subjectRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const lastFocus = useRef<"subject" | "body">("body");

  const variant: VariantDraft | undefined = isAuto
    ? (step.variants.find((v) => v.key === variantKey) ?? step.variants[0])
    : undefined;
  const subject = variant ? variant.subject : step.subject;
  const body = variant ? variant.body : step.body;
  const idp = `step-${step.key}-${variant?.key ?? "m"}`;
  const stepLabel = `step ${position}`;

  const setContent = (patch: { subject?: string; body?: string }) => {
    if (variant) {
      onChange({ variants: step.variants.map((v) => (v.key === variant.key ? { ...v, ...patch } : v)) });
    } else onChange(patch);
  };

  const insertToken = (text: string) => {
    if (lastFocus.current === "subject" && (step.threadMode !== "reply" || !isAuto)) {
      const next = insertAtCursor(subjectRef.current, subject, text);
      setContent({ subject: next.value });
    } else {
      const next = insertAtCursor(bodyRef.current, body, text);
      setContent({ body: next.value });
    }
  };

  const applyTemplate = (t: { subject: string | null; body: string }) =>
    setContent({ subject: t.subject ?? subject, body: t.body });

  const activeCount = step.variants.filter((v) => v.active).length;

  const addTest = () => {
    const a = step.variants[0];
    const v: VariantDraft = {
      key: newKey("v"),
      label: nextVariantLabel(step.variants),
      subject: a?.subject ?? "",
      body: a?.body ?? "",
      active: true,
    };
    onChange({ variants: [...step.variants, v] });
    setVariantKey(v.key);
  };

  const toggleActive = (v: VariantDraft) => {
    if (v.active && activeCount <= 1) {
      toast.error("Keep at least one version active.");
      return;
    }
    onChange({ variants: step.variants.map((x) => (x.key === v.key ? { ...x, active: !x.active } : x)) });
  };

  const removeVariant = (v: VariantDraft) => {
    const rest = step.variants.filter((x) => x.key !== v.key);
    if (!rest.some((x) => x.active)) {
      toast.error("Keep at least one version active.");
      return;
    }
    // Relabel so the first version stays "A".
    onChange({ variants: rest.map((x, i) => (i === 0 ? { ...x, label: "A" } : x)) });
    setVariantKey(rest[0].key);
  };

  async function generate(which: "assisted" | "prompt") {
    setBusy("draft");
    setError(null);
    const res = await apiRequest<DraftResponse>(`/api/v1/emailer_campaigns/${sequenceId}/draft`, {
      body: {
        mode: which,
        kind,
        tone,
        ...(tone === "custom" && customTone ? { customTone } : {}),
        personalization: chips,
        ...(chips.includes("custom") && customNote ? { customNote } : {}),
        ...(context ? { context } : {}),
        ...(which === "prompt" ? { prompt } : {}),
      },
    });
    setBusy(null);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    const { draft } = res.data;
    setContent({ subject: step.threadMode === "reply" && isAuto ? subject : draft.subject, body: draft.body });
    setDraftNote({ source: draft.source, notice: draft.notice });
    // Prompt mode keeps showing the notice; otherwise jump to the editable template.
    if (which === "assisted" || !draft.notice) setMode("template");
  }

  async function sendTest() {
    setBusy("test");
    const res = await apiRequest<{ to: string }>(`/api/v1/emailer_campaigns/${sequenceId}/test_email`, {
      body: { subject: subject || null, body },
    });
    setBusy(null);
    if (res.ok) toast.success(`Test email sent to ${res.data.to}.`);
    else toast.error(res.error);
  }

  const templateForm = (
    <div className="flex min-w-0 flex-col gap-3">
      <div className={cn("grid gap-3", isAuto && "sm:grid-cols-[minmax(0,1fr)_11rem]")}>
        <Field className="min-w-0 gap-1.5">
          <FieldLabel htmlFor={`${idp}-subject`} className="text-xs">
            Subject
          </FieldLabel>
          <Input
            id={`${idp}-subject`}
            ref={subjectRef}
            value={isAuto && step.threadMode === "reply" ? "" : subject}
            placeholder={isAuto && step.threadMode === "reply" ? "Re: previous subject" : "Enter email subject"}
            maxLength={300}
            disabled={!canEdit || (isAuto && step.threadMode === "reply")}
            onFocus={() => {
              lastFocus.current = "subject";
            }}
            onChange={(e) => setContent({ subject: e.target.value })}
          />
        </Field>
        {isAuto ? (
          <Field className="gap-1.5">
            <FieldLabel htmlFor={`${idp}-thread`} className="text-xs">
              Type
            </FieldLabel>
            <NativeSelect
              id={`${idp}-thread`}
              className="w-full"
              value={step.threadMode}
              disabled={!canEdit}
              onChange={(e) => onChange({ threadMode: e.target.value as ThreadMode })}
            >
              {THREAD_MODES.map((m) => (
                <NativeSelectOption key={m} value={m}>
                  {THREAD_MODE_LABELS[m]}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
        ) : null}
      </div>
      {isAuto && step.threadMode === "reply" ? (
        <p className="-mt-1 text-muted-foreground text-xs">
          Sent as a reply in the same thread: it reuses the previous email's subject with "Re:".
        </p>
      ) : null}
      <Field className="min-w-0 gap-1.5">
        <FieldLabel htmlFor={`${idp}-body`} className="text-xs">
          Body
        </FieldLabel>
        <Textarea
          id={`${idp}-body`}
          ref={bodyRef}
          rows={9}
          value={body}
          placeholder="Enter email body"
          disabled={!canEdit}
          onFocus={() => {
            lastFocus.current = "body";
          }}
          onChange={(e) => setContent({ body: e.target.value })}
        />
        <FieldDescription className="text-xs">
          Your signature, sender details and an unsubscribe link are added to every email.
        </FieldDescription>
      </Field>
      {canEdit ? (
        <div className="flex flex-wrap gap-2">
          <MergeFieldPicker onPick={insertToken} />
          <SnippetPicker label="Insert snippet" onPick={insertToken} />
          <TemplatePicker
            onPick={(t) => {
              if (subject.trim() || body.trim()) setPendingTemplate(t);
              else applyTemplate(t);
            }}
          />
        </div>
      ) : null}
    </div>
  );

  const assistedForm = (
    <div className="flex flex-col gap-4">
      <Chips
        label="Choose the email type"
        values={EMAIL_KINDS}
        labels={EMAIL_KIND_LABELS}
        selected={[kind]}
        onToggle={setKind}
        disabled={!canEdit}
      />
      <Chips
        label="Personalise with"
        values={PERSONALIZATION_CHIPS}
        labels={PERSONALIZATION_LABELS}
        selected={chips}
        onToggle={(c) => setChips((list) => (list.includes(c) ? list.filter((x) => x !== c) : [...list, c]))}
        disabled={!canEdit}
      />
      {chips.includes("custom") ? (
        <Field className="gap-1.5">
          <FieldLabel htmlFor={`${idp}-custom-note`} className="text-xs">
            Custom note
          </FieldLabel>
          <Input
            id={`${idp}-custom-note`}
            value={customNote}
            maxLength={500}
            onChange={(e) => setCustomNote(e.target.value)}
          />
        </Field>
      ) : null}
      <Chips
        label="Set your tone"
        values={TONES}
        labels={TONE_LABELS}
        selected={[tone]}
        onToggle={setTone}
        disabled={!canEdit}
      />
      {tone === "custom" ? (
        <Field className="gap-1.5">
          <FieldLabel htmlFor={`${idp}-custom-tone`} className="text-xs">
            Describe the tone
          </FieldLabel>
          <Input
            id={`${idp}-custom-tone`}
            value={customTone}
            maxLength={200}
            onChange={(e) => setCustomTone(e.target.value)}
          />
        </Field>
      ) : null}
      <Field className="gap-1.5">
        <FieldLabel htmlFor={`${idp}-context`} className="text-xs">
          Context
        </FieldLabel>
        <Textarea
          id={`${idp}-context`}
          rows={3}
          value={context}
          maxLength={2000}
          placeholder="What you offer, a recent event, anything the email should mention"
          onChange={(e) => setContext(e.target.value)}
        />
      </Field>
      {canEdit ? (
        <div>
          <Button size="sm" disabled={busy === "draft"} onClick={() => void generate("assisted")}>
            <Sparkles data-icon="inline-start" aria-hidden="true" />
            {busy === "draft" ? "Generating…" : "Generate draft"}
          </Button>
        </div>
      ) : null}
    </div>
  );

  const promptForm = (
    <div className="flex flex-col gap-3">
      <Field className="gap-1.5">
        <FieldLabel htmlFor={`${idp}-prompt`} className="text-xs">
          Instruction
        </FieldLabel>
        <Textarea
          id={`${idp}-prompt`}
          rows={4}
          value={prompt}
          maxLength={2000}
          placeholder="For example: a short first email to heads of sales about cutting manual data entry"
          onChange={(e) => setPrompt(e.target.value)}
        />
      </Field>
      {canEdit ? (
        <div>
          <Button size="sm" disabled={busy === "draft" || !prompt.trim()} onClick={() => void generate("prompt")}>
            <Wand2 data-icon="inline-start" aria-hidden="true" />
            {busy === "draft" ? "Writing…" : "Write draft"}
          </Button>
        </div>
      ) : null}
    </div>
  );

  return (
    <div className="flex min-w-0 flex-col gap-3">
      {isAuto ? (
        <div className="flex flex-col gap-2 border-b pb-2 md:flex-row md:items-center md:justify-between">
          <div role="tablist" aria-label={`Versions of step ${position}`} className="flex flex-wrap items-center gap-1">
            {step.variants.map((v) => {
              const selected = v.key === variant?.key;
              return (
                <button
                  key={v.key}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  onClick={() => setVariantKey(v.key)}
                  className={cn(
                    "inline-flex items-center gap-1.5 border-b-2 px-2 py-1 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                    selected ? "border-primary font-medium" : "border-transparent text-muted-foreground",
                  )}
                >
                  Test {v.label}
                  <span
                    className={cn(
                      "rounded px-1.5 text-xs",
                      v.active
                        ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                        : "bg-muted text-muted-foreground",
                    )}
                  >
                    {v.active ? "Active" : "Inactive"}
                  </span>
                </button>
              );
            })}
            {canEdit && step.variants.length < 5 ? (
              <Button size="sm" variant="ghost" onClick={addTest}>
                <Plus data-icon="inline-start" aria-hidden="true" />
                Add test
              </Button>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-1">
            {canEdit && variant && step.variants.length > 1 ? (
              <>
                <Button size="sm" variant="ghost" onClick={() => toggleActive(variant)}>
                  {variant.active ? (
                    <EyeOff data-icon="inline-start" aria-hidden="true" />
                  ) : (
                    <Eye data-icon="inline-start" aria-hidden="true" />
                  )}
                  {variant.active ? `Deactivate ${variant.label}` : `Activate ${variant.label}`}
                </Button>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label={`Delete test ${variant.label}`}
                  onClick={() => removeVariant(variant)}
                >
                  <Trash2 aria-hidden="true" />
                </Button>
              </>
            ) : null}
            {canEdit ? (
              <Button
                size="sm"
                variant="outline"
                disabled={busy === "test" || !body.trim()}
                onClick={() => void sendTest()}
              >
                <Send data-icon="inline-start" aria-hidden="true" />
                {busy === "test" ? "Sending…" : "Send me a test email"}
              </Button>
            ) : null}
            <Button
              size="icon-sm"
              variant={showPreview ? "secondary" : "ghost"}
              aria-pressed={showPreview}
              aria-label={showPreview ? "Hide preview" : "Show preview"}
              onClick={() => setShowPreview((v) => !v)}
            >
              <Eye aria-hidden="true" />
            </Button>
          </div>
        </div>
      ) : null}

      <div
        className={cn("grid min-w-0 gap-4", isAuto && showPreview && "xl:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]")}
      >
        <div className="flex min-w-0 flex-col gap-3">
          {isAuto && canEdit ? (
            <ToggleGroup
              type="single"
              variant="outline"
              size="sm"
              spacing={0}
              value={mode}
              onValueChange={(v) => v && setMode(v as Mode)}
              aria-label={`Writing mode for step ${position}`}
            >
              <ToggleGroupItem value="assisted">Assisted</ToggleGroupItem>
              <ToggleGroupItem value="prompt">Prompt</ToggleGroupItem>
              <ToggleGroupItem value="template">Template</ToggleGroupItem>
            </ToggleGroup>
          ) : null}
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          {draftNote?.notice ? (
            <Alert>
              <AlertDescription>{draftNote.notice}</AlertDescription>
            </Alert>
          ) : null}
          {draftNote && mode === "template" ? (
            <p className="text-muted-foreground text-xs">
              {draftNote.source === "ai"
                ? "Drafted with the AI provider. Review it before saving."
                : "Drafted from a template."}
            </p>
          ) : null}
          {mode === "assisted" && isAuto && canEdit ? assistedForm : null}
          {mode === "prompt" && isAuto && canEdit ? promptForm : null}
          {mode === "template" || !isAuto || !canEdit ? templateForm : null}
        </div>
        {isAuto && showPreview ? (
          <PreviewPanel
            sequenceId={sequenceId}
            subject={step.threadMode === "reply" ? "Re: (previous subject)" : subject}
            body={body}
            stepLabel={stepLabel}
          />
        ) : null}
      </div>

      <AlertDialog open={pendingTemplate !== null} onOpenChange={(open) => !open && setPendingTemplate(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Replace this email?</AlertDialogTitle>
            <AlertDialogDescription>The template replaces the subject and body you've written.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep my text</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pendingTemplate) applyTemplate(pendingTemplate);
                setPendingTemplate(null);
              }}
            >
              Replace
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
