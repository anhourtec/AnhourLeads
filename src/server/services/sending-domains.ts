import "server-only";

import { and, asc, eq, isNull, lt, or, sql } from "drizzle-orm";
import { z } from "zod";

import type { Actor } from "@/server/auth/actor";
import { db, schema } from "@/server/db";
import { notFound } from "@/server/http/errors";
import { log } from "@/server/log";
import { audit } from "@/server/services/audit";

import { normalizeDomain, unprocessable } from "./records";
import { Resolver } from "node:dns/promises";

/**
 * Sending domains: the domains the workspace's mailboxes send from, plus any added by hand, with
 * DNS health checks (SPF, DKIM, DMARC, MX). DNS only: nothing here connects to the domain's servers.
 * Results are stored as pass / fail / missing / unknown with a plain-language fix and an example
 * record people can copy. Resolver errors are never echoed.
 */

export type CheckStatus = "pass" | "fail" | "missing" | "unknown";
export type CheckKey = "spf" | "dkim" | "dmarc" | "mx";

export interface CheckDetail {
  status: CheckStatus;
  /** The record found (or the first one, when several were found). */
  record: string | null;
  message: string;
  /** What to do about it. Null when nothing needs doing. */
  fix: string | null;
  /** A record people can copy as a starting point. */
  example: { type: "TXT" | "MX"; name: string; value: string } | null;
  includes?: string[];
  policy?: string | null;
  selector?: string | null;
  hosts?: string[];
  warning?: string | null;
}

export type DomainDetails = Partial<Record<CheckKey, CheckDetail>>;

export interface SendingDomainView {
  id: string;
  domain: string;
  spf: CheckStatus;
  dkim: CheckStatus;
  dmarc: CheckStatus;
  mx: CheckStatus;
  details: DomainDetails;
  /** Mailboxes in this workspace that send from the domain. */
  mailboxes: string[];
  lastCheckedAt: string | null;
  createdAt: string;
}

export const DKIM_SELECTORS = ["google", "selector1", "selector2", "default", "s1", "k1"] as const;
const STALE_MS = 24 * 60 * 60 * 1000;
const ABSENT = new Set(["ENOTFOUND", "ENODATA", "NXDOMAIN", "ENONAME"]);

type Row = typeof schema.sendingDomain.$inferSelect;

/* -------------------------------------------------------------------------- */
/* DNS checks                                                                 */
/* -------------------------------------------------------------------------- */

const INCONCLUSIVE = Symbol("inconclusive");

function resolver(): Resolver {
  return new Resolver({ timeout: 3_000, tries: 2 });
}

async function txt(r: Resolver, name: string): Promise<string[] | typeof INCONCLUSIVE> {
  try {
    const raw = await r.resolveTxt(name);
    return raw.map((chunks) => chunks.join("").trim());
  } catch (error) {
    return ABSENT.has(String((error as { code?: unknown }).code ?? "")) ? [] : INCONCLUSIVE;
  }
}

const inconclusive = (what: string): CheckDetail => ({
  status: "unknown",
  record: null,
  message: `Couldn't look up the ${what} record right now. Try again in a few minutes.`,
  fix: null,
  example: null,
});

export function evaluateSpf(domain: string, records: string[]): CheckDetail {
  const example = { type: "TXT" as const, name: domain, value: "v=spf1 include:_spf.google.com ~all" };
  const spf = records.filter((r) => r.toLowerCase().startsWith("v=spf1"));
  if (!spf.length) {
    return {
      status: "missing",
      record: null,
      message: "No SPF record found.",
      fix: "Add one TXT record at the domain's root that lists every service allowed to send for it, such as your email provider.",
      example,
      includes: [],
    };
  }
  const record = spf[0] ?? "";
  const includes = record
    .split(/\s+/)
    .filter((t) => t.toLowerCase().startsWith("include:"))
    .map((t) => t.slice("include:".length));
  if (spf.length > 1) {
    return {
      status: "fail",
      record,
      message: `${spf.length} SPF records found. Receivers treat more than one as an error.`,
      fix: "Merge them into a single TXT record that starts with v=spf1 and lists every include.",
      example,
      includes,
    };
  }
  if (/(^|\s)\+all(\s|$)/i.test(record)) {
    return {
      status: "fail",
      record,
      message: "The SPF record ends with +all, which lets anyone send as this domain.",
      fix: "Change +all to ~all (soft fail) or -all (hard fail).",
      example,
      includes,
    };
  }
  return {
    status: "pass",
    record,
    message: includes.length ? `SPF allows ${includes.join(", ")}.` : "An SPF record is published.",
    fix: null,
    example: null,
    includes,
  };
}

export function evaluateDmarc(domain: string, records: string[]): CheckDetail {
  const name = `_dmarc.${domain}`;
  const example = {
    type: "TXT" as const,
    name,
    value: `v=DMARC1; p=quarantine; rua=mailto:dmarc@${domain}; adkim=r; aspf=r`,
  };
  const dmarc = records.filter((r) => r.toLowerCase().startsWith("v=dmarc1"));
  if (!dmarc.length) {
    return {
      status: "missing",
      record: null,
      message: "No DMARC record found.",
      fix: `Add a TXT record at ${name}. Start with p=none to monitor, then move to quarantine.`,
      example,
      policy: null,
    };
  }
  const record = dmarc[0] ?? "";
  const policy = record.match(/(?:^|;)\s*p\s*=\s*([a-z]+)/i)?.[1]?.toLowerCase() ?? null;
  if (dmarc.length > 1 || !policy || !["none", "quarantine", "reject"].includes(policy)) {
    return {
      status: "fail",
      record,
      message: dmarc.length > 1 ? "More than one DMARC record found." : "The DMARC record has no valid policy (p=).",
      fix: "Keep a single DMARC record with p=none, p=quarantine or p=reject.",
      example,
      policy,
    };
  }
  return {
    status: "pass",
    record,
    message: `DMARC policy is ${policy}.`,
    fix: null,
    example: null,
    policy,
    warning:
      policy === "none"
        ? "The policy is none, so receivers only report failures. Move to quarantine once reports look clean."
        : null,
  };
}

export function evaluateDkim(domain: string, found: { selector: string; record: string } | null): CheckDetail {
  if (!found) {
    return {
      status: "missing",
      record: null,
      message: `No DKIM key found at the common selectors (${DKIM_SELECTORS.join(", ")}).`,
      fix: "Turn on DKIM signing in your email provider's admin console and publish the TXT record it gives you. If you use a custom selector, it can't be discovered from DNS, so this check may miss it.",
      example: {
        type: "TXT",
        name: `google._domainkey.${domain}`,
        value: "v=DKIM1; k=rsa; p=<public key from your provider>",
      },
      selector: null,
    };
  }
  return {
    status: "pass",
    record: found.record.length > 120 ? `${found.record.slice(0, 117)}...` : found.record,
    message: `DKIM key published at selector ${found.selector}.`,
    fix: null,
    example: null,
    selector: found.selector,
  };
}

export function hasDkimKey(record: string): boolean {
  const key = record.match(/(?:^|;)\s*p\s*=\s*([^;\s]*)/i)?.[1] ?? "";
  return key.length > 0;
}

async function checkMx(r: Resolver, domain: string): Promise<CheckDetail> {
  const example = { type: "MX" as const, name: domain, value: "1 smtp.google.com" };
  try {
    const records = await r.resolveMx(domain);
    if (records.length === 1 && (records[0]?.exchange === "" || records[0]?.exchange === ".")) {
      return {
        status: "fail",
        record: "0 .",
        message: "The domain publishes a null MX: it says it accepts no mail, so replies and bounces are lost.",
        fix: "Replace the null MX with your email provider's MX records.",
        example,
        hosts: [],
      };
    }
    if (!records.length) throw Object.assign(new Error("none"), { code: "ENODATA" });
    const hosts = records.sort((a, b) => a.priority - b.priority).map((m) => m.exchange.toLowerCase());
    return {
      status: "pass",
      record: hosts[0] ?? null,
      message: `Mail is received by ${hosts.join(", ")}.`,
      fix: null,
      example: null,
      hosts,
    };
  } catch (error) {
    if (!ABSENT.has(String((error as { code?: unknown }).code ?? ""))) return inconclusive("MX");
    return {
      status: "missing",
      record: null,
      message: "No MX record found, so this domain can't receive replies or bounce notices.",
      fix: "Add the MX records your email provider gives you.",
      example,
      hosts: [],
    };
  }
}

/** Run every check for one domain. Never throws. */
export async function checkDomainDns(domain: string): Promise<Record<CheckKey, CheckDetail>> {
  const r = resolver();
  const [root, dmarc, mx, ...dkim] = await Promise.all([
    txt(r, domain),
    txt(r, `_dmarc.${domain}`),
    checkMx(r, domain),
    ...DKIM_SELECTORS.map((s) => txt(r, `${s}._domainkey.${domain}`)),
  ]);
  let dkimFound: { selector: string; record: string } | null = null;
  let dkimInconclusive = false;
  dkim.forEach((records, i) => {
    if (records === INCONCLUSIVE) {
      dkimInconclusive = true;
      return;
    }
    const rec = records.find((v) => v.toLowerCase().includes("p=") && hasDkimKey(v));
    if (rec && !dkimFound) dkimFound = { selector: DKIM_SELECTORS[i] ?? "", record: rec };
  });
  return {
    spf: root === INCONCLUSIVE ? inconclusive("SPF") : evaluateSpf(domain, root),
    dmarc: dmarc === INCONCLUSIVE ? inconclusive("DMARC") : evaluateDmarc(domain, dmarc),
    dkim: !dkimFound && dkimInconclusive ? inconclusive("DKIM") : evaluateDkim(domain, dkimFound),
    mx,
  };
}

/* -------------------------------------------------------------------------- */
/* CRUD                                                                       */
/* -------------------------------------------------------------------------- */

function mailboxDomain(email: string): string | null {
  const at = email.lastIndexOf("@");
  return at > 0 ? normalizeDomain(email.slice(at + 1)) : null;
}

function toView(row: Row, mailboxes: string[]): SendingDomainView {
  return {
    id: row.id,
    domain: row.domain,
    spf: row.spf,
    dkim: row.dkim,
    dmarc: row.dmarc,
    mx: row.mx,
    details: (row.details ?? {}) as DomainDetails,
    mailboxes,
    lastCheckedAt: row.lastCheckedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

async function mailboxesByDomain(organizationId: string): Promise<Map<string, string[]>> {
  const rows = await db
    .select({ email: schema.mailbox.email })
    .from(schema.mailbox)
    .where(eq(schema.mailbox.organizationId, organizationId));
  const out = new Map<string, string[]>();
  for (const r of rows) {
    const d = mailboxDomain(r.email);
    if (d) out.set(d, [...(out.get(d) ?? []), r.email]);
  }
  return out;
}

/** Domains of the workspace's mailboxes are added lazily (unchecked) so they always show. */
export async function listSendingDomains(actor: Pick<Actor, "organizationId">): Promise<SendingDomainView[]> {
  const byDomain = await mailboxesByDomain(actor.organizationId);
  if (byDomain.size) {
    await db
      .insert(schema.sendingDomain)
      .values([...byDomain.keys()].map((domain) => ({ organizationId: actor.organizationId, domain })))
      .onConflictDoNothing();
  }
  const rows = await db
    .select()
    .from(schema.sendingDomain)
    .where(eq(schema.sendingDomain.organizationId, actor.organizationId))
    .orderBy(asc(schema.sendingDomain.domain));
  return rows.map((r) => toView(r, byDomain.get(r.domain) ?? []));
}

async function findDomain(actor: Pick<Actor, "organizationId">, id: string): Promise<Row> {
  const [row] = await db
    .select()
    .from(schema.sendingDomain)
    .where(and(eq(schema.sendingDomain.id, id), eq(schema.sendingDomain.organizationId, actor.organizationId)))
    .limit(1);
  if (!row) throw notFound("Sending domain not found.");
  return row;
}

export const addSendingDomainInput = z.object({ domain: z.string().trim().min(1).max(255) }).strict();

export async function addSendingDomain(actor: Actor, input: z.infer<typeof addSendingDomainInput>) {
  const domain = normalizeDomain(input.domain.replace(/^.*@/, ""));
  if (!domain) throw unprocessable("Enter a domain like example.com.", "domain");
  const [row] = await db
    .insert(schema.sendingDomain)
    .values({ organizationId: actor.organizationId, domain })
    .onConflictDoNothing()
    .returning();
  const saved =
    row ??
    (
      await db
        .select()
        .from(schema.sendingDomain)
        .where(
          and(eq(schema.sendingDomain.organizationId, actor.organizationId), eq(schema.sendingDomain.domain, domain)),
        )
        .limit(1)
    )[0];
  if (!saved) throw new Error("sending domain insert returned nothing");
  if (row) await audit(actor, "sending_domain.create", "sending_domain", row.id, { domain });
  const checked = await runCheck(saved);
  const byDomain = await mailboxesByDomain(actor.organizationId);
  return { domain: toView(checked, byDomain.get(domain) ?? []), created: Boolean(row) };
}

export async function deleteSendingDomain(actor: Actor, id: string) {
  const row = await findDomain(actor, id);
  await db
    .delete(schema.sendingDomain)
    .where(and(eq(schema.sendingDomain.id, row.id), eq(schema.sendingDomain.organizationId, actor.organizationId)));
  await audit(actor, "sending_domain.delete", "sending_domain", row.id, { domain: row.domain });
  return { id: row.id, deleted: true };
}

async function runCheck(row: Row): Promise<Row> {
  const result = await checkDomainDns(row.domain);
  const [updated] = await db
    .update(schema.sendingDomain)
    .set({
      spf: result.spf.status,
      dkim: result.dkim.status,
      dmarc: result.dmarc.status,
      mx: result.mx.status,
      details: result as unknown as Record<string, unknown>,
      lastCheckedAt: new Date(),
    })
    .where(eq(schema.sendingDomain.id, row.id))
    .returning();
  return updated ?? row;
}

export async function checkSendingDomain(actor: Actor, id: string) {
  const row = await findDomain(actor, id);
  const checked = await runCheck(row);
  await audit(actor, "sending_domain.check", "sending_domain", row.id, {
    spf: checked.spf,
    dkim: checked.dkim,
    dmarc: checked.dmarc,
    mx: checked.mx,
  });
  const byDomain = await mailboxesByDomain(actor.organizationId);
  return toView(checked, byDomain.get(row.domain) ?? []);
}

/** Scheduled re-check (all workspaces): domains never checked or checked more than 24 hours ago. */
export async function recheckStaleSendingDomains(limit = 10): Promise<{ checked: number }> {
  const before = new Date(Date.now() - STALE_MS);
  const rows = await db
    .select()
    .from(schema.sendingDomain)
    .where(or(isNull(schema.sendingDomain.lastCheckedAt), lt(schema.sendingDomain.lastCheckedAt, before)))
    .orderBy(sql`${schema.sendingDomain.lastCheckedAt} asc nulls first`)
    .limit(limit);
  let checked = 0;
  for (const row of rows) {
    try {
      await runCheck(row);
      checked += 1;
    } catch (error) {
      log.error("sending domain re-check failed", { component: "deliverability", domainId: row.id, error });
    }
  }
  return { checked };
}
