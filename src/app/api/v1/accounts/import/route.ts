import { LIMITS } from "@/server/http/rate-limit";
import { route } from "@/server/http/route";
import { importCompaniesCsv } from "@/server/services/imports";
import { readImport } from "@/server/services/records";

/** CSV import of accounts. Dedupes by domain (or exact name without one); same settings as the contacts import. */
export const POST = route(async ({ req, actor }) => importCompaniesCsv(actor, await readImport(req)), {
  permission: "company:import",
  limit: LIMITS.sensitive,
});
