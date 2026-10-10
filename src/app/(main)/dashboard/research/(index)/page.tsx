import { notFound } from "next/navigation";

import { asc, eq } from "drizzle-orm";
import type { Metadata } from "next";

import { can } from "@/lib/rbac/permissions";
import { getAppContext } from "@/server/auth/context";
import { db, schema } from "@/server/db";
import { pageFrom } from "@/server/http/route";
import { log } from "@/server/log";
import { listCrawlJobs } from "@/server/services/research";

import { researchActor } from "../_components/actor";
import { ResearchError } from "../_components/research-error";
import { ResearchWorkspace } from "../_components/research-workspace";

export const metadata: Metadata = { title: "Research" };

export default async function ResearchPage() {
  const context = await getAppContext();
  const actor = researchActor(context);
  if (!actor || !can(actor.role, "crawler:read")) notFound();
  const canRun = can(actor.role, "crawler:run");

  const loaded = await Promise.all([
    listCrawlJobs(actor, pageFrom({ per_page: 25 })),
    canRun && can(actor.role, "company:read")
      ? db
          .select({ id: schema.company.id, name: schema.company.name, domain: schema.company.domain })
          .from(schema.company)
          .where(eq(schema.company.organizationId, actor.organizationId))
          .orderBy(asc(schema.company.name))
          .limit(500)
      : Promise.resolve([]),
  ]).catch((error: unknown) => {
    log.error("research failed to load", { component: "research", error });
    return null;
  });
  if (!loaded) return <ResearchError />;
  const [{ jobs, total }, companies] = loaded;

  return (
    <ResearchWorkspace
      initialJobs={jobs}
      total={total}
      companies={companies}
      canRun={canRun}
      canVerify={can(actor.role, "enrich:run")}
    />
  );
}
