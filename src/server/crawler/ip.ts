import { isIP } from "node:net";

/**
 * IP address classification for the crawler's SSRF guard. Pure and dependency-free so it can be
 * unit tested directly. Anything other than "public" is refused unless private hosts are allowed.
 */
export type IpClass =
  | "public"
  | "private"
  | "loopback"
  | "link_local"
  | "cgnat"
  | "multicast"
  | "unspecified"
  | "reserved"
  | "invalid";

function v4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const n = Number(part);
    if (n > 255) return null;
    value = value * 256 + n;
  }
  return value;
}

function inV4(value: number, base: string, bits: number): boolean {
  const start = v4ToInt(base) ?? 0;
  const size = 2 ** (32 - bits);
  return value >= start && value < start + size;
}

function classifyV4(ip: string): IpClass {
  const value = v4ToInt(ip);
  if (value === null) return "invalid";
  if (inV4(value, "0.0.0.0", 8)) return "unspecified";
  if (inV4(value, "10.0.0.0", 8)) return "private";
  if (inV4(value, "100.64.0.0", 10)) return "cgnat";
  if (inV4(value, "127.0.0.0", 8)) return "loopback";
  if (inV4(value, "169.254.0.0", 16)) return "link_local";
  if (inV4(value, "172.16.0.0", 12)) return "private";
  if (inV4(value, "192.0.0.0", 24)) return "reserved";
  if (inV4(value, "192.0.2.0", 24)) return "reserved";
  if (inV4(value, "192.88.99.0", 24)) return "reserved";
  if (inV4(value, "192.168.0.0", 16)) return "private";
  if (inV4(value, "198.18.0.0", 15)) return "reserved";
  if (inV4(value, "198.51.100.0", 24)) return "reserved";
  if (inV4(value, "203.0.113.0", 24)) return "reserved";
  if (inV4(value, "224.0.0.0", 4)) return "multicast";
  if (inV4(value, "240.0.0.0", 4)) return "reserved";
  return "public";
}

/** Expand an IPv6 address into eight 16-bit groups. Returns null when it doesn't parse. */
export function parseV6(input: string): number[] | null {
  let ip = input.toLowerCase();
  const zone = ip.indexOf("%");
  if (zone !== -1) ip = ip.slice(0, zone);
  if (ip.startsWith("[") && ip.endsWith("]")) ip = ip.slice(1, -1);

  let tail: number[] = [];
  const lastColon = ip.lastIndexOf(":");
  const maybeV4 = ip.slice(lastColon + 1);
  if (maybeV4.includes(".")) {
    const v4 = v4ToInt(maybeV4);
    if (v4 === null) return null;
    tail = [Math.floor(v4 / 65536), v4 % 65536];
    ip = `${ip.slice(0, lastColon + 1)}${tail.length ? "0:0" : ""}`;
  }

  const halves = ip.split("::");
  if (halves.length > 2) return null;
  const parse = (s: string) => (s === "" ? [] : s.split(":"));
  const head = parse(halves[0] ?? "");
  const rest = halves.length === 2 ? parse(halves[1] ?? "") : [];
  const groups = halves.length === 2 ? [...head, ...Array(8 - head.length - rest.length).fill("0"), ...rest] : head;
  if (groups.length !== 8) return null;
  const out: number[] = [];
  for (const g of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
    out.push(Number.parseInt(g, 16));
  }
  if (tail.length) {
    out[6] = tail[0] ?? 0;
    out[7] = tail[1] ?? 0;
  }
  return out;
}

function embeddedV4(hi: number, lo: number): string {
  return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
}

function classifyV6(ip: string): IpClass {
  const g = parseV6(ip);
  if (!g) return "invalid";
  const [a = 0, b = 0, c = 0, d = 0, e = 0, f = 0, h6 = 0, h7 = 0] = g;
  const allZeroPrefix = a === 0 && b === 0 && c === 0 && d === 0 && e === 0;
  if (allZeroPrefix && f === 0 && h6 === 0 && h7 === 0) return "unspecified";
  if (allZeroPrefix && f === 0 && h6 === 0 && h7 === 1) return "loopback";
  // IPv4-mapped (::ffff:a.b.c.d) and IPv4-compatible (::a.b.c.d) carry an IPv4 address.
  if (allZeroPrefix && (f === 0xffff || f === 0)) return classifyV4(embeddedV4(h6, h7));
  // NAT64 well-known prefix 64:ff9b::/96.
  if (a === 0x64 && b === 0xff9b && c === 0 && d === 0 && e === 0 && f === 0) return classifyV4(embeddedV4(h6, h7));
  // 6to4 2002::/16 embeds an IPv4 address in the next 32 bits.
  if (a === 0x2002) {
    const inner = classifyV4(embeddedV4(b, c));
    return inner === "public" ? "public" : inner;
  }
  if ((a & 0xfe00) === 0xfc00) return "private";
  if ((a & 0xffc0) === 0xfe80) return "link_local";
  if ((a & 0xffc0) === 0xfec0) return "reserved";
  if ((a & 0xff00) === 0xff00) return "multicast";
  if (a === 0x2001 && b === 0x0db8) return "reserved";
  if (a === 0x2001 && b === 0) return "reserved"; // Teredo tunnels can reach arbitrary IPv4 hosts.
  if (a === 0x0100 && b === 0 && c === 0 && d === 0) return "reserved";
  if (a === 0 && b === 0) return "reserved";
  return "public";
}

/** Classify an IPv4 or IPv6 literal (IPv6 may be bracketed or carry a zone id). */
export function classifyIp(ip: string): IpClass {
  const trimmed = ip.trim();
  const bare = trimmed.startsWith("[") && trimmed.endsWith("]") ? trimmed.slice(1, -1) : trimmed;
  const withoutZone = bare.split("%")[0] ?? bare;
  const family = isIP(withoutZone);
  if (family === 4) return classifyV4(withoutZone);
  if (family === 6) return classifyV6(withoutZone);
  return "invalid";
}

export function isPublicIp(ip: string): boolean {
  return classifyIp(ip) === "public";
}

/** True when the hostname is an IP literal (IPv4, or IPv6 with or without brackets). */
export function isIpLiteral(hostname: string): boolean {
  const bare = hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
  return isIP(bare.split("%")[0] ?? bare) !== 0;
}
