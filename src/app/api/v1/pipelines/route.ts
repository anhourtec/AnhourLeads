import { NextResponse } from "next/server";

import { readJson, route } from "@/server/http/route";
import { createPipeline, listPipelines, pipelineCreateSchema } from "@/server/services/pipelines";

export const GET = route(async ({ actor }) => ({ pipelines: await listPipelines(actor) }), { permission: "deal:read" });

export const POST = route(
  async ({ req, actor }) => {
    const pipeline = await createPipeline(actor, pipelineCreateSchema.parse(await readJson(req)));
    return NextResponse.json({ pipeline }, { status: 201 });
  },
  { permission: "pipeline:manage" },
);
