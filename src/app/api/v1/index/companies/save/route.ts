import { LIMITS } from "@/server/http/rate-limit";
import { readJson, route } from "@/server/http/route";
import { saveIndexCompanies, saveInput } from "@/server/services/discovery";

/** Copy index companies into this workspace (deduplicated by domain, with provenance). */
export const POST = route(
  async ({ req, actor }) => {
    const { ids } = saveInput.parse(await readJson(req));
    return saveIndexCompanies(actor, ids);
  },
  { permission: "company:create", limit: LIMITS.sensitive },
);
