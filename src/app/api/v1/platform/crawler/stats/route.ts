import { crawlerStats } from "@/server/discovery/admin";
import { route } from "@/server/http/route";
import { requirePlatformAdmin } from "@/server/services/platform";

/** Frontier by status, hosts blocked or backing off, pages per minute (last hour), index counts, live workers. */
export const GET = route(async ({ actor }) => {
  requirePlatformAdmin(actor);
  return crawlerStats();
});
