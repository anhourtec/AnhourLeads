import { route } from "@/server/http/route";
import { getUsage } from "@/server/services/usage";

/**
 * Usage this month and last month. Every member sees their own; people with `audit:read` also get the
 * workspace totals, a per-member breakdown and recent data requests.
 */
export const GET = route(async ({ actor }) => ({ usage: await getUsage(actor) }));
