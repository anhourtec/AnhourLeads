import { setHostBlocked } from "@/server/discovery/admin";
import { route } from "@/server/http/route";
import { audit } from "@/server/services/audit";
import { requirePlatformAdmin } from "@/server/services/platform";

/** Resume crawling a host and reset its error count. Platform administrators only. */
export const POST = route<{ host: string }>(async ({ actor, params }) => {
  requirePlatformAdmin(actor);
  const host = await setHostBlocked(decodeURIComponent(params.host), false);
  await audit(actor, "discovery.host.unblock", "crawl_host", host.host);
  return { host };
});
