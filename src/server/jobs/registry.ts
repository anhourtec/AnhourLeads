import "server-only";

import { crawlJob } from "./crawl";
import { domainsJob } from "./domains";
import { sequencesJob } from "./sequences";
import type { Job } from "./types";

/** Every scheduled job. The scheduler container runs each on its own interval. */
export const JOBS: Job[] = [domainsJob, crawlJob, sequencesJob];
