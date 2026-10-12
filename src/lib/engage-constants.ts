/**
 * Vocabulary for sequences, schedules, rulesets and drafts, safe to import from client components.
 * Mirrors the enums in src/server/db/schema.ts (sequence_step.type, sequence.ruleset, sending_schedule.windows).
 */

export const STEP_TYPES = [
  "auto_email",
  "manual_email",
  "call",
  "task",
  "linkedin_connect",
  "linkedin_message",
  "linkedin_view",
  "linkedin_interact",
] as const;
export type StepType = (typeof STEP_TYPES)[number];

export const STEP_TYPE_LABELS: Record<StepType, string> = {
  auto_email: "Automatic email",
  manual_email: "Manual email",
  call: "Phone call",
  task: "Action item",
  linkedin_connect: "LinkedIn: send connection request",
  linkedin_message: "LinkedIn: send message",
  linkedin_view: "LinkedIn: view profile",
  linkedin_interact: "LinkedIn: interact with post",
};

export const STEP_TYPE_HINTS: Record<StepType, string> = {
  auto_email: "Sent for you on schedule.",
  manual_email: "Creates a task to review and send an email yourself.",
  call: "Creates a call task.",
  task: "Creates a to-do task.",
  linkedin_connect: "Creates a task to send a connection request.",
  linkedin_message: "Creates a task to send a LinkedIn message.",
  linkedin_view: "Creates a task to view their profile.",
  linkedin_interact: "Creates a task to like or comment on a post.",
};

export const isEmailStep = (type: StepType) => type === "auto_email" || type === "manual_email";

export const THREAD_MODES = ["new_thread", "reply"] as const;
export type ThreadMode = (typeof THREAD_MODES)[number];
export const THREAD_MODE_LABELS: Record<ThreadMode, string> = {
  new_thread: "New thread",
  reply: "Reply in thread",
};

/** Merge fields the renderer understands. A missing value holds the message back. */
export const MERGE_FIELDS = [
  ["first_name", "First name"],
  ["last_name", "Last name"],
  ["full_name", "Full name"],
  ["email", "Email"],
  ["title", "Job title"],
  ["company", "Company name"],
  ["company_domain", "Company domain"],
  ["city", "City"],
  ["country", "Country"],
] as const;
export type MergeField = (typeof MERGE_FIELDS)[number][0];

/* -------------------------------------------------------------------------- */
/* Schedules                                                                  */
/* -------------------------------------------------------------------------- */

export const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export type Weekday = (typeof WEEKDAYS)[number];
export const WEEKDAY_LABELS: Record<Weekday, string> = {
  mon: "Monday",
  tue: "Tuesday",
  wed: "Wednesday",
  thu: "Thursday",
  fri: "Friday",
  sat: "Saturday",
  sun: "Sunday",
};

export type ScheduleWindows = Partial<Record<Weekday, [string, string][]>>;

export const DEFAULT_SCHEDULE_NAME = "Normal business hours";
export const DEFAULT_SCHEDULE_WINDOWS: ScheduleWindows = {
  mon: [["08:00", "17:00"]],
  tue: [["08:00", "17:00"]],
  wed: [["08:00", "17:00"]],
  thu: [["08:00", "17:00"]],
  fri: [["08:00", "17:00"]],
};

/** "08:00" → "8 AM", "17:30" → "5:30 PM". */
export function formatClock(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const suffix = h >= 12 ? "PM" : "AM";
  const hour = h % 12 === 0 ? 12 : h % 12;
  return m ? `${hour}:${String(m).padStart(2, "0")} ${suffix}` : `${hour} ${suffix}`;
}

export function describeWindows(windows: ScheduleWindows): { day: Weekday; label: string; text: string }[] {
  return WEEKDAYS.flatMap((day) => {
    const ranges = windows[day] ?? [];
    if (!ranges.length) return [];
    return [
      {
        day,
        label: WEEKDAY_LABELS[day],
        text: ranges.map(([a, b]) => `${formatClock(a)}–${formatClock(b)}`).join(", "),
      },
    ];
  });
}

/* -------------------------------------------------------------------------- */
/* Ruleset                                                                    */
/* -------------------------------------------------------------------------- */

export const CONTACT_STAGE_OPTIONS = [
  ["new", "Cold"],
  ["contacted", "Approaching"],
  ["replied", "Replied"],
  ["interested", "Interested"],
  ["not_interested", "Not interested"],
  ["unresponsive", "Unresponsive"],
  ["do_not_contact", "Do not contact"],
  ["bad_data", "Bad data"],
  ["changed_job", "Changed job"],
] as const;
export type ContactStageValue = (typeof CONTACT_STAGE_OPTIONS)[number][0];

export const ACCOUNT_STAGE_OPTIONS = [
  ["cold", "Cold"],
  ["prospect", "Prospect"],
  ["engaged", "Engaged"],
  ["customer", "Customer"],
  ["churned", "Churned"],
] as const;
export type AccountStageValue = (typeof ACCOUNT_STAGE_OPTIONS)[number][0];

export const SAME_ACCOUNT_REPLY_ACTIONS = ["nothing", "finish", "pause"] as const;
export type SameAccountReplyAction = (typeof SAME_ACCOUNT_REPLY_ACTIONS)[number];
export const SAME_ACCOUNT_REPLY_LABELS: Record<SameAccountReplyAction, string> = {
  nothing: "Do nothing",
  finish: "Mark them as finished",
  pause: "Pause them",
};

export interface Ruleset {
  /** When another contact at the same account replies. */
  sameAccountReply: SameAccountReplyAction;
  /** Create a call task when an active contact opens an email at least `opens` times. */
  openCallTask: { enabled: boolean; opens: number };
  /** Mark the contact finished when they click a link (needs click tracking). */
  finishOnClick: boolean;
  /** Mark contacts unresponsive N days after the last step without a reply (null = off). */
  unresponsiveAfterDays: number | null;
  /** Mark emails "Not sent" when the contact's stage is one of these. */
  notSentContactStages: ContactStageValue[];
  /** Mark emails "Not sent" when the account's stage is one of these. */
  notSentAccountStages: AccountStageValue[];
  /** Skip the workspace bounce guard for this sequence. Managers and above only. */
  ignoreBounceProtection: boolean;
}

export const DEFAULT_RULESET: Ruleset = {
  sameAccountReply: "nothing",
  openCallTask: { enabled: false, opens: 3 },
  finishOnClick: false,
  unresponsiveAfterDays: 5,
  notSentContactStages: ["bad_data", "do_not_contact", "not_interested"],
  notSentAccountStages: ["customer"],
  ignoreBounceProtection: false,
};

/** Defaults that always apply and can't be turned off. */
export const LOCKED_TRIGGERS = [
  "Finish the contact when they reply.",
  "Pause the contact when an out-of-office reply arrives.",
  "Finish the contact when a meeting is booked.",
  "Finish the contact when they unsubscribe.",
  "Fail the contact when an email bounces or is rejected as spam.",
] as const;

/* -------------------------------------------------------------------------- */
/* Drafting                                                                   */
/* -------------------------------------------------------------------------- */

export const EMAIL_KINDS = ["outreach", "follow_up", "last_pitch"] as const;
export type EmailKind = (typeof EMAIL_KINDS)[number];
export const EMAIL_KIND_LABELS: Record<EmailKind, string> = {
  outreach: "Outreach",
  follow_up: "Follow-up",
  last_pitch: "Last pitch",
};

export const TONES = ["default", "direct", "formal", "casual", "creative", "custom"] as const;
export type Tone = (typeof TONES)[number];
export const TONE_LABELS: Record<Tone, string> = {
  default: "Default",
  direct: "Direct",
  formal: "Formal",
  casual: "Casual",
  creative: "Creative",
  custom: "Custom",
};

export const PERSONALIZATION_CHIPS = ["company_facts", "technologies", "persona", "custom"] as const;
export type PersonalizationChip = (typeof PERSONALIZATION_CHIPS)[number];
export const PERSONALIZATION_LABELS: Record<PersonalizationChip, string> = {
  company_facts: "Recent company facts",
  technologies: "Technologies they use",
  persona: "Persona",
  custom: "Custom note",
};

/** Ready-made sequence outlines for "Create manually ▾". */
export const SEQUENCE_TEMPLATES = [
  { id: "cold_outreach", name: "Cold outreach", description: "Three emails and a call over two weeks." },
  { id: "event_follow_up", name: "Event follow-up", description: "Two emails after meeting at an event." },
  { id: "re_engage", name: "Re-engage past leads", description: "A short check-in and a last pitch." },
  { id: "multichannel", name: "Multichannel", description: "Email, LinkedIn and a call." },
] as const;
export type SequenceTemplateId = (typeof SEQUENCE_TEMPLATES)[number]["id"];

/** Rolling-window helpers shared by UI copy. */
export function describeWait(days: number, minutes: number, isFirst: boolean, type: StepType): string {
  const verb = type === "auto_email" ? "Send email" : "Create task";
  const parts: string[] = [];
  if (days) parts.push(`${days} day${days === 1 ? "" : "s"}`);
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours) parts.push(`${hours} hour${hours === 1 ? "" : "s"}`);
  if (mins) parts.push(`${mins} minute${mins === 1 ? "" : "s"}`);
  if (!parts.length) return isFirst ? `${verb} immediately` : `${verb} right after the previous step`;
  return isFirst ? `${verb} in ${parts.join(" ")}` : `Wait ${parts.join(" ")}, then ${verb.toLowerCase()}`;
}

/* -------------------------------------------------------------------------- */
/* Call session                                                               */
/* -------------------------------------------------------------------------- */

export const CALL_OUTCOMES = ["connected", "voicemail", "no_answer", "wrong_number"] as const;
export type CallOutcome = (typeof CALL_OUTCOMES)[number];
export const CALL_OUTCOME_LABELS: Record<CallOutcome, string> = {
  connected: "Connected",
  voicemail: "Left voicemail",
  no_answer: "No answer",
  wrong_number: "Wrong number",
};
