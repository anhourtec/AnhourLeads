import { readJson, route } from "@/server/http/route";
import { resumeContacts } from "@/server/services/sequences";

/** Resume paused enrollments from their current step. */
export const POST = route<{ id: string }>(
  async ({ req, actor, params }) => resumeContacts(actor, params.id, await readJson(req)),
  { permission: "sequence:launch" },
);
