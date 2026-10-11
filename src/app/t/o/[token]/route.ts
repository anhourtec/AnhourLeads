import type { NextRequest } from "next/server";

import { hitLimit } from "@/server/http/rate-limit";
import { recordOpen } from "@/server/services/tracking";

type Ctx = { params: Promise<{ token: string }> };

/** 1×1 transparent GIF. */
const PIXEL = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");

/** Open-tracking pixel (only in emails from sequences with open tracking on). Always answers with the pixel. */
export async function GET(req: NextRequest, ctx: Ctx): Promise<Response> {
  const { token } = await ctx.params;
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  const { allowed } = await hitLimit(`track-open:${ip}`, { max: 300, window: 60 });
  if (allowed) await recordOpen(token);
  return new Response(new Uint8Array(PIXEL), {
    status: 200,
    headers: { "content-type": "image/gif", "cache-control": "no-store, max-age=0", "x-robots-tag": "noindex" },
  });
}
