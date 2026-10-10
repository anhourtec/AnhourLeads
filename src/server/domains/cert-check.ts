import "server-only";

import { bareHost } from "./hostname";
import { lookup } from "node:dns/promises";
import { BlockList, isIPv4, isIPv6 } from "node:net";
import { connect, type PeerCertificate } from "node:tls";

/**
 * Certificate check for a serving hostname: a TLS handshake on 443 with SNI = hostname, reading the
 * certificate that is served for it. The address is resolved first and the handshake goes only to
 * a PUBLIC address (never private, loopback, link-local / metadata, CGNAT or multicast). No HTTP
 * request is made and nothing is followed.
 */

export type CertCheck =
  | { status: "active"; expiresAt: Date; issuer: string | null }
  | { status: "waiting"; expiresAt: null; issuer: null }
  | { status: "problem"; expiresAt: Date | null; issuer: string | null; reason: string };

const TIMEOUT_MS = 6_000;

const blocked = new BlockList();
for (const [net, bits] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  blocked.addSubnet(net, bits, "ipv4");
}
for (const [net, bits] of [
  ["::", 128],
  ["::1", 128],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const) {
  blocked.addSubnet(net, bits, "ipv6");
}

/** True for addresses the installation must never connect to on a workspace's behalf. */
export function isPrivateAddress(ip: string): boolean {
  if (isIPv4(ip)) return blocked.check(ip, "ipv4");
  if (isIPv6(ip)) {
    const mapped = ip.toLowerCase().match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
    if (mapped) return blocked.check(mapped, "ipv4");
    return blocked.check(ip, "ipv6");
  }
  return true;
}

function plainError(code: string): string {
  if (code === "CERT_HAS_EXPIRED") return "The certificate has expired.";
  if (code === "ERR_TLS_CERT_ALTNAME_INVALID") return "The certificate served doesn't cover this hostname.";
  if (code === "CERT_NOT_YET_VALID") return "The certificate isn't valid yet.";
  if (/SELF_SIGNED|ISSUER|VERIFY_LEAF/.test(code)) return "The certificate isn't from a trusted certificate authority.";
  return "The certificate isn't valid.";
}

function issuerOf(cert: PeerCertificate): string | null {
  const raw = cert.issuer?.O ?? cert.issuer?.CN;
  const name = Array.isArray(raw) ? raw[0] : raw;
  if (!name) return null;
  return /let's encrypt/i.test(name) ? "Let's Encrypt" : name.slice(0, 80);
}

/**
 * Handshake with SNI = hostname. `via` connects to another name's address instead (the
 * installation's own CNAME target with NGINX + certbot, so the check reads the certificate this
 * installation serves rather than whatever a proxy in front shows).
 */
export async function checkCertificate(hostname: string, opts: { via?: string } = {}): Promise<CertCheck> {
  const host = bareHost(hostname);
  const waiting: CertCheck = { status: "waiting", expiresAt: null, issuer: null };
  const connectTo = bareHost(opts.via ?? host);
  const addresses = await lookup(connectTo, { all: true }).catch(() => []);
  if (addresses.length === 0) return waiting;
  if (addresses.some((a) => isPrivateAddress(a.address))) {
    return {
      status: "problem",
      expiresAt: null,
      issuer: null,
      reason: "The hostname points at an address this installation won't connect to.",
    };
  }
  const address = addresses[0]?.address ?? connectTo;

  return new Promise<CertCheck>((resolve) => {
    let settled = false;
    const socket = connect({ host: address, port: 443, servername: host, rejectUnauthorized: false });
    const done = (result: CertCheck) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(TIMEOUT_MS);
    socket.once("secureConnect", () => {
      const cert = socket.getPeerCertificate();
      if (!cert?.valid_to) return done(waiting);
      const expiresAt = new Date(cert.valid_to);
      const issuer = issuerOf(cert);
      if (socket.authorized) return done({ status: "active", expiresAt, issuer });
      done({ status: "problem", expiresAt, issuer, reason: plainError(String(socket.authorizationError ?? "")) });
    });
    socket.once("timeout", () => done(waiting));
    socket.once("error", () => done(waiting));
  });
}
