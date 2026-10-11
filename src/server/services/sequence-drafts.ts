import "server-only";

import { and, eq } from "drizzle-orm";
import { z } from "zod";

import {
  EMAIL_KINDS,
  type EmailKind,
  PERSONALIZATION_CHIPS,
  type PersonalizationChip,
  SEQUENCE_TEMPLATES,
  type SequenceTemplateId,
  TONES,
  type Tone,
} from "@/lib/engage-constants";
import type { Actor } from "@/server/auth/actor";
import { db, schema } from "@/server/db";
import { HttpError } from "@/server/http/errors";
import { log } from "@/server/log";

import { AiProviderError, aiProvider, draftEmail, getAiContext } from "./ai";
import { mergeValuesFor, renderTemplate } from "./sending";
import { findSequence, type StepInput } from "./sequences";

/**
 * Drafting help for the sequence builder. Everything works without an AI provider: drafts come from
 * deterministic templates that use merge fields, so they read correctly for every contact. When the
 * installation has a provider configured (src/server/services/ai.ts), Assisted and Prompt modes use it.
 */

const AI_SETUP =
  "No AI provider is configured, so this draft comes from a template. An administrator can set one up in settings.";

/* -------------------------------------------------------------------------- */
/* Single email drafts                                                        */
/* -------------------------------------------------------------------------- */

export const draftSchema = z
  .object({
    mode: z.enum(["assisted", "prompt"]),
    kind: z.enum(EMAIL_KINDS).default("outreach"),
    tone: z.enum(TONES).default("default"),
    customTone: z.string().trim().max(200).optional(),
    personalization: z.array(z.enum(PERSONALIZATION_CHIPS)).max(PERSONALIZATION_CHIPS.length).default([]),
    customNote: z.string().trim().max(500).optional(),
    context: z.string().trim().max(2000).optional(),
    prompt: z.string().trim().max(2000).optional(),
    /** Optional contact used to fetch facts for the AI and to show a rendered preview. */
    contactId: z.string().min(1).max(100).optional(),
  })
  .strict()
  .refine((v) => v.mode !== "prompt" || Boolean(v.prompt), { message: "Write an instruction.", path: ["prompt"] });

export interface Draft {
  subject: string;
  body: string;
  source: "ai" | "template";
  notice: string | null;
}

const GREETING: Record<Tone, string> = {
  default: "Hi {{first_name}},",
  direct: "{{first_name}},",
  formal: "Dear {{first_name}},",
  casual: "Hey {{first_name}},",
  creative: "Hi {{first_name}},",
  custom: "Hi {{first_name}},",
};

const SIGN_OFF: Record<Tone, string> = {
  default: "Thanks,",
  direct: "Thanks,",
  formal: "Kind regards,",
  casual: "Cheers,",
  creative: "Talk soon,",
  custom: "Thanks,",
};

const SUBJECTS: Record<EmailKind, Record<Tone, string>> = {
  outreach: {
    default: "Quick question for {{company}}",
    direct: "{{company}} and a faster pipeline",
    formal: "An introduction for {{company}}",
    casual: "Idea for {{company}}",
    creative: "A small idea for {{company}}",
    custom: "Quick question for {{company}}",
  },
  follow_up: {
    default: "Following up, {{first_name}}",
    direct: "Any thoughts, {{first_name}}?",
    formal: "Following up on my previous note",
    casual: "Bumping this up",
    creative: "Round two, {{first_name}}",
    custom: "Following up, {{first_name}}",
  },
  last_pitch: {
    default: "Should I close the loop?",
    direct: "Last note from me",
    formal: "Closing the loop",
    casual: "Last one, promise",
    creative: "The final chapter",
    custom: "Should I close the loop?",
  },
};

const OPENERS: Record<EmailKind, Record<Tone, string>> = {
  outreach: {
    default: "I'm reaching out because teams like {{company}} often look for an easier way to do this.",
    direct: "I'll keep this short: I think we can help {{company}}.",
    formal: "I am writing to introduce how we support organisations such as {{company}}.",
    casual: "Came across {{company}} and thought this might be useful.",
    creative: "If {{company}} had one less thing to worry about this quarter, what would it be?",
    custom: "I'm reaching out because teams like {{company}} often look for an easier way to do this.",
  },
  follow_up: {
    default: "Following up on my last note in case it got buried.",
    direct: "Checking you saw my last email.",
    formal: "I wanted to follow up on my previous message.",
    casual: "Just floating this back to the top of your inbox.",
    creative: "Inboxes are busy, so here's my earlier note again in one line.",
    custom: "Following up on my last note in case it got buried.",
  },
  last_pitch: {
    default: "I haven't heard back, so I'll assume the timing isn't right.",
    direct: "This is my last email on this.",
    formal: "As I have not heard back, I will not follow up further after this message.",
    casual: "I'll stop here so I don't clutter your inbox.",
    creative: "I'll take the silence as a 'not now', which is completely fine.",
    custom: "I haven't heard back, so I'll assume the timing isn't right.",
  },
};

const ASKS: Record<EmailKind, string> = {
  outreach: "Would a 15-minute call next week make sense?",
  follow_up: "If someone else at {{company}} looks after this, I'd be grateful for a pointer.",
  last_pitch: "If that changes, just reply to this email.",
};

const CHIP_LINES: Record<Exclude<PersonalizationChip, "custom">, string> = {
  company_facts: "I was reading about {{company}} and what you're working on caught my eye.",
  technologies: "Given the tools {{company}} already uses, this would fit in without much change.",
  persona: "As {{title}}, you're probably the one who feels this most.",
};

const KIND_POSITION: Record<EmailKind, number> = { outreach: 1, follow_up: 2, last_pitch: 3 };

/** Deterministic draft: greeting, opener, personalisation lines, context, ask, sign-off. */
export function templateDraft(input: {
  kind: EmailKind;
  tone: Tone;
  personalization: PersonalizationChip[];
  customNote?: string;
  context?: string;
}): { subject: string; body: string } {
  const lines = [GREETING[input.tone], "", OPENERS[input.kind][input.tone]];
  const chips = input.personalization.filter((c): c is Exclude<PersonalizationChip, "custom"> => c !== "custom");
  if (chips.length) lines.push("", ...chips.map((c) => CHIP_LINES[c]));
  if (input.personalization.includes("custom") && input.customNote) lines.push("", input.customNote);
  if (input.context) lines.push("", input.context);
  lines.push("", ASKS[input.kind], "", SIGN_OFF[input.tone]);
  return { subject: SUBJECTS[input.kind][input.tone], body: lines.join("\n") };
}

async function previewContact(actor: Actor, contactId: string | undefined) {
  if (!contactId) return { contact: null, company: null };
  const [contact] = await db
    .select()
    .from(schema.contact)
    .where(and(eq(schema.contact.id, contactId), eq(schema.contact.organizationId, actor.organizationId)))
    .limit(1);
  if (!contact)
    throw new HttpError(422, "Some fields are invalid.", [{ path: "contactId", message: "Contact not found." }]);
  const [company] = contact.companyId
    ? await db.select().from(schema.company).where(eq(schema.company.id, contact.companyId)).limit(1)
    : [];
  return { contact, company: company ?? null };
}

function parseSubjectBody(text: string): { subject: string; body: string } | null {
  const match = text.match(/^\s*subject:\s*(.+)\n+([\s\S]+)$/i);
  if (!match?.[1] || !match[2]) return null;
  return { subject: match[1].trim().slice(0, 200), body: match[2].trim() };
}

export async function draftStepEmail(actor: Actor, sequenceId: string, input: unknown): Promise<Draft> {
  await findSequence(actor, sequenceId);
  const data = draftSchema.parse(input);
  const { contact, company } = await previewContact(actor, data.contactId);
  const fallback = templateDraft(data);
  const provider = aiProvider();

  if (data.mode === "assisted") {
    if (!provider) return { ...fallback, source: "template", notice: null };
    const ai = await draftEmail({
      contact,
      company,
      step: KIND_POSITION[data.kind],
      context: await getAiContext(actor),
    });
    return { subject: ai.subject, body: ai.body, source: "ai", notice: null };
  }

  if (!provider) return { ...fallback, source: "template", notice: AI_SETUP };
  try {
    const text = await provider.complete({
      system:
        "You write short, plain B2B sales emails. Never invent facts, numbers or customers. Use the merge fields " +
        "{{first_name}} and {{company}} instead of names. No exclamation marks. Answer with 'Subject: <subject>' " +
        "on the first line, a blank line, then the body.",
      messages: [
        {
          role: "user",
          content: [
            `Instruction: ${data.prompt}`,
            `Email type: ${data.kind.replace("_", " ")}`,
            `Tone: ${data.tone === "custom" ? (data.customTone ?? "default") : data.tone}`,
            data.context ? `Context: ${data.context}` : "",
          ]
            .filter(Boolean)
            .join("\n"),
        },
      ],
      maxTokens: 500,
    });
    const parsed = parseSubjectBody(text);
    if (parsed) return { ...parsed, source: "ai", notice: null };
  } catch (error) {
    if (!(error instanceof AiProviderError)) log.error("prompt draft failed", { component: "sequence-drafts", error });
  }
  return {
    ...fallback,
    source: "template",
    notice: "The AI provider didn't answer, so this draft comes from a template.",
  };
}

/* -------------------------------------------------------------------------- */
/* Whole-sequence drafts                                                      */
/* -------------------------------------------------------------------------- */

export const generateSequenceSchema = z
  .object({
    audience: z.string().trim().min(1, "Describe who you're writing to.").max(300),
    goal: z.string().trim().min(1, "Say what you want them to do.").max(300),
    steps: z.number().int().min(2, "At least 2 steps.").max(8, "At most 8 steps."),
    tone: z.enum(TONES).default("default"),
    includeCalls: z.boolean().default(true),
  })
  .strict();

type DraftStep = Pick<StepInput, "type" | "waitDays" | "waitMinutes" | "threadMode" | "subject" | "body">;

/** A full outline from audience, goal, length and tone. Emails thread after the first; calls interleave. */
export function generateSequence(input: z.infer<typeof generateSequenceSchema>): { name: string; steps: DraftStep[] } {
  const steps: DraftStep[] = [];
  const total = input.steps;
  const waits = [0, 3, 4, 5, 7, 7, 10, 14];
  for (let i = 0; i < total; i++) {
    const isLast = i === total - 1 && total > 2;
    const isCall = input.includeCalls && i > 0 && !isLast && i % 3 === 2;
    if (isCall) {
      steps.push({
        type: "call",
        waitDays: waits[Math.min(i, waits.length - 1)],
        waitMinutes: 0,
        threadMode: "new_thread",
        subject: null,
        body: `Call {{first_name}} about ${input.goal.toLowerCase()}. Mention the emails you sent.`,
      });
      continue;
    }
    let kind: EmailKind = "follow_up";
    if (i === 0) kind = "outreach";
    else if (isLast) kind = "last_pitch";
    const draft = templateDraft({
      kind,
      tone: input.tone,
      personalization: i === 0 ? ["persona"] : [],
      context: i === 0 ? `We help ${input.audience} ${input.goal.replace(/\.$/, "").toLowerCase()}.` : undefined,
    });
    steps.push({
      type: "auto_email",
      waitDays: i === 0 ? 0 : waits[Math.min(i, waits.length - 1)],
      waitMinutes: i === 0 ? 30 : 0,
      threadMode: i === 0 ? "new_thread" : "reply",
      subject: i === 0 ? draft.subject : null,
      body: draft.body,
    });
  }
  const name = `${input.audience.slice(0, 60)}: ${input.goal.slice(0, 50)}`.replace(/\s+/g, " ").trim();
  return { name: name.slice(0, 120), steps };
}

/** Ready-made outlines for "Create manually ▾ → from a template". */
export function sequenceTemplate(id: SequenceTemplateId): { name: string; steps: DraftStep[] } {
  const meta = SEQUENCE_TEMPLATES.find((t) => t.id === id);
  if (!meta) throw new HttpError(422, "Pick a template.");
  const email = (
    kind: EmailKind,
    waitDays: number,
    threadMode: "new_thread" | "reply",
    context?: string,
  ): DraftStep => {
    const d = templateDraft({ kind, tone: "default", personalization: [], context });
    return {
      type: "auto_email",
      waitDays,
      waitMinutes: waitDays ? 0 : 30,
      threadMode,
      subject: threadMode === "reply" ? null : d.subject,
      body: d.body,
    };
  };
  const task = (type: DraftStep["type"], waitDays: number, body: string): DraftStep => ({
    type,
    waitDays,
    waitMinutes: 0,
    threadMode: "new_thread",
    subject: null,
    body,
  });
  const steps: Record<SequenceTemplateId, DraftStep[]> = {
    cold_outreach: [
      email("outreach", 0, "new_thread"),
      email("follow_up", 3, "reply"),
      task("call", 2, "Call {{first_name}} and reference the emails."),
      email("last_pitch", 5, "reply"),
    ],
    event_follow_up: [
      email("outreach", 0, "new_thread", "It was good to meet at the event."),
      email("follow_up", 4, "reply"),
    ],
    re_engage: [
      email("follow_up", 0, "new_thread", "We spoke a while ago and a lot has changed since."),
      email("last_pitch", 7, "reply"),
    ],
    multichannel: [
      task("linkedin_view", 0, "View {{first_name}}'s profile before reaching out."),
      email("outreach", 1, "new_thread"),
      task("linkedin_connect", 2, "Send a connection request with a short note."),
      task("call", 3, "Call {{first_name}}."),
      email("last_pitch", 4, "reply"),
    ],
  };
  return { name: meta.name, steps: steps[id] };
}

/* -------------------------------------------------------------------------- */
/* Preview                                                                    */
/* -------------------------------------------------------------------------- */

export const previewSchema = z
  .object({
    contactId: z.string().min(1).max(100),
    subject: z.string().max(300).nullish(),
    body: z.string().max(20_000).nullish(),
  })
  .strict();

/** Render a subject and body for one contact, listing merge fields the contact has no value for. */
const senderLine = (m: { displayName: string | null; email: string }) =>
  m.displayName ? `${m.displayName} <${m.email}>` : m.email;

export async function previewForContact(actor: Actor, sequenceId: string, input: unknown) {
  const row = await findSequence(actor, sequenceId);
  const data = previewSchema.parse(input);
  const { contact, company } = await previewContact(actor, data.contactId);
  if (!contact) throw new HttpError(422, "Pick a contact.");
  const values = mergeValuesFor(contact, company);
  const subject = renderTemplate(data.subject ?? "", values);
  const body = renderTemplate(data.body ?? "", values);
  const [mailbox] = row.mailboxId
    ? await db.select().from(schema.mailbox).where(eq(schema.mailbox.id, row.mailboxId)).limit(1)
    : [];
  return {
    subject: subject.text,
    body: body.text,
    signature: mailbox?.signature ?? null,
    from: mailbox ? senderLine(mailbox) : null,
    to: contact.email,
    missing: [...new Set([...subject.missing, ...body.missing])],
  };
}
