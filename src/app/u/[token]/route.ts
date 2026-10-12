import type { NextRequest } from "next/server";

import { hitLimit } from "@/server/http/rate-limit";
import { log } from "@/server/log";
import { unsubscribe, verifyUnsubscribeToken } from "@/server/services/sending";
import { requestHost, resolveTenant } from "@/server/tenancy/host";

type Ctx = { params: Promise<{ token: string }> };

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);

/** Minimal standalone page: works without the app shell, scripts or a session. System colours only. */
function page(status: number, title: string, message: string): Response {
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapeHtml(title)}</title>
<style>
  :root { color-scheme: light dark; }
  body { margin: 0; min-height: 100dvh; display: grid; place-items: center; background: Canvas; color: CanvasText;
    font: 15px/1.5 "Geist", ui-sans-serif, system-ui, sans-serif; }
  main { max-width: 28rem; padding: 2rem 1rem; text-align: center; }
  h1 { font-size: 1.25rem; font-weight: 600; margin: 0 0 0.5rem; }
  p { margin: 0; color: GrayText; }
</style>
</head>
<body><main><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p></main></body>
</html>`;
  return new Response(html, {
    status,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex" },
  });
}

const notFoundPage = () =>
  page(404, "Link not found", "This unsubscribe link isn't valid. Check that it was copied whole.");

async function handle(req: NextRequest, ctx: Ctx, oneClick: boolean): Promise<Response> {
  const { token } = await ctx.params;
  const host = requestHost(req.headers);
  const tenant = await resolveTenant(host);
  if (!tenant) return notFoundPage();
  const parsed = verifyUnsubscribeToken(token);
  if (!parsed) return notFoundPage();
  // A workspace's own hostname only serves that workspace's links.
  if (tenant.kind === "workspace" && tenant.organizationId !== parsed.organizationId) return notFoundPage();

  const { allowed } = await hitLimit(`unsubscribe:${req.headers.get("x-forwarded-for") ?? host}`, {
    max: 60,
    window: 60,
  });
  if (!allowed) return page(429, "Too many requests", "Wait a minute and try again.");

  try {
    const result = await unsubscribe(token);
    if (!result) return notFoundPage();
    if (oneClick) return new Response("Unsubscribed.", { status: 200, headers: { "content-type": "text/plain" } });
    return page(
      200,
      "You're unsubscribed",
      `${result.brandName} won't email ${result.email ?? "you"} again. You don't need to do anything else.`,
    );
  } catch (error) {
    log.error("unsubscribe failed", { component: "unsubscribe", error });
    return page(500, "Something went wrong", "We couldn't process this link. Try again in a minute.");
  }
}

/** Opening the link unsubscribes in one click, no sign-in. */
export function GET(req: NextRequest, ctx: Ctx) {
  return handle(req, ctx, false);
}

/** RFC 8058 one-click unsubscribe from the List-Unsubscribe-Post header (mail clients POST here). */
export function POST(req: NextRequest, ctx: Ctx) {
  return handle(req, ctx, true);
}
