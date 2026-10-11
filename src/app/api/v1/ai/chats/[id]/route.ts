import { route } from "@/server/http/route";
import { deleteChat, getChat } from "@/server/services/ai-chats";

/** One of your chats with its messages. Anyone else's chat id answers 404. */
export const GET = route<{ id: string }>(async ({ actor, params }) => getChat(actor, params.id), {
  permission: "ai:use",
});

export const DELETE = route<{ id: string }>(async ({ actor, params }) => deleteChat(actor, params.id), {
  permission: "ai:use",
});
