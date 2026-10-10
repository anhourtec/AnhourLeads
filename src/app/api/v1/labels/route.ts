import { NextResponse } from "next/server";

import { z } from "zod";

import { readJson, route } from "@/server/http/route";
import { createList, listLists } from "@/server/services/lists";

const query = z.object({ entityType: z.enum(["contact", "company"]).optional() });

/** All lists in the workspace with member counts (Apollo: GET /labels). */
export const GET = route(
  async ({ req, actor }) => {
    const { entityType } = query.parse(Object.fromEntries(req.nextUrl.searchParams));
    return { labels: await listLists(actor, { entityType }) };
  },
  { permission: "list:read" },
);

/** Create a static or dynamic list (Apollo: POST /labels). */
export const POST = route(
  async ({ req, actor }) => NextResponse.json({ label: await createList(actor, await readJson(req)) }, { status: 201 }),
  { permission: "list:create" },
);
