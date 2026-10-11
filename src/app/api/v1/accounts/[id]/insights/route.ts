import { route } from "@/server/http/route";
import { companyInsights } from "@/server/services/company-insights";

/** Lists, people locations and crawler-suggested people for one account. */
export const GET = route<{ id: string }>(async ({ actor, params }) => companyInsights(actor, params.id), {
  permission: "company:read",
});
