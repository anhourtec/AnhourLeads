import "server-only";

import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import type { Actor } from "@/server/auth/actor";
import { db, schema } from "@/server/db";
import { log } from "@/server/log";

import { audit } from "./audit";

/**
 * AI that assists (README §6): optional and provider-agnostic. Nothing here needs a provider: the
 * presets and the email draft fall back to deterministic templates, and every statement about a
 * company comes from workspace data with a link to its source. When a provider is configured
 * (AI_PROVIDER, AI_API_KEY, AI_BASE_URL, AI_MODEL), free-form questions are answered by it, with a
 * system prompt that limits it to the facts supplied.
 */

/* -------------------------------------------------------------------------- */
/* Provider                                                                   */
/* -------------------------------------------------------------------------- */

export interface AiMessageInput {
  role: "user" | "assistant";
  content: string;
}

export interface AiProvider {
  name: "openai-compatible" | "anthropic";
  model: string;
  complete(input: { system: string; messages: AiMessageInput[]; maxTokens: number }): Promise<string>;
}

/** A provider error, already reduced to a plain sentence for the user. */
export class AiProviderError extends Error {}

const TIMEOUT_MS = 30_000;

export const AI_ENV_VARS = ["AI_PROVIDER", "AI_API_KEY", "AI_BASE_URL", "AI_MODEL"] as const;

function providerError(status: number | null): AiProviderError {
  if (status === 401 || status === 403) {
    return new AiProviderError("The AI provider refused the API key. Check AI_API_KEY.");
  }
  if (status === 429) return new AiProviderError("The AI provider is rate limiting requests. Try again in a minute.");
  if (status === null) return new AiProviderError("The AI provider didn't answer in time. Try again.");
  return new AiProviderError("The AI provider couldn't answer right now. Try again later.");
}

async function postJson(url: string, headers: Record<string, string>, body: unknown): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    log.warn("ai provider request failed", { component: "ai", error });
    throw providerError(null);
  }
  if (!res.ok) {
    log.warn("ai provider returned an error", { component: "ai", status: res.status });
    throw providerError(res.status);
  }
  return res.json();
}

function trimSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

function openAiCompatible(apiKey: string, baseUrl: string, model: string): AiProvider {
  return {
    name: "openai-compatible",
    model,
    async complete({ system, messages, maxTokens }) {
      const json = (await postJson(
        `${trimSlash(baseUrl)}/chat/completions`,
        { authorization: `Bearer ${apiKey}` },
        { model, max_tokens: maxTokens, messages: [{ role: "system", content: system }, ...messages] },
      )) as { choices?: { message?: { content?: unknown } }[] };
      const text = json.choices?.[0]?.message?.content;
      if (typeof text !== "string" || !text.trim()) throw providerError(500);
      return text.trim();
    },
  };
}

function anthropicProvider(apiKey: string, baseUrl: string, model: string): AiProvider {
  return {
    name: "anthropic",
    model,
    async complete({ system, messages, maxTokens }) {
      const json = (await postJson(
        `${trimSlash(baseUrl)}/v1/messages`,
        { "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
        { model, max_tokens: maxTokens, system, messages },
      )) as { content?: { type?: string; text?: unknown }[] };
      const text = (json.content ?? [])
        .filter((c) => c.type === "text" && typeof c.text === "string")
        .map((c) => c.text as string)
        .join("\n")
        .trim();
      if (!text) throw providerError(500);
      return text;
    },
  };
}

/** The configured provider, or null when AI is off (the default) or incompletely configured. */
export function aiProvider(): AiProvider | null {
  const kind = (process.env.AI_PROVIDER ?? "none").trim().toLowerCase();
  const apiKey = process.env.AI_API_KEY?.trim();
  const model = process.env.AI_MODEL?.trim();
  if (!apiKey || !model) return null;
  if (kind === "openai-compatible" || kind === "openai") {
    return openAiCompatible(apiKey, process.env.AI_BASE_URL?.trim() || "https://api.openai.com/v1", model);
  }
  if (kind === "anthropic") {
    return anthropicProvider(apiKey, process.env.AI_BASE_URL?.trim() || "https://api.anthropic.com", model);
  }
  return null;
}

export function aiStatus() {
  const provider = aiProvider();
  return { configured: Boolean(provider), provider: provider?.name ?? "none", model: provider?.model ?? null };
}

export const SETUP_MESSAGE =
  "The AI assistant isn't set up in this installation, so it can't answer free-form questions yet. " +
  "An administrator can turn it on by setting AI_PROVIDER (openai-compatible or anthropic), AI_API_KEY, AI_MODEL " +
  "and, if needed, AI_BASE_URL, then restarting the app. The presets below still work without it: build a target " +
  "audience, write an account brief from your research, draft a 3-step sequence or summarise the last 30 days.";

/* -------------------------------------------------------------------------- */
/* AI context center                                                          */
/* -------------------------------------------------------------------------- */

export interface AiContextView {
  companyDescription: string | null;
  valueProposition: string | null;
  targetCustomers: string | null;
  tone: string | null;
  updatedAt: string | null;
}

const contextText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .optional()
    .transform((v) => {
      if (v === undefined) return undefined;
      return v || null;
    });

export const aiContextInput = z
  .object({
    companyDescription: contextText(2000),
    valueProposition: contextText(2000),
    targetCustomers: contextText(2000),
    tone: contextText(500),
  })
  .strict();

export async function getAiContext(actor: Pick<Actor, "organizationId">): Promise<AiContextView> {
  const [row] = await db
    .select()
    .from(schema.aiContext)
    .where(eq(schema.aiContext.organizationId, actor.organizationId))
    .limit(1);
  return {
    companyDescription: row?.companyDescription ?? null,
    valueProposition: row?.valueProposition ?? null,
    targetCustomers: row?.targetCustomers ?? null,
    tone: row?.tone ?? null,
    updatedAt: row?.updatedAt.toISOString() ?? null,
  };
}

export async function updateAiContext(actor: Actor, input: z.infer<typeof aiContextInput>): Promise<AiContextView> {
  const values = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined));
  await db
    .insert(schema.aiContext)
    .values({ organizationId: actor.organizationId, ...values })
    .onConflictDoUpdate({ target: schema.aiContext.organizationId, set: { ...values, updatedAt: new Date() } });
  await audit(actor, "ai_context.update", "ai_context", actor.organizationId, { fields: Object.keys(values) });
  return getAiContext(actor);
}

export function contextIsEmpty(c: AiContextView): boolean {
  return !c.companyDescription && !c.valueProposition && !c.targetCustomers;
}

/* -------------------------------------------------------------------------- */
/* Email drafts (shared with the sequence editor's assisted modes)            */
/* -------------------------------------------------------------------------- */

export interface Source {
  label: string;
  url: string | null;
}

type ContactLike = Partial<Pick<typeof schema.contact.$inferSelect, "firstName" | "lastName" | "title" | "email">>;
type CompanyLike = Partial<
  Pick<typeof schema.company.$inferSelect, "id" | "organizationId" | "name" | "domain" | "industry" | "description">
>;

export interface DraftEmailInput {
  contact?: ContactLike | null;
  company?: CompanyLike | null;
  /** 1-based step position (1 = introduction, 2 = follow-up, 3+ = last note), or an object with it. */
  step: number | { position: number };
  context?: AiContextView | null;
}

export interface DraftEmail {
  subject: string;
  body: string;
  sources: Source[];
}

const CONTEXT_SOURCE: Source = { label: "AI context center", url: "/dashboard/settings/ai-context" };

function firstSentence(text: string, max = 220): string {
  const one = text.split(/(?<=[.!?])\s+/)[0]?.trim() ?? text.trim();
  return one.length > max ? `${one.slice(0, max - 1).trimEnd()}…` : one;
}

function lowerFirst(text: string): string {
  return text && /^[A-Z][a-z]/.test(text) ? text[0]?.toLowerCase() + text.slice(1) : text;
}

/** Company facts usable in a draft, each with the source it came from (never invented). */
async function companyFacts(company: CompanyLike | null | undefined): Promise<{ industry: Source | null }> {
  if (!company?.industry) return { industry: null };
  let url: string | null = company.id ? `/dashboard/companies/${company.id}` : null;
  if (company.id && company.organizationId) {
    const [prov] = await db
      .select({ sourceUrl: schema.fieldProvenance.sourceUrl, source: schema.fieldProvenance.source })
      .from(schema.fieldProvenance)
      .where(
        and(
          eq(schema.fieldProvenance.organizationId, company.organizationId),
          eq(schema.fieldProvenance.entityType, "company"),
          eq(schema.fieldProvenance.entityId, company.id),
          inArray(schema.fieldProvenance.field, ["industry"]),
        ),
      )
      .orderBy(desc(schema.fieldProvenance.retrievedAt))
      .limit(1);
    if (prov?.sourceUrl) url = prov.sourceUrl;
  }
  return { industry: { label: `${company.name ?? "Company"} industry: ${company.industry}`, url } };
}

function templateDraft(position: number, context: AiContextView | null, industry: Source | null): DraftEmail {
  const sources: Source[] = [];
  const value = context?.valueProposition ? firstSentence(context.valueProposition) : null;
  const who = context?.targetCustomers ? lowerFirst(firstSentence(context.targetCustomers, 140)) : null;
  if (value || who) sources.push(CONTEXT_SOURCE);
  if (industry) sources.push(industry);
  const valueLine = value ?? "[Add your value proposition in the AI context center.]";
  const industryLine = industry ? industry.label.replace(/^.*industry: /, "") : null;

  if (position <= 1) {
    let opener = "I'm reaching out because {{company}} looks like a good fit for what we do.";
    if (industryLine) opener = `I work with teams in ${industryLine.toLowerCase()} like {{company}}.`;
    else if (who) opener = `I work with ${who.replace(/\.$/, "")}.`;
    return {
      subject: "Quick question for {{company}}",
      body: `Hi {{first_name}},\n\n${opener}\n\n${valueLine}\n\nWould a short call next week make sense to see if this is useful for {{company}}?\n\nThanks,`,
      sources,
    };
  }
  if (position === 2) {
    return {
      subject: "Re: Quick question for {{company}}",
      body: `Hi {{first_name}},\n\nFollowing up on my last note in case it got buried.\n\n${valueLine}\n\nIf someone else at {{company}} looks after this, I'd be grateful for a pointer.\n\nThanks,`,
      sources,
    };
  }
  return {
    subject: "Should I close the loop?",
    body: "Hi {{first_name}},\n\nI haven't heard back, so I'll assume the timing isn't right and won't follow up again.\n\nIf that changes, just reply to this email.\n\nThanks,",
    sources,
  };
}

function parseDraft(text: string): { subject: string; body: string } | null {
  const match = text.match(/^\s*subject:\s*(.+)\n+([\s\S]+)$/i);
  if (!match?.[1] || !match[2]) return null;
  return { subject: match[1].trim().slice(0, 200), body: match[2].trim() };
}

/**
 * Draft one sequence email. Uses merge fields ({{first_name}}, {{company}}) so it works for every
 * enrolled contact; mentions company facts only when the workspace holds them, with their source.
 * Without a provider (or when it fails) the deterministic template is returned.
 */
export async function draftEmail(input: DraftEmailInput): Promise<DraftEmail> {
  const position = typeof input.step === "number" ? input.step : input.step.position;
  const context = input.context ?? null;
  const { industry } = await companyFacts(input.company);
  const fallback = templateDraft(position, context, industry);
  const provider = aiProvider();
  if (!provider) return fallback;

  const facts = [
    context?.companyDescription && `What we do: ${context.companyDescription}`,
    context?.valueProposition && `Value proposition: ${context.valueProposition}`,
    context?.targetCustomers && `Target customers: ${context.targetCustomers}`,
    context?.tone && `Tone: ${context.tone}`,
    industry && `Recipient company industry: ${industry.label}`,
    input.contact?.title && `Recipient title: ${input.contact.title}`,
  ].filter(Boolean);
  const angles = ["a first introduction", "a short follow-up", "a polite last note"];
  const angle = angles[Math.min(Math.max(position, 1), 3) - 1];
  try {
    const text = await provider.complete({
      system:
        "You write short, plain B2B sales emails. Use only the facts given. Never invent numbers, customers, news or " +
        "personal details. Use the merge fields {{first_name}} and {{company}} instead of names. No exclamation marks. " +
        "Answer with 'Subject: <subject>' on the first line, a blank line, then the body.",
      messages: [{ role: "user", content: `Write ${angle} (step ${position}).\n\nFacts:\n${facts.join("\n")}` }],
      maxTokens: 500,
    });
    const parsed = parseDraft(text);
    return parsed ? { ...parsed, sources: fallback.sources } : fallback;
  } catch (error) {
    if (!(error instanceof AiProviderError)) log.error("draft email failed", { component: "ai", error });
    return fallback;
  }
}
