import { NextResponse } from "next/server";

import { LIMITS } from "@/server/http/rate-limit";
import { readJson, route } from "@/server/http/route";
import { postMessage, postMessageInput } from "@/server/services/ai-chats";

/**
 * Send a message (`content`) or run a preset (`preset`: prospecting, research, sequencing,
 * analytics). Returns the stored user message and the assistant's reply with its sources.
 */
export const POST = route<{ id: string }>(
  async ({ req, actor, params }) => {
    const input = postMessageInput.parse(await readJson(req));
    return NextResponse.json(await postMessage(actor, params.id, input), { status: 201 });
  },
  { permission: "ai:use", limit: LIMITS.sensitive },
);
