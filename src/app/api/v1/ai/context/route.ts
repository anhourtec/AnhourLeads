import { readJson, route } from "@/server/http/route";
import { aiContextInput, getAiContext, updateAiContext } from "@/server/services/ai";

/** AI context center: what the workspace sells and to whom. Grounds drafts and the assistant. */
export const GET = route(async ({ actor }) => ({ context: await getAiContext(actor) }), { permission: "ai:use" });

export const PUT = route(
  async ({ req, actor }) => ({ context: await updateAiContext(actor, aiContextInput.parse(await readJson(req))) }),
  { permission: "aicontext:manage" },
);
