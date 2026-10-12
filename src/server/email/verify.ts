import "server-only";

import { and, desc, eq, inArray, sql } from "drizzle-orm";

import { guardedLookup } from "@/server/crawler/fetch";
import { db, schema } from "@/server/db";
import { env } from "@/server/env";
import { log } from "@/server/log";
import { cacheGet, cacheSet } from "@/server/redis";

import {
  checkSyntax,
  classify,
  isDisposableDomain,
  isRoleAddress,
  type MailHostState,
  type ProbeOutcome,
  type VerificationStatus,
} from "./verify-rules";
import { createHash, randomBytes } from "node:crypto";
import { Resolver } from "node:dns/promises";
import net from "node:net";

/**
 * Email verification without sending a message: syntax, disposable domains, role addresses, MX
 * lookup (falling back to A/AAAA per RFC 5321 §5.1) and, only when VERIFY_SMTP_PROBE=true, an SMTP
 * RCPT probe. Many providers (Microsoft 365, Gmail, Proofpoint…) refuse or tarpit probes, and port 25
 * is often blocked outbound, so the probe is off by default; with it off, an address whose domain
 * accepts mail is "unknown" unless a real send from this workspace confirmed it (or it bounced).
 *
 * Results are cached per address for 7 days so the same lookup is never repeated ("never pay twice").
 */

export interface VerificationResult {
  email: string;
  status: VerificationStatus;
  reason: string;
  checks: {
    syntax: boolean;
    disposable: boolean;
    role: boolean;
    mx: string[];
    mailHost: MailHostState["kind"] | null;
    smtpProbe: ProbeOutcome;
    confirmedBySend: boolean;
  };
  cached: boolean;
  checkedAt: string;
}

const CACHE_TTL_SECONDS = 7 * 24 * 60 * 60;
const ERROR_TTL_SECONDS = 60 * 60;
const DNS_TIMEOUT_MS = 4000;

type CachedCore = Omit<VerificationResult, "cached" | "checks"> & {
  checks: Omit<VerificationResult["checks"], "confirmedBySend">;
};

export function smtpProbeEnabled(): boolean {
  return env().VERIFY_SMTP_PROBE;
}

function cacheKey(email: string): string {
  return `anhour:verify:v1:${createHash("sha256").update(email).digest("hex")}`;
}

function errorCode(error: unknown): string {
  return typeof error === "object" && error && "code" in error ? String((error as { code: unknown }).code) : "ERROR";
}

const NO_RECORDS = new Set(["ENOTFOUND", "ENODATA", "NXDOMAIN"]);

/** MX hosts for a domain, falling back to the domain itself when it has an A/AAAA record. */
export async function mailHosts(domain: string): Promise<MailHostState> {
  const resolver = new Resolver({ timeout: DNS_TIMEOUT_MS, tries: 2 });
  try {
    const records = await resolver.resolveMx(domain);
    if (records.length === 1 && (records[0]?.exchange === "" || records[0]?.exchange === "."))
      return { kind: "null_mx" };
    const hosts = records
      .filter((r) => r.exchange && r.exchange !== ".")
      .sort((a, b) => a.priority - b.priority)
      .map((r) => r.exchange.toLowerCase());
    if (hosts.length) return { kind: "mx", hosts };
  } catch (error) {
    const code = errorCode(error);
    if (!NO_RECORDS.has(code)) return { kind: "error", code };
    if (code === "ENOTFOUND") return { kind: "none" };
  }
  // No MX: RFC 5321 says the domain itself is the implicit mail host if it has an address.
  for (const type of ["resolve4", "resolve6"] as const) {
    try {
      const addresses = await resolver[type](domain);
      if (addresses.length) return { kind: "a_fallback", hosts: [domain] };
    } catch (error) {
      const code = errorCode(error);
      if (!NO_RECORDS.has(code)) return { kind: "error", code };
    }
  }
  return { kind: "none" };
}

/* -------------------------------------------------------------------------- */
/* Optional SMTP probe                                                        */
/* -------------------------------------------------------------------------- */

function smtpConversation(host: string, email: string, domain: string): Promise<ProbeOutcome> {
  return new Promise((resolve) => {
    const helo = env().APP_DOMAIN_TARGET || "localhost";
    const random = `${randomBytes(8).toString("hex")}@${domain}`;
    const steps = [`EHLO ${helo}`, "MAIL FROM:<>", `RCPT TO:<${email}>`, `RCPT TO:<${random}>`, "QUIT"];
    const codes: number[] = [];
    let buffer = "";
    let finished = false;
    const socket = net.connect({ host, port: 25, lookup: guardedLookup(env().CRAWLER_ALLOW_PRIVATE_HOSTS) });
    const finish = (outcome: ProbeOutcome) => {
      if (finished) return;
      finished = true;
      socket.destroy();
      resolve(outcome);
    };
    const timer = setTimeout(() => finish("inconclusive"), 10_000);
    socket.setEncoding("utf8");
    socket.on("error", () => finish("inconclusive"));
    socket.on("close", () => {
      clearTimeout(timer);
      finish("inconclusive");
    });
    socket.on("data", (chunk: string) => {
      buffer += chunk;
      const lines = buffer.split("\r\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        // Multi-line replies use "250-"; the last line uses "250 ".
        if (!/^\d{3} /.test(line) && !/^\d{3}$/.test(line)) continue;
        const code = Number(line.slice(0, 3));
        codes.push(code);
        const step = codes.length - 1;
        if (step === 0 && code !== 220) return finish("inconclusive");
        if ((step === 1 || step === 2) && code >= 400) return finish("inconclusive");
        if (step === 3) {
          if (code >= 500 && code < 600) return finish("rejected");
          if (code >= 400) return finish("inconclusive");
        }
        if (step === 4) {
          const target = codes[3] ?? 0;
          if (target >= 200 && target < 300) return finish(code >= 200 && code < 300 ? "catch_all" : "accepted");
          return finish("inconclusive");
        }
        const next = steps[step];
        if (next) socket.write(`${next}\r\n`);
        else finish("inconclusive");
      }
    });
  });
}

async function smtpProbe(hosts: string[], email: string, domain: string): Promise<ProbeOutcome> {
  for (const host of hosts.slice(0, 2)) {
    const outcome = await smtpConversation(host, email, domain);
    if (outcome !== "inconclusive") return outcome;
  }
  return "inconclusive";
}

/* -------------------------------------------------------------------------- */
/* Send history                                                               */
/* -------------------------------------------------------------------------- */

/** "sent" when a real send from this workspace went out, "bounced" when the latest one bounced. */
async function sendHistory(organizationId: string, email: string): Promise<"sent" | "bounced" | null> {
  try {
    const [row] = await db
      .select({ status: schema.outboundMessage.status })
      .from(schema.outboundMessage)
      .where(
        and(
          eq(schema.outboundMessage.organizationId, organizationId),
          sql`lower(${schema.outboundMessage.toEmail}) = ${email}`,
          inArray(schema.outboundMessage.status, ["sent", "bounced"]),
        ),
      )
      .orderBy(desc(schema.outboundMessage.createdAt))
      .limit(1);
    return row?.status === "sent" || row?.status === "bounced" ? row.status : null;
  } catch (error) {
    log.warn("send history lookup failed", { component: "verify", error });
    return null;
  }
}

/* -------------------------------------------------------------------------- */
/* Entry point                                                                */
/* -------------------------------------------------------------------------- */

async function verifyUncached(email: string): Promise<CachedCore> {
  const syntax = checkSyntax(email);
  const base = {
    syntax: syntax.ok,
    disposable: syntax.ok && isDisposableDomain(syntax.domain),
    role: syntax.ok && isRoleAddress(syntax.local),
  };
  let mail: MailHostState | null = null;
  let probe: ProbeOutcome = "skipped";
  if (syntax.ok && !base.disposable) {
    mail = await mailHosts(syntax.domain);
    if ((mail.kind === "mx" || mail.kind === "a_fallback") && !base.role && smtpProbeEnabled()) {
      probe = await smtpProbe(mail.hosts, syntax.email, syntax.domain);
    }
  }
  const { status, reason } = classify({ syntax, mail, probe });
  return {
    email: syntax.email,
    status,
    reason,
    checks: {
      ...base,
      mx: mail && (mail.kind === "mx" || mail.kind === "a_fallback") ? mail.hosts : [],
      mailHost: mail?.kind ?? null,
      smtpProbe: probe,
    },
    checkedAt: new Date().toISOString(),
  };
}

/**
 * Verify one address. `organizationId` lets a real send (or bounce) from that workspace settle an
 * otherwise unknown result. `force` skips the cache.
 */
export async function verifyEmail(
  input: string,
  options: { organizationId?: string; force?: boolean } = {},
): Promise<VerificationResult> {
  const email = input.trim().toLowerCase();
  const key = cacheKey(email);
  let core = options.force ? null : await cacheGet<CachedCore>(key);
  const cached = core !== null;
  if (!core) {
    core = await verifyUncached(email);
    const ttl =
      core.reason === "dns_error" || core.reason === "smtp_inconclusive" ? ERROR_TTL_SECONDS : CACHE_TTL_SECONDS;
    await cacheSet(key, core, ttl);
  }

  let { status, reason } = core;
  let confirmedBySend = false;
  if (options.organizationId && (status === "unknown" || status === "catch_all" || status === "valid")) {
    const history = await sendHistory(options.organizationId, core.email);
    if (history === "bounced") {
      status = "invalid";
      reason = "bounced";
    } else if (history === "sent" && status !== "valid") {
      status = "valid";
      reason = "confirmed_by_send";
      confirmedBySend = true;
    }
  }
  return { ...core, status, reason, checks: { ...core.checks, confirmedBySend }, cached };
}
