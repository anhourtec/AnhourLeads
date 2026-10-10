import { route } from "@/server/http/route";
import { accountStages } from "@/server/services/companies";

export const GET = route(async () => accountStages(), { permission: "company:read" });
