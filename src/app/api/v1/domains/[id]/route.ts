import { route } from "@/server/http/route";
import { removeDomain } from "@/server/services/domains";

/** Remove a hostname. It stops serving on the next request. */
export const DELETE = route<{ id: string }>(async ({ actor, params }) => removeDomain(actor, params.id), {
  permission: "domain:manage",
});
