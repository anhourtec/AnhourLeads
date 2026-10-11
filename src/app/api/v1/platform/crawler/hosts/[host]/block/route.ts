import { z } from "zod";

import { setHostBlocked } from "@/server/discovery/admin";
import { readJson, route } from "@/server/http/route";
import { audit } from "@/server/services/audit";
import { requirePlatformAdmin } from "@/server/services/platform";

const input = z.strictObject({ reason: z.string().trim().max(300).optional() });

/** Stop crawling a host (its queued URLs stay queued until it is unblocked). Platform administrators only. */
export const POST = route<{ host: string }>(async ({ req, actor, params }) => {
  requirePlatformAdmin(actor);
  const { reason } = input.parse(await readJson(req));
  const host = await setHostBlocked(decodeURIComponent(params.host), true, reason ?? null);
  await audit(actor, "discovery.host.block", "crawl_host", host.host);
  return { host };
});
