import { readJson, route } from "@/server/http/route";
import { markNotificationsRead, markReadSchema } from "@/server/services/notifications";

/** Mark notifications read. Body: { ids: string[] } or { all: true }. Only your own; others are 404. */
export const POST = route(async ({ req, actor }) => {
  const input = markReadSchema.parse(await readJson(req));
  return markNotificationsRead(actor, input);
});
