import { NextResponse } from "next/server";

import { readJson, route } from "@/server/http/route";
import {
  createSavedSearch,
  listSavedSearches,
  savedSearchCreateSchema,
  savedSearchListQuery,
} from "@/server/services/saved-searches";

/** Saved searches the caller can see (own, shared, assigned to them). `tab`: all, mine, starred, assigned, shared. */
export const GET = route(
  async ({ req, actor }) => {
    const query = savedSearchListQuery.parse(Object.fromEntries(req.nextUrl.searchParams));
    return { saved_searches: await listSavedSearches(actor, query) };
  },
  { permission: "search:run" },
);

export const POST = route(
  async ({ req, actor }) => {
    const input = savedSearchCreateSchema.parse(await readJson(req));
    return NextResponse.json({ saved_search: await createSavedSearch(actor, input) }, { status: 201 });
  },
  { permission: "savedsearch:create" },
);
