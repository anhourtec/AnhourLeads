import { route } from "@/server/http/route";
import { dealActivity } from "@/server/services/deals";

type Params = { id: string };

export const GET = route<Params>(async ({ actor, params }) => ({ activities: await dealActivity(actor, params.id) }), {
  permission: "deal:read",
});
