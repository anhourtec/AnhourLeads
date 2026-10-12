import "server-only";

import { after } from "next/server";

import { and, desc, eq, inArray, isNotNull, or, sql } from "drizzle-orm";
import { z } from "zod";

import { can } from "@/lib/rbac/permissions";
import { type Actor, requirePermission } from "@/server/auth/actor";
import { db, schema } from "@/server/db";
import { log } from "@/server/log";

import { audit } from "./audit";
import { COMPANY_STAGES, companyCreateSchema } from "./companies";
import { CONTACT_STAGES, contactCreateSchema, contactName, SENIORITIES } from "./contacts";
import { type CustomFieldDto, type CustomFieldValue, coerceCustomFieldValue, listCustomFields } from "./custom-fields";
import { matchPerson, runEmailVerification } from "./enrichment";
import { recordEvent } from "./events";
import { createList, findList } from "./lists";
import {
  chunk,
  csvEnum,
  csvInt,
  csvList,
  defaultOwner,
  headerKey,
  IMPORT_MAX_ROWS,
  type ImportPayload,
  type ImportRowError,
  mapCsv,
  normalizeDomain,
  parseCsv,
  unprocessable,
} from "./records";
import { randomUUID } from "node:crypto";

/**
 * CSV import pipeline behind the import wizard (docs/reference/apollo-ui.md §17) and the
 * `/contacts/import` and `/accounts/import` endpoints: column mapping (including custom fields),
 * stage from the file or a fixed stage, update or skip existing records, account auto-assignment,
 * adding everything to a list, and optional enrichment after the import. Every import gets a batch
 * id, written to field provenance (`source_url = import:<batchId>`) and to the audit log, so search
 * can filter "imported in this file".
 */

export type ImportEntity = "contact" | "company";

const { contact, company } = schema;
const SOURCE = "csv_import";
const EVENT_CAP = 1000;
const ENRICH_CAP = 200;

/* -------------------------------------------------------------------------- */
/* Fields and header aliases                                                  */
/* -------------------------------------------------------------------------- */

const CONTACT_FIELDS = [
  ["firstName", "First name", "Contact"],
  ["lastName", "Last name", "Contact"],
  ["name", "Full name", "Contact"],
  ["email", "Email", "Contact"],
  ["title", "Job title", "Contact"],
  ["seniority", "Management level", "Contact"],
  ["department", "Department", "Contact"],
  ["phone", "Phone", "Contact"],
  ["linkedinUrl", "LinkedIn URL", "Contact"],
  ["city", "City", "Contact"],
  ["state", "State or region", "Contact"],
  ["country", "Country", "Contact"],
  ["timezone", "Time zone", "Contact"],
  ["stage", "Stage", "Contact"],
  ["tags", "Tags", "Contact"],
  ["consentBasis", "Consent basis", "Contact"],
  ["companyName", "Company name", "Account"],
  ["companyDomain", "Company website or domain", "Account"],
] as const;

const COMPANY_FIELDS = [
  ["name", "Company name", "Account"],
  ["domain", "Domain", "Account"],
  ["websiteUrl", "Website", "Account"],
  ["linkedinUrl", "LinkedIn URL", "Account"],
  ["twitterUrl", "X / Twitter URL", "Account"],
  ["phone", "Phone", "Account"],
  ["industry", "Industry", "Account"],
  ["keywords", "Keywords", "Account"],
  ["technologies", "Technologies", "Account"],
  ["employeeCount", "Number of employees", "Account"],
  ["annualRevenue", "Annual revenue", "Account"],
  ["foundedYear", "Founded year", "Account"],
  ["description", "Description", "Account"],
  ["city", "City", "Account"],
  ["state", "State or region", "Account"],
  ["country", "Country", "Account"],
  ["stage", "Stage", "Account"],
] as const;

const CONTACT_ALIASES: Record<string, string> = {
  firstname: "firstName",
  first: "firstName",
  givenname: "firstName",
  contactfirstname: "firstName",
  lastname: "lastName",
  last: "lastName",
  surname: "lastName",
  familyname: "lastName",
  contactlastname: "lastName",
  name: "name",
  fullname: "name",
  personname: "name",
  contactname: "name",
  email: "email",
  emailaddress: "email",
  workemail: "email",
  businessemail: "email",
  contactemail: "email",
  title: "title",
  jobtitle: "title",
  position: "title",
  role: "title",
  contacttitle: "title",
  seniority: "seniority",
  managementlevel: "seniority",
  department: "department",
  phone: "phone",
  phonenumber: "phone",
  mobile: "phone",
  directphone: "phone",
  linkedin: "linkedinUrl",
  linkedinurl: "linkedinUrl",
  linkedinprofile: "linkedinUrl",
  personlinkedinurl: "linkedinUrl",
  city: "city",
  state: "state",
  region: "state",
  province: "state",
  country: "country",
  timezone: "timezone",
  stage: "stage",
  contactstage: "stage",
  tags: "tags",
  consentbasis: "consentBasis",
  company: "companyName",
  companyname: "companyName",
  organization: "companyName",
  organizationname: "companyName",
  account: "companyName",
  accountname: "companyName",
  companydomain: "companyDomain",
  domain: "companyDomain",
  website: "companyDomain",
  companywebsite: "companyDomain",
  websiteurl: "companyDomain",
};

const COMPANY_ALIASES: Record<string, string> = {
  name: "name",
  company: "name",
  companyname: "name",
  account: "name",
  accountname: "name",
  organization: "name",
  organizationname: "name",
  domain: "domain",
  companydomain: "domain",
  website: "websiteUrl",
  websiteurl: "websiteUrl",
  url: "websiteUrl",
  linkedin: "linkedinUrl",
  linkedinurl: "linkedinUrl",
  companylinkedinurl: "linkedinUrl",
  twitter: "twitterUrl",
  twitterurl: "twitterUrl",
  phone: "phone",
  phonenumber: "phone",
  companyphone: "phone",
  industry: "industry",
  keywords: "keywords",
  technologies: "technologies",
  tech: "technologies",
  techstack: "technologies",
  employees: "employeeCount",
  employeecount: "employeeCount",
  numberofemployees: "employeeCount",
  headcount: "employeeCount",
  annualrevenue: "annualRevenue",
  revenue: "annualRevenue",
  foundedyear: "foundedYear",
  founded: "foundedYear",
  description: "description",
  shortdescription: "description",
  city: "city",
  state: "state",
  region: "state",
  country: "country",
  stage: "stage",
  accountstage: "stage",
};

const CF = "cf.";

/** Free-mail providers never become accounts when auto-assigning from the email domain. */
const FREE_MAIL = new Set([
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "msn.com",
  "yahoo.com",
  "ymail.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "aol.com",
  "proton.me",
  "protonmail.com",
  "gmx.com",
  "gmx.de",
  "mail.com",
  "yandex.com",
  "zoho.com",
  "fastmail.com",
]);

interface Vocabulary {
  fields: string[];
  aliases: Record<string, string>;
  custom: Map<string, CustomFieldDto>;
  options: { value: string; label: string; group: "Contact" | "Account" | "Custom fields" }[];
}

async function vocabulary(actor: Actor, entity: ImportEntity): Promise<Vocabulary> {
  const base = entity === "contact" ? CONTACT_FIELDS : COMPANY_FIELDS;
  const custom = await listCustomFields(actor, entity);
  const aliases: Record<string, string> = {};
  for (const f of custom) {
    aliases[headerKey(f.label)] = `${CF}${f.key}`;
    aliases[headerKey(f.key)] = `${CF}${f.key}`;
  }
  // Built-in aliases win over custom field labels.
  Object.assign(aliases, entity === "contact" ? CONTACT_ALIASES : COMPANY_ALIASES);
  return {
    fields: [...base.map(([value]) => value), ...custom.map((f) => `${CF}${f.key}`)],
    aliases,
    custom: new Map(custom.map((f) => [`${CF}${f.key}`, f])),
    options: [
      ...base.map(([value, label, group]) => ({ value, label, group })),
      ...custom.map((f) => ({ value: `${CF}${f.key}`, label: f.label, group: "Custom fields" as const })),
    ],
  };
}

/* -------------------------------------------------------------------------- */
/* Settings                                                                    */
/* -------------------------------------------------------------------------- */

const boolish = z.preprocess(
  (v) => (v === "true" || v === "false" ? v === "true" : v),
  z.boolean({ message: "Use true or false." }),
);

const settingsSchema = z.object({
  stageMode: z.enum(["csv", "fixed"]).default("csv"),
  stage: z.string().trim().max(50).optional(),
  ifExists: z.enum(["update", "skip"]).optional(),
  autoAssignAccounts: boolish.default(true),
  listId: z.string().trim().min(1).max(100).optional(),
  newListName: z.string().trim().min(1, "Name the new list.").max(120).optional(),
  fileName: z.string().trim().max(200).optional(),
  enrichment: z
    .object({ verifyEmails: boolish.optional(), findMissingEmails: boolish.optional() })
    .strict()
    .default({}),
});
type ImportSettings = z.infer<typeof settingsSchema>;

function parseSettings(entity: ImportEntity, payload: ImportPayload): ImportSettings & { update: boolean } {
  const raw = { ...payload.settings };
  if (typeof raw.enrichment === "string") {
    try {
      raw.enrichment = JSON.parse(raw.enrichment);
    } catch {
      throw unprocessable("Enrichment settings must be a JSON object.", "enrichment");
    }
  }
  const parsed = settingsSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw unprocessable(issue?.message ?? "Invalid settings.", issue?.path.join(".") ?? "settings");
  }
  const s = parsed.data;
  if (s.stageMode === "fixed") {
    const stages: readonly string[] = entity === "contact" ? CONTACT_STAGES : COMPANY_STAGES;
    if (!s.stage || !stages.includes(s.stage)) throw unprocessable("Pick a stage from the list.", "stage");
  }
  if (s.listId && s.newListName) throw unprocessable("Pick an existing list or a new list name, not both.", "listId");
  const wantsEnrichment = Boolean(s.enrichment.verifyEmails || s.enrichment.findMissingEmails);
  if (wantsEnrichment && entity === "company") {
    throw unprocessable("Email enrichment applies to contact imports only.", "enrichment");
  }
  return { ...s, update: s.ifExists ? s.ifExists === "update" : payload.updateExisting };
}

interface TargetList {
  id: string;
  name: string;
}

async function resolveList(actor: Actor, entity: ImportEntity, s: ImportSettings): Promise<TargetList | null> {
  if (s.listId) {
    requirePermission(actor, "list:update");
    const row = await findList(actor, s.listId);
    if (row.entityType !== entity) {
      throw unprocessable(`Pick a ${entity === "contact" ? "people" : "company"} list.`, "listId");
    }
    if (row.kind !== "static") throw unprocessable("Dynamic lists fill themselves from their filters.", "listId");
    return { id: row.id, name: row.name };
  }
  if (s.newListName) {
    requirePermission(actor, "list:create");
    const created = await createList(actor, { name: s.newListName, entityType: entity, kind: "static" });
    return { id: created.id, name: created.name };
  }
  return null;
}

async function addToList(list: TargetList, ids: string[]): Promise<void> {
  const unique = [...new Set(ids)];
  for (const part of chunk(unique, 1000)) {
    await db
      .insert(schema.listMember)
      .values(part.map((entityId) => ({ listId: list.id, entityId })))
      .onConflictDoNothing();
  }
  await db.update(schema.list).set({ updatedAt: new Date() }).where(eq(schema.list.id, list.id));
}

/* -------------------------------------------------------------------------- */
/* Provenance with the batch id                                               */
/* -------------------------------------------------------------------------- */

function provenanceValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) return value.join(", ");
  return String(value).slice(0, 1000);
}

interface ProvRow {
  entityId: string;
  field: string;
  value: unknown;
}

function fieldsOf(
  entityId: string,
  values: Record<string, unknown>,
  custom: Record<string, CustomFieldValue>,
): ProvRow[] {
  return [
    ...Object.entries(values)
      .filter(([field, v]) => v !== undefined && v !== null && field !== "customFields")
      .map(([field, value]) => ({ entityId, field, value })),
    ...Object.entries(custom).map(([key, value]) => ({ entityId, field: `${CF}${key}`, value })),
  ];
}

async function writeProvenance(actor: Actor, entity: ImportEntity, rows: ProvRow[], batchId: string): Promise<void> {
  const values = rows.map((r) => ({
    organizationId: actor.organizationId,
    entityType: entity,
    entityId: r.entityId,
    field: r.field,
    value: provenanceValue(r.value),
    source: SOURCE,
    sourceUrl: `import:${batchId}`,
    confidence: 0.9,
  }));
  for (const part of chunk(values, 1000)) await db.insert(schema.fieldProvenance).values(part);
}

/* -------------------------------------------------------------------------- */
/* Shared row helpers                                                          */
/* -------------------------------------------------------------------------- */

/** Coerce the row's custom field cells; returns the first error as a sentence. */
function customValues(
  raw: Record<string, string>,
  vocab: Vocabulary,
): { values: Record<string, CustomFieldValue> } | { error: string } {
  const values: Record<string, CustomFieldValue> = {};
  for (const [field, cell] of Object.entries(raw)) {
    const def = vocab.custom.get(field);
    if (!def) continue;
    const result = coerceCustomFieldValue(def, cell);
    if ("error" in result) return { error: result.error };
    if (result.value !== null) values[def.key] = result.value;
  }
  return { values };
}

function mergeCustom(current: Record<string, unknown> | null | undefined, patch: Record<string, CustomFieldValue>) {
  return { ...(current ?? {}), ...patch };
}

export interface ImportResult {
  total: number;
  created: number;
  updated: number;
  skipped: number;
  errors: ImportRowError[];
  columns: Record<string, string | null>;
  batchId: string;
  listId: string | null;
  listName: string | null;
  enrichmentQueued: number;
}

function emailDomain(email: string | null | undefined): string | null {
  if (!email) return null;
  const domain = email.split("@")[1]?.toLowerCase();
  if (!domain || FREE_MAIL.has(domain)) return null;
  return normalizeDomain(domain);
}

function splitName(full: string): { firstName: string; lastName: string | null } {
  const parts = full.trim().split(/\s+/);
  return { firstName: parts[0], lastName: parts.length > 1 ? parts.slice(1).join(" ") : null };
}

/* -------------------------------------------------------------------------- */
/* Contacts                                                                    */
/* -------------------------------------------------------------------------- */

export async function importContactsCsv(
  actor: Actor,
  payload: ImportPayload,
): Promise<ImportResult & { companiesCreated: number }> {
  const settings = parseSettings("contact", payload);
  const wantsEnrichment = Boolean(settings.enrichment.verifyEmails || settings.enrichment.findMissingEmails);
  if (wantsEnrichment) requirePermission(actor, "enrich:run");
  const vocab = await vocabulary(actor, "contact");
  const { columns, rows } = mapCsv(payload.csv, vocab.aliases, vocab.fields, payload.mapping);
  const list = await resolveList(actor, "contact", settings);
  const batchId = randomUUID();
  const errors: ImportRowError[] = [];
  const report = { total: rows.length, created: 0, updated: 0, skipped: 0, companiesCreated: 0 };
  const fail = (row: number, message: string) => {
    report.skipped++;
    if (errors.length < 500) errors.push({ row, message });
  };

  type Fields = Record<string, unknown> & { email?: string | null };
  type Prepared = {
    row: number;
    fields: Fields;
    custom: Record<string, CustomFieldValue>;
    companyName?: string;
    companyDomain?: string | null;
  };
  const prepared: Prepared[] = [];
  const seen = new Map<string, number>();
  rows.forEach((r, index) => {
    const row = index + 2;
    const named = r.name && !r.firstName && !r.lastName ? splitName(r.name) : null;
    const candidate = {
      firstName: r.firstName ?? named?.firstName,
      lastName: r.lastName ?? named?.lastName ?? undefined,
      email: r.email,
      title: r.title,
      seniority: csvEnum(r.seniority, SENIORITIES),
      department: r.department,
      phone: r.phone,
      linkedinUrl: r.linkedinUrl,
      city: r.city,
      state: r.state,
      country: r.country,
      timezone: r.timezone,
      stage: settings.stageMode === "fixed" ? settings.stage : csvEnum(r.stage, CONTACT_STAGES),
      tags: csvList(r.tags),
      consentBasis: r.consentBasis,
    };
    const result = contactCreateSchema.safeParse(candidate);
    if (!result.success) {
      fail(row, result.error.issues[0]?.message ?? "Invalid row.");
      return;
    }
    const custom = customValues(r, vocab);
    if ("error" in custom) {
      fail(row, custom.error);
      return;
    }
    const { runDedupe: _r, customFields: _cf, personaId: _p, ...fields } = result.data;
    if (fields.email) {
      const first = seen.get(fields.email);
      if (first) {
        fail(row, `Duplicate of row ${first}.`);
        return;
      }
      seen.set(fields.email, row);
    }
    let companyDomain: string | null = null;
    let companyName: string | undefined;
    if (settings.autoAssignAccounts) {
      companyDomain = (r.companyDomain ? normalizeDomain(r.companyDomain) : null) ?? emailDomain(fields.email);
      companyName = r.companyName;
    }
    prepared.push({ row, fields, custom: custom.values, companyName, companyDomain });
  });

  const companyIds = await resolveImportCompanies(actor, prepared, batchId, (n) => {
    report.companiesCreated += n;
  });

  const emails = prepared.flatMap((p) => (p.fields.email ? [p.fields.email] : []));
  const existing = new Map<string, { id: string; customFields: Record<string, unknown> }>();
  for (const part of chunk(emails, 1000)) {
    const found = await db
      .select({ id: contact.id, email: contact.email, customFields: contact.customFields })
      .from(contact)
      .where(and(eq(contact.organizationId, actor.organizationId), inArray(contact.email, part)));
    for (const f of found) existing.set(f.email as string, { id: f.id, customFields: f.customFields });
  }

  const ownerId = await defaultOwner(actor);
  const provenance: ProvRow[] = [];
  const touched: string[] = [];
  const createdIds: { id: string; name: string; companyId: string | null; hasEmail: boolean; stageSet: boolean }[] = [];
  const updatedIds: { id: string; hasEmail: boolean }[] = [];
  const inserts: {
    row: number;
    values: typeof contact.$inferInsert;
    fields: Record<string, unknown>;
    custom: Record<string, CustomFieldValue>;
  }[] = [];

  for (const p of prepared) {
    const setFields: Record<string, unknown> = Object.fromEntries(
      Object.entries(p.fields).filter(([, v]) => v !== undefined && v !== null),
    );
    const companyId = companyIds.get(p);
    if (companyId) setFields.companyId = companyId;
    const known = p.fields.email ? existing.get(p.fields.email) : undefined;
    if (known) {
      if (!settings.update) {
        fail(p.row, "Already in your workspace (skipped).");
        continue;
      }
      const { email: _e, ...update } = setFields;
      const set: Record<string, unknown> = { ...update };
      if (Object.keys(p.custom).length) set.customFields = mergeCustom(known.customFields, p.custom);
      if (Object.keys(set).length) {
        await db
          .update(contact)
          .set(set)
          .where(and(eq(contact.organizationId, actor.organizationId), eq(contact.id, known.id)));
        provenance.push(...fieldsOf(known.id, update, p.custom));
      }
      report.updated++;
      touched.push(known.id);
      updatedIds.push({ id: known.id, hasEmail: true });
      continue;
    }
    inserts.push({
      row: p.row,
      fields: setFields,
      custom: p.custom,
      values: {
        ...setFields,
        customFields: p.custom,
        ownerId,
        organizationId: actor.organizationId,
        source: SOURCE,
      },
    });
  }

  const remember = (id: string, item: (typeof inserts)[number]) => {
    provenance.push(...fieldsOf(id, item.fields, item.custom));
    touched.push(id);
    createdIds.push({
      id,
      name: contactName({
        firstName: (item.fields.firstName as string | undefined) ?? null,
        lastName: (item.fields.lastName as string | undefined) ?? null,
        email: (item.fields.email as string | undefined) ?? null,
      }),
      companyId: (item.fields.companyId as string | undefined) ?? null,
      hasEmail: Boolean(item.fields.email),
      stageSet: item.fields.stage !== undefined,
    });
  };
  for (const part of chunk(inserts, 500)) {
    try {
      const created = await db
        .insert(contact)
        .values(part.map((i) => i.values))
        .returning({ id: contact.id });
      created.forEach((c, i) => {
        remember(c.id, part[i]);
      });
      report.created += created.length;
    } catch {
      // A concurrent write took one of the emails: fall back to row-by-row so the rest still import.
      for (const item of part) {
        try {
          const [c] = await db.insert(contact).values(item.values).returning({ id: contact.id });
          remember(c.id, item);
          report.created++;
        } catch {
          fail(item.row, "Couldn't save this row (the email may already exist).");
        }
      }
    }
  }

  await writeProvenance(actor, "contact", provenance, batchId);
  if (list && touched.length) await addToList(list, touched);
  errors.sort((a, b) => a.row - b.row);

  await audit(actor, "contact.import", "contact", null, {
    batchId,
    fileName: settings.fileName ?? payload.fileName,
    total: report.total,
    created: report.created,
    updated: report.updated,
    skipped: report.skipped,
    companiesCreated: report.companiesCreated,
    errors: errors.length,
    listId: list?.id ?? null,
  });

  // Enrichment candidates: verify emails we have, find the ones we don't.
  const people = [...createdIds, ...updatedIds];
  const toVerify = settings.enrichment.verifyEmails ? people.filter((p) => p.hasEmail).map((p) => p.id) : [];
  const toFind = settings.enrichment.findMissingEmails ? people.filter((p) => !p.hasEmail).map((p) => p.id) : [];
  const enrichIds = [...toFind.map((id) => ({ id, find: true })), ...toVerify.map((id) => ({ id, find: false }))].slice(
    0,
    ENRICH_CAP,
  );
  const canEnrich = can(actor.role, "enrich:run") && can(actor.role, "contact:update");

  after(async () => {
    const explicit = createdIds.slice(0, EVENT_CAP).filter((c) => c.stageSet);
    if (explicit.length) {
      // The file (or the wizard) chose the stage: keep it rather than letting the "prospect created"
      // stage trigger reset it, so these only get their timeline row.
      await db.insert(schema.activity).values(
        explicit.map((c) => ({
          organizationId: actor.organizationId,
          contactId: c.id,
          companyId: c.companyId,
          type: "contact_created",
          summary: `${c.name} was imported from a CSV file`,
          metadata: { source: SOURCE, batchId, explicitStage: true },
          actorUserId: actor.userId,
        })),
      );
    }
    for (const c of createdIds.slice(0, EVENT_CAP).filter((x) => !x.stageSet)) {
      await recordEvent({
        organizationId: actor.organizationId,
        type: "contact_created",
        summary: `${c.name} was imported from a CSV file`,
        contactId: c.id,
        companyId: c.companyId,
        actorUserId: actor.userId,
        metadata: { source: SOURCE, batchId },
      });
    }
    if (list) {
      for (const id of touched.slice(0, EVENT_CAP)) {
        await recordEvent({
          organizationId: actor.organizationId,
          type: "contact_added_to_list",
          summary: `Added to the list ${list.name}`,
          contactId: id,
          actorUserId: actor.userId,
          metadata: { listId: list.id, batchId },
        });
      }
    }
    if (canEnrich) {
      for (const item of enrichIds) {
        try {
          if (item.find) await matchPerson(actor, { contactId: item.id, verify: true });
          else await runEmailVerification(actor, { contactId: item.id });
        } catch (error) {
          log.warn("import enrichment failed", { component: "imports", batchId, contactId: item.id, error });
        }
      }
    }
  });

  return {
    ...report,
    errors,
    columns,
    batchId,
    listId: list?.id ?? null,
    listName: list?.name ?? null,
    enrichmentQueued: canEnrich ? enrichIds.length : 0,
  };
}

async function resolveImportCompanies<T extends { companyName?: string; companyDomain?: string | null }>(
  actor: Actor,
  rows: T[],
  batchId: string,
  onCreated: (n: number) => void,
): Promise<Map<T, string>> {
  const result = new Map<T, string>();
  const wanted = rows.filter((r) => r.companyDomain || r.companyName);
  if (!wanted.length) return result;
  const domains = [...new Set(wanted.flatMap((r) => (r.companyDomain ? [r.companyDomain] : [])))];
  const names = [...new Set(wanted.flatMap((r) => (r.companyName ? [r.companyName.toLowerCase()] : [])))];
  const byDomain = new Map<string, string>();
  const byName = new Map<string, string>();
  for (const part of chunk(domains, 1000)) {
    const found = await db
      .select({ id: company.id, domain: company.domain })
      .from(company)
      .where(and(eq(company.organizationId, actor.organizationId), inArray(company.domain, part)));
    for (const f of found) byDomain.set(f.domain as string, f.id);
  }
  for (const part of chunk(names, 1000)) {
    const found = await db
      .select({ id: company.id, name: company.name })
      .from(company)
      .where(and(eq(company.organizationId, actor.organizationId), inArray(sql`lower(${company.name})`, part)));
    for (const f of found) if (!byName.has(f.name.toLowerCase())) byName.set(f.name.toLowerCase(), f.id);
  }
  let created = 0;
  const provenance: ProvRow[] = [];
  for (const r of wanted) {
    let id = (r.companyDomain && byDomain.get(r.companyDomain)) || undefined;
    if (!id && r.companyName) id = byName.get(r.companyName.toLowerCase());
    if (!id) {
      const name = r.companyName ?? r.companyDomain ?? "";
      const values = {
        organizationId: actor.organizationId,
        name: name.slice(0, 200),
        domain: r.companyDomain ?? null,
        websiteUrl: r.companyDomain ? `https://${r.companyDomain}` : null,
        source: SOURCE,
        ownerId: await defaultOwner(actor),
      };
      const [row] = await db.insert(company).values(values).onConflictDoNothing().returning({ id: company.id });
      if (row) {
        id = row.id;
        created++;
        provenance.push(...fieldsOf(row.id, { name: values.name, domain: values.domain ?? undefined }, {}));
      } else if (r.companyDomain) {
        const [again] = await db
          .select({ id: company.id })
          .from(company)
          .where(and(eq(company.organizationId, actor.organizationId), eq(company.domain, r.companyDomain)))
          .limit(1);
        id = again?.id;
      }
      if (id && r.companyDomain) byDomain.set(r.companyDomain, id);
      if (id && r.companyName && !byName.has(r.companyName.toLowerCase())) byName.set(r.companyName.toLowerCase(), id);
    }
    if (id) result.set(r, id);
  }
  if (provenance.length) await writeProvenance(actor, "company", provenance, batchId);
  onCreated(created);
  return result;
}

/* -------------------------------------------------------------------------- */
/* Accounts                                                                    */
/* -------------------------------------------------------------------------- */

export async function importCompaniesCsv(actor: Actor, payload: ImportPayload): Promise<ImportResult> {
  const settings = parseSettings("company", payload);
  const vocab = await vocabulary(actor, "company");
  const { columns, rows } = mapCsv(payload.csv, vocab.aliases, vocab.fields, payload.mapping);
  const list = await resolveList(actor, "company", settings);
  const batchId = randomUUID();
  const errors: ImportRowError[] = [];
  const report = { total: rows.length, created: 0, updated: 0, skipped: 0 };
  const fail = (row: number, message: string) => {
    report.skipped++;
    if (errors.length < 500) errors.push({ row, message });
  };

  type Fields = Record<string, unknown> & { name?: string | null; domain?: string | null; websiteUrl?: string | null };
  const prepared: { row: number; fields: Fields; custom: Record<string, CustomFieldValue> }[] = [];
  const seenDomains = new Map<string, number>();
  const seenNames = new Map<string, number>();
  rows.forEach((r, index) => {
    const row = index + 2;
    const domainSource = r.domain ?? r.websiteUrl;
    const domain = domainSource ? normalizeDomain(domainSource) : undefined;
    if (r.domain && !domain) {
      fail(row, "The domain doesn't look valid.");
      return;
    }
    const candidate = {
      name: r.name,
      domain: domain ?? undefined,
      websiteUrl: r.websiteUrl,
      linkedinUrl: r.linkedinUrl,
      twitterUrl: r.twitterUrl,
      phone: r.phone,
      industry: r.industry,
      keywords: csvList(r.keywords),
      technologies: csvList(r.technologies),
      employeeCount: csvInt(r.employeeCount),
      annualRevenue: csvInt(r.annualRevenue),
      foundedYear: csvInt(r.foundedYear),
      description: r.description,
      city: r.city,
      state: r.state,
      country: r.country,
      stage: settings.stageMode === "fixed" ? settings.stage : csvEnum(r.stage, COMPANY_STAGES),
    };
    const result = companyCreateSchema.safeParse(candidate);
    if (!result.success) {
      fail(row, result.error.issues[0]?.message ?? "Invalid row.");
      return;
    }
    const custom = customValues(r, vocab);
    if ("error" in custom) {
      fail(row, custom.error);
      return;
    }
    const { runDedupe: _r, customFields: _cf, ...fields } = result.data;
    const key = fields.domain ?? undefined;
    const nameKey = !key && fields.name ? fields.name.toLowerCase() : undefined;
    const first = key ? seenDomains.get(key) : nameKey && seenNames.get(nameKey);
    if (first) {
      fail(row, `Duplicate of row ${first}.`);
      return;
    }
    if (key) seenDomains.set(key, row);
    if (nameKey) seenNames.set(nameKey, row);
    prepared.push({ row, fields, custom: custom.values });
  });

  const byDomain = new Map<string, { id: string; customFields: Record<string, unknown> }>();
  const byName = new Map<string, { id: string; customFields: Record<string, unknown> }>();
  const domains = prepared.flatMap((p) => (p.fields.domain ? [p.fields.domain] : []));
  const names = prepared.flatMap((p) => (!p.fields.domain && p.fields.name ? [p.fields.name.toLowerCase()] : []));
  for (const part of chunk(domains, 1000)) {
    const found = await db
      .select({ id: company.id, domain: company.domain, customFields: company.customFields })
      .from(company)
      .where(and(eq(company.organizationId, actor.organizationId), inArray(company.domain, part)));
    for (const f of found) byDomain.set(f.domain as string, { id: f.id, customFields: f.customFields });
  }
  for (const part of chunk(names, 1000)) {
    const found = await db
      .select({ id: company.id, name: company.name, customFields: company.customFields })
      .from(company)
      .where(and(eq(company.organizationId, actor.organizationId), inArray(sql`lower(${company.name})`, part)));
    for (const f of found) {
      if (!byName.has(f.name.toLowerCase()))
        byName.set(f.name.toLowerCase(), { id: f.id, customFields: f.customFields });
    }
  }

  const ownerId = await defaultOwner(actor);
  const provenance: ProvRow[] = [];
  const touched: string[] = [];
  const inserts: {
    row: number;
    values: typeof company.$inferInsert;
    fields: Record<string, unknown>;
    custom: Record<string, CustomFieldValue>;
  }[] = [];
  for (const p of prepared) {
    const setFields: Record<string, unknown> = Object.fromEntries(
      Object.entries(p.fields).filter(([, v]) => v !== undefined && v !== null),
    );
    let known: { id: string; customFields: Record<string, unknown> } | undefined;
    if (p.fields.domain) known = byDomain.get(p.fields.domain);
    else if (p.fields.name) known = byName.get(p.fields.name.toLowerCase());
    if (known) {
      if (!settings.update) {
        fail(p.row, "Already in your workspace (skipped).");
        continue;
      }
      const { domain: _d, ...update } = setFields;
      const set: Record<string, unknown> = { ...update };
      if (Object.keys(p.custom).length) set.customFields = mergeCustom(known.customFields, p.custom);
      if (Object.keys(set).length) {
        await db
          .update(company)
          .set(set)
          .where(and(eq(company.organizationId, actor.organizationId), eq(company.id, known.id)));
        provenance.push(...fieldsOf(known.id, update, p.custom));
      }
      report.updated++;
      touched.push(known.id);
      continue;
    }
    const name = (p.fields.name ?? p.fields.domain ?? "") as string;
    const fields = { ...setFields, name };
    inserts.push({
      row: p.row,
      fields,
      custom: p.custom,
      values: {
        ...fields,
        customFields: p.custom,
        websiteUrl: p.fields.websiteUrl ?? (p.fields.domain ? `https://${p.fields.domain}` : null),
        ownerId,
        organizationId: actor.organizationId,
        source: SOURCE,
      },
    });
  }

  for (const part of chunk(inserts, 500)) {
    try {
      const created = await db
        .insert(company)
        .values(part.map((i) => i.values))
        .returning({ id: company.id });
      created.forEach((c, i) => {
        provenance.push(...fieldsOf(c.id, part[i].fields, part[i].custom));
        touched.push(c.id);
      });
      report.created += created.length;
    } catch {
      for (const item of part) {
        try {
          const [c] = await db.insert(company).values(item.values).returning({ id: company.id });
          provenance.push(...fieldsOf(c.id, item.fields, item.custom));
          touched.push(c.id);
          report.created++;
        } catch {
          fail(item.row, "Couldn't save this row (the domain may already exist).");
        }
      }
    }
  }

  await writeProvenance(actor, "company", provenance, batchId);
  if (list && touched.length) await addToList(list, touched);
  errors.sort((a, b) => a.row - b.row);
  await audit(actor, "company.import", "company", null, {
    batchId,
    fileName: settings.fileName ?? payload.fileName,
    total: report.total,
    created: report.created,
    updated: report.updated,
    skipped: report.skipped,
    errors: errors.length,
    listId: list?.id ?? null,
  });
  return {
    ...report,
    errors,
    columns,
    batchId,
    listId: list?.id ?? null,
    listName: list?.name ?? null,
    enrichmentQueued: 0,
  };
}

/* -------------------------------------------------------------------------- */
/* Preview, sample template, batches                                           */
/* -------------------------------------------------------------------------- */

export interface ImportPreview {
  rows: number;
  maxRows: number;
  columns: { header: string; field: string | null; recognised: boolean; samples: string[] }[];
  fields: { value: string; label: string; group: "Contact" | "Account" | "Custom fields" }[];
}

export async function importPreview(actor: Actor, entity: ImportEntity, csv: string): Promise<ImportPreview> {
  const vocab = await vocabulary(actor, entity);
  const table = parseCsv(csv);
  if (table.length < 2) throw unprocessable("The file needs a header row and at least one data row.", "file");
  const [header, ...data] = table;
  const used = new Set<string>();
  const columns = header.map((raw, index) => {
    const name = raw.trim();
    let field: string | null = vocab.aliases[headerKey(name)] ?? null;
    if (field && used.has(field)) field = null;
    if (field) used.add(field);
    const samples: string[] = [];
    for (const row of data) {
      const cell = row[index]?.trim();
      if (cell) samples.push(cell.slice(0, 200));
      if (samples.length >= 3) break;
    }
    return { header: name, field, recognised: field !== null, samples };
  });
  return { rows: data.length, maxRows: IMPORT_MAX_ROWS, columns, fields: vocab.options };
}

export function sampleCsv(entity: ImportEntity): string {
  if (entity === "contact") {
    return [
      "First name,Last name,Email,Title,Company,Website,City,Country,Phone,LinkedIn URL,Stage",
      "Ada,Lovelace,ada@example.com,Head of engineering,Example Inc,example.com,London,United Kingdom,+44 20 7946 0000,https://www.linkedin.com/in/example,Cold",
      "Grace,Hopper,grace@example.org,VP operations,Example Org,example.org,New York,United States,,,",
    ]
      .join("\r\n")
      .concat("\r\n");
  }
  return [
    "Company name,Website,Industry,Employees,Annual revenue,Founded year,City,Country,Keywords,Stage",
    "Example Inc,example.com,Software,120,15000000,2012,London,United Kingdom,analytics; saas,Prospect",
    "Example Org,example.org,Logistics,45,,2018,Toronto,Canada,shipping,Cold",
  ]
    .join("\r\n")
    .concat("\r\n");
}

export interface ImportBatch {
  batchId: string;
  fileName: string | null;
  createdAt: string;
  created: number;
  updated: number;
  skipped: number;
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

export async function listImportBatches(actor: Actor, entityType: ImportEntity): Promise<ImportBatch[]> {
  const rows = await db
    .select({ metadata: schema.auditLog.metadata, createdAt: schema.auditLog.createdAt })
    .from(schema.auditLog)
    .where(
      and(
        eq(schema.auditLog.organizationId, actor.organizationId),
        eq(schema.auditLog.action, entityType === "contact" ? "contact.import" : "company.import"),
        isNotNull(sql`${schema.auditLog.metadata}->>'batchId'`),
      ),
    )
    .orderBy(desc(schema.auditLog.createdAt))
    .limit(200);
  return rows.map((r) => {
    const m = r.metadata ?? {};
    return {
      batchId: String(m.batchId),
      fileName: typeof m.fileName === "string" ? m.fileName : null,
      createdAt: r.createdAt.toISOString(),
      created: num(m.created),
      updated: num(m.updated),
      skipped: num(m.skipped),
    };
  });
}

/* -------------------------------------------------------------------------- */
/* Imports & exports history                                                   */
/* -------------------------------------------------------------------------- */

export const HISTORY_ACTIONS = ["contact.import", "company.import", "contact.export", "company.export"] as const;

export interface HistoryEntry {
  id: string;
  action: (typeof HISTORY_ACTIONS)[number];
  createdAt: string;
  actorName: string | null;
  actorEmail: string | null;
  viaApiKey: boolean;
  fileName: string | null;
  total: number | null;
  created: number | null;
  updated: number | null;
  skipped: number | null;
  count: number | null;
}

export async function importHistory(
  actor: Actor,
  page: { perPage: number; offset: number },
): Promise<{ entries: HistoryEntry[]; total: number }> {
  const where = and(
    eq(schema.auditLog.organizationId, actor.organizationId),
    or(...HISTORY_ACTIONS.map((a) => eq(schema.auditLog.action, a))),
  );
  const [rows, [{ total }]] = await Promise.all([
    db
      .select({
        id: schema.auditLog.id,
        action: schema.auditLog.action,
        metadata: schema.auditLog.metadata,
        createdAt: schema.auditLog.createdAt,
        actorApiKeyId: schema.auditLog.actorApiKeyId,
        actorName: schema.user.name,
        actorEmail: schema.user.email,
      })
      .from(schema.auditLog)
      .leftJoin(schema.user, eq(schema.user.id, schema.auditLog.actorUserId))
      .where(where)
      .orderBy(desc(schema.auditLog.createdAt), desc(schema.auditLog.id))
      .limit(page.perPage)
      .offset(page.offset),
    db.select({ total: sql<number>`count(*)::int` }).from(schema.auditLog).where(where),
  ]);
  const opt = (m: Record<string, unknown>, key: string) => (typeof m[key] === "number" ? (m[key] as number) : null);
  return {
    total,
    entries: rows.map((r) => {
      const m = r.metadata ?? {};
      return {
        id: r.id,
        action: r.action as HistoryEntry["action"],
        createdAt: r.createdAt.toISOString(),
        actorName: r.actorName,
        actorEmail: r.actorEmail,
        viaApiKey: Boolean(r.actorApiKeyId),
        fileName: typeof m.fileName === "string" ? m.fileName : null,
        total: opt(m, "total"),
        created: opt(m, "created"),
        updated: opt(m, "updated"),
        skipped: opt(m, "skipped"),
        count: opt(m, "count"),
      };
    }),
  };
}
