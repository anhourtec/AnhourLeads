import { pageFrom, route } from "@/server/http/route";
import { activityQuerySchema, contactActivities } from "@/server/services/activities";
import { queryObject } from "@/server/services/records";

/** A person's activity timeline, newest first. Optional `type` (one or many) narrows it. */
export const GET = route<{ id: string }>(
  async ({ req, actor, params }) => {
    const query = queryObject(req.url);
    const { type } = activityQuerySchema.parse(query);
    return contactActivities(actor, params.id, type, pageFrom(query));
  },
  { permission: "contact:read" },
);
