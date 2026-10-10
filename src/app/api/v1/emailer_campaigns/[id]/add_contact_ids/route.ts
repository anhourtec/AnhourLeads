import { readJson, route } from "@/server/http/route";
import { enrollContacts } from "@/server/services/sequences";

/**
 * Enroll contacts. Each id is either enrolled or skipped with a reason: not found, no email,
 * suppressed email or domain, invalid or disposable email, do-not-contact stage, already enrolled.
 */
export const POST = route<{ id: string }>(
  async ({ req, actor, params }) => {
    const result = await enrollContacts(actor, params.id, await readJson(req));
    return { enrolled_contact_ids: result.enrolled, skipped: result.skipped };
  },
  { permission: "sequence:launch" },
);
