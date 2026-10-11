import { z } from "zod";

import { readJson, route } from "@/server/http/route";
import { companyIdsFor, companySearchSchema } from "@/server/services/companies";
import { asObject } from "@/server/services/records";

const options = z.object({ limit: z.number().int().min(1).max(10_000).default(10_000) });

/** Ids of the companies matching the filters, for "select all" (up to 10,000). */
export const POST = route(
  async ({ req, actor }) => {
    const body = asObject(await readJson(req));
    const { limit, ...filters } = body;
    return companyIdsFor(actor, companySearchSchema.parse(filters), options.parse({ limit }));
  },
  { permission: "search:run" },
);
