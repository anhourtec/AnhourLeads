import { pageFrom, pagination, readJson, route } from "@/server/http/route";
import { indexCompanySearchInput, indexSegmentCounts, searchIndexCompanies } from "@/server/services/discovery";
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
    const [result, counts] = await Promise.all([
      searchIndexCompanies(actor, filters, page),
      includeCounts === true ? indexSegmentCounts(actor, "company", filters) : Promise.resolve(null),
    ]);
    return {
      companies: result.companies,
      pagination: pagination(page, result.total),
      ...(counts ? { counts } : {}),
    };
  },
  { permission: "search:run" },
);
