import { after } from "next/server";

import { readJson, route } from "@/server/http/route";
import { recordEvent } from "@/server/services/events";
import { addMembers } from "@/server/services/lists";

/** Add contacts or companies (matching the list's record type) to a static list, by list id. */
export const POST = route(
  async ({ req, actor }) => {
    const { addedIds, ...result } = await addMembers(actor, await readJson(req));
    if (result.list.entityType === "contact" && addedIds.length) {
      const event = (contactId: string) =>
        recordEvent({
          organizationId: actor.organizationId,
          type: "contact_added_to_list",
          summary: `Added to list ${result.list.name}`,
          contactId,
          actorUserId: actor.userId,
          metadata: { listId: result.list.id, listName: result.list.name },
        });
      // Small batches land on the timeline before the response; big ones right after it.
      if (addedIds.length <= 25) for (const id of addedIds) await event(id);
      else
        after(async () => {
          for (const id of addedIds) await event(id);
        });
    }
    return result;
  },
  { permission: "list:update" },
);
