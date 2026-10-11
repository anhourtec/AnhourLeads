import { NextResponse } from "next/server";

import { route } from "@/server/http/route";
import { cloneSequence } from "@/server/services/sequences";

/** Copy a sequence's settings and steps into a new draft. */
export const POST = route<{ id: string }>(
  async ({ actor, params }) => {
    const { sequence, steps } = await cloneSequence(actor, params.id);
    return NextResponse.json({ emailer_campaign: sequence, emailer_steps: steps }, { status: 201 });
  },
  { permission: "sequence:create" },
);
