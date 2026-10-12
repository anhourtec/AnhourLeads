import { frontierQuery, listFrontier } from "@/server/discovery/admin";
import { pageFrom, pagination, route } from "@/server/http/route";
import { requirePlatformAdmin } from "@/server/services/platform";
import { queryObject } from "@/server/services/records";

/** The crawl queue, filterable by status, kind, host and URL text. Platform administrators only. */
export const GET = route(async ({ req, actor }) => {
  requirePlatformAdmin(actor);
  const query = queryObject(req.url);
  const page = pageFrom(query);
  const { rows, total } = await listFrontier(frontierQuery.parse(query), page);
  return { frontier: rows, pagination: pagination(page, total) };
});
