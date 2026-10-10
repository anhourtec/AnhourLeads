import { readJson, route } from "@/server/http/route";
import { bulkDeleteCompanies, companyBulkDeleteSchema } from "@/server/services/companies";

export const POST = route(
  async ({ req, actor }) => {
    const { accountIds } = companyBulkDeleteSchema.parse(await readJson(req));
    return bulkDeleteCompanies(actor, accountIds);
  },
  { permission: "company:delete" },
);
