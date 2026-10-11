import { NextResponse } from "next/server";

import { readJson, route } from "@/server/http/route";
import { createSnippet, listSnippets } from "@/server/services/templates";

/** Reusable text snippets for emails and task descriptions. Filter with `q`. */
export const GET = route(
  async ({ req, actor }) => ({
    snippets: await listSnippets(actor, { q: req.nextUrl.searchParams.get("q") ?? undefined }),
  }),
  { permission: "template:read" },
);

export const POST = route(
  async ({ req, actor }) =>
    NextResponse.json({ snippet: await createSnippet(actor, await readJson(req)) }, { status: 201 }),
  { permission: "template:create" },
);
