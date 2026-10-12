import { route } from "@/server/http/route";
import { sequenceStats } from "@/server/services/sequences";

export const GET = route<{ id: string }>(
  async ({ actor, params }) => ({ stats: await sequenceStats(actor, params.id) }),
  {
    permission: "sequence:read",
  },
);
