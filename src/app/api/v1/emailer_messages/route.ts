import { NextResponse } from "next/server";

import { readJson, route } from "@/server/http/route";
import { composeMessage } from "@/server/services/emails";

/**
 * Create a one-off email to a contact (the composer). It is queued: send it with
 * POST /emailer_messages/{id}/send_now, or pass `scheduledAt` and the engine sends it then.
 */
export const POST = route(
  async ({ req, actor }) => {
    const { message } = await composeMessage(actor, await readJson(req));
    return NextResponse.json({ emailer_message: message }, { status: 201 });
  },
  { permission: "sequence:launch" },
);
