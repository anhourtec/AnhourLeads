import { readJson, route } from "@/server/http/route";
import { applyCrawlJob, applyCrawlJobInput } from "@/server/services/research";

/**
 * Apply a completed crawl's findings to its company (creating the company if needed), writing
 * provenance for every value. `createContacts: true` also adds the people found (needs contact:create).
 */
export const POST = route<{ id: string }>(
  async ({ req, actor, params }) => {
    const input = applyCrawlJobInput.parse(await readJson(req));
    return applyCrawlJob(actor, params.id, input);
  },
  { permission: "company:update" },
);
