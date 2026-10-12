import { pageFrom, readJson, route } from "@/server/http/route";
import { companySearchSchema, fromApolloCompanySearch, searchCompanies } from "@/server/services/companies";
import { asObject } from "@/server/services/records";

export const POST = route(
  async ({ req, actor }) => {
    const body = asObject(await readJson(req));
    return searchCompanies(actor, companySearchSchema.parse(fromApolloCompanySearch(body)), pageFrom(body));
  },
  { permission: "company:read" },
);
