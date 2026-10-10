import { notFound } from "next/navigation";

import type { Metadata } from "next";

import { can } from "@/lib/rbac/permissions";
import { getAppContext } from "@/server/auth/context";
import { HttpError } from "@/server/http/errors";
import { log } from "@/server/log";
import { type CrawlJobDetail, getCrawlJob } from "@/server/services/research";

import { researchActor } from "../_components/actor";
import { CrawlJobView } from "../_components/crawl-job-view";
import { ResearchError } from "../_components/research-error";

export const metadata: Metadata = { title: "Crawl job" };

export default async function CrawlJobPage({ params }: PageProps<"/dashboard/research/[id]">) {
  const { id } = await params;
  const context = await getAppContext();
  const actor = researchActor(context);
  if (!actor || !can(actor.role, "crawler:read")) notFound();

  let detail: CrawlJobDetail;
  try {
    detail = await getCrawlJob(actor, id);
  } catch (error) {
    if (error instanceof HttpError && error.status === 404) notFound();
    log.error("crawl job failed to load", { component: "research", error });
    return <ResearchError />;
  }

  return (
    <CrawlJobView
      detail={detail}
      canApply={can(actor.role, "company:update")}
      canCreateContacts={can(actor.role, "contact:create")}
    />
  );
}
