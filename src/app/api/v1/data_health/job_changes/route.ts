import { route } from "@/server/http/route";
import { findJobChanges } from "@/server/services/data-health";

/** Contacts who may have changed jobs (bouncing email, missing from the company's crawled team page). */
export const GET = route(async ({ actor }) => ({ job_changes: await findJobChanges(actor) }), {
  permission: "contact:read",
});
