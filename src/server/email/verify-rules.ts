/**
 * Pure verification rules: syntax, role addresses and the final classification. The DNS / SMTP
 * side lives in verify.ts. Statuses are always one of EMAIL_STATUSES in the schema.
 */
import { isDisposableDomain } from "./disposable-domains";

export type VerificationStatus = "valid" | "invalid" | "catch_all" | "unknown" | "role" | "disposable";

const ROLE_LOCAL_PARTS = new Set([
  "abuse",
  "accounts",
  "accounting",
  "admin",
  "administrator",
  "all",
  "billing",
  "careers",
  "contact",
  "customercare",
  "customerservice",
  "dev",
  "devops",
  "enquiries",
  "enquiry",
  "everyone",
  "feedback",
  "finance",
  "hello",
  "help",
  "helpdesk",
  "hi",
  "hostmaster",
  "hr",
  "info",
  "inquiries",
  "investors",
  "it",
  "jobs",
  "legal",
  "mail",
  "marketing",
  "media",
  "newsletter",
  "no-reply",
  "noreply",
  "office",
  "ops",
  "orders",
  "partners",
  "postmaster",
  "press",
  "privacy",
  "recruiting",
  "recruitment",
  "root",
  "sales",
  "security",
  "service",
  "support",
  "team",
  "webmaster",
]);

export interface SyntaxResult {
  ok: boolean;
  email: string;
  local: string;
  domain: string;
  reason?: string;
}

/**
 * RFC-practical syntax check: one @, a dot-atom local part (no quoted strings), a hostname with a
 * letter TLD, length limits from RFC 5321. Returns the address lowercased.
 */
export function checkSyntax(input: string): SyntaxResult {
  const email = input.trim().toLowerCase();
  const at = email.lastIndexOf("@");
  const local = at > 0 ? email.slice(0, at) : "";
  const domain = at > 0 ? email.slice(at + 1).replace(/\.$/, "") : "";
  const fail = (reason: string): SyntaxResult => ({ ok: false, email, local, domain, reason });
  if (!email || email.length > 254) return fail("length");
  if (at < 1 || email.indexOf("@") !== at) return fail("at_sign");
  if (local.length > 64) return fail("local_length");
  if (!/^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*$/.test(local)) return fail("local_part");
  if (domain.length > 253 || !domain.includes(".")) return fail("domain");
  const labels = domain.split(".");
  if (!labels.every((l) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(l))) return fail("domain");
  if (!/^(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})$/.test(labels[labels.length - 1] ?? "")) return fail("tld");
  return { ok: true, email, local, domain };
}

export function isRoleAddress(local: string): boolean {
  const base = local.toLowerCase().split("+")[0] ?? "";
  return ROLE_LOCAL_PARTS.has(base) || ROLE_LOCAL_PARTS.has(base.replace(/[._-]/g, ""));
}

export { isDisposableDomain };

/** What DNS said about the domain's mail hosts. */
export type MailHostState =
  | { kind: "mx"; hosts: string[] }
  | { kind: "a_fallback"; hosts: string[] }
  | { kind: "null_mx" }
  | { kind: "none" }
  | { kind: "error"; code: string };

export type ProbeOutcome = "accepted" | "rejected" | "catch_all" | "inconclusive" | "skipped";

export interface ClassifyInput {
  syntax: SyntaxResult;
  mail: MailHostState | null;
  probe: ProbeOutcome;
}

/**
 * Final status. Order: bad syntax → invalid; disposable domain → disposable; no mail host → invalid;
 * role address → role; SMTP probe result if one ran; otherwise unknown (a domain that accepts mail
 * proves nothing about the mailbox).
 */
export function classify({ syntax, mail, probe }: ClassifyInput): { status: VerificationStatus; reason: string } {
  if (!syntax.ok) return { status: "invalid", reason: `syntax:${syntax.reason ?? "invalid"}` };
  if (isDisposableDomain(syntax.domain)) return { status: "disposable", reason: "disposable_domain" };
  if (mail?.kind === "null_mx") return { status: "invalid", reason: "null_mx" };
  if (mail?.kind === "none") return { status: "invalid", reason: "no_mail_host" };
  if (isRoleAddress(syntax.local)) return { status: "role", reason: "role_address" };
  if (mail?.kind === "error" || !mail) return { status: "unknown", reason: "dns_error" };
  if (probe === "accepted") return { status: "valid", reason: "smtp_accepted" };
  if (probe === "rejected") return { status: "invalid", reason: "smtp_rejected" };
  if (probe === "catch_all") return { status: "catch_all", reason: "accepts_all_addresses" };
  if (probe === "inconclusive") return { status: "unknown", reason: "smtp_inconclusive" };
  return { status: "unknown", reason: mail.kind === "a_fallback" ? "a_record_only" : "mx_found_unconfirmed" };
}
