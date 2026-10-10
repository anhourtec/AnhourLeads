import { readJson, route } from "@/server/http/route";
import { bulkUpdateCompanies, companyOwnersSchema } from "@/server/services/companies";

export const POST = route(
  async ({ req, actor }) => {
    const { accountIds, ownerId } = companyOwnersSchema.parse(await readJson(req));
    return bulkUpdateCompanies(actor, accountIds, { ownerId }, "company.update_owners");
  },
  { permission: "company:update" },
);
