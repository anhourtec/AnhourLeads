import "server-only";

import { env } from "@/server/env";
import { forbidden, HttpError, notFound } from "@/server/http/errors";
import { hitLimit } from "@/server/http/rate-limit";
import { requestHost, requestOrigin, resolveTenant } from "@/server/tenancy/host";

/**
 * Guards for the public removal-request endpoints (no sign-in): served on the installation's own
 * hostnames only, same-origin POSTs only, and rate limited by client IP (the proxy's
 * X-Real-IP / X-Forwarded-For when APP_TRUST_PROXY=true; one shared, wider bucket otherwise).
 */
export function clientIp(headers: Headers): string {
  if (!env().APP_TRUST_PROXY) return "direct";
  const real = headers.get("x-real-ip")?.trim();
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return real || forwarded || "unknown";
}

export async function guardPublicPost(req: Request, bucket: string, max: number): Promise<{ origin: string }> {
  const tenant = await resolveTenant(requestHost(req.headers));
  if (!tenant || tenant.kind !== "primary") throw notFound();
  const origin = req.headers.get("origin");
  if (origin && new URL(origin).host.toLowerCase() !== requestHost(req.headers)) {
    throw forbidden("Cross-site request refused.");
  }
  const ip = clientIp(req.headers);
  // Without a trusted proxy every client shares one bucket, so it is wider; the per-address limit
  // in removal.ts (3 an hour) still applies to everyone.
  const limit = ip === "direct" ? max * 10 : max;
  const { allowed } = await hitLimit(`removal:${bucket}:${ip}`, { max: limit, window: 600 });
  if (!allowed) throw new HttpError(429, "Too many requests. Try again in a few minutes.");
  return { origin: requestOrigin(req.headers) };
}
