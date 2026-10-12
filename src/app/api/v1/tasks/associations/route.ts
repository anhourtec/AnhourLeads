import { route } from "@/server/http/route";
import { associationQuerySchema, searchAssociations } from "@/server/services/tasks";

/** Contacts and companies matching `q`, for "Associated with" in the new-task form. */
export const GET = route(
  async ({ req, actor }) => {
    const { q } = associationQuerySchema.parse({ q: req.nextUrl.searchParams.get("q") ?? undefined });
    return { associations: await searchAssociations(actor, q) };
  },
  { permission: "task:read" },
);
