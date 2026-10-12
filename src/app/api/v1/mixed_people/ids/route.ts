import { z } from "zod";

import { readJson, route } from "@/server/http/route";
import { contactIdsFor, contactSearchSchema } from "@/server/services/contacts";
import { asObject } from "@/server/services/records";

const options = z.object({
  limit: z.number().int().min(1).max(10_000).default(10_000),
  maxPerCompany: z.number().int().min(1).max(1000).optional(),
});

/** Ids of the people matching the filters, for "select all" (up to 10,000, optionally capped per company). */
export const POST = route(
  async ({ req, actor }) => {
    const body = asObject(await readJson(req));
    const { limit, maxPerCompany, ...filters } = body;
    const opts = options.parse({ limit, maxPerCompany });
    return contactIdsFor(actor, contactSearchSchema.parse(filters), opts);
  },
  { permission: "search:run" },
);
