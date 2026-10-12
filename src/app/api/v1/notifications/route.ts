import { route } from "@/server/http/route";
import { listNotifications } from "@/server/services/notifications";

/** The signed-in person's own notifications in this workspace, newest first, with the unread count. */
export const GET = route(async ({ req, actor }) => {
  const limit = Number.parseInt(req.nextUrl.searchParams.get("limit") ?? "30", 10) || 30;
  return listNotifications(actor, limit);
});
