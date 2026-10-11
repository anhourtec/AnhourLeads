import "server-only";

import { env } from "@/server/env";

import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Signed tokens for open and click tracking. Only used when a sequence turns tracking on (off by
 * default). The token names the outbound message; links carry the destination in `u`.
 */
/** Click tokens also sign the destination, so a tracked link can't be turned into an open redirect. */
function sign(kind: "o" | "c", messageId: string, url = ""): Buffer {
  return createHmac("sha256", env().BETTER_AUTH_SECRET).update(`track:${kind}:${messageId}:${url}`).digest();
}

export function trackingToken(kind: "o" | "c", messageId: string, url = ""): string {
  return `${Buffer.from(messageId).toString("base64url")}.${sign(kind, messageId, url).toString("base64url")}`;
}

export function verifyTrackingToken(kind: "o" | "c", token: string, url = ""): string | null {
  const [encoded, signature, extra] = token.split(".");
  if (!encoded || !signature || extra !== undefined || token.length > 300) return null;
  const messageId = Buffer.from(encoded, "base64url").toString("utf8");
  if (!messageId) return null;
  const expected = sign(kind, messageId, url);
  const given = Buffer.from(signature, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  return messageId;
}

export const openPixelUrl = (origin: string, messageId: string) => `${origin}/t/o/${trackingToken("o", messageId)}`;

export const trackedLinkUrl = (origin: string, messageId: string, url: string) =>
  `${origin}/t/c/${trackingToken("c", messageId, url)}?u=${encodeURIComponent(url)}`;
