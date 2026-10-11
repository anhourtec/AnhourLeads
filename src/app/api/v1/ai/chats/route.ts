import { NextResponse } from "next/server";

import { readJson, route } from "@/server/http/route";
import { createChat, createChatInput, listChats } from "@/server/services/ai-chats";

/** Your own assistant chats, most recent first. Chats are private to the person who started them. */
export const GET = route(async ({ actor }) => ({ chats: await listChats(actor) }), { permission: "ai:use" });

/** Start a new chat (`title` optional; it's set from the first message otherwise). */
export const POST = route(
  async ({ req, actor }) => {
    const input = createChatInput.parse(await readJson(req));
    return NextResponse.json({ chat: await createChat(actor, input) }, { status: 201 });
  },
  { permission: "ai:use" },
);
