import { pageFrom, pagination, route } from "@/server/http/route";
import { listEnrollments } from "@/server/services/sequences";

export const GET = route<{ id: string }>(
  async ({ req, actor, params }) => {
    const search = Object.fromEntries(req.nextUrl.searchParams);
    const page = pageFrom(search);
    const { enrollments, total } = await listEnrollments(actor, params.id, page, {
      status: search.status || undefined,
      q: search.q || undefined,
    });
    return { enrollments, pagination: pagination(page, total) };
  },
  { permission: "sequence:read" },
);
