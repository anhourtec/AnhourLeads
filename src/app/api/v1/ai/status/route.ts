import { route } from "@/server/http/route";
import { aiStatus } from "@/server/services/ai";

/** Whether an AI provider is configured. Presets work either way. */
export const GET = route(async () => ({ status: aiStatus() }), { permission: "ai:use" });
