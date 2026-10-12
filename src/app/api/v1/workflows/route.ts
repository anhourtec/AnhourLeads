import { NextResponse } from "next/server";

import { readJson, route } from "@/server/http/route";
import {
  createWorkflow,
  searchWorkflows,
  workflowCreateSchema,
  workflowSearchSchema,
} from "@/server/services/workflows";

export const GET = route(
  async ({ req, actor }) => {
    const q = req.nextUrl.searchParams;
    const input = workflowSearchSchema.parse({ status: q.get("status") ?? undefined, q: q.get("q") ?? undefined });
    return { workflows: await searchWorkflows(actor, input) };
  },
  { permission: "workflow:read" },
);

/** Create a draft, empty or from a template (`templateId`). */
export const POST = route(
  async ({ req, actor }) => {
    const workflow = await createWorkflow(actor, workflowCreateSchema.parse(await readJson(req)));
    return NextResponse.json({ workflow }, { status: 201 });
  },
  { permission: "workflow:create" },
);
