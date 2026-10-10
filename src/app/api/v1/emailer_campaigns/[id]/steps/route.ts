import { NextResponse } from "next/server";

import { readJson, route } from "@/server/http/route";
import { addStep, listSteps, replaceSteps } from "@/server/services/sequences";

type P = { id: string };

export const GET = route<P>(async ({ actor, params }) => ({ emailer_steps: await listSteps(actor, params.id) }), {
  permission: "sequence:read",
});

/** Append a step. */
export const POST = route<P>(
  async ({ req, actor, params }) =>
    NextResponse.json({ emailer_steps: await addStep(actor, params.id, await readJson(req)) }, { status: 201 }),
  { permission: "sequence:update" },
);

/** Replace the ordered step list: steps with an id are kept and updated, others created, missing ones removed. */
export const PUT = route<P>(
  async ({ req, actor, params }) => ({ emailer_steps: await replaceSteps(actor, params.id, await readJson(req)) }),
  { permission: "sequence:update" },
);
