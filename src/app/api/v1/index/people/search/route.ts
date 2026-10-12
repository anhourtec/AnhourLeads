import { pageFrom, pagination, readJson, route } from "@/server/http/route";
import { indexPeopleSearchInput, searchIndexPeople } from "@/server/services/discovery";
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
    const result = await searchIndexPeople(actor, filters, page);
    const counts =
      includeCounts === true
        ? {
            counts: {
              total: (await searchIndexPeople(actor, { ...filters, segment: "total" }, { perPage: 1, offset: 0 }))
                .total,
              net_new: (await searchIndexPeople(actor, { ...filters, segment: "net_new" }, { perPage: 1, offset: 0 }))
                .total,
              saved: (await searchIndexPeople(actor, { ...filters, segment: "saved" }, { perPage: 1, offset: 0 }))
                .total,
            },
          }
        : {};
    return { people: result.people, pagination: pagination(page, result.total), ...counts };
  },
  { permission: "search:run" },
);
