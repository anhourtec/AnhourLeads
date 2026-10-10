import { getAppContext } from "@/server/auth/context";
import { orNotFound } from "@/server/services/engage-context";
import { jobRow } from "@/server/services/research";

import { researchActor } from "../_components/actor";

/** Check the crawl job exists outside the loading boundary, so a missing or out-of-scope id gets a real 404 status. */
export default async function CrawlJobLayout({ children, params }: LayoutProps<"/dashboard/research/[id]">) {
  const actor = researchActor(await getAppContext());
  // The parent research layout already 404s without a workspace or `crawler:read`.
  if (actor) await orNotFound(jobRow(actor, (await params).id));
  return children;
}
