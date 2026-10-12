import { route } from "@/server/http/route";
import { sequenceHealth } from "@/server/services/sequence-insights";

export const GET = route<{ id: string }>(
  async ({ actor, params }) => ({ health: await sequenceHealth(actor, params.id) }),
  {
    permission: "sequence:read",
  },
);
