import "server-only";

import { and, eq, inArray, isNotNull, or, sql } from "drizzle-orm";
import { z } from "zod";

import { can } from "@/lib/rbac/permissions";
import { type Actor, requirePermission } from "@/server/auth/actor";
import { domainFromInput, registrableDomain } from "@/server/crawler/url";
import { db, schema } from "@/server/db";
import {
  type DetectedPattern,
  detectPattern,
  type EmailPattern,
  generateCandidates,
  isEmailPattern,
} from "@/server/email/patterns";
import { smtpProbeEnabled, type VerificationResult, verifyEmail } from "@/server/email/verify";
import { checkSyntax } from "@/server/email/verify-rules";
import { HttpError, notFound } from "@/server/http/errors";
import type { PersonQuery, ProviderId } from "@/server/providers";

import {
  lookupCompanyWithProviders,
  lookupPersonWithProviders,
  type PersonField,
  type ProviderPersonHit,
} from "./data-providers";
import {
  companyByDomain,
  companyById,
  companyByName,
  contactById,
  costSummary,
  type FieldOutcome,
  type FieldProposal,
  type Lookup,
  planFieldUpdates,
  provenanceFor,
  suppressionChecker,
} from "./enrichment-common";
import {
  applyFindingsToCompany,
  crawlJobById,
  createCrawlJob,
  findingsOf,
  processCrawlJob,
  recentCompletedJob,
  validateSeed,
} from "./research";
import { recordLookups } from "./usage-events";

type CompanyRow = typeof schema.company.$inferSelect;
type ContactRow = typeof schema.contact.$inferSelect;

const invalid = (path: string, message: string) => new HttpError(422, "Some fields are invalid.", [{ path, message }]);
const REUSE_CRAWL_MS = 7 * 24 * 60 * 60 * 1000;

/* -------------------------------------------------------------------------- */
/* Email verification                                                         */
/* -------------------------------------------------------------------------- */

export const emailVerificationInput = z
  .object({
    email: z.string().trim().min(1).max(320).optional(),
    contactId: z.string().trim().min(1).max(100).optional(),
    force: z.boolean().optional(),
  })
  .strict()
  .refine((v) => Boolean(v.email) !== Boolean(v.contactId), {
    message: "Give either an email address or a contact.",
    path: ["email"],
  });

async function recordContactVerification(actor: Actor, contact: ContactRow, result: VerificationResult) {
  requirePermission(actor, "contact:update");
  const now = new Date();
  await db.transaction(async (tx) => {
    await tx
      .update(schema.contact)
      .set({ emailStatus: result.status, emailVerifiedAt: now })
      .where(and(eq(schema.contact.id, contact.id), eq(schema.contact.organizationId, actor.organizationId)));
    await tx.insert(schema.fieldProvenance).values({
      organizationId: actor.organizationId,
      entityType: "contact",
      entityId: contact.id,
      field: "emailStatus",
      value: result.status,
      source: result.checks.confirmedBySend ? "send_history" : "verification",
      sourceUrl: null,
      confidence: result.status === "unknown" ? 0.5 : 0.9,
      retrievedAt: now,
    });
  });
}

export async function runEmailVerification(actor: Actor, input: z.infer<typeof emailVerificationInput>) {
  let contact: ContactRow | null = null;
  let email = input.email ?? null;
  if (input.contactId) {
    contact = await contactById(actor, input.contactId);
    if (!contact) throw notFound("Contact not found.");
    if (!contact.email) throw invalid("contactId", "This contact has no email address to verify.");
    email = contact.email;
  }
  if (!email) throw invalid("email", "Enter an email address.");
  const result = await verifyEmail(email, { organizationId: actor.organizationId, force: input.force });
  if (contact) await recordContactVerification(actor, contact, result);
  await recordLookups(actor, [{ type: "email_verification", cached: result.cached }]);
  return {
    ...result,
    contactId: contact?.id ?? null,
    smtpProbe: smtpProbeEnabled(),
    credits: costSummary([{ type: "email_verification", target: result.email, cached: result.cached, cost: 0 }]),
  };
}

/* -------------------------------------------------------------------------- */
/* People match                                                               */
/* -------------------------------------------------------------------------- */

export const personMatchInput = z
  .object({
    contactId: z.string().trim().min(1).max(100).optional(),
    firstName: z.string().trim().max(80).optional(),
    lastName: z.string().trim().max(80).optional(),
    name: z.string().trim().max(160).optional(),
    email: z.string().trim().max(320).optional(),
    domain: z.string().trim().max(255).optional(),
    companyId: z.string().trim().min(1).max(100).optional(),
    organizationName: z.string().trim().max(200).optional(),
    verify: z.boolean().default(true),
  })
  .strict()
  .refine(
    (v) =>
      Boolean(
        v.contactId ||
          v.email ||
          ((v.firstName || v.lastName || v.name) && (v.domain || v.companyId || v.organizationName)),
      ),
    {
      message: "Give a contact, an email address, or a name with a company or domain.",
      path: ["contactId"],
    },
  );
export type PersonMatchInput = z.infer<typeof personMatchInput>;

export const bulkMatchInput = z
  .object({ details: z.array(z.record(z.string(), z.unknown())).min(1).max(10), verify: z.boolean().optional() })
  .strict();

function splitFullName(name: string | undefined): { first: string | null; last: string | null } {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return { first: null, last: null };
  return { first: parts[0] ?? null, last: parts.length > 1 ? (parts[parts.length - 1] ?? null) : null };
}

/** The company's stored pattern, else one detected from known-valid addresses in this workspace. */
async function patternForDomain(
  actor: Actor,
  company: CompanyRow | null,
  domain: string,
  lookups: Lookup[],
): Promise<{ pattern: EmailPattern; confidence: number; detected: DetectedPattern | null } | null> {
  if (company?.emailPattern && isEmailPattern(company.emailPattern)) {
    return { pattern: company.emailPattern, confidence: 0.8, detected: null };
  }
  const rows = await db
    .select({ firstName: schema.contact.firstName, lastName: schema.contact.lastName, email: schema.contact.email })
    .from(schema.contact)
    .where(
      and(
        eq(schema.contact.organizationId, actor.organizationId),
        isNotNull(schema.contact.email),
        inArray(schema.contact.emailStatus, ["valid", "catch_all"]),
        sql`lower(${schema.contact.email}) like ${`%@${domain}`}`,
      ),
    )
    .limit(200);
  lookups.push({ type: "pattern_detection", target: domain, cached: false, cost: 0 });
  const detected = detectPattern(rows.flatMap((r) => (r.email ? [{ ...r, email: r.email }] : [])));
  if (!detected) return null;
  if (company && can(actor.role, "company:update")) {
    const plan = await planFieldUpdates(actor.organizationId, "company", company.id, company, [
      { field: "emailPattern", value: detected.pattern, source: "pattern_detection", confidence: detected.confidence },
    ]);
    if (Object.keys(plan.updates).length || plan.provenance.length) {
      await db.transaction(async (tx) => {
        if (Object.keys(plan.updates).length) {
          await tx
            .update(schema.company)
            .set(plan.updates as Partial<CompanyRow>)
            .where(eq(schema.company.id, company.id));
        }
        if (plan.provenance.length) await tx.insert(schema.fieldProvenance).values(plan.provenance);
      });
    }
  }
  return { pattern: detected.pattern, confidence: detected.confidence, detected };
}

async function findContact(
  actor: Actor,
  email: string | null,
  first: string | null,
  last: string | null,
  companyId: string | null,
) {
  const conditions = [];
  if (email) conditions.push(sql`lower(${schema.contact.email}) = ${email}`);
  if (first && last && companyId) {
    conditions.push(
      and(
        eq(schema.contact.companyId, companyId),
        sql`lower(${schema.contact.firstName}) = ${first.toLowerCase()}`,
        sql`lower(${schema.contact.lastName}) = ${last.toLowerCase()}`,
      ),
    );
  }
  if (!conditions.length) return null;
  const [row] = await db
    .select()
    .from(schema.contact)
    .where(and(eq(schema.contact.organizationId, actor.organizationId), or(...conditions)))
    .limit(1);
  return row ?? null;
}

/** Confidence in a generated address: confirmed by the mail server, from a known pattern, or a plain guess. */
function guessConfidence(confirmed: boolean, patternConfidence: number | null): number {
  if (confirmed) return 0.95;
  if (patternConfidence !== null) return Math.round(patternConfidence * 0.9 * 100) / 100;
  return 0.3;
}

/* -------------------------- Workspace data providers ---------------------- */

/** Confidence given to a provider's value: below a person's entry (1.0), above a plain guess. */
const PROVIDER_CONFIDENCE = 0.7;
const PERSON_DETAIL_FIELDS = ["title", "seniority", "phone", "linkedinUrl", "city", "state", "country"] as const;
const COMPANY_PROVIDER_FIELDS = [
  "industry",
  "employeeCount",
  "foundedYear",
  "linkedinUrl",
  "country",
  "state",
  "city",
  "description",
  "phone",
] as const;

const providerSource = (provider: ProviderId) => `provider:${provider}`;

function isBlank(value: unknown): boolean {
  return value === null || value === undefined || value === "";
}

/** Enough to identify a person at a provider: an email, a LinkedIn URL, or a name with a company. */
function identifiable(q: PersonQuery): boolean {
  const has = (v: string | null | undefined) => typeof v === "string" && v.length > 0;
  const named = (has(q.firstName) && has(q.lastName)) || has(q.name);
  return has(q.email) || has(q.linkedinUrl) || (named && (has(q.domain) || has(q.companyName)));
}

/** Contact detail proposals from provider answers: only for fields the contact doesn't have yet. */
function detailProposals(contact: ContactRow, hits: ProviderPersonHit[]): FieldProposal[] {
  const proposals: FieldProposal[] = [];
  for (const field of PERSON_DETAIL_FIELDS) {
    if (!isBlank(contact[field])) continue;
    const hit = hits.find((h) => h.result[field] !== null);
    if (!hit) continue;
    proposals.push({
      field,
      value: hit.result[field],
      source: providerSource(hit.provider),
      confidence: PROVIDER_CONFIDENCE,
    });
  }
  return proposals;
}

function missingDetails(contact: ContactRow | null): PersonField[] {
  return contact ? PERSON_DETAIL_FIELDS.filter((f) => isBlank(contact[f])) : [];
}

/**
 * Fill a contact's empty detail fields (title, seniority, phone, LinkedIn, location) from the
 * workspace's enabled data providers. Never overwrites a value; skips do-not-contact people.
 * Used by enrichment jobs for contacts that already have an address.
 */
export async function fillContactFromProviders(
  actor: Actor,
  contact: ContactRow,
): Promise<{ fields: string[]; providers: ProviderId[] }> {
  if (!can(actor.role, "enrich:run") || !can(actor.role, "contact:update")) return { fields: [], providers: [] };
  const missing = missingDetails(contact);
  if (!missing.length) return { fields: [], providers: [] };
  const company = contact.companyId ? await companyById(actor, contact.companyId) : null;
  const domain = company?.domain ? (domainFromInput(company.domain)?.split(":")[0] ?? null) : null;
  const query: PersonQuery = {
    firstName: contact.firstName,
    lastName: contact.lastName,
    domain,
    companyName: company?.name ?? null,
    email: contact.email,
    linkedinUrl: contact.linkedinUrl,
  };
  if (!identifiable(query)) return { fields: [], providers: [] };
  const suppressed = await suppressionChecker(actor.organizationId, [
    ...(contact.email ? [contact.email] : []),
    ...(domain ? [domain] : []),
  ]);
  if ((contact.email && suppressed(contact.email)) || (domain && suppressed(domain))) {
    return { fields: [], providers: [] };
  }
  const { hits, called } = await lookupPersonWithProviders(actor.organizationId, query, missing);
  if (called.length) {
    await recordLookups(
      actor,
      called.map(() => ({ type: "provider_lookup" as const, cached: false })),
    );
  }
  const plan = await planFieldUpdates(
    actor.organizationId,
    "contact",
    contact.id,
    contact,
    detailProposals(contact, hits),
  );
  if (!Object.keys(plan.updates).length) return { fields: [], providers: called };
  const now = new Date();
  await db.transaction(async (tx) => {
    await tx
      .update(schema.contact)
      .set({ ...(plan.updates as Partial<ContactRow>), lastEnrichedAt: now })
      .where(and(eq(schema.contact.id, contact.id), eq(schema.contact.organizationId, actor.organizationId)));
    if (plan.provenance.length) await tx.insert(schema.fieldProvenance).values(plan.provenance);
  });
  return { fields: Object.keys(plan.updates), providers: called };
}

/** Fill a company's empty fields from the workspace's providers (PDL, then Apollo). */
async function fillCompanyFromProviders(actor: Actor, company: CompanyRow, domain: string): Promise<FieldOutcome[]> {
  if (!can(actor.role, "enrich:run") || !can(actor.role, "company:update")) return [];
  const missing = COMPANY_PROVIDER_FIELDS.filter((f) => isBlank(company[f]));
  if (!missing.length) return [];
  const suppressed = await suppressionChecker(actor.organizationId, [domain]);
  if (suppressed(domain)) return [];
  const { hits, called } = await lookupCompanyWithProviders(actor.organizationId, domain, missing);
  if (called.length) {
    await recordLookups(
      actor,
      called.map(() => ({ type: "provider_lookup" as const, cached: false })),
    );
  }
  const proposals: FieldProposal[] = [];
  for (const field of missing) {
    const hit = hits.find((h) => h.result[field] !== null);
    if (!hit) continue;
    proposals.push({
      field,
      value: hit.result[field],
      source: providerSource(hit.provider),
      confidence: PROVIDER_CONFIDENCE,
    });
  }
  const plan = await planFieldUpdates(actor.organizationId, "company", company.id, company, proposals);
  if (!Object.keys(plan.updates).length) return plan.outcomes;
  const now = new Date();
  await db.transaction(async (tx) => {
    await tx
      .update(schema.company)
      .set({ ...(plan.updates as Partial<CompanyRow>), lastEnrichedAt: now })
      .where(and(eq(schema.company.id, company.id), eq(schema.company.organizationId, actor.organizationId)));
    if (plan.provenance.length) await tx.insert(schema.fieldProvenance).values(plan.provenance);
  });
  return plan.outcomes;
}

function organizationRef(
  company: CompanyRow | null,
  domain: string | null,
  name: string | null,
  pattern: string | null,
) {
  if (company) return { id: company.id, name: company.name, domain: company.domain, emailPattern: pattern };
  return domain ? { id: null, name, domain, emailPattern: pattern } : null;
}

export async function matchPerson(actor: Actor, input: PersonMatchInput) {
  const lookups: Lookup[] = [];
  let contact: ContactRow | null = null;
  if (input.contactId) {
    contact = await contactById(actor, input.contactId);
    if (!contact) throw notFound("Contact not found.");
  }
  const split = splitFullName(input.name);
  const firstName = input.firstName || contact?.firstName || split.first;
  const lastName = input.lastName || contact?.lastName || split.last;
  const givenEmail = (input.email || contact?.email || "").toLowerCase() || null;
  if (givenEmail && !checkSyntax(givenEmail).ok && !contact) throw invalid("email", "Enter a valid email address.");

  // Company: explicit id, the contact's company, then domain, then name.
  let company: CompanyRow | null = null;
  if (input.companyId) {
    company = await companyById(actor, input.companyId);
    if (!company) throw notFound("Company not found.");
  } else if (contact?.companyId) {
    company = await companyById(actor, contact.companyId);
  }
  const inputDomain = input.domain ? (domainFromInput(input.domain)?.split(":")[0] ?? null) : null;
  if (input.domain && !inputDomain) throw invalid("domain", "Enter a domain such as acme.com.");
  if (!company && inputDomain) company = await companyByDomain(actor, inputDomain);
  if (!company && input.organizationName) company = await companyByName(actor, input.organizationName);
  if (!input.companyId && (inputDomain || input.organizationName)) {
    lookups.push({
      type: "company_match",
      target: inputDomain ?? input.organizationName ?? "",
      cached: false,
      cost: 0,
    });
  }
  const domain =
    inputDomain ??
    (company?.domain ? domainFromInput(company.domain)?.split(":")[0] : null) ??
    givenEmail?.split("@")[1] ??
    null;

  if (!contact) {
    contact = await findContact(actor, givenEmail, firstName ?? null, lastName ?? null, company?.id ?? null);
    lookups.push({
      type: "contact_match",
      target: givenEmail ?? `${firstName ?? ""} ${lastName ?? ""}`.trim(),
      cached: false,
      cost: 0,
    });
  }

  const suppressed = await suppressionChecker(actor.organizationId, [
    ...(domain ? [domain] : []),
    ...(givenEmail ? [givenEmail] : []),
  ]);
  const domainSuppressed = domain ? suppressed(domain) : false;

  let email: string | null = null;
  let emailSource: "input" | "contact" | "pattern" | "provider" | null = null;
  let emailConfidence: number | null = null;
  let candidates: string[] = [];
  let verification: VerificationResult | null = null;
  let pattern: string | null = company?.emailPattern ?? null;

  if (givenEmail) {
    if (!suppressed(givenEmail)) {
      email = givenEmail;
      emailSource = input.email ? "input" : "contact";
      emailConfidence = 1;
      if (input.verify) verification = await verifyEmail(givenEmail, { organizationId: actor.organizationId });
    }
  } else if (firstName && lastName && domain && !domainSuppressed) {
    const known = await patternForDomain(actor, company, domain, lookups);
    pattern = known?.pattern ?? pattern;
    candidates = generateCandidates(firstName, lastName, domain, known?.pattern ?? null).filter((c) => !suppressed(c));
    const toCheck = input.verify ? candidates.slice(0, smtpProbeEnabled() ? 3 : 1) : [];
    for (const candidate of toCheck) {
      const result = await verifyEmail(candidate, { organizationId: actor.organizationId });
      lookups.push({ type: "email_verification", target: candidate, cached: result.cached, cost: 0 });
      if (result.status === "invalid" && (result.reason === "no_mail_host" || result.reason === "null_mx")) {
        verification = result;
        break;
      }
      if (result.status === "valid" || !verification) verification = result;
      if (result.status === "valid") break;
    }
    const deliverable = verification ? verification.status !== "invalid" : !input.verify;
    const pick = verification?.status === "valid" ? verification.email : candidates[0];
    if (deliverable && pick) {
      email = pick;
      emailSource = "pattern";
      emailConfidence = guessConfidence(verification?.status === "valid", known?.confidence ?? null);
    }
  }
  if (verification && givenEmail) {
    lookups.push({ type: "email_verification", target: verification.email, cached: verification.cached, cost: 0 });
  }

  // The workspace's own data providers fill what the self-hosted steps left: a missing or unconfirmed
  // address, and (for a saved contact) empty detail fields. Never for do-not-contact people.
  let emailProvider: ProviderId | null = null;
  let providerEmailStatus: ContactRow["emailStatus"] | null = null;
  let providerHits: ProviderPersonHit[] = [];
  let providersCalled: ProviderId[] = [];
  const blocked = domainSuppressed || Boolean(givenEmail && suppressed(givenEmail));
  const writable = Boolean(contact && can(actor.role, "contact:update"));
  if (can(actor.role, "enrich:run") && !blocked) {
    const needEmail = !email || (emailSource === "pattern" && verification?.status !== "valid");
    const missing: PersonField[] = [
      ...(needEmail ? (["email"] as const) : []),
      ...(writable ? missingDetails(contact) : []),
    ];
    const query: PersonQuery = {
      firstName,
      lastName,
      name: input.name ?? null,
      domain,
      companyName: company?.name ?? input.organizationName ?? null,
      email: givenEmail,
      linkedinUrl: contact?.linkedinUrl ?? null,
    };
    if (missing.length && identifiable(query)) {
      const answer = await lookupPersonWithProviders(actor.organizationId, query, missing);
      providerHits = answer.hits;
      providersCalled = answer.called;
      for (const provider of answer.called)
        lookups.push({ type: "provider_lookup", target: provider, cached: false, cost: 0 });
      const hit = needEmail ? answer.hits.find((h) => h.result.email && !suppressed(h.result.email)) : undefined;
      if (hit?.result.email) {
        email = hit.result.email;
        emailSource = "provider";
        emailProvider = hit.provider;
        providerEmailStatus = hit.result.emailStatus;
        emailConfidence =
          hit.result.emailConfidence ?? (hit.result.emailStatus === "valid" ? 0.9 : PROVIDER_CONFIDENCE);
        verification = null;
        if (!providerEmailStatus && input.verify) {
          verification = await verifyEmail(email, { organizationId: actor.organizationId });
          lookups.push({ type: "email_verification", target: email, cached: verification.cached, cost: 0 });
        }
      }
    }
  }

  // Save to the contact when one was given or matched and the caller may edit contacts.
  let saved = false;
  const details = contact && writable ? detailProposals(contact, providerHits) : [];
  if (contact && writable && (email || details.length)) {
    const target = contact;
    const updates: Partial<ContactRow> = {};
    const provenance: Array<typeof schema.fieldProvenance.$inferInsert> = [];
    const now = new Date();
    if (details.length) {
      const plan = await planFieldUpdates(actor.organizationId, "contact", contact.id, contact, details);
      Object.assign(updates, plan.updates as Partial<ContactRow>);
      provenance.push(...plan.provenance);
    }
    if (email && !contact.email && (emailSource === "pattern" || emailSource === "provider")) {
      const taken = await findContact(actor, email, null, null, null);
      if (!taken) {
        updates.email = email;
        provenance.push({
          organizationId: actor.organizationId,
          entityType: "contact",
          entityId: contact.id,
          field: "email",
          value: email,
          source: emailProvider ? providerSource(emailProvider) : "pattern",
          confidence: emailConfidence ?? 0.3,
          retrievedAt: now,
        });
        if (emailProvider && providerEmailStatus) {
          updates.emailStatus = providerEmailStatus;
          updates.emailVerifiedAt = now;
          provenance.push({
            organizationId: actor.organizationId,
            entityType: "contact",
            entityId: contact.id,
            field: "emailStatus",
            value: providerEmailStatus,
            source: providerSource(emailProvider),
            confidence: PROVIDER_CONFIDENCE,
            retrievedAt: now,
          });
        }
      }
    }
    if (verification && (updates.email ?? contact.email)?.toLowerCase() === verification.email) {
      updates.emailStatus = verification.status;
      updates.emailVerifiedAt = now;
      provenance.push({
        organizationId: actor.organizationId,
        entityType: "contact",
        entityId: contact.id,
        field: "emailStatus",
        value: verification.status,
        source: verification.checks.confirmedBySend ? "send_history" : "verification",
        confidence: verification.status === "unknown" ? 0.5 : 0.9,
        retrievedAt: now,
      });
    }
    if (!contact.companyId && company) updates.companyId = company.id;
    if (Object.keys(updates).length) {
      await db.transaction(async (tx) => {
        await tx
          .update(schema.contact)
          .set({ ...updates, lastEnrichedAt: now })
          .where(and(eq(schema.contact.id, target.id), eq(schema.contact.organizationId, actor.organizationId)));
        if (provenance.length) await tx.insert(schema.fieldProvenance).values(provenance);
      });
      saved = true;
      contact = { ...contact, ...updates };
    }
  }

  await recordLookups(actor, lookups);
  // A provider's address that wasn't saved (no contact, or taken) carries the provider's own status.
  let storedStatus: ContactRow["emailStatus"] = contact?.emailStatus ?? providerEmailStatus ?? "unverified";
  if (emailProvider && contact?.email !== email) storedStatus = providerEmailStatus ?? "unverified";
  return {
    person: {
      id: contact?.id ?? null,
      firstName: firstName ?? null,
      lastName: lastName ?? null,
      name: [firstName, lastName].filter(Boolean).join(" ") || null,
      title: contact?.title ?? providerHits.find((h) => h.result.title)?.result.title ?? null,
      linkedinUrl: contact?.linkedinUrl ?? providerHits.find((h) => h.result.linkedinUrl)?.result.linkedinUrl ?? null,
      email,
      emailStatus: verification?.email === email ? verification?.status : storedStatus,
      emailSource,
      emailProvider,
      providers: providersCalled,
      emailConfidence,
      emailCandidates: candidates,
      suppressed: domainSuppressed || (givenEmail ? suppressed(givenEmail) : false),
      saved,
      verification,
      organization: organizationRef(company, domain, input.organizationName ?? null, pattern),
      provenance: contact ? await provenanceFor(actor.organizationId, "contact", contact.id) : [],
    },
    credits: costSummary(lookups),
  };
}

export async function bulkMatchPeople(actor: Actor, input: z.infer<typeof bulkMatchInput>) {
  const matches: Array<Awaited<ReturnType<typeof matchPerson>>["person"] | null> = [];
  const errors: Array<{ index: number; error: string }> = [];
  const lookups: Lookup[] = [];
  for (const [index, raw] of input.details.entries()) {
    const parsed = personMatchInput.safeParse({
      ...raw,
      ...(input.verify === undefined ? {} : { verify: input.verify }),
    });
    if (!parsed.success) {
      matches.push(null);
      errors.push({ index, error: parsed.error.issues[0]?.message ?? "Invalid details." });
      continue;
    }
    try {
      const result = await matchPerson(actor, parsed.data);
      matches.push(result.person);
      lookups.push(...result.credits.lookups);
    } catch (error) {
      if (!(error instanceof HttpError) || error.status !== 404) throw error;
      matches.push(null);
      errors.push({ index, error: error.message });
    }
  }
  return {
    status: "success",
    total_requested_enrichments: input.details.length,
    unique_enriched_records: matches.filter((m) => m?.email).length,
    missing_records: matches.filter((m) => !m?.email).length,
    matches,
    errors,
    credits: costSummary(lookups),
  };
}

/* -------------------------------------------------------------------------- */
/* Organization enrichment                                                    */
/* -------------------------------------------------------------------------- */

export const organizationEnrichInput = z
  .object({
    domain: z.string().trim().max(255).optional(),
    website: z.string().trim().max(2000).optional(),
    companyId: z.string().trim().min(1).max(100).optional(),
    name: z.string().trim().max(200).optional(),
    /** Write the findings to the company (default true when the company exists). */
    apply: z.boolean().optional(),
    /** Reuse a completed crawl from the last 7 days (default true). */
    reuse: z.boolean().optional(),
  })
  .strict()
  .refine((v) => Boolean(v.domain || v.website || v.companyId), {
    message: "Give a domain, a website or a company.",
    path: ["domain"],
  });
export type OrganizationEnrichInput = z.infer<typeof organizationEnrichInput>;

export const bulkEnrichInput = z
  .object({
    domains: z.array(z.string().trim().min(1).max(255)).max(10).optional(),
    details: z.array(z.record(z.string(), z.unknown())).max(10).optional(),
  })
  .strict()
  .refine((v) => (v.domains?.length ?? 0) + (v.details?.length ?? 0) > 0, {
    message: "Give up to 10 domains or details.",
    path: ["domains"],
  })
  .refine((v) => (v.domains?.length ?? 0) + (v.details?.length ?? 0) <= 10, {
    message: "Enrich at most 10 organizations per request.",
    path: ["domains"],
  });

interface ResolvedOrg {
  company: CompanyRow | null;
  domain: string;
  seed: string;
}

async function resolveOrganization(actor: Actor, input: OrganizationEnrichInput): Promise<ResolvedOrg> {
  let company: CompanyRow | null = null;
  if (input.companyId) {
    company = await companyById(actor, input.companyId);
    if (!company) throw notFound("Company not found.");
  }
  const raw = input.website || input.domain || company?.websiteUrl || company?.domain;
  if (!raw) throw invalid("companyId", "This company has no website or domain to enrich from.");
  const seed = validateSeed(raw);
  const domain = registrableDomain(seed.hostname);
  if (!company) company = await companyByDomain(actor, domain);
  return { company, domain, seed: seed.toString() };
}

function organizationView(company: CompanyRow | null, domain: string, job: typeof schema.crawlJob.$inferSelect | null) {
  const findings = job ? findingsOf(job) : null;
  const fact = (field: string) =>
    findings?.facts.filter((f) => f.field === field).sort((a, b) => b.confidence - a.confidence)[0]?.value ?? null;
  return {
    id: company?.id ?? null,
    name: company?.name ?? fact("siteName") ?? fact("name") ?? domain,
    domain: company?.domain ?? domain,
    websiteUrl: company?.websiteUrl ?? (findings ? new URL(findings.seedUrl).origin : null),
    description: company?.description ?? fact("description"),
    phone: company?.phone ?? fact("phone") ?? findings?.phones[0]?.value ?? null,
    linkedinUrl: company?.linkedinUrl ?? fact("linkedinUrl"),
    twitterUrl: company?.twitterUrl ?? fact("twitterUrl"),
    foundedYear: company?.foundedYear ?? (fact("foundedYear") ? Number(fact("foundedYear")) : null),
    technologies: company?.technologies?.length
      ? company.technologies
      : (findings?.technologies.map((t) => t.name) ?? []),
    emailPattern: company?.emailPattern ?? findings?.emailPattern?.pattern ?? null,
    socialLinks: findings?.social ?? [],
    hiring: findings?.hiring ?? null,
    peopleFound: findings?.people.length ?? 0,
    emailsFound: findings?.emails.length ?? 0,
  };
}

/** Enrich one organization synchronously: reuse a recent crawl or run a small one now. */
export async function enrichOrganization(actor: Actor, input: OrganizationEnrichInput) {
  const { company, domain, seed } = await resolveOrganization(actor, input);
  const lookups: Lookup[] = [];
  let job = input.reuse === false ? null : await recentCompletedJob(actor, domain, company?.id ?? null, REUSE_CRAWL_MS);
  const cached = Boolean(job);
  if (!job) {
    requirePermission(actor, "crawler:run");
    const created = await createCrawlJob(actor, { url: seed, companyId: company?.id, maxPages: 5 });
    await processCrawlJob(created.id);
    job = await crawlJobById(actor, created.id);
  }
  lookups.push({ type: "website_crawl", target: domain, cached, cost: 0 });
  await recordLookups(actor, lookups);

  const findings = findingsOf(job);
  let fields: Awaited<ReturnType<typeof applyFindingsToCompany>> = [];
  let current = company;
  if (company && findings && job.status === "completed" && input.apply !== false && can(actor.role, "company:update")) {
    fields = await applyFindingsToCompany(actor, company, findings);
    current = (await companyById(actor, company.id)) ?? company;
  }
  // Gaps the website didn't fill come from the workspace's own data providers, if any are enabled.
  if (current && input.apply !== false) {
    const filled = await fillCompanyFromProviders(actor, current, domain);
    if (filled.length) {
      fields = [...fields, ...filled];
      current = (await companyById(actor, current.id)) ?? current;
    }
  }
  return {
    organization: organizationView(current, domain, job),
    crawlJobId: job.id,
    status: job.status,
    error: job.error,
    cached,
    fields,
    provenance: current ? await provenanceFor(actor.organizationId, "company", current.id) : [],
    credits: costSummary(lookups),
  };
}

/** Queue up to 10 crawls (or reuse recent ones). Returns job ids to poll. */
export async function bulkEnrichOrganizations(actor: Actor, input: z.infer<typeof bulkEnrichInput>) {
  requirePermission(actor, "crawler:run");
  const requests: OrganizationEnrichInput[] = [
    ...(input.domains ?? []).map((domain) => ({ domain })),
    ...(input.details ?? []).map((d) => organizationEnrichInput.parse(d)),
  ];
  const organizations = [];
  const queued: string[] = [];
  const seen = new Set<string>();
  for (const request of requests) {
    let resolved: ResolvedOrg;
    try {
      resolved = await resolveOrganization(actor, request);
    } catch (error) {
      if (!(error instanceof HttpError)) throw error;
      organizations.push({
        input: request,
        status: "error",
        error: error.message,
        crawlJobId: null,
        organization: null,
      });
      continue;
    }
    if (seen.has(resolved.domain)) continue;
    seen.add(resolved.domain);
    const recent = await recentCompletedJob(actor, resolved.domain, resolved.company?.id ?? null, REUSE_CRAWL_MS);
    if (recent) {
      organizations.push({
        input: request,
        status: "cached",
        error: null,
        crawlJobId: recent.id,
        organization: organizationView(resolved.company, resolved.domain, recent),
      });
      continue;
    }
    const job = await createCrawlJob(actor, { url: resolved.seed, companyId: resolved.company?.id, maxPages: 10 });
    queued.push(job.id);
    organizations.push({ input: request, status: "queued", error: null, crawlJobId: job.id, organization: null });
  }
  await recordLookups(
    actor,
    organizations
      .filter((o) => o.status !== "error")
      .map((o) => ({ type: "website_crawl" as const, cached: o.status === "cached" })),
  );
  return {
    result: {
      status: "success",
      total_requested_records: requests.length,
      unique_domains: seen.size,
      organizations,
      credits: costSummary(
        organizations.map((o) => ({
          type: "website_crawl" as const,
          target: o.organization?.domain ?? String(o.input.domain ?? o.input.website ?? o.input.companyId ?? ""),
          cached: o.status === "cached",
          cost: 0,
        })),
      ),
    },
    queued,
  };
}
