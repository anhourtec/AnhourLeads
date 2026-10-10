import { LIMITS } from "@/server/http/rate-limit";
import { route } from "@/server/http/route";
import { importCompanies } from "@/server/services/companies";
import { readImport } from "@/server/services/records";

/** CSV import (multipart `file`, JSON `{ csv }` or a text/csv body). Dedupes by domain, then exact name. */
export const POST = route(async ({ req, actor }) => importCompanies(actor, await readImport(req)), {
  permission: "company:import",
  limit: LIMITS.sensitive,
});
