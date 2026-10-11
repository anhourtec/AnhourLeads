import { readJson, route } from "@/server/http/route";
import { previewForContact } from "@/server/services/sequence-drafts";

/** Render a subject and body for one contact (`contactId`, `subject`, `body`). */
export const POST = route<{ id: string }>(
  async ({ req, actor, params }) => ({ preview: await previewForContact(actor, params.id, await readJson(req)) }),
  { permission: "sequence:read" },
);
