import { route } from "@/server/http/route";
import { sequenceTags } from "@/server/services/sequences";

export const GET = route(async ({ actor }) => ({ tags: await sequenceTags(actor) }), { permission: "sequence:read" });
