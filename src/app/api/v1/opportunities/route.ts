import { NextResponse } from "next/server";

import { readJson, route } from "@/server/http/route";
import { createDeal, dealCreateSchema } from "@/server/services/deals";

export const POST = route(
  async ({ req, actor }) => {
    const opportunity = await createDeal(actor, dealCreateSchema.parse(await readJson(req)));
    return NextResponse.json({ opportunity }, { status: 201 });
  },
  { permission: "deal:create" },
);
