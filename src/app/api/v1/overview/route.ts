import { route } from "@/server/http/route";
import { getOverview } from "@/server/services/overview";

/** Workspace KPIs for the overview screen. */
export const GET = route(async ({ actor }) => ({ overview: await getOverview(actor) }));
