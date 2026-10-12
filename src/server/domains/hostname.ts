import "server-only";

import { env, primaryHosts } from "@/server/env";
import { HttpError } from "@/server/http/errors";
import { isLocalHostname } from "@/server/tenancy/host";

import { isIP } from "node:net";

/**
 * Hostname rules for white-label domains (docs/domains-and-ssl.md). Names end up in DNS lookups,
 * NGINX server blocks and certificate file names, so the pattern is strict.
 */

/** One DNS label: letters, digits and inner hyphens, 1–63 characters. */
const LABEL = "[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?";
/** Two or more labels, optional :port (local development only). */
const HOSTNAME_RE = new RegExp(`^${LABEL}(?:\\.${LABEL})+(?::(\\d{1,5}))?$`);

export const MAX_HOSTNAME_LENGTH = 253;
/** Upper bound for a workspace's hostname limit (set by platform administrators). */
export const MAX_HOSTNAME_LIMIT = 50;
/** Local development names (`*.localhost`, ported) have their own cap and never count towards the limit. */
export const MAX_LOCAL_HOSTNAMES = 10;
/** Unverified claims expire, so nobody can block a name with a pending hostname forever. */
export const PENDING_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** The host without any :port. */
export function bareHost(host: string): string {
  return host.replace(/:\d+$/, "");
}

const invalid = (message: string) => new HttpError(422, message, [{ path: "hostname", message }]);

/** True when the name passes the strict pattern (no normalisation). */
export function isValidHostname(host: string): boolean {
  if (host.length > MAX_HOSTNAME_LENGTH || !HOSTNAME_RE.test(host)) return false;
  const port = host.match(/:(\d+)$/)?.[1];
  if (port && (Number(port) < 1 || Number(port) > 65535)) return false;
  const bare = bareHost(host);
  // No IP addresses, and the last label is never all digits.
  return isIP(bare) === 0 && !/\.\d+$/.test(bare);
}

/** Where workspaces point their CNAME: APP_DOMAIN_TARGET, else the first primary host without its port. */
export function domainTarget(): string {
  const target = env().APP_DOMAIN_TARGET?.trim().toLowerCase().replace(/\.$/, "");
  if (target) return target;
  return bareHost(primaryHosts()[0] ?? "localhost");
}

/** The installation's own names (primary hosts, the CNAME target and their subdomains) can't be claimed. */
export function isReservedHostname(host: string): boolean {
  if (primaryHosts().includes(host)) return true;
  const bare = bareHost(host);
  const own = [domainTarget(), ...primaryHosts().map(bareHost)].filter((h) => h && !isLocalHostname(h));
  return own.some((h) => bare === h || bare.endsWith(`.${h}`));
}

/**
 * Normalise and validate a hostname a person typed. Throws 422 with a plain sentence. Returns the
 * stored form: lowercase, no scheme, no path, no trailing dot.
 */
export function parseHostname(raw: unknown): { hostname: string; local: boolean; apex: boolean } {
  if (typeof raw !== "string" || !raw.trim()) throw invalid("Enter a hostname like portal.example.com.");
  const hostname = raw.trim().toLowerCase();
  if (hostname.endsWith(".")) throw invalid("Remove the trailing dot from the hostname.");
  if (hostname.length > MAX_HOSTNAME_LENGTH) throw invalid("That hostname is too long.");
  if (hostname.includes("://") || hostname.includes("/")) {
    throw invalid("Enter only the hostname, without https:// or a path.");
  }
  if (primaryHosts().includes(hostname)) throw invalid("That hostname is reserved.");
  if (isIP(bareHost(hostname)) !== 0 || isIP(hostname.replace(/^\[|\]$/g, "")) !== 0) {
    throw invalid("Enter a hostname, not an IP address.");
  }
  if (!isValidHostname(hostname)) throw invalid("Enter a hostname like portal.example.com.");
  const local = isLocalHostname(hostname);
  if (local && env().APP_PROTOCOL === "https") {
    throw invalid("Enter a public hostname like portal.example.com, without a port.");
  }
  if (isReservedHostname(hostname)) throw invalid("That hostname is reserved.");
  const apex = !local && bareHost(hostname).split(".").length === 2;
  return { hostname, local, apex };
}
