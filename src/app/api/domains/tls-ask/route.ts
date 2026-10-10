import { type NextRequest, NextResponse } from "next/server";

import { bareHost, isValidHostname } from "@/server/domains/hostname";
import { primaryHosts } from "@/server/env";
import { hitLimit, LIMITS } from "@/server/http/rate-limit";
import { requestHost, resolveTenant } from "@/server/tenancy/host";

/**
 * Certificate gate (docs/domains-and-ssl.md): "may this name have a certificate?". Public and
 * session-less. 200 for the installation's primary hosts (with or without their port) and for
 * workspace hostnames that serve right now (verified, or failing within the grace period); 404
 * for everything else, so no certificate is ever issued for a pending or unknown name. The certbot
 * sync applies the same rule in SQL. Cheap: resolveTenant is cached in Redis.
 */
export async function GET(req: NextRequest) {
  const caller = (req.headers.get("x-real-ip") ?? requestHost(req.headers)) || "anon";
  const { allowed } = await hitLimit(`tls-ask:${caller}`, LIMITS.read);
  if (!allowed) return new NextResponse(null, { status: 429 });

  const host = (req.nextUrl.searchParams.get("domain") ?? "").trim().toLowerCase();
  if (!host || (!isValidHostname(host) && host !== "localhost" && !/^localhost:\d+$/.test(host))) {
    return new NextResponse(null, { status: 404 });
  }
  const primaries = primaryHosts();
  if (primaries.includes(host) || primaries.map(bareHost).includes(bareHost(host))) {
    return new NextResponse(null, { status: 200 });
  }
  const tenant = await resolveTenant(host);
  return new NextResponse(null, { status: tenant?.kind === "workspace" ? 200 : 404 });
}
