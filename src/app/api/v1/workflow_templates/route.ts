import { route } from "@/server/http/route";
import { listTemplates } from "@/server/services/workflows";

export const GET = route(async () => ({ workflow_templates: listTemplates() }), { permission: "workflow:read" });
