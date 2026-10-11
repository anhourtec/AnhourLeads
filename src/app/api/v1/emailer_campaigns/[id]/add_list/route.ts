import { z } from "zod";

import { readJson, route } from "@/server/http/route";
import { enrollContacts, listContactIds } from "@/server/services/sequences";

const body = z.object({ listId: z.string().min(1).max(100) }).strict();

/** Enroll every contact in a contact list (up to 1,000), with the same skip rules as add_contact_ids. */
export const POST = route<{ id: string }>(
  async ({ req, actor, params }) => {
    const { listId } = body.parse(await readJson(req));
    const ids = await listContactIds(actor, listId);
    if (!ids.length) return { enrolled_contact_ids: [], skipped: [] };
    const result = await enrollContacts(actor, params.id, { contactIds: ids });
    return { enrolled_contact_ids: result.enrolled, skipped: result.skipped };
  },
  { permission: "sequence:launch" },
);
