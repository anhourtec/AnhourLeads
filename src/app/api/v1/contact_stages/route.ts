import { route } from "@/server/http/route";
import { contactStages } from "@/server/services/contacts";

export const GET = route(async () => contactStages(), { permission: "contact:read" });
