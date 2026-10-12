import { readJson, route } from "@/server/http/route";
import { changeRole, removeMember, roleChangeSchema } from "@/server/services/members";

type Params = { userId: string };

/** Change a member's role. Guard rails live in the service. */
export const PATCH = route<Params>(
  async ({ req, actor, params }) => {
    const { role } = roleChangeSchema.parse(await readJson(req));
    return { user: await changeRole(actor, params.userId, role) };
  },
  { permission: "member:update" },
);

export const DELETE = route<Params>(
  async ({ actor, params }) => {
    await removeMember(actor, params.userId);
    return { removed: true, id: params.userId };
  },
  { permission: "member:remove" },
);
