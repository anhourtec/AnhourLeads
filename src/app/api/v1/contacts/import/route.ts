import { LIMITS } from "@/server/http/rate-limit";
import { route } from "@/server/http/route";
import { importContacts } from "@/server/services/contacts";
import { readImport } from "@/server/services/records";

/** CSV import (multipart `file`, JSON `{ csv }` or a text/csv body). Dedupes by email. */
export const POST = route(async ({ req, actor }) => importContacts(actor, await readImport(req)), {
  permission: "contact:import",
  limit: LIMITS.sensitive,
});
