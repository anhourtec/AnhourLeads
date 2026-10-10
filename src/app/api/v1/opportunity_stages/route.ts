import { route } from "@/server/http/route";
import { dealStages } from "@/server/services/deals";

export const GET = route(async () => ({ opportunity_stages: dealStages() }), { permission: "deal:read" });
