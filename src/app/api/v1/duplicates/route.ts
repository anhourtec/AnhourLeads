import { route } from "@/server/http/route";
import { findDuplicates } from "@/server/services/data-health";

/** Duplicate groups: contacts with the same email or name at the same company, companies with the same domain or name. */
export const GET = route(async ({ actor }) => ({ duplicates: await findDuplicates(actor) }), {
  permission: "contact:read",
});
