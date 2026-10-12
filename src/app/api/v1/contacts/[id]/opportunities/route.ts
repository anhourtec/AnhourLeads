import { LIMITS } from "@/server/http/rate-limit";
import { route } from "@/server/http/route";
import { dealsForContact } from "@/server/services/deals";

type Params = { id: string };

/** Deals linked to a contact. Unknown ids give an empty list, as in Apollo. */
const handler = route<Params>(
  async ({ actor, params }) => ({ opportunities: await dealsForContact(actor, params.id) }),
  {
    permission: "deal:read",
    limit: LIMITS.read,
  },
);

export const GET = handler;
export const POST = handler;
