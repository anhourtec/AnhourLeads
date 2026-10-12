import { route } from "@/server/http/route";
import { verifyDomain } from "@/server/services/domains";

/** "Verify now": look for the TXT record. At most once per 10 seconds per hostname (429 otherwise). */
export const POST = route<{ id: string }>(async ({ actor, params }) => verifyDomain(actor, params.id), {
  permission: "domain:manage",
});
