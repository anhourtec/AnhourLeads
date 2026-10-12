import { removeOptout } from "@/server/discovery/optouts";
import { notFound } from "@/server/http/errors";
import { route } from "@/server/http/route";
import { audit } from "@/server/services/audit";
import { requirePlatformAdmin } from "@/server/services/platform";

/** Remove an opt-out (the crawler may index that domain, address or person again). Platform administrators only. */
export const DELETE = route<{ id: string }>(async ({ actor, params }) => {
  requirePlatformAdmin(actor);
  const removed = await removeOptout(params.id);
  if (!removed) throw notFound("Opt-out not found.");
  await audit(actor, "discovery.optout.delete", "index_optout", removed.id, { kind: removed.kind });
  return { optout: removed, deleted: true };
});
