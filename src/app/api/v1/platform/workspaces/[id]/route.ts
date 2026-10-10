import { readJson, route } from "@/server/http/route";
import { requirePlatformAdmin, setHostnameLimit, workspaceLimitInput } from "@/server/services/platform";

/** Set a workspace's custom hostname limit (0–50). Platform administrators only. */
export const PATCH = route<{ id: string }>(async ({ req, actor, params }) => {
  requirePlatformAdmin(actor);
  const { hostnameLimit } = workspaceLimitInput.parse(await readJson(req));
  return { workspace: await setHostnameLimit(actor, params.id, hostnameLimit) };
});
