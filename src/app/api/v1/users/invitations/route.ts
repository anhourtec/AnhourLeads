import { route } from "@/server/http/route";
import { listInvitations } from "@/server/services/members";

/** Pending, unexpired invitations. */
export const GET = route(async ({ actor }) => ({ invitations: await listInvitations(actor) }), {
  permission: "member:invite",
});
