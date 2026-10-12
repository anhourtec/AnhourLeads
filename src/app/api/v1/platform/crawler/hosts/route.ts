import { hostsQuery, listHosts } from "@/server/discovery/admin";
import { pageFrom, pagination, route } from "@/server/http/route";
import { requirePlatformAdmin } from "@/server/services/platform";
import { queryObject } from "@/server/services/records";

/** Crawled hosts with politeness state (delay, errors, blocked). `state=blocked|backoff` filters. */
export const GET = route(async ({ req, actor }) => {
  requirePlatformAdmin(actor);
  const query = queryObject(req.url);
  const page = pageFrom(query);
  const { hosts, total } = await listHosts(hostsQuery.parse(query), page);
  return { hosts, pagination: pagination(page, total) };
});
