import "server-only";

import { and, desc, eq, gt, like } from "drizzle-orm";
import { z } from "zod";

import { db, schema } from "@/server/db";
import { sendMail } from "@/server/email/mailer";
import { HttpError } from "@/server/http/errors";
import { log } from "@/server/log";

import { addOptout, normalizeOptoutDomain, normalizeOptoutEmail, type OptoutView } from "./optouts";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { resolveTxt } from "node:dns/promises";

/**
 * Public removal requests (/privacy/removal). Nobody is removed on someone else's say-so:
 *  - an email address is removed after a link sent to that address is followed;
 *  - a domain is removed after a DNS TXT record `anhour-optout=<token>` appears on it, or after a
 *    link sent to an address at that domain is followed.
 * Pending requests live 7 days in the generic `verification` table (identifier
 * `index-removal:<token>`); only a hash of the emailed secret is stored.
 */

const PREFIX = "index-removal:";
const TTL_MS = 7 * 24 * 60 * 60 * 1000;

export const removalRequestInput = z
  .strictObject({
    kind: z.enum(["email", "domain"]),
    value: z.string().trim().min(3, "Enter an email address or a domain.").max(254),
    reason: z.string().trim().max(1000).optional(),
    /** Domain requests: an address at that domain to send the confirmation link to (optional). */
    contactEmail: z.string().trim().max(254).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.kind === "email" && !normalizeOptoutEmail(v.value)) {
      ctx.addIssue({ code: "custom", path: ["value"], message: "Enter a valid email address." });
    }
    if (v.kind === "domain") {
      const domain = normalizeOptoutDomain(v.value);
      if (!domain || !domain.includes(".")) {
        ctx.addIssue({ code: "custom", path: ["value"], message: "Enter a domain such as example.com." });
        return;
      }
      if (v.contactEmail) {
        const email = normalizeOptoutEmail(v.contactEmail);
        const at = email?.split("@")[1] ?? "";
        if (!email || (at !== domain && !at.endsWith(`.${domain}`))) {
          ctx.addIssue({ code: "custom", path: ["contactEmail"], message: `Use an address at ${domain}.` });
        }
      }
    }
  });

export const removalVerifyInput = z.strictObject({
  token: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9_-]{16,64}$/, "This link isn't valid."),
  method: z.enum(["link", "dns"]),
  secret: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9_-]{16,64}$/, "This link isn't valid.")
    .optional(),
});

interface Pending {
  kind: "email" | "domain";
  value: string;
  reason: string | null;
  /** Where the confirmation link went (the email itself, or an address at the domain). */
  sentTo: string | null;
  secretHash: string | null;
  createdAt: string;
}

const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const token = () => randomBytes(18).toString("base64url");

export function txtRecordFor(t: string): string {
  return `anhour-optout=${t}`;
}

function mask(email: string): string {
  const [local = "", domain = ""] = email.split("@");
  return `${local.slice(0, 1)}${"•".repeat(Math.max(1, Math.min(6, local.length - 1)))}@${domain}`;
}

async function sendConfirmation(to: string, link: string, what: string): Promise<boolean> {
  return sendMail({
    to,
    subject: "Confirm your removal request",
    text: [
      `Someone asked to remove ${what} from this installation's public business index.`,
      "",
      "If that was you, confirm here (the link works for 7 days):",
      link,
      "",
      "If it wasn't you, ignore this message and nothing changes.",
    ].join("\n"),
  });
}

export interface RemovalRequestResult {
  token: string;
  kind: "email" | "domain";
  value: string;
  /** Masked address the confirmation link was sent to, if any. */
  sentTo: string | null;
  /** Domain requests: the TXT record that proves control of the domain. */
  txtRecord: string | null;
  expiresAt: string;
}

/** Recent pending requests for the same value (anti-abuse: at most 3 per hour). */
async function recentFor(value: string): Promise<number> {
  const rows = await db
    .select({ value: schema.verification.value })
    .from(schema.verification)
    .where(
      and(
        like(schema.verification.identifier, `${PREFIX}%`),
        gt(schema.verification.createdAt, new Date(Date.now() - 60 * 60 * 1000)),
      ),
    )
    .limit(500);
  return rows.filter((r) => {
    try {
      return (JSON.parse(r.value) as Pending).value === value;
    } catch {
      return false;
    }
  }).length;
}

export async function createRemovalRequest(
  input: z.infer<typeof removalRequestInput>,
  origin: string,
): Promise<RemovalRequestResult> {
  const value =
    input.kind === "email"
      ? (normalizeOptoutEmail(input.value) as string)
      : (normalizeOptoutDomain(input.value) as string);
  if ((await recentFor(value)) >= 3)
    throw new HttpError(429, "Too many requests for this address. Try again in an hour.");
  const t = token();
  const secret = token();
  const sentTo = input.kind === "email" ? value : input.contactEmail ? normalizeOptoutEmail(input.contactEmail) : null;
  const pending: Pending = {
    kind: input.kind,
    value,
    reason: input.reason ?? null,
    sentTo,
    secretHash: sentTo ? hash(secret) : null,
    createdAt: new Date().toISOString(),
  };
  const expiresAt = new Date(Date.now() + TTL_MS);
  await db
    .insert(schema.verification)
    .values({ id: crypto.randomUUID(), identifier: `${PREFIX}${t}`, value: JSON.stringify(pending), expiresAt });
  if (sentTo) {
    const link = `${origin.replace(/\/+$/, "")}/privacy/removal/confirm/${t}.${secret}`;
    const sent = await sendConfirmation(sentTo, link, input.kind === "email" ? value : `the domain ${value}`);
    if (!sent) log.warn("removal confirmation not sent", { component: "discovery", kind: input.kind });
  }
  log.info("removal request created", { component: "discovery", kind: input.kind });
  return {
    token: t,
    kind: input.kind,
    value,
    sentTo: sentTo ? mask(sentTo) : null,
    txtRecord: input.kind === "domain" ? txtRecordFor(t) : null,
    expiresAt: expiresAt.toISOString(),
  };
}

async function pendingRow(t: string): Promise<{ id: string; pending: Pending } | null> {
  const [row] = await db
    .select()
    .from(schema.verification)
    .where(and(eq(schema.verification.identifier, `${PREFIX}${t}`), gt(schema.verification.expiresAt, new Date())))
    .limit(1);
  if (!row) return null;
  try {
    return { id: row.id, pending: JSON.parse(row.value) as Pending };
  } catch {
    return null;
  }
}

/** What a confirmation page shows (no secrets). Null when the request is unknown or expired. */
export async function describeRemovalRequest(t: string) {
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(t)) return null;
  const found = await pendingRow(t);
  if (!found) return null;
  return {
    kind: found.pending.kind,
    value: found.pending.value,
    sentTo: found.pending.sentTo ? mask(found.pending.sentTo) : null,
    txtRecord: found.pending.kind === "domain" ? txtRecordFor(t) : null,
  };
}

async function dnsProof(domain: string, t: string): Promise<boolean> {
  try {
    const records = await resolveTxt(domain);
    return records.some((chunks) => chunks.join("").trim() === txtRecordFor(t));
  } catch {
    return false;
  }
}

/** Confirm a request by its emailed link or by DNS. Adds the opt-out and deletes matching index rows. */
export async function verifyRemovalRequest(
  input: z.infer<typeof removalVerifyInput>,
): Promise<{ optout: OptoutView; removed: { companies: number; people: number } }> {
  const found = await pendingRow(input.token);
  if (!found) throw new HttpError(404, "This request has expired or was already confirmed.");
  const { pending } = found;
  if (input.method === "link") {
    const ok =
      pending.secretHash !== null &&
      input.secret !== undefined &&
      timingSafeEqual(Buffer.from(hash(input.secret)), Buffer.from(pending.secretHash));
    if (!ok) throw new HttpError(404, "This request has expired or was already confirmed.");
  } else {
    if (pending.kind !== "domain")
      throw new HttpError(422, "Some fields are invalid.", [
        { path: "method", message: "Email requests are confirmed by the emailed link." },
      ]);
    if (!(await dnsProof(pending.value, input.token))) {
      throw new HttpError(
        409,
        `The TXT record ${txtRecordFor(input.token)} wasn't found on ${pending.value} yet. DNS changes can take a while to appear.`,
      );
    }
  }
  const result = await addOptout({
    kind: pending.kind,
    value: pending.value,
    reason: pending.reason ?? "Removal request",
    requestedBy: input.method === "dns" ? "removal_request:dns" : "removal_request:email",
  });
  await db.delete(schema.verification).where(eq(schema.verification.id, found.id));
  log.info("removal request confirmed", { component: "discovery", kind: pending.kind, method: input.method });
  return { optout: result.optout, removed: result.removed };
}

/** Pending requests for the platform screen (values shown, secrets never). */
export async function listRemovalRequests(limit = 100) {
  const rows = await db
    .select()
    .from(schema.verification)
    .where(and(like(schema.verification.identifier, `${PREFIX}%`), gt(schema.verification.expiresAt, new Date())))
    .orderBy(desc(schema.verification.createdAt))
    .limit(limit);
  return rows.flatMap((r) => {
    try {
      const p = JSON.parse(r.value) as Pending;
      return [
        {
          id: r.id,
          kind: p.kind,
          value: p.value,
          reason: p.reason,
          verification: p.kind === "email" ? "email link" : p.sentTo ? "DNS or email link" : "DNS",
          createdAt: p.createdAt,
          expiresAt: r.expiresAt.toISOString(),
        },
      ];
    } catch {
      return [];
    }
  });
}
