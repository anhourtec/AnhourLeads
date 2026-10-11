import { route } from "@/server/http/route";
import { apolloStageList } from "@/server/services/record-stages";

/** The workspace's contact stages with its own display names (settings → contact stages). */
export const GET = route(
  async ({ actor }) => ({ contact_stages: await apolloStageList(actor.organizationId, "contact") }),
  {
    permission: "contact:read",
  },
);
