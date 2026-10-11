import { readJson, route } from "@/server/http/route";
import { activeJobs, automationInput, getAutomation, saveAutomation } from "@/server/services/enrichment-jobs";

/** The workspace's enrichment schedule and the jobs queued or running now. */
export const GET = route(
  async ({ actor }) => ({ automation: await getAutomation(actor), active_jobs: await activeJobs(actor) }),
  { permission: "contact:read" },
);

/** Save the schedule: re-verify emails older than N days and re-crawl companies older than N days, every N days. */
export const PUT = route(
  async ({ req, actor }) => ({ automation: await saveAutomation(actor, automationInput.parse(await readJson(req))) }),
  { permission: "enrich:run" },
);
