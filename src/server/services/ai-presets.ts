import "server-only";

import { and, asc, desc, eq, sql } from "drizzle-orm";

import type { Actor } from "@/server/auth/actor";
import { registrableDomain } from "@/server/crawler/url";
import { db, schema } from "@/server/db";
import { log } from "@/server/log";

import { type AiContextView, contextIsEmpty, draftEmail, getAiContext, type Source } from "./ai";
import { queryAnalytics } from "./analytics";
import { provenanceFor } from "./enrichment-common";
import { findingsOf } from "./research";

/**
 * Deterministic assistant presets. They work without an AI provider and only state what the
 * workspace holds, with a link to where each fact came from. When a fact isn't there, they say so.
 */

export const AI_PRESETS = ["prospecting", "research", "sequencing", "analytics"] as const;
export type AiPreset = (typeof AI_PRESETS)[number];

export const PRESET_LABELS: Record<AiPreset, string> = {
  prospecting: "Build your target audience",
  research: "Write an account brief",
  sequencing: "Draft a 3-step sequence",
  analytics: "Summarise the last 30 days",
};

export interface AssistantAction {
  label: string;
  href: string;
}

export interface AssistantReply {
  content: string;
  sources: Source[];
  actions: AssistantAction[];
  grounded: boolean;
}

/* -------------------------------------------------------------------------- */
/* Prospecting                                                                */
/* -------------------------------------------------------------------------- */

const SENIORITY_WORDS: Array<[RegExp, string]> = [
  [/\bfounders?\b/i, "founder"],
  [/\bowners?\b/i, "owner"],
  [/\b(c-suite|ceo|cto|cfo|coo|cmo|cro|chief)\b/i, "c_suite"],
  [/\b(vp|vps|vice presidents?)\b/i, "vp"],
  [/\bheads? of\b/i, "head"],
  [/\bdirectors?\b/i, "director"],
  [/\bmanagers?\b/i, "manager"],
];
const SENIORITY_LABELS: Record<string, string> = {
  owner: "owners",
  founder: "founders",
  c_suite: "C-suite",
  partner: "partners",
  vp: "VPs",
  head: "heads of department",
  director: "directors",
  manager: "managers",
  senior: "senior staff",
  entry: "entry level",
  intern: "interns",
};

async function prospecting(actor: Actor, prompt: string, context: AiContextView): Promise<AssistantReply> {
  const [persona] = await db
    .select()
    .from(schema.persona)
    .where(eq(schema.persona.organizationId, actor.organizationId))
    .orderBy(asc(schema.persona.createdAt))
    .limit(1);
  const params = new URLSearchParams();
  const sources: Source[] = [];
  const described: string[] = [];
  let seniorities: string[] = [];
  let title: string | null = null;

  if (persona) {
    title = persona.titles[0] ?? null;
    seniorities = persona.seniorities.filter((s) => s in SENIORITY_LABELS);
    sources.push({ label: `Persona: ${persona.name}`, url: null });
    described.push(`your persona "${persona.name}"`);
  } else {
    const text = `${prompt} ${context.targetCustomers ?? ""}`;
    seniorities = [...new Set(SENIORITY_WORDS.filter(([re]) => re.test(text)).map(([, s]) => s))];
    if (context.targetCustomers) {
      sources.push({ label: "AI context center: target customers", url: "/dashboard/settings/ai-context" });
      described.push("the target customers in your AI context center");
    }
  }
  if (title) params.set("title", title);
  for (const s of seniorities) params.append("seniority", s);
  const href = `/dashboard/people${params.size ? `?${params.toString()}` : ""}`;

  if (!params.size) {
    return {
      content:
        "I couldn't work out a target audience yet: there are no personas in this workspace and the AI context center " +
        "doesn't name the roles you sell to. Describe your target customers there (for example \"VPs of sales at software " +
        'companies"), or open people search and set the filters yourself.',
      sources: [CONTEXT_LINK],
      actions: [
        { label: "Open AI context center", href: "/dashboard/settings/ai-context" },
        { label: "Open people search", href: "/dashboard/people" },
      ],
      grounded: true,
    };
  }
  const parts = [
    title ? `job title containing "${title}"` : null,
    seniorities.length ? `seniority: ${seniorities.map((s) => SENIORITY_LABELS[s] ?? s).join(", ")}` : null,
  ].filter(Boolean);
  return {
    content: `Here's a people search built from ${described.join(" and ") || "your request"}: ${parts.join("; ")}. Open it to review the matches in your workspace and save the ones that fit.`,
    sources,
    actions: [{ label: "Open people search", href }],
    grounded: true,
  };
}

const CONTEXT_LINK: Source = { label: "AI context center", url: "/dashboard/settings/ai-context" };

/* -------------------------------------------------------------------------- */
/* Research: account brief                                                    */
/* -------------------------------------------------------------------------- */

type CompanyRow = typeof schema.company.$inferSelect;

/** The workspace company a prompt is about: a domain in the text, else the longest company name it contains. */
export async function companyFromPrompt(actor: Actor, prompt: string): Promise<CompanyRow | null> {
  const text = prompt.toLowerCase();
  const domain = text.match(/\b((?:[a-z0-9-]+\.)+[a-z]{2,})\b/)?.[1];
  if (domain) {
    const bare = registrableDomain(domain.replace(/^www\./, ""));
    const [row] = await db
      .select()
      .from(schema.company)
      .where(
        and(
          eq(schema.company.organizationId, actor.organizationId),
          sql`lower(${schema.company.domain}) in (${bare}, ${`www.${bare}`}, ${domain})`,
        ),
      )
      .limit(1);
    if (row) return row;
  }
  const names = await db
    .select({ id: schema.company.id, name: schema.company.name })
    .from(schema.company)
    .where(eq(schema.company.organizationId, actor.organizationId))
    .limit(5000);
  const hit = names
    .filter((c) => c.name.trim().length >= 2 && text.includes(c.name.trim().toLowerCase()))
    .sort((a, b) => b.name.length - a.name.length)[0];
  if (!hit) return null;
  const [row] = await db.select().from(schema.company).where(eq(schema.company.id, hit.id)).limit(1);
  return row ?? null;
}

interface Fact {
  text: string;
  source: Source;
}

const FIELD_LABELS: Partial<Record<keyof CompanyRow, string>> = {
  description: "What they do",
  industry: "Industry",
  employeeCount: "Employees",
  foundedYear: "Founded",
  city: "City",
  country: "Country",
  technologies: "Technologies seen",
  websiteUrl: "Website",
  linkedinUrl: "LinkedIn",
};

/** Facts about a company, each linked to its provenance or the crawl page it came from. */
export async function companyBrief(
  actor: Actor,
  company: CompanyRow,
): Promise<{ facts: Fact[]; crawlJobId: string | null }> {
  const recordUrl = `/dashboard/companies/${company.id}`;
  const provenance = await provenanceFor(actor.organizationId, "company", company.id);
  const facts: Fact[] = [];
  for (const [field, label] of Object.entries(FIELD_LABELS) as Array<[keyof CompanyRow, string]>) {
    const raw = company[field];
    const value = Array.isArray(raw) ? raw.slice(0, 8).join(", ") : raw;
    if (value === null || value === undefined || value === "") continue;
    const prov = provenance.find((p) => p.field === field);
    const source: Source = prov
      ? { label: `${prov.source} · ${prov.retrievedAt.slice(0, 10)}`, url: prov.sourceUrl ?? recordUrl }
      : { label: "Company record", url: recordUrl };
    facts.push({ text: `${label}: ${typeof value === "string" ? value : String(value)}`, source });
  }

  const [job] = await db
    .select()
    .from(schema.crawlJob)
    .where(
      and(
        eq(schema.crawlJob.organizationId, actor.organizationId),
        eq(schema.crawlJob.status, "completed"),
        company.domain
          ? sql`(${schema.crawlJob.companyId} = ${company.id} or ${schema.crawlJob.result}->>'domain' = ${registrableDomain(company.domain.replace(/^www\./, "").split(":")[0] ?? company.domain)})`
          : eq(schema.crawlJob.companyId, company.id),
      ),
    )
    .orderBy(desc(schema.crawlJob.finishedAt))
    .limit(1);
  const findings = job ? findingsOf(job) : null;
  if (job && findings) {
    const jobUrl = `/dashboard/research/${job.id}`;
    const crawled = (url: string): Source => ({ label: `Website crawl · ${url}`, url });
    if (findings.hiring.jobCount) {
      facts.push({
        text: `Hiring: ${findings.hiring.jobCount} open roles listed${findings.hiring.ats.length ? ` (via ${findings.hiring.ats.join(", ")})` : ""}`,
        source: findings.hiring.careersUrl
          ? crawled(findings.hiring.careersUrl)
          : { label: "Website crawl", url: jobUrl },
      });
    }
    for (const person of findings.people.slice(0, 5)) {
      facts.push({
        text: `Team page lists ${person.name}${person.title ? `, ${person.title}` : ""}`,
        source: crawled(person.sourceUrl),
      });
    }
    const known = new Set(facts.map((f) => f.text.split(":")[0]));
    for (const fact of findings.facts) {
      if (fact.field === "description" && !known.has("What they do")) {
        facts.push({ text: `Their site says: ${firstLine(fact.value)}`, source: crawled(fact.sourceUrl) });
        known.add("What they do");
      }
    }
    if (!company.technologies.length && findings.technologies.length) {
      const first = findings.technologies[0];
      facts.push({
        text: `Technologies seen: ${findings.technologies
          .slice(0, 8)
          .map((t) => t.name)
          .join(", ")}`,
        source: first ? crawled(first.sourceUrl) : { label: "Website crawl", url: jobUrl },
      });
    }
  }
  return { facts, crawlJobId: job?.id ?? null };
}

function firstLine(text: string): string {
  const t = text.trim().split(/\n/)[0] ?? "";
  return t.length > 240 ? `${t.slice(0, 239)}…` : t;
}

/** Numbered sources: each fact ends with [n], and the reply carries the matching links. */
function cite(facts: Fact[]): { lines: string[]; sources: Source[] } {
  const sources: Source[] = [];
  const lines = facts.map((f) => {
    let index = sources.findIndex((s) => s.url === f.source.url && s.label === f.source.label);
    if (index === -1) {
      sources.push(f.source);
      index = sources.length - 1;
    }
    return `- ${f.text} [${index + 1}]`;
  });
  return { lines, sources };
}

async function research(actor: Actor, prompt: string): Promise<AssistantReply> {
  const company = await companyFromPrompt(actor, prompt);
  if (!company) {
    return {
      content:
        "Which company should the brief cover? I couldn't match a company in this workspace from your message. " +
        "Name it exactly as it's saved, or give its domain (for example acme.com). I only write briefs from data the " +
        "workspace holds, so add the company first if it's new.",
      sources: [],
      actions: [{ label: "Open companies", href: "/dashboard/companies" }],
      grounded: true,
    };
  }
  const { facts, crawlJobId } = await companyBrief(actor, company);
  const actions: AssistantAction[] = [{ label: `Open ${company.name}`, href: `/dashboard/companies/${company.id}` }];
  if (!crawlJobId) actions.push({ label: "Research the website", href: "/dashboard/research" });
  if (!facts.length) {
    return {
      content: `There aren't enough facts about ${company.name} in this workspace to write a brief yet. The record has no description, industry or size, and its website hasn't been crawled. Run a crawl from Research, then ask again.`,
      sources: [],
      actions,
      grounded: true,
    };
  }
  const { lines, sources } = cite(facts);
  const gaps = [
    !company.description && "what they do",
    !company.industry && "industry",
    !company.employeeCount && "headcount",
    !crawlJobId && "a website crawl",
  ].filter(Boolean);
  const content = [
    `Account brief: ${company.name}${company.domain ? ` (${company.domain})` : ""}`,
    "",
    ...lines,
    "",
    gaps.length
      ? `Not available in this workspace: ${gaps.join(", ")}. Nothing above is inferred beyond the sources listed.`
      : "Every point above comes from the sources listed.",
  ].join("\n");
  return { content, sources, actions, grounded: true };
}

/* -------------------------------------------------------------------------- */
/* Sequencing                                                                 */
/* -------------------------------------------------------------------------- */

async function sequencing(actor: Actor, prompt: string, context: AiContextView): Promise<AssistantReply> {
  if (contextIsEmpty(context)) {
    return {
      content:
        "The AI context center is empty, so a draft would have nothing true to say about what you offer. Add your " +
        "company description, value proposition and target customers there, then ask again.",
      sources: [CONTEXT_LINK],
      actions: [{ label: "Open AI context center", href: "/dashboard/settings/ai-context" }],
      grounded: true,
    };
  }
  const company = prompt ? await companyFromPrompt(actor, prompt) : null;
  const steps = await Promise.all([1, 2, 3].map((step) => draftEmail({ step, company, context })));
  const waits = ["Day 1", "Day 4", "Day 9"];
  const sources: Source[] = [];
  for (const s of steps.flatMap((d) => d.sources)) {
    if (!sources.some((x) => x.label === s.label && x.url === s.url)) sources.push(s);
  }
  const content = [
    `Draft 3-step sequence${company ? ` for ${company.name}` : ""}. Merge fields like {{first_name}} are filled in for each contact when the email is sent; review every step before using it.`,
    ...steps.flatMap((d, i) => ["", `Step ${i + 1} · ${waits[i]}`, `Subject: ${d.subject}`, "", d.body]),
  ].join("\n");
  return { content, sources, actions: [{ label: "Open sequences", href: "/dashboard/sequences" }], grounded: true };
}

/* -------------------------------------------------------------------------- */
/* Analytics                                                                  */
/* -------------------------------------------------------------------------- */

type Metric = Parameters<typeof queryAnalytics>[1]["metric"];

const SUMMARY_METRICS = [
  "emails_sent",
  "emails_delivered",
  "emails_bounced",
  "emails_replied",
  "positive_replies",
  "tasks_completed",
  "deals_won",
] as const satisfies readonly Metric[];

async function analytics(actor: Actor): Promise<AssistantReply> {
  const to = new Date();
  const from = new Date(to.getTime() - 30 * 864e5);
  const totals = new Map<string, number>();
  for (const metric of SUMMARY_METRICS) {
    try {
      const result = await queryAnalytics(actor, { metric, groupBy: "none", from, to });
      totals.set(metric, result.total);
    } catch (error) {
      log.warn("analytics preset metric failed", { component: "ai", metric, error });
    }
  }
  const n = (k: string) => totals.get(k) ?? 0;
  const fmt = (v: number) => v.toLocaleString("en-US");
  const sent = n("emails_sent");
  const rate = (part: number) => (sent ? `${((part / sent) * 100).toFixed(1)}%` : "n/a");
  const lines = [
    `Last 30 days (${from.toISOString().slice(0, 10)} to ${to.toISOString().slice(0, 10)}):`,
    "",
    `- Emails sent: ${fmt(sent)}`,
    `- Delivered: ${fmt(n("emails_delivered"))}`,
    `- Bounced: ${fmt(n("emails_bounced"))} (bounce rate ${rate(n("emails_bounced"))})`,
    `- Replies: ${fmt(n("emails_replied"))} (reply rate ${rate(n("emails_replied"))})`,
    `- Positive replies: ${fmt(n("positive_replies"))}`,
    `- Tasks completed: ${fmt(n("tasks_completed"))}`,
    `- Deals won: ${fmt(n("deals_won"))}`,
  ];
  if (!sent) lines.push("", "No emails were sent in this period, so there are no rates to compare yet.");
  else if (n("emails_bounced") / sent > 0.05) {
    lines.push("", "The bounce rate is above 5%. Verify list emails before the next send.");
  }
  return {
    content: lines.join("\n"),
    sources: [{ label: "Analytics", url: "/dashboard/analytics" }],
    actions: [{ label: "Open analytics", href: "/dashboard/analytics" }],
    grounded: true,
  };
}

/* -------------------------------------------------------------------------- */
/* Entry points                                                               */
/* -------------------------------------------------------------------------- */

export async function runPreset(actor: Actor, preset: AiPreset, prompt: string): Promise<AssistantReply> {
  const context = await getAiContext(actor);
  switch (preset) {
    case "prospecting":
      return prospecting(actor, prompt, context);
    case "research":
      return research(actor, prompt);
    case "sequencing":
      return sequencing(actor, prompt, context);
    case "analytics":
      return analytics(actor);
  }
}

/** Compact, sourced workspace facts for a free-form question (sent to the provider as context). */
export async function workspaceFacts(actor: Actor, prompt: string): Promise<{ text: string; sources: Source[] }> {
  const count = sql<number>`count(*)::int`;
  const [[contacts], [companies], [sequences]] = await Promise.all([
    db.select({ n: count }).from(schema.contact).where(eq(schema.contact.organizationId, actor.organizationId)),
    db.select({ n: count }).from(schema.company).where(eq(schema.company.organizationId, actor.organizationId)),
    db
      .select({ n: count })
      .from(schema.sequence)
      .where(and(eq(schema.sequence.organizationId, actor.organizationId), eq(schema.sequence.status, "active"))),
  ]);
  const lines = [
    `Workspace: ${contacts?.n ?? 0} contacts, ${companies?.n ?? 0} companies, ${sequences?.n ?? 0} active sequences.`,
  ];
  let sources: Source[] = [];
  const company = await companyFromPrompt(actor, prompt);
  if (company) {
    const { facts } = await companyBrief(actor, company);
    const cited = cite(facts);
    sources = cited.sources;
    lines.push(`Facts about ${company.name} (cite with [n]):`, ...cited.lines);
    if (!facts.length) lines.push(`No facts about ${company.name} are stored.`);
  }
  return { text: lines.join("\n"), sources };
}
