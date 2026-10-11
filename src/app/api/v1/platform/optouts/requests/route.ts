import { listRemovalRequests } from "@/server/discovery/removal";
import { route } from "@/server/http/route";
import { requirePlatformAdmin } from "@/server/services/platform";

/** Removal requests waiting for their email link or DNS record. Platform administrators only. */
export const GET = route(async ({ actor }) => {
  requirePlatformAdmin(actor);
  return { requests: await listRemovalRequests() };
});
