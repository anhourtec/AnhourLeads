import { route } from "@/server/http/route";
import { apolloStageList } from "@/server/services/record-stages";

/** The workspace's account stages with its own display names (settings → contact stages → account stages). */
export const GET = route(
  async ({ actor }) => ({ account_stages: await apolloStageList(actor.organizationId, "company") }),
  {
    permission: "company:read",
  },
);
