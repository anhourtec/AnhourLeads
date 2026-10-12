import { pageFrom, pagination, route } from "@/server/http/route";
import { listEnrollments } from "@/server/services/sequences";

/** Contacts in the sequence. `status` filters (including not_sent); `counts` gives every tab's total. */
export const GET = route<{ id: string }>(
  async ({ req, actor, params }) => {
    const search = Object.fromEntries(req.nextUrl.searchParams);
    const page = pageFrom(search);
    const { enrollments, total, counts } = await listEnrollments(actor, params.id, page, {
      status: search.status || undefined,
      q: search.q || undefined,
    });
    return { enrollments, counts, pagination: pagination(page, total) };
  },
  { permission: "sequence:read" },
);
