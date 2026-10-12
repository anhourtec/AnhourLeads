import { NextResponse } from "next/server";

import { readJson, route } from "@/server/http/route";
import { createTemplate, listTemplates } from "@/server/services/templates";

/** Email templates: shared ones plus your own private ones. Filter with `q`. */
export const GET = route(
  async ({ req, actor }) => ({
    email_templates: await listTemplates(actor, { q: req.nextUrl.searchParams.get("q") ?? undefined }),
  }),
  { permission: "template:read" },
);

export const POST = route(
  async ({ req, actor }) =>
    NextResponse.json({ email_template: await createTemplate(actor, await readJson(req)) }, { status: 201 }),
  { permission: "template:create" },
);
