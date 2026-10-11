import { LIMITS } from "@/server/http/rate-limit";
import { route } from "@/server/http/route";
import { importContactsCsv } from "@/server/services/imports";
import { readImport } from "@/server/services/records";

/**
 * CSV import (multipart `file` + optional `mapping` / `settings` JSON fields, JSON `{ csv, mapping?, settings? }`
 * or a text/csv body). Dedupes by email; settings choose the stage, update or skip existing people,
 * account auto-assignment, a target list and enrichment after the import.
 */
export const POST = route(async ({ req, actor }) => importContactsCsv(actor, await readImport(req)), {
  permission: "contact:import",
  limit: LIMITS.sensitive,
});
