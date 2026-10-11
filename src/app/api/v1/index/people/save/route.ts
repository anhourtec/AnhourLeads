import { LIMITS } from "@/server/http/rate-limit";
import { readJson, route } from "@/server/http/route";
import { saveIndexPeople, saveInput } from "@/server/services/discovery";

/**
 * Copy index people into this workspace as contacts (source "discovery_index", provenance with the
 * page each came from). Existing contacts (same address, or same name at the same company) are
 * reported, not duplicated; do-not-contact and opted-out people are skipped. Creates the company
 * too when the role may create companies.
 */
export const POST = route(
  async ({ req, actor }) => {
    const { ids } = saveInput.parse(await readJson(req));
    return saveIndexPeople(actor, ids);
  },
  { permission: "contact:create", limit: LIMITS.sensitive },
);
