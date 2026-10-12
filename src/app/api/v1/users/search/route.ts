import { pageFrom, pagination, route } from "@/server/http/route";
import { memberSearchSchema, searchMembers } from "@/server/services/members";

/** Workspace members (Apollo "users"). Filters: q, role. */
export const GET = route(
  async ({ req, actor }) => {
    const query = Object.fromEntries(req.nextUrl.searchParams);
    const page = pageFrom(query);
    const { users, total } = await searchMembers(actor, memberSearchSchema.parse(query), page);
    return { users, pagination: pagination(page, total) };
  },
  { permission: "member:read" },
);
