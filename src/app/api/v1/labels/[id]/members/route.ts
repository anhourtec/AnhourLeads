import { z } from "zod";

import { pageFrom, pagination, route } from "@/server/http/route";
import { listMembers } from "@/server/services/lists";

const query = z.object({ q: z.string().trim().max(200).optional() });

/** Paginated members: `contacts` for contact lists, `accounts` for company lists. Dynamic lists resolve their filters. */
export const GET = route<{ id: string }>(
  async ({ req, actor, params }) => {
    const search = Object.fromEntries(req.nextUrl.searchParams);
    const page = pageFrom(search);
    const { q } = query.parse({ q: search.q });
    const result = await listMembers(actor, params.id, page, q);
    return { ...result, pagination: pagination(page, result.total) };
  },
  { permission: "list:read" },
);
