import { readJson, route } from "@/server/http/route";
import { bulkCreateCompanies, companyBulkCreateSchema } from "@/server/services/companies";

/** Up to 100 accounts; existing ones (same domain) are returned untouched in `existing_accounts`. */
export const POST = route(
  async ({ req, actor }) => {
    const body = companyBulkCreateSchema.parse(await readJson(req));
    return bulkCreateCompanies(actor, body.accounts);
  },
  { permission: "company:create" },
);
