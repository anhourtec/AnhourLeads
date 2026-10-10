import { NextResponse } from "next/server";

import { readJson, route } from "@/server/http/route";
import { inviteMember, inviteSchema } from "@/server/services/members";

export const POST = route(
  async ({ req, actor }) => {
    const invitation = await inviteMember(actor, inviteSchema.parse(await readJson(req)));
    return NextResponse.json({ invitation }, { status: 201 });
  },
  { permission: "member:invite" },
);
