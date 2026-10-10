import { route } from "@/server/http/route";
import { companyProvenance } from "@/server/services/companies";

export const GET = route<{ id: string }>(
  async ({ actor, params }) => ({ provenance: await companyProvenance(actor, params.id) }),
  { permission: "company:read" },
);
