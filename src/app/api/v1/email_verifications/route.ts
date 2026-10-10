import { LIMITS } from "@/server/http/rate-limit";
import { readJson, route } from "@/server/http/route";
import { emailVerificationInput, runEmailVerification } from "@/server/services/enrichment";

/**
 * Verify an address (`email`) or a contact's address (`contactId`, which also updates the contact's
 * status with provenance). Results are cached per address for 7 days.
 */
export const POST = route(
  async ({ req, actor }) => {
    const input = emailVerificationInput.parse(await readJson(req));
    return { verification: await runEmailVerification(actor, input) };
  },
  { permission: "enrich:run", limit: LIMITS.sensitive },
);
