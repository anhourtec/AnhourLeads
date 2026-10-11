import "server-only";

import { log } from "@/server/log";
import { processDue } from "@/server/services/workflow-runner";

import type { Job } from "./types";

/** Scheduled workflow triggers (enroll matching records when a schedule is due) and resumes after delays. */
export const workflowsJob: Job = {
  name: "workflows",
  everySeconds: 60,
  run: async () => {
    const { enrolled, resumed } = await processDue();
    if (enrolled || resumed) log.info("workflows pass", { component: "workflows", enrolled, resumed });
    return { processed: enrolled + resumed, note: `${enrolled} enrolled by schedules, ${resumed} resumed` };
  },
};
