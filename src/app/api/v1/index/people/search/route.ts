import { pageFrom, pagination, readJson, route } from "@/server/http/route";
import { indexPeopleSearchInput, indexSegmentCounts, searchIndexPeople } from "@/server/services/discovery";
import { asObject } from "@/server/services/records";

/**
 * People in the installation-wide discovery index (built from public company websites). Same
 * filter keys as workspace people search where they apply; `includeCounts: true` adds
 * Total / Net new / Saved counts for this workspace. Opted-out people and domains never appear.
 */
export const POST = route(
  async ({ req, actor }) => {
    const { includeCounts, ...body } = asObject(await readJson(req));
    const filters = indexPeopleSearchInput.parse(body);
    const page = pageFrom(body);
    const [result, counts] = await Promise.all([
      searchIndexPeople(actor, filters, page),
      includeCounts === true ? indexSegmentCounts(actor, "contact", filters) : Promise.resolve(null),
    ]);
    return { people: result.people, pagination: pagination(page, result.total), ...(counts ? { counts } : {}) };
  },
  { permission: "search:run" },
);
