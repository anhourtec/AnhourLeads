import { route } from "@/server/http/route";
import { sequenceActivity } from "@/server/services/sequence-insights";

export const GET = route<{ id: string }>(
  async ({ req, actor, params }) => ({
    activities: await sequenceActivity(actor, params.id, Number(req.nextUrl.searchParams.get("limit") ?? 100) || 100),
  }),
  { permission: "sequence:read" },
);
