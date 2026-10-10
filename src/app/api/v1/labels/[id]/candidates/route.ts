import { z } from "zod";

import { route } from "@/server/http/route";
import { listCandidates } from "@/server/services/lists";

const query = z.object({ q: z.string().trim().max(200).default("") });

/** Records not yet in a static list that match `q`, for the add-members picker. */
export const GET = route<{ id: string }>(
  async ({ req, actor, params }) => {
    const { q } = query.parse({ q: req.nextUrl.searchParams.get("q") ?? undefined });
    return listCandidates(actor, params.id, q);
  },
  { permission: "list:update" },
);
