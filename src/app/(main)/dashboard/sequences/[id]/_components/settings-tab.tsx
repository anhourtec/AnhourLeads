"use client";

import { useState } from "react";

import Link from "next/link";
import { useRouter } from "next/navigation";

import {
  CalendarClock,
  ChevronDown,
  ListChecks,
  Lock,
  Pencil,
  Plus,
  Save,
  Settings2,
  SlidersHorizontal,
} from "lucide-react";
import { toast } from "sonner";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldContent, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  ACCOUNT_STAGE_OPTIONS,
  type AccountStageValue,
  CONTACT_STAGE_OPTIONS,
  type ContactStageValue,
  LOCKED_TRIGGERS,
  SAME_ACCOUNT_REPLY_ACTIONS,
  SAME_ACCOUNT_REPLY_LABELS,
  type SameAccountReplyAction,
} from "@/lib/engage-constants";
import type { SequenceView } from "@/server/services/sequences";

import { apiRequest } from "../../../_components/records/api-client";
import { type MailboxOption, type ScheduleOption, SchedulePreview } from "../../_components/create-flow";

const REVIEW_MODES = {
  all: "Review every email",
  first_step: "Review the first email only",
  none: "Send without review",
} as const;
type ReviewMode = keyof typeof REVIEW_MODES;

function Section({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof Settings2;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="gap-4 py-4">
      <CardHeader className="px-4">
        <CardTitle className="flex items-center gap-2 text-base">
          <Icon className="size-4 text-muted-foreground" aria-hidden="true" />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 px-4">{children}</CardContent>
    </Card>
  );
}

function Group({
  title,
  children,
  defaultOpen = false,
}: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  return (
    <details className="group rounded-lg border" open={defaultOpen}>
      <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-2.5 font-medium text-sm [&::-webkit-details-marker]:hidden">
        {title}
        <ChevronDown
          className="size-4 text-muted-foreground transition-transform group-open:rotate-180"
          aria-hidden="true"
        />
      </summary>
      <div className="flex flex-col gap-4 border-t px-3 py-3">{children}</div>
    </details>
  );
}

function SwitchRow({
  id,
  label,
  description,
  checked,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  description?: React.ReactNode;
  checked: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <Field orientation="horizontal" className="items-start gap-3">
      <Switch id={id} checked={checked} disabled={disabled} onCheckedChange={onChange} className="mt-0.5" />
      <FieldContent>
        <FieldLabel htmlFor={id} className="font-normal">
          {label}
        </FieldLabel>
        {description ? <FieldDescription className="text-xs">{description}</FieldDescription> : null}
      </FieldContent>
    </Field>
  );
}

function StageChecks<T extends string>({
  legend,
  options,
  value,
  disabled,
  onChange,
}: {
  legend: string;
  options: readonly (readonly [T, string])[];
  value: T[];
  disabled: boolean;
  onChange: (v: T[]) => void;
}) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-2 text-sm">{legend}</legend>
      <div className="grid gap-2 sm:grid-cols-3">
        {options.map(([v, label]) => {
          const id = `${legend}-${v}`.replace(/\W+/g, "-");
          return (
            <label key={v} htmlFor={id} className="flex items-center gap-2 text-sm">
              <Checkbox
                id={id}
                checked={value.includes(v)}
                disabled={disabled}
                onCheckedChange={(c) => onChange(c === true ? [...value, v] : value.filter((x) => x !== v))}
              />
              {label}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

const optionalInt = (v: string): number | null => {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
};

/** Sequence settings, scheduling, the ruleset and other sending options, saved together. */
export function SettingsTab({
  sequence,
  mailboxes,
  schedules,
  members,
  canEdit,
  canOverrideBounceGuard,
}: {
  sequence: SequenceView;
  mailboxes: MailboxOption[];
  schedules: ScheduleOption[];
  members: { id: string; name: string }[];
  canEdit: boolean;
  canOverrideBounceGuard: boolean;
}) {
  const router = useRouter();
  const r = sequence.ruleset;
  const [name, setName] = useState(sequence.name);
  const [description, setDescription] = useState(sequence.description ?? "");
  const [tags, setTags] = useState(sequence.tags.join(", "));
  const [ownerId, setOwnerId] = useState(sequence.ownerId ?? "");
  const [scheduleId, setScheduleId] = useState(sequence.scheduleId ?? "");
  const [sameAccountReply, setSameAccountReply] = useState<SameAccountReplyAction>(r.sameAccountReply);
  const [openTask, setOpenTask] = useState(r.openCallTask.enabled);
  const [opens, setOpens] = useState(String(r.openCallTask.opens));
  const [finishOnClick, setFinishOnClick] = useState(r.finishOnClick);
  const [unresponsive, setUnresponsive] = useState(r.unresponsiveAfterDays !== null);
  const [unresponsiveDays, setUnresponsiveDays] = useState(String(r.unresponsiveAfterDays ?? 5));
  const [contactStages, setContactStages] = useState<ContactStageValue[]>(r.notSentContactStages);
  const [accountStages, setAccountStages] = useState<AccountStageValue[]>(r.notSentAccountStages);
  const [ignoreBounce, setIgnoreBounce] = useState(r.ignoreBounceProtection);
  const [mailboxId, setMailboxId] = useState(sequence.mailboxId ?? "");
  const [reviewMode, setReviewMode] = useState<ReviewMode>(sequence.reviewMode);
  const [stopOnReply, setStopOnReply] = useState(sequence.stopOnReply);
  const [maxPer24h, setMaxPer24h] = useState(sequence.maxPer24h ? String(sequence.maxPer24h) : "");
  const [cc, setCc] = useState(sequence.cc ?? "");
  const [bcc, setBcc] = useState(sequence.bcc ?? "");
  const [trackOpens, setTrackOpens] = useState(sequence.trackOpens);
  const [trackClicks, setTrackClicks] = useState(sequence.trackClicks);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const disabled = !canEdit;
  const schedule = schedules.find((s) => s.id === scheduleId);
  const ownerOptions =
    sequence.owner && !members.some((m) => m.id === sequence.owner?.id)
      ? [...members, { id: sequence.owner.id, name: sequence.owner.name }]
      : members;
  const mailboxOptions =
    sequence.mailbox && !mailboxes.some((m) => m.id === sequence.mailbox?.id)
      ? [
          ...mailboxes,
          { id: sequence.mailbox.id, email: sequence.mailbox.email, readyToSend: sequence.mailbox.readyToSend },
        ]
      : mailboxes;

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    const body: Record<string, unknown> = {
      name: name.trim(),
      description: description.trim() || null,
      tags: [
        ...new Set(
          tags
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean),
        ),
      ],
      ...(ownerId ? { ownerId } : {}),
      scheduleId: scheduleId || null,
      mailboxId: mailboxId || null,
      reviewMode,
      stopOnReply,
      maxPer24h: optionalInt(maxPer24h),
      cc: cc.trim() || null,
      bcc: bcc.trim() || null,
      trackOpens,
      trackClicks,
      ruleset: {
        sameAccountReply,
        openCallTask: { enabled: openTask, opens: optionalInt(opens) ?? 3 },
        finishOnClick: trackClicks && finishOnClick,
        unresponsiveAfterDays: unresponsive ? (optionalInt(unresponsiveDays) ?? 5) : null,
        notSentContactStages: contactStages,
        notSentAccountStages: accountStages,
        ...(canOverrideBounceGuard ? { ignoreBounceProtection: ignoreBounce } : {}),
      },
    };
    const result = await apiRequest(`/api/v1/emailer_campaigns/${sequence.id}`, { method: "PATCH", body });
    setSaving(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    toast.success("Settings updated.");
    router.refresh();
  }

  return (
    <form onSubmit={save} noValidate className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-muted-foreground text-sm">
          {canEdit
            ? "Changes apply to emails that haven't been sent yet."
            : "You can view these settings but not change them."}
        </p>
        {canEdit ? (
          <Button type="submit" size="sm" disabled={saving}>
            <Save data-icon="inline-start" aria-hidden="true" />
            {saving ? "Saving…" : "Update settings"}
          </Button>
        ) : null}
      </div>
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <Section icon={Settings2} title="Sequence settings">
        <FieldGroup className="gap-4">
          <Field className="gap-1.5">
            <FieldLabel htmlFor="seq-name">Name</FieldLabel>
            <Input
              id="seq-name"
              value={name}
              maxLength={120}
              disabled={disabled}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <Field className="gap-1.5">
            <FieldLabel htmlFor="seq-description">Description</FieldLabel>
            <Textarea
              id="seq-description"
              rows={3}
              maxLength={2000}
              value={description}
              disabled={disabled}
              onChange={(e) => setDescription(e.target.value)}
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field className="gap-1.5">
              <FieldLabel htmlFor="seq-tags">Tags</FieldLabel>
              <Input
                id="seq-tags"
                value={tags}
                disabled={disabled}
                placeholder="outbound, q4"
                onChange={(e) => setTags(e.target.value)}
              />
              <FieldDescription className="text-xs">Separate tags with commas.</FieldDescription>
            </Field>
            <Field className="gap-1.5">
              <FieldLabel htmlFor="seq-owner">Owner</FieldLabel>
              <NativeSelect
                id="seq-owner"
                className="w-full"
                value={ownerId}
                disabled={disabled}
                onChange={(e) => setOwnerId(e.target.value)}
              >
                {ownerId ? null : <NativeSelectOption value="">No owner</NativeSelectOption>}
                {ownerOptions.map((m) => (
                  <NativeSelectOption key={m.id} value={m.id}>
                    {m.name}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Field>
          </div>
        </FieldGroup>
      </Section>

      <Section icon={CalendarClock} title="Scheduling">
        <Field className="gap-1.5">
          <FieldLabel htmlFor="seq-schedule">Schedule</FieldLabel>
          <NativeSelect
            id="seq-schedule"
            className="w-full"
            value={scheduleId}
            disabled={disabled}
            onChange={(e) => setScheduleId(e.target.value)}
          >
            <NativeSelectOption value="">Mailbox sending window</NativeSelectOption>
            {schedules.map((s) => (
              <NativeSelectOption key={s.id} value={s.id}>
                {s.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Field>
        {schedule ? (
          <SchedulePreview windows={schedule.windows} timezone={schedule.timezone} />
        ) : (
          <p className="text-muted-foreground text-xs">Sends inside the mailbox's own daily window and time zone.</p>
        )}
        <div className="flex flex-wrap gap-2 border-t pt-4">
          <Button asChild size="sm" variant="outline">
            <Link href="/dashboard/settings/schedules">
              <Pencil data-icon="inline-start" aria-hidden="true" />
              Edit schedule
            </Link>
          </Button>
          <Button asChild size="sm" variant="outline">
            <Link href="/dashboard/settings/schedules?new=1">
              <Plus data-icon="inline-start" aria-hidden="true" />
              Create new schedule
            </Link>
          </Button>
        </div>
      </Section>

      <Section icon={ListChecks} title="Ruleset">
        <Group title="Triggers" defaultOpen>
          <Field className="gap-1.5">
            <FieldLabel htmlFor="rule-same-account">When someone else at the same account replies</FieldLabel>
            <NativeSelect
              id="rule-same-account"
              className="w-full sm:w-72"
              value={sameAccountReply}
              disabled={disabled}
              onChange={(e) => setSameAccountReply(e.target.value as SameAccountReplyAction)}
            >
              {SAME_ACCOUNT_REPLY_ACTIONS.map((a) => (
                <NativeSelectOption key={a} value={a}>
                  {SAME_ACCOUNT_REPLY_LABELS[a]}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
          <div className="flex flex-wrap items-center gap-3">
            <SwitchRow
              id="rule-open-task"
              label="Create a call task when an active contact opens an email at least"
              checked={openTask}
              disabled={disabled}
              onChange={setOpenTask}
            />
            <Input
              aria-label="Number of opens"
              type="number"
              min={1}
              max={50}
              className="h-7 w-20 font-mono"
              value={opens}
              disabled={disabled || !openTask}
              onChange={(e) => setOpens(e.target.value)}
            />
            <span className="text-sm">times</span>
          </div>
          {openTask && !trackOpens ? (
            <p className="text-muted-foreground text-xs">Turn on open tracking below for this to work.</p>
          ) : null}
        </Group>
        <Group title="Contact triggers" defaultOpen>
          <SwitchRow
            id="rule-click-finish"
            label="Mark the contact finished when they click a link in an email"
            description={trackClicks ? undefined : "Needs click tracking, which is off for this sequence."}
            checked={trackClicks && finishOnClick}
            disabled={disabled || !trackClicks}
            onChange={setFinishOnClick}
          />
          <div className="flex flex-wrap items-center gap-3">
            <SwitchRow
              id="rule-unresponsive"
              label="Mark contacts unresponsive if they don't reply or book a meeting"
              checked={unresponsive}
              disabled={disabled}
              onChange={setUnresponsive}
            />
            <Input
              aria-label="Days after the last step"
              type="number"
              min={1}
              max={365}
              className="h-7 w-20 font-mono"
              value={unresponsiveDays}
              disabled={disabled || !unresponsive}
              onChange={(e) => setUnresponsiveDays(e.target.value)}
            />
            <span className="text-sm">days after the last step</span>
          </div>
        </Group>
        <Group title="Email triggers">
          <p className="text-muted-foreground text-xs">Emails are marked not sent, and the contact paused, when:</p>
          <StageChecks
            legend="The contact's stage is any of"
            options={CONTACT_STAGE_OPTIONS}
            value={contactStages}
            disabled={disabled}
            onChange={setContactStages}
          />
          <StageChecks
            legend="The account's stage is any of"
            options={ACCOUNT_STAGE_OPTIONS}
            value={accountStages}
            disabled={disabled}
            onChange={setAccountStages}
          />
        </Group>
        <Group title="Default triggers">
          <p className="text-muted-foreground text-xs">These always apply, to protect you and the people you email.</p>
          <ul className="flex flex-col gap-2">
            {LOCKED_TRIGGERS.map((t) => (
              <li key={t} className="flex items-center gap-2 text-sm">
                <Checkbox checked disabled aria-label={t} />
                <span className="min-w-0 flex-1">{t}</span>
                <Lock className="size-3.5 text-muted-foreground" aria-hidden="true" />
              </li>
            ))}
          </ul>
        </Group>
      </Section>

      <Section icon={SlidersHorizontal} title="Other settings">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field className="gap-1.5">
            <FieldLabel htmlFor="seq-mailbox">Send from</FieldLabel>
            <NativeSelect
              id="seq-mailbox"
              className="w-full"
              value={mailboxId}
              disabled={disabled}
              onChange={(e) => setMailboxId(e.target.value)}
            >
              <NativeSelectOption value="">No mailbox</NativeSelectOption>
              {mailboxOptions.map((m) => (
                <NativeSelectOption key={m.id} value={m.id}>
                  {m.email}
                  {m.readyToSend ? "" : " (needs setup)"}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
          <Field className="gap-1.5">
            <FieldLabel htmlFor="seq-review">Review mode</FieldLabel>
            <NativeSelect
              id="seq-review"
              className="w-full"
              value={reviewMode}
              disabled={disabled}
              onChange={(e) => setReviewMode(e.target.value as ReviewMode)}
            >
              {(Object.keys(REVIEW_MODES) as ReviewMode[]).map((m) => (
                <NativeSelectOption key={m} value={m}>
                  {REVIEW_MODES[m]}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
          <Field className="gap-1.5">
            <FieldLabel htmlFor="seq-max">Max emails per 24 hours</FieldLabel>
            <Input
              id="seq-max"
              type="number"
              min={1}
              max={5000}
              inputMode="numeric"
              className="font-mono"
              placeholder="Mailbox limits only"
              value={maxPer24h}
              disabled={disabled}
              onChange={(e) => setMaxPer24h(e.target.value)}
            />
          </Field>
          <div />
          <Field className="gap-1.5">
            <FieldLabel htmlFor="seq-cc">CC all emails to</FieldLabel>
            <Input
              id="seq-cc"
              className="font-mono"
              placeholder="name@company.com"
              value={cc}
              disabled={disabled}
              onChange={(e) => setCc(e.target.value)}
            />
          </Field>
          <Field className="gap-1.5">
            <FieldLabel htmlFor="seq-bcc">BCC all emails to</FieldLabel>
            <Input
              id="seq-bcc"
              className="font-mono"
              placeholder="crm@company.com"
              value={bcc}
              disabled={disabled}
              onChange={(e) => setBcc(e.target.value)}
            />
          </Field>
        </div>
        <div className="flex flex-col gap-3 border-t pt-4">
          <SwitchRow
            id="seq-stop-reply"
            label="Stop on reply"
            description="When off, contacts who reply keep getting the remaining steps."
            checked={stopOnReply}
            disabled={disabled}
            onChange={setStopOnReply}
          />
          <SwitchRow
            id="seq-track-opens"
            label="Track opens"
            description="Adds an invisible image to emails. Off by default."
            checked={trackOpens}
            disabled={disabled}
            onChange={setTrackOpens}
          />
          <SwitchRow
            id="seq-track-clicks"
            label="Track clicks"
            description="Routes links through this app to count clicks. Off by default."
            checked={trackClicks}
            disabled={disabled}
            onChange={setTrackClicks}
          />
          <SwitchRow
            id="seq-ignore-bounce"
            label="Ignore bounce protection"
            description={
              canOverrideBounceGuard
                ? "Bounce guard won't pause this sequence. High bounce rates can damage your domain's reputation."
                : "Only managers and above can change this."
            }
            checked={ignoreBounce}
            disabled={disabled || !canOverrideBounceGuard}
            onChange={setIgnoreBounce}
          />
        </div>
      </Section>
    </form>
  );
}
