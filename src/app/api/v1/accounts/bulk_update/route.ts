import { readJson, route } from "@/server/http/route";
import { bulkUpdateCompanies, companyBulkUpdateSchema } from "@/server/services/companies";

/** Apply the same values to up to 1,000 accounts. */
export const POST = route(
  async ({ req, actor }) => {
    const { accountIds, ...fields } = companyBulkUpdateSchema.parse(await readJson(req));
    return bulkUpdateCompanies(actor, accountIds, fields);
  },
  { permission: "company:update" },
);
