import type { NextRequest } from "next/server";

import type { Actor } from "@/server/auth/actor";
import { LIMITS } from "@/server/http/rate-limit";
import { pageFrom, pagination, readJson, route } from "@/server/http/route";
import { dealSearchSchema, searchDeals } from "@/server/services/deals";

async function search(actor: Actor, input: unknown) {
  const body = dealSearchSchema.parse(input);
  const page = pageFrom(body);
  const { deals, total, totals, pipelineTotals } = await searchDeals(actor, body, page);
  return {
    opportunities: deals,
    stage_totals: totals,
    pipeline_stage_totals: pipelineTotals,
    pagination: pagination(page, total),
  };
}

function queryInput(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const stages = q.getAll("stage");
  const stageIds = q.getAll("stageIds");
  const ownerIds = q.getAll("ownerIds");
  const multi = new Set(["stage", "stageIds", "ownerIds", "open", "mine", "sort_ascending"]);
  return {
    ...Object.fromEntries([...q.entries()].filter(([k]) => !multi.has(k))),
    ...(stages.length ? { stage: stages } : {}),
    ...(stageIds.length ? { stageIds } : {}),
    ...(ownerIds.length ? { ownerIds } : {}),
    ...(q.has("sort_ascending") ? { sort_ascending: q.get("sort_ascending") === "true" } : {}),
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
