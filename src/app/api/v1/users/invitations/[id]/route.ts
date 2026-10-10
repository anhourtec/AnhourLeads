import { route } from "@/server/http/route";
import { cancelInvitation } from "@/server/services/members";

export const DELETE = route<{ id: string }>(
  async ({ actor, params }) => {
    await cancelInvitation(actor, params.id);
    return { canceled: true, id: params.id };
  },
  { permission: "member:invite" },
);
