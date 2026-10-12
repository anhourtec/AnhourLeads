import "server-only";

import { crawlJob } from "./crawl";
import { discoveryJob } from "./discovery";
import { domainsJob } from "./domains";
import { enrichmentJob } from "./enrichment";
import { sequencesJob } from "./sequences";
import type { Job } from "./types";
import { workflowsJob } from "./workflows";

/** Every scheduled job. The scheduler container runs each on its own interval. */
export const JOBS: Job[] = [domainsJob, crawlJob, sequencesJob, workflowsJob, enrichmentJob, discoveryJob];
