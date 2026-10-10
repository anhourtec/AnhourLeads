import { route } from "@/server/http/route";
import { contactProvenance } from "@/server/services/contacts";

export const GET = route<{ id: string }>(
  async ({ actor, params }) => ({ provenance: await contactProvenance(actor, params.id) }),
  { permission: "contact:read" },
);
