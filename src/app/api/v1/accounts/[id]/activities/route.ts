import { pageFrom, route } from "@/server/http/route";
import { accountActivities, activityQuerySchema } from "@/server/services/activities";
import { queryObject } from "@/server/services/records";

/** A company's activity timeline (its own rows and its people's), newest first. */
export const GET = route<{ id: string }>(
  async ({ req, actor, params }) => {
    const query = queryObject(req.url);
    const { type } = activityQuerySchema.parse(query);
    return accountActivities(actor, params.id, type, pageFrom(query));
  },
  { permission: "company:read" },
);
