import { readJson, route } from "@/server/http/route";
import { markReplied } from "@/server/services/sequences";

/** Record that contacts replied. With stop on reply, their enrollments stop. */
export const POST = route<{ id: string }>(
  async ({ req, actor, params }) => markReplied(actor, params.id, await readJson(req)),
  { permission: "sequence:launch" },
);
