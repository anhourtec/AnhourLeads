import { z } from "zod";

import { route } from "@/server/http/route";
import { enrollmentCandidates } from "@/server/services/sequences";

const query = z.object({ q: z.string().trim().max(200).default("") });

/** Contacts not yet in this sequence that match `q`, for the add-people picker. */
export const GET = route<{ id: string }>(
  async ({ req, actor, params }) => {
    const { q } = query.parse({ q: req.nextUrl.searchParams.get("q") ?? undefined });
    return { contacts: await enrollmentCandidates(actor, params.id, q) };
  },
  { permission: "sequence:launch" },
);
