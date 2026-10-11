import { NextResponse } from "next/server";

import { readJson, route } from "@/server/http/route";
import { createPersona, listPersonas, personaCreateSchema } from "@/server/services/personas";

export const GET = route(async ({ actor }) => ({ personas: await listPersonas(actor) }), {
  permission: "contact:read",
});

export const POST = route(
  async ({ req, actor }) => {
    const input = personaCreateSchema.parse(await readJson(req));
    return NextResponse.json({ persona: await createPersona(actor, input) }, { status: 201 });
  },
  { permission: "persona:manage" },
);
