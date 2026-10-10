import { route } from "@/server/http/route";
import { listWorkspaces, requirePlatformAdmin } from "@/server/services/platform";

/** Every workspace on this installation, with member counts and hostnames. Platform administrators only. */
export const GET = route(async ({ actor }) => {
  requirePlatformAdmin(actor);
  return { workspaces: await listWorkspaces() };
});
