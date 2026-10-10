import type { NextRequest } from "next/server";

import type { Actor } from "@/server/auth/actor";
import { LIMITS } from "@/server/http/rate-limit";
import { pageFrom, pagination, readJson, route } from "@/server/http/route";
import { dealSearchSchema, searchDeals } from "@/server/services/deals";

async function search(actor: Actor, input: unknown) {
  const body = dealSearchSchema.parse(input);
  const page = pageFrom(body);
  const { deals, total, totals } = await searchDeals(actor, body, page);
  return { opportunities: deals, stage_totals: totals, pagination: pagination(page, total) };
}

function queryInput(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const stages = q.getAll("stage");
  return {
    ...Object.fromEntries([...q.entries()].filter(([k]) => k !== "stage" && k !== "open" && k !== "mine")),
    ...(stages.length ? { stage: stages } : {}),
    ...(q.has("open") ? { open: q.get("open") === "true" } : {}),
    ...(q.has("mine") ? { mine: q.get("mine") === "true" } : {}),
  };
}

/** Search deals (Apollo "opportunities"). Accepts a JSON body (POST) or query parameters (GET). */
export const POST = route(async ({ req, actor }) => search(actor, await readJson(req)), {
  permission: "deal:read",
  limit: LIMITS.read,
});

export const GET = route(async ({ req, actor }) => search(actor, queryInput(req)), { permission: "deal:read" });
