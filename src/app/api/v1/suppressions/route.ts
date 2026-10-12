import { NextResponse } from "next/server";

import { pageFrom, pagination, readJson, route } from "@/server/http/route";
import {
  createSuppression,
  listSuppressions,
  suppressionCreateSchema,
  suppressionListSchema,
} from "@/server/services/suppressions";

/** The do-not-contact list. Filters: q (search), kind, reason. */
export const GET = route(
  async ({ req, actor }) => {
    const query = Object.fromEntries(req.nextUrl.searchParams);
    const page = pageFrom(query);
    const { suppressions, total } = await listSuppressions(actor, suppressionListSchema.parse(query), page);
    return { suppressions, pagination: pagination(page, total) };
  },
  { permission: "suppression:read" },
);

/** Add an email or domain. Adding an existing entry is idempotent (200 with created: false). */
export const POST = route(
  async ({ req, actor }) => {
    const result = await createSuppression(actor, suppressionCreateSchema.parse(await readJson(req)));
    return NextResponse.json(result, { status: result.created ? 201 : 200 });
  },
  { permission: "suppression:create" },
);
