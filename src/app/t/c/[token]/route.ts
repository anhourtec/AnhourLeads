import { type NextRequest, NextResponse } from "next/server";

import { hitLimit } from "@/server/http/rate-limit";
import { recordClick } from "@/server/services/tracking";

type Ctx = { params: Promise<{ token: string }> };

/**
 * Click tracking (only in emails from sequences with click tracking on). The token signs the
 * destination, so only links the app itself wrote are followed.
 */
export async function GET(req: NextRequest, ctx: Ctx): Promise<Response> {
  const { token } = await ctx.params;
  const url = req.nextUrl.searchParams.get("u") ?? "";
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  const { allowed } = await hitLimit(`track-click:${ip}`, { max: 300, window: 60 });
  if (!allowed) return new Response("Too many requests.", { status: 429 });
  const target = await recordClick(token, url);
  if (!target) return new Response("Link not found.", { status: 404, headers: { "x-robots-tag": "noindex" } });
  return NextResponse.redirect(target, { status: 302, headers: { "cache-control": "no-store" } });
}
