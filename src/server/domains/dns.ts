import "server-only";

import { bareHost, domainTarget } from "./hostname";
import { Resolver } from "node:dns/promises";

/**
 * DNS lookups for hostname verification. DNS only: nothing here opens a connection to the
 * hostname, so a workspace can't steer it at internal services. Results are reduced to plain
 * sentences; resolver errors are never echoed.
 */

export const VERIFY_PREFIX = "_anhour-verify";

export const verificationRecordName = (hostname: string) => `${VERIFY_PREFIX}.${bareHost(hostname)}`;
export const verificationRecordValue = (token: string) => `anhour-verify=${token}`;

function resolver(): Resolver {
  return new Resolver({ timeout: 3_000, tries: 2 });
}

/** Codes meaning "the record definitely isn't there" (vs. a lookup that couldn't finish). */
const ABSENT = new Set(["ENOTFOUND", "ENODATA", "NXDOMAIN", "ENONAME"]);

export interface TxtResult {
  found: boolean;
  /** DNS couldn't answer (timeout, server failure): the stored state must not change. */
  inconclusive: boolean;
  error: string | null;
}

const notFoundYet = (name: string) => `No TXT record found at ${name} yet. DNS changes can take up to an hour.`;

/** Is `anhour-verify=<token>` published at `_anhour-verify.<hostname>`? */
export async function checkVerificationTxt(hostname: string, token: string): Promise<TxtResult> {
  const name = verificationRecordName(hostname);
  const expected = verificationRecordValue(token);
  try {
    const raw = await resolver().resolveTxt(name);
    const records = raw.map((chunks) => chunks.join("").trim());
    if (records.includes(expected)) return { found: true, inconclusive: false, error: null };
    return {
      found: false,
      inconclusive: false,
      error:
        records.length > 0
          ? `The TXT record at ${name} doesn't match. Copy the value again exactly.`
          : notFoundYet(name),
    };
  } catch (error) {
    const code = String((error as { code?: unknown }).code ?? "");
    if (ABSENT.has(code)) return { found: false, inconclusive: false, error: notFoundYet(name) };
    return {
      found: false,
      inconclusive: true,
      error: `Couldn't look up DNS for ${bareHost(hostname)} right now. Try again in a few minutes.`,
    };
  }
}

export interface RoutingResult {
  pointed: boolean;
  inconclusive: boolean;
}

const INCONCLUSIVE = Symbol("inconclusive");

async function answer(p: Promise<string[]>): Promise<string[] | typeof INCONCLUSIVE> {
  try {
    return await p;
  } catch (error) {
    return ABSENT.has(String((error as { code?: unknown }).code)) ? [] : INCONCLUSIVE;
  }
}

const strip = (name: string) => name.toLowerCase().replace(/\.$/, "");

/** Informational: does the hostname point at the installation (CNAME to the target, or the same A records)? */
export async function checkRouting(hostname: string): Promise<RoutingResult> {
  const host = bareHost(hostname);
  const target = domainTarget();
  const r = resolver();
  const cnames = await answer(r.resolveCname(host));
  if (cnames === INCONCLUSIVE) return { pointed: false, inconclusive: true };
  if (cnames.some((c) => strip(c) === target)) return { pointed: true, inconclusive: false };
  if (cnames.length > 0) return { pointed: false, inconclusive: false };
  const [mine, theirs] = await Promise.all([answer(r.resolve4(host)), answer(r.resolve4(target))]);
  if (mine === INCONCLUSIVE || theirs === INCONCLUSIVE) return { pointed: false, inconclusive: true };
  return { pointed: mine.length > 0 && mine.some((ip) => theirs.includes(ip)), inconclusive: false };
}
