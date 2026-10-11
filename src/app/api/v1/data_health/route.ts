import { route } from "@/server/http/route";
import { getDataHealth } from "@/server/services/data-health";

/** Data health center: enrichable data, duplicate counts and enrichment activity (last 30 days). */
export const GET = route(async ({ actor }) => ({ data_health: await getDataHealth(actor) }), {
  permission: "contact:read",
});
