import { pageFrom, pagination, route } from "@/server/http/route";
import { listRuns } from "@/server/services/workflows";

type Params = { id: string };

export const GET = route<Params>(
  async ({ req, actor, params }) => {
    const page = pageFrom(Object.fromEntries(req.nextUrl.searchParams));
    const { runs, total } = await listRuns(actor, params.id, page);
    return { runs, pagination: pagination(page, total) };
  },
  { permission: "workflow:read" },
);
