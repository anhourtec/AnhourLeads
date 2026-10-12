import { pageFrom, pagination, readJson, route } from "@/server/http/route";
import { indexCompanySearchInput, searchIndexCompanies } from "@/server/services/discovery";
import { asObject } from "@/server/services/records";

/**
 * Companies in the installation-wide discovery index. `includeCounts: true` adds
 * Total / Net new / Saved counts for this workspace. Opted-out domains never appear.
 */
export const POST = route(
  async ({ req, actor }) => {
    const { includeCounts, ...body } = asObject(await readJson(req));
    const filters = indexCompanySearchInput.parse(body);
    const page = pageFrom(body);
    const result = await searchIndexCompanies(actor, filters, page);
    const one = { perPage: 1, offset: 0 };
    const counts =
      includeCounts === true
        ? {
            counts: {
              total: (await searchIndexCompanies(actor, { ...filters, segment: "total" }, one)).total,
              net_new: (await searchIndexCompanies(actor, { ...filters, segment: "net_new" }, one)).total,
              saved: (await searchIndexCompanies(actor, { ...filters, segment: "saved" }, one)).total,
            },
          }
        : {};
    return { companies: result.companies, pagination: pagination(page, result.total), ...counts };
  },
  { permission: "search:run" },
);
