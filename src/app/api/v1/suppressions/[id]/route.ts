import { route } from "@/server/http/route";
import { deleteSuppression } from "@/server/services/suppressions";

export const DELETE = route<{ id: string }>(
  async ({ actor, params }) => {
    await deleteSuppression(actor, params.id);
    return { deleted: true, id: params.id };
  },
  { permission: "suppression:delete" },
);
