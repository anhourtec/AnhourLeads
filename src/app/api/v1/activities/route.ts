import { route } from "@/server/http/route";
import { recentActivities } from "@/server/services/notifications";

/** Recent activity in the caller's workspace (any member). `limit` defaults to 20, max 50. */
export const GET = route(async ({ req, actor }) => {
  const limit = Number.parseInt(req.nextUrl.searchParams.get("limit") ?? "20", 10) || 20;
  return { activities: await recentActivities(actor, limit) };
});
