import { NextResponse } from "next/server";

import { readJson, route } from "@/server/http/route";
import { createSequence } from "@/server/services/sequences";

/** Create a sequence, optionally with its ordered steps. It starts as a draft. */
export const POST = route(
  async ({ req, actor }) => {
    const { sequence, steps } = await createSequence(actor, await readJson(req));
    return NextResponse.json({ emailer_campaign: sequence, emailer_steps: steps }, { status: 201 });
  },
  { permission: "sequence:create" },
);
